"""
Wahy-Finder v2.0 — Module 4: Transcription Engine (Word-Level Timestamps)
File: backend/transcriber.py

Supports the 3-tier hardware/cloud strategy:
1. Primary Option: Groq Cloud API (`whisper-large-v3-turbo`) with
   `timestamp_granularities=["word", "segment"]` and automatic chunk stitching.
2. Secondary Option (Local GPU - Turbo): `faster-whisper` (`large-v3-turbo`)
   with `compute_type="int8"` (~2.2GB VRAM on GTX 1050 3GB).
3. Ultra-Safe Fallback (Local GPU - Small): `faster-whisper` (`small`)
   with `compute_type="int8"` (~800MB VRAM on GTX 1050 3GB).

Always enforces explicit VRAM cleanup (`del model`, `gc.collect()`,
`torch.cuda.empty_cache()`) after every local transcription run.
"""

from __future__ import annotations

import gc
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import torch  # type: ignore
except ImportError:
    torch = None

try:
    from faster_whisper import WhisperModel  # type: ignore
except ImportError:
    WhisperModel = None

try:
    from groq import Groq  # type: ignore
except ImportError:
    Groq = None

import httpx


class CUDAOutOfMemoryError(RuntimeError):
    """Raised when local GPU runs out of VRAM (e.g. on GTX 1050 3GB)."""


class GroqAPIError(RuntimeError):
    """Raised when Groq Cloud API request fails or returns an error."""


class LocalWhisperError(RuntimeError):
    """Raised when local faster-whisper fails to initialize or transcribe."""


ARABIC_INITIAL_PROMPT = (
    "إن الحمد لله نحمده ونستعينه ونستغفره، قال الله تعالى في القرآن الكريم، "
    "وقال رسول الله صلى الله عليه وسلم في الحديث الصحيح:"
)


