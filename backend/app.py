"""
Wahy-Finder v2.0 — FastAPI Backend Server & Global Structured Error Wrapper
File: backend/app.py

Features:
1. Global Exception Handler (@app.exception_handler(Exception)) returning HTTP 500
   with the exact structured JSON diagnostic schema required by Module 2.
2. /api/transcribe endpoint supporting YouTube URLs and local Audio/Video uploads
   with the 3-tier model selection & automatic fallback chain:
   - groq-whisper-large-v3-turbo (Groq Cloud API)
   - local-turbo-int8 (faster-whisper large-v3-turbo int8 ~2.2GB VRAM)
   - local-small-int8 (faster-whisper small int8 ~800MB VRAM)
3. /api/corpus/cache endpoints for optional local disk caching in backend/data_cache/.
4. Serves the Vanilla ES6 Frontend (index.html, /js, /css, /media).
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import traceback
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from media_processor import (
    TEMP_MEDIA_DIR,
    FFmpegProcessingError,
    YtDlpDownloadError,
    check_ffmpeg_available,
    download_youtube_media,
    normalize_audio_streams,
    slice_audio_for_groq,
)
from transcriber import (
    CUDAOutOfMemoryError,
    GroqAPIError,
    LocalWhisperError,
    build_unified_word_schema,
    cleanup_cuda_vram,
    get_vram_allocated_mb,
    transcribe_with_groq_chunks,
    transcribe_with_local_faster_whisper,
)
from progress import clear_control, get_control, get_progress, set_control, set_progress
from corpus_sources import SOURCES as HADITH_SOURCES, CorpusSourceManager
from laya_engine import laya_verifier
from laya_converter import convert_verification_records_to_laya_jsonl

try:
    from backend.tafrigh.pipeline import TafrighPipeline
    from backend.tafrigh.segmenter import SegmentationConfig, segment_transcript
    from backend.tafrigh.schemas import PipelineConfig
    from backend.tafrigh.matn_aligner import MatnConfig
    from backend.tafrigh.outline_repair import run_outline_repair_pass
    from backend.tafrigh.review_queue import ReviewQueueManager
    from backend.tafrigh.run_logger import RunLogger
    from backend.tafrigh.compare_runs import compare_run_dirs
    from backend.tafrigh.renderer import (
        RenderConfig,
        render_to_html,
        render_to_markdown,
        render_to_structured_json,
    )
    from backend.tafrigh.training_store import CanonicalTrainingRecord, TrainingStore
    from backend.tafrigh.laya_export import build_examples as build_laya_examples, save_run as save_laya_run
    from backend.tafrigh.models import (
        CommentKind,
        LectureSpan,
        OutlineState,
        SourcePosition,
        StructuralTag,
        TranscriptSegment,
    )
    from backend.tafrigh.adapters.gemini_adapter import GeminiAdapter, GeminiAPIError, list_gemini_models, pick_model
    from backend.tafrigh.adapters.errors import ModelAPIError, redact_secrets
    from backend.tafrigh.pipeline import TafrighModelError
    from backend.tafrigh.adapters.jev_adapter import JEVAdapter, JEVRequestConfig
except ImportError:
    from tafrigh.pipeline import TafrighPipeline
    from tafrigh.segmenter import SegmentationConfig, segment_transcript
    from tafrigh.schemas import PipelineConfig
    from tafrigh.matn_aligner import MatnConfig
    from tafrigh.outline_repair import run_outline_repair_pass
    from tafrigh.review_queue import ReviewQueueManager
    from tafrigh.run_logger import RunLogger
    from tafrigh.compare_runs import compare_run_dirs
    from tafrigh.renderer import (
        RenderConfig,
        render_to_html,
        render_to_markdown,
        render_to_structured_json,
    )
    from tafrigh.training_store import CanonicalTrainingRecord, TrainingStore
    from tafrigh.laya_export import build_examples as build_laya_examples, save_run as save_laya_run
    from tafrigh.models import (
        CommentKind,
        LectureSpan,
        OutlineState,
        SourcePosition,
        StructuralTag,
        TranscriptSegment,
    )
    from tafrigh.adapters.gemini_adapter import GeminiAdapter, GeminiAPIError, list_gemini_models, pick_model
    from tafrigh.adapters.errors import ModelAPIError, redact_secrets
    from tafrigh.pipeline import TafrighModelError
    from tafrigh.adapters.jev_adapter import JEVAdapter, JEVRequestConfig


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_CACHE_DIR = BACKEND_DIR / "data_cache"
DATA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
CORPUS_CACHE_FILE = DATA_CACHE_DIR / "corpus_cache.json"

app = FastAPI(
    title="Wahy-Finder v2.0 Backend API",
    version="2.0.0",
    description="FastAPI + yt-dlp + FFmpeg + Groq/faster-whisper int8 word-timestamp backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def classify_exception_type(exc: Exception) -> str:
    if isinstance(exc, CUDAOutOfMemoryError):
        return "CUDAOutOfMemoryError"
    if isinstance(exc, YtDlpDownloadError):
        return "YtDlpDownloadError"
    if isinstance(exc, GroqAPIError):
        return "GroqAPIError"
    if isinstance(exc, FFmpegProcessingError):
        return "FFmpegProcessingError"
    if isinstance(exc, LocalWhisperError):
        return "LocalWhisperError"
    return exc.__class__.__name__ or "UnhandledBackendException"


@app.exception_handler(Exception)
async def global_diagnostic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Module 2 Global Backend Error Wrapper:
    Never fail silently. Return HTTP 500 with structured JSON diagnostic payload.
    """
    ctx_state = getattr(request.state, "diag_context", {}) or {}
    payload = {
        "error": True,
        "error_type": classify_exception_type(exc),
        "message": redact_secrets(str(exc)) or "حدث خطأ غير متوقع في الخادم الخلفي (FastAPI Backend).",
        "traceback": redact_secrets(traceback.format_exc()),
        "context": {
            "endpoint": str(request.url.path),
            "model_selected": ctx_state.get("model_selected", "unknown"),
            "vram_allocated_mb": get_vram_allocated_mb(),
            "input_source": ctx_state.get("input_source", "unknown"),
        },
    }
    return JSONResponse(status_code=500, content=payload)


