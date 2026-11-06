"""The speech recognisers (ASR): each one turns a lecture's audio into timed words.

    Groq (cloud)  ·  faster-whisper large-v3-turbo or small (local, int8)  ·  specialized Whisper (local)

All of them have the same call, so the fallback chain in service.py can try one after another:

    words = backend.transcribe(audio, on_percent=..., check=ctx.check)     # [RawWord(text, start, end), ...]

The local ones never load a model themselves: they borrow it from the GPU owner (ADR 0006), which keeps
only one model in VRAM. `register_models(gpu)` tells the owner how to load each one.

Every failure becomes an `AsrError`, so the chain can fall back; a cancelled or interrupted job is never
turned into one (it must reach the job runner).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from wahy.core.gpu import GpuOwner
from wahy.core.jobs import JobCancelled, JobInterrupted
from wahy.core.settings import Settings
from wahy.features.transcription.audio import PreparedAudio

ARABIC_PROMPT = ("إن الحمد لله نحمده ونستعينه ونستغفره، قال الله تعالى في القرآن الكريم، "
                 "وقال رسول الله صلى الله عليه وسلم في الحديث الصحيح:")

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
SPECIALIZED_MODEL_ID = "Abu-Dju/whisper-large-v3-ar"

log = logging.getLogger("wahy.asr")


class AsrError(RuntimeError):
    """A recogniser failed (missing key, rejected request, model not installed, crash...)."""


class OutOfGpuMemory(AsrError):
    """The GPU ran out of memory: the next smaller model may still fit."""


@dataclass(frozen=True)
class RawWord:
    text: str
    start: float
    end: float


class AsrBackend(Protocol):
    id: str            # what the API and the web app call it
    label: str         # what a lecture records as its model, e.g. "groq:whisper-large-v3-turbo"

    def transcribe(self, audio: PreparedAudio, *, on_percent: Callable[[float], None],
                   check: Callable[[], None]) -> list[RawWord]: ...


@contextmanager
def _translating(what: str) -> Iterator[None]:
    """Turn any failure inside into an AsrError (an out-of-memory one into OutOfGpuMemory)."""
    try:
        yield
    except (JobCancelled, JobInterrupted, AsrError):
        raise
    except ImportError as e:
        raise AsrError(f"{what} is not installed ({e.name}); install the local-asr extra: "
                       "uv sync --extra local-asr") from e
    except Exception as e:
        text = str(e).lower()
        if "out of memory" in text or "cuda" in text or "cublas" in text:
            raise OutOfGpuMemory(f"the GPU ran out of memory or failed while running {what}: {e}") from e
        raise AsrError(f"{what} failed: {e}") from e


def _words_of_segment(text: str, start: float, end: float) -> list[RawWord]:
    """A segment that came without word times: spread its words evenly over it."""
    pieces = text.strip().split()
    if not pieces:
        return []
    step = max(0.08, (end - start) / len(pieces))
    return [RawWord(p, start + i * step, start + (i + 1) * step) for i, p in enumerate(pieces)]


# ---- Groq (cloud) --------------------------------------------------------------------------------

class GroqBackend:
    id = "groq-whisper-large-v3-turbo"
    label = "groq:whisper-large-v3-turbo"
    RETRY_STATUS = {429, 500, 502, 503, 504}

    def __init__(self, api_key: Callable[[], str | None], *, transport: httpx.BaseTransport | None = None,
                 sleep: Callable[[float], None] = time.sleep, attempts: int = 3):
        self._api_key = api_key
        self._transport = transport
        self._sleep = sleep
        self._attempts = attempts

    def transcribe(self, audio: PreparedAudio, *, on_percent: Callable[[float], None],
                   check: Callable[[], None]) -> list[RawWord]:
        key = self._api_key()
        if not key:
            raise AsrError("no Groq API key: set GROQ_API_KEY in .env, or pick a local model")
        words: list[RawWord] = []
        with _translating("Groq"):
            chunks = audio.groq_chunks()
            with httpx.Client(timeout=300.0, transport=self._transport) as client:
                for i, chunk in enumerate(chunks):
                    check()
                    payload = self._post(client, key, chunk.path, check)
                    words += self._words(payload, chunk.offset_s)
                    on_percent(100 * (i + 1) / len(chunks))
        return words

    def _post(self, client: httpx.Client, key: str, path, check: Callable[[], None]) -> dict[str, Any]:
        last = ""
        for attempt in range(self._attempts):
            check()
            wait: float | None = None
            try:
                with open(path, "rb") as fp:
                    resp = client.post(
                        GROQ_URL, headers={"Authorization": f"Bearer {key}"},
                        files={"file": (path.name, fp, "audio/mpeg")},
                        data={"model": "whisper-large-v3-turbo", "language": "ar",
                              "response_format": "verbose_json", "prompt": ARABIC_PROMPT,
                              "timestamp_granularities[]": ["word", "segment"]})
            except httpx.HTTPError as e:
                last = f"connection failed: {e}"
            else:
                if resp.status_code == 200:
                    return resp.json()
                last = f"HTTP {resp.status_code}: {resp.text[:300]}"
                if resp.status_code not in self.RETRY_STATUS:
                    break
                wait = _retry_after(resp)
            if attempt + 1 < self._attempts:
                self._wait(wait or 2.0 * 2 ** attempt, check)
        raise AsrError(f"Groq rejected the request ({last})")

    def _wait(self, seconds: float, check: Callable[[], None]) -> None:
        """Sleep in short steps so a pause or cancel still works while waiting."""
        end = time.monotonic() + seconds
        while (left := end - time.monotonic()) > 0:
            check()
            self._sleep(min(1.0, left))

    @staticmethod
    def _words(payload: dict[str, Any], offset: float) -> list[RawWord]:
        if payload.get("words"):
            return [RawWord(str(w.get("word") or "").strip(), float(w.get("start") or 0.0) + offset,
                            float(w.get("end") or 0.0) + offset) for w in payload["words"]]
        out: list[RawWord] = []
        for seg in payload.get("segments") or []:
            start = float(seg.get("start") or 0.0) + offset
            end = float(seg.get("end") or start + 1.0) + offset
            out += _words_of_segment(str(seg.get("text") or ""), start, end)
        return out


def _retry_after(resp: httpx.Response) -> float | None:
    try:
        return min(60.0, float(resp.headers["retry-after"]))
    except (KeyError, ValueError):
        return None


# ---- local faster-whisper ------------------------------------------------------------------------

class LocalWhisperBackend:
    """faster-whisper, int8, through the GPU owner. `gpu_key` is the name it was registered under."""

    def __init__(self, gpu: GpuOwner, *, id: str, label: str, gpu_key: str):
        self.gpu, self.id, self.label, self.gpu_key = gpu, id, label, gpu_key

    def transcribe(self, audio: PreparedAudio, *, on_percent: Callable[[float], None],
                   check: Callable[[], None]) -> list[RawWord]:
        words: list[RawWord] = []
        try:
            with _translating(self.label):
                samples = audio.array()
                with self.gpu.use(self.gpu_key, should_stop=check) as model:
                    segments, _info = model.transcribe(samples, language="ar", word_timestamps=True,
                                                       vad_filter=True, initial_prompt=ARABIC_PROMPT)
                    for seg in segments:
                        check()
                        if audio.duration_s:
                            on_percent(min(100.0, 100 * float(seg.end or 0.0) / audio.duration_s))
                        if getattr(seg, "words", None):
                            words += [RawWord(str(w.word or "").strip(), float(w.start or 0.0),
                                              float(w.end or 0.0)) for w in seg.words]
                        else:
                            start = float(seg.start or 0.0)
                            words += _words_of_segment(str(seg.text or ""), start,
                                                       float(seg.end or start + 1.0))
        except OutOfGpuMemory:
            self.gpu.unload()          # outside `use`: a half-run model must not stay in memory
            raise
        return words


# ---- the specialized Arabic Whisper --------------------------------------------------------------

class SpecializedBackend:
    id = "specialized-whisper-large-v3-ar"
    label = f"local:{SPECIALIZED_MODEL_ID}"
    gpu_key = "whisper:specialized-ar"

    def __init__(self, gpu: GpuOwner):
        self.gpu = gpu

    def transcribe(self, audio: PreparedAudio, *, on_percent: Callable[[float], None],
                   check: Callable[[], None]) -> list[RawWord]:
        words: list[RawWord] = []
        try:
            with _translating(self.label):
                samples = audio.array()
                with self.gpu.use(self.gpu_key, should_stop=check) as pipe:
                    on_percent(0.0)
                    batch = 8 if getattr(getattr(pipe, "device", None), "type", "cpu") == "cuda" else 1
                    out = pipe({"raw": samples, "sampling_rate": 16000},
                               generate_kwargs={"language": "arabic", "task": "transcribe"},
                               return_timestamps="word", batch_size=batch)
                for c in (out.get("chunks") or []) if isinstance(out, dict) else []:
                    text = str(c.get("text", "")).strip()
                    if not text:
                        continue
                    a, b = c.get("timestamp") or (0.0, 0.0)
                    start = float(a if a is not None else 0.0)
                    end = float(b if b is not None else start + 0.2)
                    words.append(RawWord(text, round(start, 3), round(max(end, start + 0.05), 3)))
                if not words and isinstance(out, dict) and out.get("text"):
                    words = [RawWord(w, round(i * 0.3, 3), round((i + 1) * 0.3, 3))
                             for i, w in enumerate(str(out["text"]).split())]
        except OutOfGpuMemory:
            self.gpu.unload()
            raise
        return words


# ---- how the GPU owner loads them ----------------------------------------------------------------

def _cuda_available() -> bool:
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def _preload_cuda_libraries() -> None:
    """faster-whisper (ctranslate2) needs cuBLAS 12 and cuDNN 9. The pip packages `nvidia-cublas-cu12` and
    `nvidia-cudnn-cu12` (in the local-asr extra) hold them but are not on the system library path, so load
    them into the process first; ctranslate2 then finds them. Anything missing is simply skipped: the model
    load that follows reports it."""
    import ctypes
    import importlib.util
    from pathlib import Path

    for package, names in (("nvidia.cublas", ("libcublasLt.so.12", "libcublas.so.12")),
                           ("nvidia.cudnn", ("libcudnn.so.9",))):
        try:
            spec = importlib.util.find_spec(package)
        except ModuleNotFoundError:
            continue
        for root in (spec.submodule_search_locations or []) if spec else []:
            for name in names:
                lib = Path(root) / "lib" / name
                if lib.exists():
                    try:
                        ctypes.CDLL(str(lib), mode=ctypes.RTLD_GLOBAL)
                    except OSError:
                        pass


def _load_faster_whisper(size: str) -> Any:
    """int8 keeps large-v3-turbo near 2.2 GB and small near 0.8 GB, which fits the 3 GB GTX 1050. When CUDA
    can't be used, `small` runs on the CPU (slow but it works); the bigger model fails, so the chain moves
    on to `small`."""
    from faster_whisper import WhisperModel

    if _cuda_available():
        _preload_cuda_libraries()
        try:
            return WhisperModel(size, device="cuda", compute_type="int8", cpu_threads=4)
        except Exception as e:
            if size != "small":
                raise
            log.warning("CUDA failed for whisper %s (%s); running it on the CPU", size, e)
    return WhisperModel(size, device="cpu", compute_type="int8", cpu_threads=4)


def _load_specialized() -> Any:
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

    cuda = torch.cuda.is_available()
    dtype = torch.float16 if cuda else torch.float32
    model = AutoModelForSpeechSeq2Seq.from_pretrained(SPECIALIZED_MODEL_ID, torch_dtype=dtype,
                                                      low_cpu_mem_usage=True, use_safetensors=True)
    if cuda:
        model.to("cuda:0")
    processor = AutoProcessor.from_pretrained(SPECIALIZED_MODEL_ID)
    return pipeline("automatic-speech-recognition", model=model, tokenizer=processor.tokenizer,
                    feature_extractor=processor.feature_extractor, torch_dtype=dtype,
                    return_timestamps="word", chunk_length_s=30)


def register_models(gpu: GpuOwner) -> None:
    """Tell the GPU owner how to load each speech model (nothing is loaded until a job asks)."""
    gpu.register("whisper:large-v3-turbo", load=lambda: _load_faster_whisper("large-v3-turbo"))
    gpu.register("whisper:small", load=lambda: _load_faster_whisper("small"))
    gpu.register(SpecializedBackend.gpu_key, load=_load_specialized)


def default_backends(gpu: GpuOwner, settings: Settings) -> dict[str, AsrBackend]:
    local = [
        LocalWhisperBackend(gpu, id="local-turbo-int8", label="local:faster-whisper-large-v3-turbo-int8",
                            gpu_key="whisper:large-v3-turbo"),
        LocalWhisperBackend(gpu, id="local-small-int8", label="local:faster-whisper-small-int8",
                            gpu_key="whisper:small"),
    ]
    backends: list[AsrBackend] = [GroqBackend(lambda: settings.key("groq")), SpecializedBackend(gpu), *local]
    return {b.id: b for b in backends}
