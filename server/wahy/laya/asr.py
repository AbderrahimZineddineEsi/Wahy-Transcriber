"""ASR with an on-disk cache keyed by (audio bytes, backend, model): the expensive step runs once per lesson,
whatever engine or labelling change comes later."""
from __future__ import annotations

import hashlib
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


def transcribe(audio: Path, backend: str = "local", model: str = "small", on_segment=None) -> Dict[str, Any]:
    """Returns {"words": [{"word","start","end"}], "backend", "model"}. backend: "local" (faster-whisper, model
    "small" or "large-v3-turbo") | "groq" (model "whisper-large-v3-turbo").

    Since rewrite phase 22 the speech models are the app's (wahy/features/transcription): Groq through core/ai (its
    key, retries and request log), local Whisper through the GPU owner, both fed by the same ffmpeg step. Every
    lecture transcribed before is in the cache, so only new lectures run them. `on_segment(seconds)` is told how
    far the transcription has got."""
    import tempfile

    from wahy.core.ai.types import Call
    from wahy.features.transcription.audio import AudioTools
    from wahy.features.transcription.backends import GroqBackend, LocalWhisperBackend, _load_faster_whisper

    from . import context

    cache = JsonCache("asr")
    key = sha(_file_sha(audio), backend, model)
    hit = cache.get(key)
    if hit:
        return hit
    with tempfile.TemporaryDirectory(prefix="laya_asr_") as tmp:
        prepared = AudioTools().prepare(audio, Path(tmp))

        def on_percent(pct: float) -> None:
            if on_segment:
                on_segment(prepared.duration_s * pct / 100)

        call = Call(purpose="transcribe")
        if backend == "groq":
            if model != GroqBackend.id.removeprefix("groq-"):
                raise ValueError(f"groq runs whisper-large-v3-turbo only, not {model!r}")
            raw = GroqBackend(context.ai().groq).transcribe(prepared, on_percent=on_percent, check=call.check, call=call)
        else:
            gpu, gpu_key = context.gpu(), f"whisper:{model}"
            gpu.register(gpu_key, load=lambda: _load_faster_whisper(model))
            raw = LocalWhisperBackend(gpu, id=f"local-{model}", label=f"local:faster-whisper-{model}-int8",
                                      gpu_key=gpu_key).transcribe(prepared, on_percent=on_percent, check=call.check,
                                                                  call=call)
    words = [{"word": w.word.strip(), "start": float(w.start), "end": float(w.end)} for w in raw if str(w.word).strip()]
    out = {"words": words, "backend": backend, "model": model, "audio_sha": key}
    cache.put(key, out)
    return out