@app.get("/api/health")
async def api_health() -> Dict[str, Any]:
    cuda_available = False
    device_name = "CPU Only"
    try:
        import torch  # type: ignore

        cuda_available = bool(torch.cuda.is_available())
        if cuda_available:
            device_name = str(torch.cuda.get_device_name(0))
    except Exception:
        pass

    return {
        "status": "ok",
        "version": "2.0.0",
        "ffmpeg_available": check_ffmpeg_available(),
        "cuda_available": cuda_available,
        "gpu_device": device_name,
        "vram_allocated_mb": get_vram_allocated_mb(),
        "groq_env_key_configured": bool(os.environ.get("GROQ_API_KEY")),
    }


@app.get("/api/transcribe/progress/{job_id}")
def api_transcribe_progress(job_id: str) -> Dict[str, Any]:
    return get_progress(job_id)


# NOTE: plain `def` (not async) so FastAPI runs this blocking pipeline in a worker thread; otherwise the
# event loop would be stuck for the whole transcription and the progress endpoint could not answer.
@app.post("/api/transcribe")
def api_transcribe(
    request: Request,
    job_id: Optional[str] = Form(default=None),
    youtube_url: Optional[str] = Form(default=None),
    model_selected: str = Form(default="groq-whisper-large-v3-turbo"),
    groq_api_key: Optional[str] = Form(default=None),
    auto_fallback: bool = Form(default=True),
    file: Optional[UploadFile] = File(default=None),
) -> Dict[str, Any]:
    """
    Module 3 & Module 4 Unified Media & Word-Timestamp Transcription Pipeline.
    Accepts either a YouTube URL or an uploaded Video/Audio file, normalizes audio,
    and executes word-level transcription with Groq or local faster-whisper (int8).
    """
    input_source_label = (youtube_url or (file.filename if file else "none")).strip()
    request.state.diag_context = {
        "model_selected": model_selected,
        "input_source": input_source_label,
    }

    session_id = uuid.uuid4().hex[:10]
    media_url = ""
    media_title = ""
    source_path: Optional[Path] = None

    if youtube_url and youtube_url.strip():
        set_progress(job_id, "download", 0, "جاري بدء التحميل...")
        yt_info = download_youtube_media(youtube_url.strip(), session_id=session_id, job_id=job_id)
        source_path = yt_info["video_path"]
        media_url = yt_info["media_url"]
        media_title = yt_info["title"]
    elif file is not None and file.filename:
        ext = Path(file.filename).suffix.lower() or ".mp4"
        saved_path = TEMP_MEDIA_DIR / f"upload_{session_id}{ext}"
        with open(saved_path, "wb") as out_fp:
            shutil.copyfileobj(file.file, out_fp)
        source_path = saved_path
        media_url = f"/media/{saved_path.name}"
        media_title = Path(file.filename).stem
    else:
        raise ValueError("يرجى تقديم رابط يوتيوب صالح أو رفع ملف فيديو/صوت للتفريغ.")

    set_progress(job_id, "audio", None, "جاري استخراج الصوت وتجهيزه...")
    norm_info = normalize_audio_streams(source_path, session_id=session_id)
    wav_path: Path = norm_info["wav_path"]
    mp3_path: Path = norm_info["mp3_path"]
    duration_sec: float = float(norm_info["duration_sec"] or 0.0)

    raw_words = []
    actual_model_used = model_selected
    set_progress(job_id, "transcribe", 0, "جاري التفريغ الصوتي...")

    def on_chunk_done(done: int, total: int) -> None:
        set_progress(job_id, "transcribe", 100 * done / max(1, total), f"التفريغ: المقطع {done} من {total}")

    def on_segment(end_sec: float) -> None:
        pct = 100 * end_sec / duration_sec if duration_sec else None
        set_progress(job_id, "transcribe", pct, "التفريغ المحلي بالبطاقة الرسومية...")

    # Execution + Fallback Chain:
    # 1. Groq Cloud API (whisper-large-v3-turbo)
    # 2. Local GPU - Turbo (faster-whisper large-v3-turbo int8)
    # 3. Local GPU - Small (faster-whisper small int8)
    if model_selected == "groq-whisper-large-v3-turbo":
        try:
            chunks = slice_audio_for_groq(mp3_path, duration_sec=duration_sec)
            raw_words = transcribe_with_groq_chunks(
                chunks=chunks,
                api_key=groq_api_key or "",
                model_name="whisper-large-v3-turbo",
                on_chunk_done=on_chunk_done,
            )
            actual_model_used = "groq:whisper-large-v3-turbo"
        except Exception as groq_exc:
            if not auto_fallback:
                raise
            # Fallback to local GPU Turbo -> Small
            try:
                request.state.diag_context["model_selected"] = "faster-whisper-large-v3-turbo-int8"
                raw_words = transcribe_with_local_faster_whisper(
                    wav_path=wav_path, model_size="large-v3-turbo", on_segment=on_segment
                )
                actual_model_used = "local:faster-whisper-large-v3-turbo-int8"
            except CUDAOutOfMemoryError:
                request.state.diag_context["model_selected"] = "faster-whisper-small-int8"
                raw_words = transcribe_with_local_faster_whisper(
                    wav_path=wav_path, model_size="small", on_segment=on_segment
                )
                actual_model_used = "local:faster-whisper-small-int8"
            except Exception:
                raise groq_exc

    elif model_selected == "local-turbo-int8":
        try:
            raw_words = transcribe_with_local_faster_whisper(
                wav_path=wav_path, model_size="large-v3-turbo", on_segment=on_segment
            )
            actual_model_used = "local:faster-whisper-large-v3-turbo-int8"
        except CUDAOutOfMemoryError:
            if not auto_fallback:
                raise
            request.state.diag_context["model_selected"] = "faster-whisper-small-int8"
            raw_words = transcribe_with_local_faster_whisper(
                wav_path=wav_path, model_size="small", on_segment=on_segment
            )
            actual_model_used = "local:faster-whisper-small-int8 (OOM fallback)"

    elif model_selected == "local-small-int8":
        raw_words = transcribe_with_local_faster_whisper(
            wav_path=wav_path, model_size="small", on_segment=on_segment
        )
        actual_model_used = "local:faster-whisper-small-int8"
    else:
        raise ValueError(f"خيار النموذج غير معروف: {model_selected}")

    result = build_unified_word_schema(
        raw_words=raw_words,
        media_url=media_url,
        model_used=actual_model_used,
        duration_sec=duration_sec,
    )
    set_progress(job_id, "done", 100, "اكتمل التفريغ")
    result["title"] = media_title
    result["from_cache"] = bool(yt_info.get("from_cache", False)) if (youtube_url and youtube_url.strip()) else False
    return result


