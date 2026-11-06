"""HTTP for transcription: list the models, start a transcription from a YouTube link, an uploaded file or an
existing lecture. Each start returns at once with the job; follow it at GET /api/jobs/{id}/events."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from wahy.features.lectures.media import MediaError
from wahy.features.lectures.service import LectureNotFound
from wahy.features.transcription.schemas import ModelInfo, Started, TranscribeOptions, YoutubeRequest
from wahy.features.transcription.service import TranscriptionService, UnknownModel

router = APIRouter(tags=["transcription"])


def get_transcription(request: Request) -> TranscriptionService:
    return request.app.state.transcription


Service = Annotated[TranscriptionService, Depends(get_transcription)]


@router.get("/api/transcription/models")
def list_models(service: Service) -> list[ModelInfo]:
    return service.models()


@router.post("/api/transcriptions/youtube", status_code=202)
def transcribe_youtube(body: YoutubeRequest, service: Service) -> Started:
    """Make a lecture from a YouTube link: download, extract the audio, transcribe."""
    try:
        return service.start_youtube(body.url, title=body.title, model=body.model,
                                     auto_fallback=body.auto_fallback)
    except UnknownModel as e:
        raise HTTPException(422, str(e)) from None


@router.post("/api/transcriptions/upload", status_code=202)
def transcribe_upload(service: Service, file: Annotated[UploadFile, File()],
                      title: Annotated[str | None, Form()] = None,
                      model: Annotated[str | None, Form()] = None,
                      auto_fallback: Annotated[bool, Form()] = True) -> Started:
    """Make a lecture from an uploaded audio or video file."""
    try:
        return service.start_upload(file.file, file.filename or "", title=title, model=model,
                                    auto_fallback=auto_fallback)
    except UnknownModel as e:
        raise HTTPException(422, str(e)) from None
    except MediaError as e:
        raise HTTPException(400, str(e)) from None


@router.post("/api/lectures/{lecture_id}/transcribe", status_code=202)
def transcribe_lecture(lecture_id: int, body: TranscribeOptions, service: Service) -> Started:
    """Transcribe (again) a lecture that has a link or media. The new words replace the old ones."""
    try:
        return service.start_for_lecture(lecture_id, model=body.model, auto_fallback=body.auto_fallback)
    except LectureNotFound:
        raise HTTPException(404, f"no lecture {lecture_id}") from None
    except UnknownModel as e:
        raise HTTPException(422, str(e)) from None
    except MediaError as e:
        raise HTTPException(409, str(e)) from None
