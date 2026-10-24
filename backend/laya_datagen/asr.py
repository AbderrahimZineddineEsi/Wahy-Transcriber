"""ASR with an on-disk cache keyed by (audio bytes, backend, model): the expensive step runs once per lesson,
whatever engine or labelling change comes later."""
from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from .cache import DATA_DIR, JsonCache, sha


def _file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:24]


def to_wav16k(src: Path) -> Path:
    out = DATA_DIR / "cache" / "wav" / (src.stem + ".wav")
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "16000", str(out)], check=True)
    return out


def _local_whisper(audio: Path, model_size: str, on_segment=None, device: str = "cpu") -> List[Dict[str, Any]]:
    """faster-whisper on a numpy array: its own decode_audio breaks with the PyAV installed here
    (`open() got an unexpected keyword argument 'metadata_errors'`), so ffmpeg does the decoding."""
    import gc

    import numpy as np
    from faster_whisper import WhisperModel

    from backend.transcriber import ARABIC_INITIAL_PROMPT, cleanup_cuda_vram
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(audio), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    pcm = np.frombuffer(raw, dtype=np.float32)
    model = None
    try:
        # cuda needs libcublas.so.12 at encode time (absent on this machine), hence cpu by default
        model = WhisperModel(model_size, device=device, compute_type="int8", cpu_threads=6)
        segments, _ = model.transcribe(pcm, language="ar", word_timestamps=True, vad_filter=True,
                                       initial_prompt=ARABIC_INITIAL_PROMPT)
        words: List[Dict[str, Any]] = []
        for seg in segments:
            if on_segment:
                on_segment(float(seg.end or 0.0))
            for w in seg.words or []:
                if str(w.word or "").strip():
                    words.append({"word": w.word.strip(), "start": float(w.start or 0), "end": float(w.end or 0)})
        return words
    finally:
        del model
        gc.collect()
        cleanup_cuda_vram()


def transcribe(audio: Path, backend: str = "local", model: str = "small", on_segment=None) -> Dict[str, Any]:
    """Returns {"words": [{"word","start","end"}], "backend", "model"}. backend: "local" (faster-whisper) | "groq"."""
    cache = JsonCache("asr")
    key = sha(_file_sha(audio), backend, model)
    hit = cache.get(key)
    if hit:
        return hit
    from backend import transcriber            # imported late: pulls in torch / faster-whisper

    if backend == "groq":
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # media_processor does `from progress import ...`
        from backend import media_processor
        dur = media_processor.probe_media_duration_seconds(audio)
        chunks = media_processor.slice_audio_for_groq(audio, dur)
        words = transcriber.transcribe_with_groq_chunks(chunks, os.environ.get("GROQ_API_KEY", ""), model_name=model)
    else:
        words = _local_whisper(audio, model, on_segment)
    out = {"words": words, "backend": backend, "model": model, "audio_sha": key}
    cache.put(key, out)
    return out