# --- Selectable hadith corpora (see corpus_sources.py) -------------------------------------------------------
CORPUS_SOURCES = CorpusSourceManager(PROJECT_ROOT / "data")


@app.get("/api/corpus/sources")
def api_corpus_sources() -> JSONResponse:
    return JSONResponse({"success": True, "sources": CORPUS_SOURCES.describe()})


def _start_corpus_prepare(source_id: str) -> str:
    job_id = f"corpus_{source_id}_{uuid.uuid4().hex[:6]}"
    set_progress(job_id, "corpus", 0, "جاري التحضير...")

    def work() -> None:
        try:
            summary = CORPUS_SOURCES.prepare(source_id, job_id, lambda pct, msg: set_progress(job_id, "corpus", pct, msg))
            set_progress(job_id, "done", 100, f"جاهزة: {summary['count']} حديث", details=summary)
        except Exception as exc:  # reported to the UI through the progress endpoint
            set_progress(job_id, "error", None, str(exc))

    threading.Thread(target=work, name=job_id, daemon=True).start()
    return job_id


@app.post("/api/corpus/sources/{source_id}/prepare")
def api_corpus_prepare(source_id: str) -> JSONResponse:
    if source_id not in HADITH_SOURCES or HADITH_SOURCES[source_id].get("builtin"):
        return JSONResponse(status_code=404, content={"success": False, "message": "مصدر غير معروف."})
    return JSONResponse({"success": True, "job_id": _start_corpus_prepare(source_id)})


@app.post("/api/corpus/sources/{source_id}/upload")
async def api_corpus_upload(source_id: str, file: UploadFile = File(...)) -> JSONResponse:
    """For when the automatic download is blocked: the user downloads the release zip and uploads it here."""
    if source_id not in HADITH_SOURCES or HADITH_SOURCES[source_id].get("builtin"):
        return JSONResponse(status_code=404, content={"success": False, "message": "مصدر غير معروف."})
    try:
        CORPUS_SOURCES.save_upload(source_id, await file.read())
    except Exception as exc:
        return JSONResponse(status_code=400, content={"success": False, "message": f"الملف ليس zip صالحاً: {exc}"})
    return JSONResponse({"success": True, "job_id": _start_corpus_prepare(source_id)})


@app.get("/api/corpus/cache")
async def get_backend_corpus_cache() -> Dict[str, Any]:
    if CORPUS_CACHE_FILE.exists():
        try:
            return json.loads(CORPUS_CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"cached": False}


@app.post("/api/corpus/cache")
async def save_backend_corpus_cache(request: Request) -> Dict[str, Any]:
    body = await request.json()
    CORPUS_CACHE_FILE.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"saved": True, "path": str(CORPUS_CACHE_FILE)}


@app.delete("/api/corpus/cache")
async def clear_backend_corpus_cache() -> Dict[str, Any]:
    if CORPUS_CACHE_FILE.exists():
        CORPUS_CACHE_FILE.unlink()
    return {"cleared": True}


