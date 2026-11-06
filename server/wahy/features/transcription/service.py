"""Transcription: a lecture's media in, timed words out, as a job (ADR 0007).

    transcription = TranscriptionService(db, settings, gpu, jobs, lectures)
    started = transcription.start_youtube("https://youtu.be/...", model="groq-whisper-large-v3-turbo")
    started.job.id                      # follow it at /api/jobs/<id>/events

The job's stages, in order: `download` (YouTube only, and skipped when the link is cached), `audio` (ffmpeg),
`transcribe`, `save`. Its result says which model really ran:

    {"model_used": "local:faster-whisper-small-int8", "requested_model": "groq-whisper-large-v3-turbo",
     "fallback": {"reason": "Groq rejected the request (HTTP 401 ...)"}, "word_count": 5120,
     "warnings": [...]}

Fallback (F-022), when `auto_fallback` is on and a model fails: Groq → local turbo → local small;
specialized → Groq → local small; local turbo → local small. If every model fails, the first error is the
one reported.
"""

from __future__ import annotations

import importlib.util
import logging
from collections.abc import Callable
from dataclasses import asdict
from typing import Any, BinaryIO

from wahy.core.ai.groq import GroqAsr
from wahy.core.ai.log import RequestLog
from wahy.core.ai.types import Call
from wahy.core.db import Database
from wahy.core.gpu import GpuOwner
from wahy.core.jobs import JobContext, JobRunner
from wahy.core.settings import Settings
from wahy.features.lectures.media import MediaError
from wahy.features.lectures.parsing import TimedWord
from wahy.features.lectures.service import LectureService
from wahy.features.transcription.audio import AudioTools, PreparedAudio, remove_tree
from wahy.features.transcription.backends import (
    AsrBackend,
    AsrError,
    RawWord,
    default_backends,
    register_models,
)
from wahy.features.transcription.quality import check_transcript
from wahy.features.transcription.schemas import ModelInfo, Started

log = logging.getLogger("wahy.transcription")

GROQ, SPECIALIZED = "groq-whisper-large-v3-turbo", "specialized-whisper-large-v3-ar"
LOCAL_TURBO, LOCAL_SMALL = "local-turbo-int8", "local-small-int8"
FALLBACKS = {GROQ: [LOCAL_TURBO, LOCAL_SMALL], SPECIALIZED: [GROQ, LOCAL_SMALL], LOCAL_TURBO: [LOCAL_SMALL],
             LOCAL_SMALL: []}
STAGES = ["download", "audio", "transcribe", "save"]


class UnknownModel(ValueError):
    """The model id is not one of the four (the API answers 422)."""


def normalise_words(raw: list[RawWord]) -> list[TimedWord]:
    """Drop empty words and make each at least 0.04 s long, with times to 2 decimals (as the old app did)."""
    out: list[TimedWord] = []
    for w in raw:
        text = w.text.strip()
        if not text:
            continue
        start = round(float(w.start or 0.0), 2)
        end = round(max(start + 0.04, float(w.end or (start + 0.25))), 2)
        out.append(TimedWord(text, start, end))
    return out


