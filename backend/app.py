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
from laya_engine import laya_verifier
from laya_converter import convert_verification_records_to_laya_jsonl

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
        "message": str(exc) or "حدث خطأ غير متوقع في الخادم الخلفي (FastAPI Backend).",
        "traceback": traceback.format_exc(),
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


@app.post("/api/transcribe")
async def api_transcribe(
    request: Request,
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
        yt_info = download_youtube_media(youtube_url.strip(), session_id=session_id)
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

    norm_info = normalize_audio_streams(source_path, session_id=session_id)
    wav_path: Path = norm_info["wav_path"]
    mp3_path: Path = norm_info["mp3_path"]
    duration_sec: float = float(norm_info["duration_sec"] or 0.0)

    raw_words = []
    actual_model_used = model_selected

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
            )
            actual_model_used = "groq:whisper-large-v3-turbo"
        except Exception as groq_exc:
            if not auto_fallback:
                raise
            # Fallback to local GPU Turbo -> Small
            try:
                request.state.diag_context["model_selected"] = "faster-whisper-large-v3-turbo-int8"
                raw_words = transcribe_with_local_faster_whisper(
                    wav_path=wav_path, model_size="large-v3-turbo"
                )
                actual_model_used = "local:faster-whisper-large-v3-turbo-int8"
            except CUDAOutOfMemoryError:
                request.state.diag_context["model_selected"] = "faster-whisper-small-int8"
                raw_words = transcribe_with_local_faster_whisper(
                    wav_path=wav_path, model_size="small"
                )
                actual_model_used = "local:faster-whisper-small-int8"
            except Exception:
                raise groq_exc

    elif model_selected == "local-turbo-int8":
        try:
            raw_words = transcribe_with_local_faster_whisper(
                wav_path=wav_path, model_size="large-v3-turbo"
            )
            actual_model_used = "local:faster-whisper-large-v3-turbo-int8"
        except CUDAOutOfMemoryError:
            if not auto_fallback:
                raise
            request.state.diag_context["model_selected"] = "faster-whisper-small-int8"
            raw_words = transcribe_with_local_faster_whisper(
                wav_path=wav_path, model_size="small"
            )
            actual_model_used = "local:faster-whisper-small-int8 (OOM fallback)"

    elif model_selected == "local-small-int8":
        raw_words = transcribe_with_local_faster_whisper(
            wav_path=wav_path, model_size="small"
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
    result["title"] = media_title
    return result


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


# Mount static directories
app.mount("/media", StaticFiles(directory=str(TEMP_MEDIA_DIR)), name="media")
if (PROJECT_ROOT / "css").exists():
    app.mount("/css", StaticFiles(directory=str(PROJECT_ROOT / "css")), name="css")
if (PROJECT_ROOT / "js").exists():
    app.mount("/js", StaticFiles(directory=str(PROJECT_ROOT / "js")), name="js")
if (PROJECT_ROOT / "data").exists():
    app.mount("/data", StaticFiles(directory=str(PROJECT_ROOT / "data")), name="data")


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(str(PROJECT_ROOT / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