@app.get("/api/laya/status")
async def api_laya_status() -> Dict[str, Any]:
    """Check local Laya model status, device, and GTX 1050 VRAM."""
    status = laya_verifier.get_status()
    status["installed"] = True
    status["laya_installed"] = True
    return status


@app.post("/api/laya/load")
async def api_laya_load(request: Request) -> Dict[str, Any]:
    """Load Laya model with 3GB VRAM protection, automatically unloading Whisper."""
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    checkpoint = body.get("checkpoint") or "convaiinnovations/laya-multilingual"
    preferred_device = body.get("device") or "auto"
    return laya_verifier.load_model(
        checkpoint_id_or_path=checkpoint,
        preferred_device=preferred_device,
        unload_whisper_fn=cleanup_cuda_vram,
    )


@app.post("/api/laya/unload")
async def api_laya_unload() -> Dict[str, Any]:
    """Unload Laya from GPU/RAM and clean CUDA VRAM."""
    status = laya_verifier.unload_model()
    cleanup_cuda_vram()
    return status


@app.post("/api/laya/predict")
async def api_laya_predict(request: Request) -> Dict[str, Any]:
    """
    Run local Laya-Multilingual inference.
    Supports either:
    1. Single envelope: { "state": {...}, "questions": {...}, "max_len": 1024 }
    2. Batched findings: { "items": [ { "finding_id": "...", "state": {...}, "questions": {...} } ] }
    """
    body = await request.json()
    max_len = int(body.get("max_len") or 1024)

    # Batch support
    if "items" in body and isinstance(body["items"], list):
        results = []
        for item in body["items"]:
            finding_id = item.get("finding_id") or ""
            state = item.get("state") or {}
            questions = item.get("questions") or {}
            pred = laya_verifier.predict_decision(state, questions, max_len=max_len)
            results.append({
                "finding_id": finding_id,
                "answers": pred.get("answers", {}),
                "latency_ms": pred.get("latency_ms", 0),
                "model": pred.get("model", ""),
                "device": pred.get("device", ""),
            })
        return {"items": results, "total": len(results)}

    state = body.get("state") or {}
    questions = body.get("questions") or {}
    return laya_verifier.predict_decision(state, questions, max_len=max_len)


@app.post("/api/laya/convert-dataset")
async def api_laya_convert_dataset(request: Request) -> Dict[str, Any]:
    """Convert accumulated verification records into Laya JSONL training format."""
    body = await request.json()
    records = body.get("records") or []
    jsonl_str, stats = convert_verification_records_to_laya_jsonl(records)
    return {
        "success": True,
        "jsonl": jsonl_str,
        "stats": stats,
    }