class TranscriptionService:
    def __init__(self, db: Database, settings: Settings, gpu: GpuOwner, jobs: JobRunner,
                 lectures: LectureService, *, audio: AudioTools | None = None,
                 backends: dict[str, AsrBackend] | None = None, groq: GroqAsr | None = None):
        self.db, self.settings, self.gpu, self.jobs, self.lectures = db, settings, gpu, jobs, lectures
        self.audio = audio or AudioTools()
        groq = groq or GroqAsr(RequestLog(db), lambda: settings.key("groq"))
        self.backends = backends if backends is not None else default_backends(gpu, groq)
        if backends is None:
            register_models(gpu)
        jobs.register("transcribe", self.run_job)

    # ---- what the web app asks -------------------------------------------------------------------

    def models(self) -> list[ModelInfo]:
        has_key = self.settings.key("groq") is not None
        local_ok = importlib.util.find_spec("faster_whisper") is not None
        special_ok = all(importlib.util.find_spec(m) for m in ("torch", "transformers"))
        local_missing = "faster-whisper is not installed (uv sync --extra local-asr)"
        default = self.default_model()
        rows = [
            (GROQ, "Groq whisper-large-v3-turbo", "cloud", has_key, None if has_key else "no GROQ_API_KEY"),
            (SPECIALIZED, "Specialized Arabic Whisper (Quran and hadith)", "local", special_ok,
             None if special_ok else "needs torch and transformers"),
            (LOCAL_TURBO, "Local Whisper turbo (int8, ~2.2 GB VRAM)", "local", local_ok,
             None if local_ok else local_missing),
            (LOCAL_SMALL, "Local Whisper small (int8, ~0.8 GB VRAM)", "local", local_ok,
             None if local_ok else local_missing),
        ]
        return [ModelInfo(id=i, label=label, kind=kind, available=ok, reason=why, default=i == default)
                for i, label, kind, ok, why in rows]

    def default_model(self) -> str:
        return GROQ if self.settings.key("groq") else LOCAL_SMALL

    def start_youtube(self, url: str, *, title: str | None = None, model: str | None = None,
                      auto_fallback: bool = True) -> Started:
        """A new lecture from a YouTube link, transcribed in the background."""
        model = self._model(model)
        lecture_id = self.lectures.create_empty(title=(title or "").strip() or url, source_kind="youtube",
                                                source_url=url)
        return self._start(lecture_id, model, auto_fallback)

    def start_upload(self, stream: BinaryIO, filename: str, *, title: str | None = None,
                     model: str | None = None, auto_fallback: bool = True) -> Started:
        """A new lecture from an uploaded audio or video file, transcribed in the background."""
        model = self._model(model)
        media = self.lectures.media.save_upload(stream, filename)
        stem = filename.rsplit(".", 1)[0] if "." in filename else filename
        lecture_id = self.lectures.create_empty(title=(title or "").strip() or stem or "Upload",
                                                source_kind="upload", media_path=media)
        return self._start(lecture_id, model, auto_fallback)

    def start_for_lecture(self, lecture_id: int, *, model: str | None = None,
                          auto_fallback: bool = True) -> Started:
        """Transcribe (again) a lecture that has media: its link, or a file attached to it. The new words
        replace the old ones."""
        source = self.lectures.source(lecture_id)
        if not source.media_path and not source.source_url:
            raise MediaError("this lecture has no media or link to transcribe; attach a file first")
        return self._start(lecture_id, self._model(model), auto_fallback)

    def _model(self, model: str | None) -> str:
        model = model or self.default_model()
        if model not in FALLBACKS:
            raise UnknownModel(f"unknown model {model!r}; use one of {', '.join(FALLBACKS)}")
        return model

    def _start(self, lecture_id: int, model: str, auto_fallback: bool) -> Started:
        job = self.jobs.submit("transcribe", {"model": model, "auto_fallback": auto_fallback},
                               lecture_id=lecture_id)
        return Started(lecture=self.lectures.list_one(lecture_id), job=job)

    # ---- the job ---------------------------------------------------------------------------------

    def run_job(self, ctx: JobContext) -> dict[str, Any]:
        lecture_id = ctx.lecture_id
        assert lecture_id is not None
        model, auto_fallback = ctx.params["model"], ctx.params["auto_fallback"]
        source = self.lectures.source(lecture_id)
        ctx.progress(stage="download", stages=STAGES, model=model, percent=0)

        from_cache = None
        if source.media_path is None:
            assert source.source_url is not None
            got = self.lectures.media.fetch_youtube(
                source.source_url, check=ctx.check,
                on_progress=lambda p: ctx.progress(stage="download", percent=p))
            self.lectures.set_media(lecture_id, got.media_path, duration_s=got.duration_s,
                                    title_if_untitled=got.title or None)
            media_rel, from_cache = got.media_path, got.from_cache
        else:
            media_rel = source.media_path
        ctx.progress(stage="download", percent=100)

        work_dir = self.settings.media_dir / "tmp" / ctx.job_id
        try:
            ctx.progress(stage="audio", percent=None)
            audio = self.audio.prepare(self.lectures.media.path(media_rel), work_dir, ctx.check)
            ctx.progress(stage="transcribe", percent=0)
            used, raw, fallback = self._run_chain(
                model, auto_fallback, audio,
                Call(purpose="transcribe", job_id=ctx.job_id, lecture_id=lecture_id, check=ctx.check),
                lambda p: ctx.progress(stage="transcribe", percent=round(p, 1)))
            words = normalise_words(raw)
            if not words:
                raise AsrError("no speech was found in the audio")
            ctx.progress(stage="save", percent=None)
            self.lectures.replace_words(lecture_id, words, duration_s=round(audio.duration_s, 2),
                                        transcription_model=used)
            warnings = check_transcript(words)
        finally:
            remove_tree(work_dir)
        ctx.progress(stage="save", percent=100)
        return {"model_used": used, "requested_model": model, "fallback": fallback, "word_count": len(words),
                "duration_s": round(audio.duration_s, 2), "from_cache": from_cache,
                "warnings": [asdict(w) for w in warnings]}

    def _run_chain(self, model: str, auto_fallback: bool, audio: PreparedAudio, call: Call,
                   on_percent: Callable[[float], None]) -> tuple[str, list[RawWord], dict[str, str] | None]:
        """Try `model`, then (if allowed) its fallbacks. Returns the label that ran, the words, and why a
        fallback happened (None when the first choice worked)."""
        order = [model, *(FALLBACKS[model] if auto_fallback else [])]
        first_error: AsrError | None = None
        for model_id in order:
            backend = self.backends[model_id]
            try:
                raw = backend.transcribe(audio, on_percent=on_percent, check=call.check, call=call)
            except AsrError as e:
                log.warning("%s failed: %s", model_id, e)
                first_error = first_error or e
                continue
            return backend.label, raw, ({"reason": str(first_error)} if first_error else None)
        assert first_error is not None
        raise first_error