def get_vram_allocated_mb() -> int:
    """Return currently allocated CUDA VRAM in MB (0 if CUDA is unavailable)."""
    if torch is not None and hasattr(torch, "cuda") and torch.cuda.is_available():
        try:
            return int(torch.cuda.memory_allocated() // (1024 * 1024))
        except Exception:
            return 0
    return 0


def cleanup_cuda_vram() -> None:
    """Explicitly run garbage collection and empty PyTorch/CUDA cache."""
    gc.collect()
    if torch is not None and hasattr(torch, "cuda") and torch.cuda.is_available():
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass


def build_unified_word_schema(
    raw_words: List[Dict[str, Any]],
    media_url: str,
    model_used: str,
    duration_sec: float = 0.0,
) -> Dict[str, Any]:
    """
    Build the exact Unified Output Schema required by Module 4:
    {
      "media_url": "/media/temp_video.mp4",
      "full_text": "إن الحمد لله نحمده ونستعينه...",
      "words": [
        { "id": 0, "word": "إن", "start": 0.12, "end": 0.40, "char_start": 0, "char_end": 2 },
        { "id": 1, "word": "الحمد", "start": 0.42, "end": 0.88, "char_start": 3, "char_end": 8 }
      ]
    }
    """
    words_out: List[Dict[str, Any]] = []
    text_parts: List[str] = []
    char_cursor = 0

    for item in raw_words:
        w_text = str(item.get("word") or "").strip()
        if not w_text:
            continue
        start_t = round(float(item.get("start") or 0.0), 2)
        end_t = round(max(start_t + 0.04, float(item.get("end") or (start_t + 0.25))), 2)

        char_start = char_cursor
        char_end = char_start + len(w_text)

        words_out.append(
            {
                "id": len(words_out),
                "word": w_text,
                "start": start_t,
                "end": end_t,
                "char_start": char_start,
                "char_end": char_end,
            }
        )
        text_parts.append(w_text)
        char_cursor = char_end + 1  # +1 for the joining space

    full_text = " ".join(text_parts)
    return {
        "media_url": media_url,
        "full_text": full_text,
        "words": words_out,
        "model_used": model_used,
        "duration_sec": round(duration_sec, 2),
    }


def transcribe_with_groq_chunks(
    chunks: List[Dict[str, Any]],
    api_key: str,
    model_name: str = "whisper-large-v3-turbo",
    on_chunk_done=None,
) -> List[Dict[str, Any]]:
    """
    Transcribe one or more audio chunks via Groq's OpenAI-compatible endpoint
    with word-level timestamps (`timestamp_granularities=["word", "segment"]`),
    stitching timestamps across chunks using `offset_sec`.
    """
    effective_key = (api_key or os.environ.get("GROQ_API_KEY") or "").strip()
    if not effective_key:
        raise GroqAPIError(
            "مفتاح Groq API غير متوفر. يرجى إدخال المفتاح في إعدادات الواجهة أو اختيار نموذج البطاقة الرسومية المحلية (faster-whisper)."
        )

    stitched_words: List[Dict[str, Any]] = []
    endpoint = "https://api.groq.com/openai/v1/audio/transcriptions"

    for chunk_idx, chunk in enumerate(chunks):
        chunk_path: Path = chunk["path"]
        offset_sec: float = float(chunk.get("offset_sec") or 0.0)

        payload = None
        # 1. Try official Groq SDK client if installed
        if Groq is not None:
            try:
                client = Groq(api_key=effective_key)
                with open(chunk_path, "rb") as audio_fp:
                    transcription = client.audio.transcriptions.create(
                        file=(chunk_path.name, audio_fp),
                        model=model_name,
                        language="ar",
                        response_format="verbose_json",
                        prompt=ARABIC_INITIAL_PROMPT,
                        timestamp_granularities=["word", "segment"],
                    )
                if hasattr(transcription, "model_dump"):
                    payload = transcription.model_dump()
                elif hasattr(transcription, "to_dict"):
                    payload = transcription.to_dict()
                elif isinstance(transcription, dict):
                    payload = transcription
            except Exception:
                payload = None

        # 2. HTTPX multipart request (data must be dict, not list of tuples, for httpx multipart)
        if payload is None:
            try:
                with open(chunk_path, "rb") as audio_fp:
                    files = {"file": (chunk_path.name, audio_fp, "audio/mpeg")}
                    data = {
                        "model": model_name,
                        "language": "ar",
                        "response_format": "verbose_json",
                        "prompt": ARABIC_INITIAL_PROMPT,
                        "timestamp_granularities[]": ["word", "segment"],
                    }
                    headers = {"Authorization": f"Bearer {effective_key}"}
                    with httpx.Client(timeout=300.0) as client:
                        resp = client.post(endpoint, headers=headers, data=data, files=files)
            except Exception as exc:
                raise GroqAPIError(f"فشل الاتصال بخادم Groq API أثناء رفع المقطع: {exc}") from exc

            if resp.status_code != 200:
                raise GroqAPIError(
                    f"رفض خادم Groq API الطلب (HTTP {resp.status_code}): {resp.text[:500]}"
                )

            payload = resp.json()
        chunk_words = payload.get("words") or []
        if chunk_words:
            for w in chunk_words:
                stitched_words.append(
                    {
                        "word": str(w.get("word") or "").strip(),
                        "start": float(w.get("start") or 0.0) + offset_sec,
                        "end": float(w.get("end") or 0.0) + offset_sec,
                    }
                )
        else:
            # Fallback if only segments were returned
            for seg in payload.get("segments") or []:
                seg_text = str(seg.get("text") or "").strip()
                seg_words = seg_text.split()
                if not seg_words:
                    continue
                s_start = float(seg.get("start") or 0.0) + offset_sec
                s_end = float(seg.get("end") or (s_start + 1.0)) + offset_sec
                step = max(0.08, (s_end - s_start) / len(seg_words))
                for idx, sw in enumerate(seg_words):
                    stitched_words.append(
                        {
                            "word": sw,
                            "start": s_start + idx * step,
                            "end": s_start + (idx + 1) * step,
                        }
                    )

        if on_chunk_done:
            on_chunk_done(chunk_idx + 1, len(chunks))

    return stitched_words


def transcribe_with_local_faster_whisper(
    wav_path: Path,
    model_size: str = "small",  # "small" or "large-v3-turbo"
    prefer_device: str = "cuda",
    on_segment=None,
) -> List[Dict[str, Any]]:
    """
    Run local faster-whisper with `compute_type="int8"` and `word_timestamps=True`.
    Strictly cleans up CUDA VRAM (`del model`, `gc.collect()`, `torch.cuda.empty_cache()`)
    immediately after completion to protect 3GB VRAM GPUs (GTX 1050).
    """
    if WhisperModel is None:
        raise LocalWhisperError(
            "مكتبة faster-whisper غير مثبتة. يرجى تشغيل: pip install faster-whisper"
        )

    device = prefer_device
    if device == "cuda" and torch is not None and not torch.cuda.is_available():
        device = "cpu"

    model = None
    extracted_words: List[Dict[str, Any]] = []
    try:
        model = WhisperModel(
            model_size,
            device=device,
            compute_type="int8",  # Critical for 3GB VRAM (GTX 1050)
            cpu_threads=4,
        )
        segments, _info = model.transcribe(
            str(wav_path),
            language="ar",
            word_timestamps=True,
            vad_filter=True,
            initial_prompt=ARABIC_INITIAL_PROMPT,
        )
        for segment in segments:
            if on_segment:
                on_segment(float(segment.end or 0.0))
            if getattr(segment, "words", None):
                for w in segment.words:
                    extracted_words.append(
                        {
                            "word": str(w.word or "").strip(),
                            "start": float(w.start or 0.0),
                            "end": float(w.end or 0.0),
                        }
                    )
            else:
                seg_words = str(segment.text or "").strip().split()
                if not seg_words:
                    continue
                s_start = float(segment.start or 0.0)
                s_end = float(segment.end or (s_start + 1.0))
                step = max(0.08, (s_end - s_start) / len(seg_words))
                for idx, sw in enumerate(seg_words):
                    extracted_words.append(
                        {
                            "word": sw,
                            "start": s_start + idx * step,
                            "end": s_start + (idx + 1) * step,
                        }
                    )
        return extracted_words
    except RuntimeError as exc:
        err_msg = str(exc).lower()
        if "out of memory" in err_msg or "cuda" in err_msg or "cublas" in err_msg:
            raise CUDAOutOfMemoryError(
                f"نفدت ذاكرة البطاقة الرسومية (CUDA Out-Of-Memory) أثناء تشغيل النموذج ({model_size} int8) على بطاقة 3GB VRAM. "
                f"يرجى التبديل إلى الوضع الآمن (Local GPU - Small int8 ~800MB) أو استخدام Groq Cloud API. التفاصيل: {exc}"
            ) from exc
        raise LocalWhisperError(f"خطأ أثناء التفريغ المحلي بواسطة faster-whisper: {exc}") from exc
    except Exception as exc:
        raise LocalWhisperError(f"فشل التفريغ المحلي بواسطة faster-whisper: {exc}") from exc
    finally:
        if model is not None:
            del model
        cleanup_cuda_vram()