@app.post("/api/openrouter/decisions")
async def api_openrouter_decisions(request: Request) -> JSONResponse:
    """
    Server-side proxy for OpenRouter Decisions API (https://openrouter.ai/api/alpha/decisions).
    Bypasses browser CORS restrictions while preserving user's OpenRouter API key.
    """
    auth_header = request.headers.get("authorization") or ""
    if not auth_header:
        return JSONResponse(status_code=400, content={"error": True, "message": "Missing Authorization header."})

    body = await request.json()
    target_url = "https://openrouter.ai/api/alpha/decisions"
    headers = {
        "Authorization": auth_header,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://wahy-transcriber.local",
        "X-Title": "Wahy Transcriber AI Verifier",
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(target_url, headers=headers, json=body)
            try:
                resp_data = resp.json()
            except Exception:
                resp_data = {"text": resp.text}
            return JSONResponse(status_code=resp.status_code, content=resp_data)
    except Exception as exc:
        return JSONResponse(status_code=502, content={"error": True, "message": f"Proxy request failed: {exc}"})


@app.post("/api/diagnostic-test-error")
async def trigger_test_backend_error(request: Request) -> Dict[str, Any]:
    request.state.diag_context = {
        "model_selected": "faster-whisper-large-v3-turbo-int8",
        "input_source": "https://www.youtube.com/watch?v=diagnostic_test",
    }
    raise CUDAOutOfMemoryError(
        "Simulated CUDA out of memory error on GTX 1050 (3GB VRAM): tried to allocate 512.00 MiB."
    )


# -------------------------------------------------------------------------
# AI Tafrigh Phase Endpoints
# -------------------------------------------------------------------------
ACTIVE_TAFRIGH_SESSIONS: Dict[str, Dict[str, Any]] = {}
GLOBAL_TRAINING_STORE = TrainingStore()


@app.post("/api/tafrigh/models")
def api_tafrigh_models(body: Dict[str, Any]) -> JSONResponse:
    """Models this Gemini key can really call (so the UI never offers a name that 404s)."""
    key = (body.get("gemini_api_key") or os.getenv("GEMINI_API_KEY", "")).strip()
    if not key:
        return JSONResponse({"success": False, "message": "أدخل مفتاح Gemini API أولاً."})
    try:
        names = list_gemini_models(key)
    except GeminiAPIError as exc:
        return JSONResponse({"success": False, "message": str(exc)})
    return JSONResponse({"success": True, "models": sorted(names), "recommended": pick_model(names)})


def _segmentation_config(raw: Optional[Dict[str, Any]]) -> "SegmentationConfig":
    raw = raw or {}
    allowed = {k: raw[k] for k in ("use_punctuation", "pause_sec", "min_words", "max_words") if k in raw}
    return SegmentationConfig(**allowed)


@app.post("/api/tafrigh/segment")
def api_tafrigh_segment(body: Dict[str, Any]) -> JSONResponse:
    """Preview: the exact sentences a run would classify (same segmenter, same settings), plus stats."""
    raw_text = body.get("raw_text") or ""
    cfg = _segmentation_config(body.get("seg_config"))
    segs = segment_transcript(
        raw_text=raw_text,
        asr_words=body.get("asr_words"),
        detection_spans=body.get("detection_spans"),
        # each detected ayah / hadith / dhikr is its own sentence (never merged with commentary, never cut inside)
        use_detection_boundaries=bool(body.get("use_detection_boundaries", True)),
        config=cfg,
    )
    rows = []
    for k, sg in enumerate(segs):
        rows.append({
            "index": k, "id": sg.id, "text": sg.original_text.strip(),
            "words": len(sg.original_text.split()),
            "start_time": sg.source_pos.start_time, "end_time": sg.source_pos.end_time,
            "cut_reason": sg.cut_reason, "has_detection": bool(sg.detection_signals),
            "quote_kinds": sorted({str(d.get("type") or "") for d in sg.detection_signals if d.get("type")}),
        })
    counts = sorted(r["words"] for r in rows) or [0]
    reasons: Dict[str, int] = {}
    for r in rows:
        reasons[r["cut_reason"] or "end"] = reasons.get(r["cut_reason"] or "end", 0) + 1
    durs = [r["end_time"] - r["start_time"] for r in rows if r["start_time"] is not None and r["end_time"] is not None]
    stats = {
        "sentences": len(rows),
        "words_total": sum(counts) if rows else 0,
        "min_words": counts[0], "max_words": counts[-1],
        "avg_words": round(sum(counts) / max(1, len(rows)), 1),
        "median_words": counts[len(counts) // 2],
        "over_cap": sum(1 for c in counts if cfg.max_words and c > cfg.max_words),
        "avg_duration_sec": round(sum(durs) / len(durs), 1) if durs else None,
        "cut_reasons": reasons,
        "quote_sentences": sum(1 for r in rows if r["has_detection"]),
        "has_timestamps": any(r["start_time"] is not None for r in rows),
    }
    return JSONResponse({"success": True, "segments": rows, "stats": stats, "seg_config": cfg.model_dump()})


@app.post("/api/tafrigh/control")
def api_tafrigh_control(body: Dict[str, Any]) -> JSONResponse:
    job_id = str(body.get("job_id") or "")
    try:
        state = set_control(job_id, str(body.get("action") or ""))
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"success": False, "message": str(exc)})
    return JSONResponse({"success": True, "state": state})


# Plain `def`: FastAPI runs it in a worker thread so the progress endpoint stays responsive during the run.
@app.post("/api/tafrigh/run")
def api_tafrigh_run(body: Dict[str, Any]) -> JSONResponse:
    """
    Executes the 7-stage AI Tafrigh pipeline.
    Transforms raw ASR transcripts into faithfully structured output with versions and review queue.
    """
    job_id = body.get("job_id")
    raw_text = body.get("raw_text")
    segments_raw = body.get("segments")
    asr_words = body.get("asr_words")
    detection_spans = body.get("detection_spans")

    processing_mode = body.get("processing_mode", "per_sentence")
    model_candidate = body.get("model_candidate", "gemini_all")
    _MODEL_CANDIDATE_ALIASES = {
        "jev_independent": "jev_hybrid",
        "jev": "jev_hybrid",
        "laya_only": "laya_hybrid",
        "laya": "laya_hybrid",
        "gemini": "gemini_all",
    }
    model_candidate = _MODEL_CANDIDATE_ALIASES.get(model_candidate, model_candidate)
    jev_layout = body.get("jev_layout", "independent_questions")
    typo_strategy = body.get("typo_strategy", "gated")
    lecture_slug = body.get("lecture_slug", "lecture")
    label = body.get("label", "default")

    matn_cfg_dict = body.get("matn_config", {})
    matn_cfg = MatnConfig(
        mode=matn_cfg_dict.get("mode", "no_matn"),
        matn_id=matn_cfg_dict.get("matn_id"),
        raw_matn_text=matn_cfg_dict.get("raw_matn_text"),
    )

    pipeline_cfg = PipelineConfig(
        processing_mode=processing_mode,
        model_candidate=model_candidate,
        jev_layout=jev_layout,
        typo_strategy=typo_strategy,
        use_detection_boundaries=bool(body.get("use_detection_boundaries", True)),
    )

    initial_segments = None
    if segments_raw and isinstance(segments_raw, list):
        initial_segments = []
        for s in segments_raw:
            sp = s.get("source_pos", {})
            pos = SourcePosition(
                char_start=sp.get("char_start", 0),
                char_end=sp.get("char_end", len(s.get("text", s.get("original_text", "")))),
                start_time=sp.get("start_time"),
                end_time=sp.get("end_time"),
            )
            initial_segments.append(
                TranscriptSegment(
                    id=s.get("id", f"seg_{len(initial_segments)+1:04d}"),
                    original_text=s.get("text", s.get("original_text", "")),
                    source_pos=pos,
                )
            )

    gemini_key = body.get("gemini_api_key") or body.get("api_key") or os.getenv("GEMINI_API_KEY", "")
    openrouter_key = body.get("openrouter_api_key") or os.getenv("JEV_API_KEY", "")
    model_name = body.get("model_name") or "auto"
    # The Gemini adapter must always target a Gemini model, even when JEV/Laya is the primary classifier;
    # "auto" resolves to the best Flash-Lite this key can actually call (see GeminiAdapter.resolve_model).
    gemini_model_name = model_name if str(model_name).startswith("gemini") else "auto"

    # Gemini calls (the classifier in Gemini mode; split points and typo fixes in JEV / Laya mode) go through
    # OpenRouter by default when its key is present: Google's free tier rate-limits them into ~40 s retries.
    gemini_route = body.get("gemini_route") or ("openrouter" if openrouter_key else "direct")
    via_openrouter = gemini_route == "openrouter" and bool(openrouter_key)
    or_gemini_model = (body.get("openrouter_gemini_model") or "").strip()
    if not or_gemini_model and str(model_name).startswith("gemini"):
        or_gemini_model = f"google/{model_name}"   # a specific Gemini model picked in the UI, same model via OpenRouter

    custom_adapters: Dict[str, Any] = {}
    custom_adapters["gemini"] = GeminiAdapter(
        api_key=gemini_key,
        model_name=gemini_model_name,
        typo_strategy=typo_strategy,
        openrouter_api_key=openrouter_key if via_openrouter else None,
        openrouter_model=or_gemini_model or None,
    )
    if openrouter_key:
        jev_cfg = JEVRequestConfig(
            jev_layout=jev_layout,
            execution_order=body.get("jev_execution_order", "parallel"),
        )
        jev_model = model_name if "jev" in str(model_name) else "typesafe/jev-1.14"
        custom_adapters["jev"] = JEVAdapter(api_key=openrouter_key, config=jev_cfg, model=jev_model)

    logger = RunLogger(lecture_slug=lecture_slug, label=label)
    pipeline = TafrighPipeline(pipeline_config=pipeline_cfg, matn_config=matn_cfg, adapters=custom_adapters)


    last_pct = {"v": 0.0}

    def on_progress(done: int, total: int, msg: str, info: Optional[Dict[str, Any]] = None) -> None:
        last_pct["v"] = max(last_pct["v"], min(99.0, 100 * done / max(1, total)))
        set_progress(job_id, "tafrigh", last_pct["v"], msg, details=info)

    pipeline.on_progress = on_progress
    pipeline.control = lambda: get_control(job_id)
    pipeline.segmentation_config = _segmentation_config(body.get("seg_config"))
    target_range = body.get("target_range")
    if isinstance(target_range, list) and len(target_range) == 2:
        target_range = (int(target_range[0]), int(target_range[1]))
    else:
        target_range = None
    set_progress(job_id, "tafrigh", 0, "جاري تقطيع النص ومطابقة المتن...")

    # Execute Stages 1 - 5 in a worker thread so a stop / cancel can answer immediately, even while the
    # worker is blocked on a slow model request (rate-limit backoff, retries).
    outcome: Dict[str, Any] = {}

    def _work() -> None:
        try:
            outcome["result"] = pipeline.run(
                raw_text=raw_text,
                initial_segments=initial_segments,
                asr_words=asr_words,
                detection_spans=detection_spans,
                target_range=target_range,
            )
        except Exception as exc:  # re-raised / reported on the request thread below
            outcome["error"] = exc

    def _discard(message: str) -> JSONResponse:
        """Nothing from this run is kept: drop its (still empty) run folder too."""
        try:
            logger.run_dir.rmdir()
        except OSError:
            pass
        set_progress(job_id, "done", 100, message)
        return JSONResponse({"success": False, "discarded": True, "message": message})

    worker = threading.Thread(target=_work, name=f"tafrigh-{job_id}", daemon=True)
    worker.start()
    try:
        while worker.is_alive():
            worker.join(0.3)
            control = get_control(job_id)
            if control == "cancel":
                pipeline.snapshot_result()  # halts the worker; nothing from this run is kept
                return _discard("تم إلغاء التفريغ دون تطبيق أي تغيير")
            if control == "stop" and worker.is_alive():
                outcome["result"] = pipeline.snapshot_result()
                break
    finally:
        clear_control(job_id)

    if "error" in outcome and "result" not in outcome:
        exc = outcome["error"]
        if not isinstance(exc, (TafrighModelError, ModelAPIError)):
            raise exc
        set_progress(job_id, "error", None, str(exc))
        return JSONResponse({"success": False, "message": redact_secrets(exc)})
    result = outcome["result"]
    if result is None or not result.segments:
        return _discard("لم تكتمل أي جملة قبل الإيقاف")

    for req in result.request_logs:
        logger.log_request(req)

    # Stage 6: Outline Repair Pass
    run_outline_repair_pass(result.segments, result.outline_state)

    # Review Queue
    review_manager = ReviewQueueManager(result.segments)

    # Finalize logger
    report_data = logger.finalize_run(result.run_manifest, result.segments)

    # Stage 7: Deterministic Rendering
    qs = body.get("quote_style") or {}
    render_cfg = RenderConfig(**{k: v for k, v in qs.items() if k in RenderConfig.model_fields and v is not None})
    rendered_md = render_to_markdown(result.segments, result.outline_state, render_cfg)
    rendered_html = render_to_html(result.segments, result.outline_state, render_cfg)
    rendered_json = render_to_structured_json(
        result.segments, result.outline_state, result.lecture_spans, render_cfg
    )

    run_id = result.run_manifest["run_id"]
    ACTIVE_TAFRIGH_SESSIONS[run_id] = {
        "segments": result.segments,
        "outline_state": result.outline_state,
        "lecture_spans": result.lecture_spans,
        "manager": review_manager,
        "logger": logger,
        "manifest": result.run_manifest,
        "render_cfg": render_cfg,
        "run_dir": str(logger.run_dir),
    }
    _save_tafrigh_session(ACTIVE_TAFRIGH_SESSIONS[run_id])

    set_progress(job_id, "done", 100, "اكتمل التفريغ الذكي")
    warnings = []
    if result.run_manifest.get("adapter_mode") == "offline_heuristic":
        warnings.append("لم يُدخل مفتاح Gemini: تم التصنيف بقواعد نصية بسيطة وليس بنموذج ذكاء اصطناعي. أدخل المفتاح في إعدادات التدقيق للحصول على نتائج حقيقية.")
    if result.run_manifest.get("cancelled"):
        warnings.append(f"تم إيقاف التفريغ بطلب منك بعد معالجة {len(result.segments)} جملة؛ المعروض هو ما اكتمل فقط.")
    errs = sum(1 for r in result.request_logs if r.get("error"))
    if errs:
        warnings.append(f"فشل {errs} طلب إلى النموذج وتم تعليم الجمل المتأثرة للمراجعة.")

    return JSONResponse({
        "success": True,
        "warnings": warnings,
        "cancelled": bool(result.run_manifest.get("cancelled")),
        "run_id": run_id,
        "markdown": rendered_md,
        "html": rendered_html,
        "structured_json": rendered_json,
        "review_items": [item.model_dump() for item in review_manager.get_items()],
        "report": report_data,
    })


SESSION_FILE = "session.json"


def _save_tafrigh_session(session: Dict[str, Any]) -> None:
    """Runs live in memory, and `run.sh` reloads the server on every backend change: keep a copy on disk."""
    run_dir = session.get("run_dir")
    if not run_dir:
        return
    payload = {
        "run_id": session["manifest"].get("run_id"),
        "manifest": session["manifest"],
        "segments": [s.model_dump(mode="json") for s in session["segments"]],
        "outline_state": session["outline_state"].model_dump(mode="json"),
        "lecture_spans": [s.model_dump(mode="json") for s in session["lecture_spans"]],
        "render_cfg": session["render_cfg"].model_dump(mode="json") if session.get("render_cfg") else None,
        "saved": session.get("saved"),
    }
    try:
        Path(run_dir, SESSION_FILE).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _load_tafrigh_session(run_id: str) -> Optional[Dict[str, Any]]:
    session = ACTIVE_TAFRIGH_SESSIONS.get(run_id)
    if session:
        return session
    for base in (Path("runs"), Path(__file__).resolve().parent / "runs", PROJECT_ROOT / "runs"):
        if not base.is_dir():
            continue
        for f in base.glob(f"*/{SESSION_FILE}"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if data.get("run_id") != run_id:
                continue
            segments = [TranscriptSegment.model_validate(x) for x in data["segments"]]
            session = {
                "segments": segments,
                "outline_state": OutlineState.model_validate(data["outline_state"]),
                "lecture_spans": [LectureSpan.model_validate(x) for x in data["lecture_spans"]],
                "manager": ReviewQueueManager(segments),
                "manifest": data["manifest"],
                "render_cfg": RenderConfig.model_validate(data["render_cfg"]) if data.get("render_cfg") else RenderConfig(),
                "run_dir": str(f.parent),
                "saved": data.get("saved"),
            }
            ACTIVE_TAFRIGH_SESSIONS[run_id] = session
            return session
    return None


@app.post("/api/tafrigh/review-action")
async def api_tafrigh_review_action(request: Request) -> JSONResponse:
    """
    Applies a human review decision (confirm, correct, reject).
    Immediately updates version history and re-renders output with zero model calls.
    """
    body = await request.json()
    run_id = body.get("run_id")
    segment_id = body.get("segment_id")
    action = body.get("action", "confirm")

    session = _load_tafrigh_session(run_id)
    if not session:
        return JSONResponse(status_code=404, content={
            "error": True, "success": False,
            "message": "تعذر العثور على جلسة التفريغ هذه (ربما من قبل التحديث الأخير). أعد تشغيل التفريغ لهذه الجمل."})

    manager: ReviewQueueManager = session["manager"]
    segments: List[TranscriptSegment] = session["segments"]
    outline_state = session["outline_state"]
    lecture_spans = session["lecture_spans"]

    reviewer_id = body.get("reviewer_id", "web_editor")
    note = body.get("note")

    target_seg = None
    if segment_id not in manager.segments_by_id:
        return JSONResponse(status_code=404, content={"success": False, "message": "هذه الجملة غير موجودة في هذا التشغيل."})
    if action == "confirm":
        target_seg = manager.confirm_decision(segment_id, reviewer_id=reviewer_id, note=note)
    elif action == "correct":
        corr_tag_str = body.get("corrected_tag")
        corr_tag = StructuralTag(corr_tag_str) if corr_tag_str else None
        corr_level = body.get("corrected_level")
        corr_parent = body.get("corrected_parent")
        corr_text = body.get("corrected_text")
        target_seg = manager.correct_decision(
            segment_id=segment_id,
            corrected_tag=corr_tag,
            corrected_level=corr_level,
            corrected_parent=corr_parent,
            corrected_text=corr_text,
            reviewer_id=reviewer_id,
            note=note,
        )
    elif action == "reject":
        target_seg = manager.reject_decision(segment_id, reviewer_id=reviewer_id, note=note)

    # Training data is written only by "Save run" (/api/tafrigh/save-run), for the sentences the user picks
    # Deterministic re-render (and keep the on-disk copy in sync)
    _save_tafrigh_session(session)
    rendered_md = render_to_markdown(segments, outline_state, session.get("render_cfg"))
    rendered_html = render_to_html(segments, outline_state, session.get("render_cfg"))
    rendered_json = render_to_structured_json(segments, outline_state, lecture_spans, session.get("render_cfg"))

    return JSONResponse({
        "success": True,
        "segment_id": segment_id,
        "markdown": rendered_md,
        "html": rendered_html,
        "structured_json": rendered_json,
        "review_items": [item.model_dump() for item in manager.get_items()],
    })


TAFRIGH_LAYA_DIR = PROJECT_ROOT / "data" / "training_store" / "tafrigh_runs"


@app.post("/api/tafrigh/save-run")
async def api_tafrigh_save_run(request: Request) -> JSONResponse:
    """Save the chosen sentences of a run (with their current, possibly human-corrected labels) as Laya
    fine-tuning examples. Re-saving a run rewrites its file, so examples are never duplicated."""
    body = await request.json()
    run_id = str(body.get("run_id") or "")
    session = _load_tafrigh_session(run_id)
    if not session:
        return JSONResponse(status_code=404, content={"success": False, "message": "تعذر العثور على جلسة التفريغ هذه."})
    segments: List[TranscriptSegment] = session["segments"]
    known = {s.id for s in segments}
    selected = [sid for sid in (body.get("segment_ids") or []) if sid in known]
    if not selected:
        return JSONResponse(status_code=400, content={"success": False, "message": "لم تُحدَّد أي جملة للحفظ."})

    examples = build_laya_examples(run_id, segments, selected)
    meta = {
        "lecture_title": body.get("lecture_title") or None,
        "model_candidate": (session.get("manifest") or {}).get("model_candidate"),
        "note": body.get("note") or None,
    }
    path = save_laya_run(TAFRIGH_LAYA_DIR, run_id, examples, meta)
    by_source: Dict[str, int] = {}
    for ex in examples:
        by_source[ex["label_source"]] = by_source.get(ex["label_source"], 0) + 1
    session["saved"] = {"segment_ids": selected, "count": len(examples), "path": str(path)}
    _save_tafrigh_session(session)
    return JSONResponse({
        "success": True,
        "count": len(examples),
        "sentences": len(selected),
        "by_source": by_source,
        "path": str(path.relative_to(PROJECT_ROOT)),
    })


@app.get("/api/tafrigh/runs")
async def api_tafrigh_list_runs() -> JSONResponse:
    """Lists past execution runs and reports from the runs/ directory."""
    runs_dir = Path("runs")
    if not runs_dir.exists():
        return JSONResponse({"runs": []})

    runs = []
    for d in sorted(runs_dir.iterdir(), reverse=True):
        if d.is_dir() and (d / "report.json").exists():
            try:
                with open(d / "report.json", "r", encoding="utf-8") as f:
                    rep = json.load(f)
                runs.append({"dir": str(d), "report": rep})
            except Exception:
                pass

    return JSONResponse({"runs": runs})


@app.post("/api/tafrigh/compare")
async def api_tafrigh_compare(request: Request) -> JSONResponse:
    """Compares multiple runs side-by-side."""
    body = await request.json()
    run_dirs = body.get("run_dirs", [])
    paths = [Path(d) for d in run_dirs if Path(d).exists()]
    if not paths:
        return JSONResponse(status_code=400, content={"error": True, "message": "No valid run directories provided."})

    md_report = compare_run_dirs(paths)
    return JSONResponse({"report_markdown": md_report})


# Mount static directories
app.mount("/media", StaticFiles(directory=str(TEMP_MEDIA_DIR)), name="media")
if (PROJECT_ROOT / "css").exists():
    app.mount("/css", StaticFiles(directory=str(PROJECT_ROOT / "css")), name="css")
if (PROJECT_ROOT / "js").exists():
    app.mount("/js", StaticFiles(directory=str(PROJECT_ROOT / "js")), name="js")
if (PROJECT_ROOT / "data").exists():
    app.mount("/data", StaticFiles(directory=str(PROJECT_ROOT / "data")), name="data")


@app.middleware("http")
async def no_cache_frontend_assets(request, call_next):
    """Force revalidation of the frontend so edited JS/CSS/HTML is never served stale."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith(("/js/", "/css/")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(str(PROJECT_ROOT / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
