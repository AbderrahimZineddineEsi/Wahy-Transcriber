"""HTTP for lectures: create from text, a subtitle file or the sample; list, open, rename, delete; attach and
serve media; save versions. It only translates HTTP to `LectureService` calls (YouTube links and uploaded
audio start in features/transcription, which creates the lecture and its transcription job together)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from wahy.features.lectures.media import MediaError
from wahy.features.lectures.schemas import (
    CreateLecture,
    CreateVersion,
    LectureDetail,
    LectureSummary,
    RenameLecture,
    RenameVersion,
    VersionDetail,
    VersionSummary,
)
from wahy.features.lectures.service import (
    BadLectureInput,
    LectureError,
    LectureNotFound,
    LectureService,
    VersionNotFound,
)

router = APIRouter(prefix="/api/lectures", tags=["lectures"])

TEXT_FILE_SUFFIXES = (".txt", ".srt", ".vtt")
MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024


def get_lectures(request: Request) -> LectureService:
    return request.app.state.lectures


Lectures = Annotated[LectureService, Depends(get_lectures)]


@contextmanager
def lecture_errors() -> Iterator[None]:
    """The lecture errors as HTTP answers: 404 not found, 422 unusable input, 400 bad media, 409 can't now."""
    try:
        yield
    except (LectureNotFound, VersionNotFound) as e:
        raise HTTPException(404, f"not found: {e}") from None
    except BadLectureInput as e:
        raise HTTPException(422, str(e)) from None
    except MediaError as e:
        raise HTTPException(400, str(e)) from None
    except LectureError as e:
        raise HTTPException(409, str(e)) from None


@router.get("")
def list_lectures(lectures: Lectures) -> list[LectureSummary]:
    return lectures.list()


@router.post("", status_code=201)
def create_lecture(body: CreateLecture, lectures: Lectures) -> LectureDetail:
    """Pasted text, or the content of an .srt / .vtt file (subtitle cues keep their times)."""
    with lecture_errors():
        return lectures.create_from_text(body.text, title=body.title, filename=body.filename)


@router.post("/import", status_code=201)
def import_text_file(lectures: Lectures, file: Annotated[UploadFile, File()],
                     title: Annotated[str | None, Form()] = None) -> LectureDetail:
    """Upload a .txt, .srt or .vtt file."""
    name = file.filename or ""
    if not name.lower().endswith(TEXT_FILE_SUFFIXES):
        raise HTTPException(400, f"use a {', '.join(TEXT_FILE_SUFFIXES)} file")
    raw = file.file.read(MAX_TEXT_FILE_BYTES + 1)
    if len(raw) > MAX_TEXT_FILE_BYTES:
        raise HTTPException(413, "text file too large (5 MB at most)")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "the file is not UTF-8 text") from None
    with lecture_errors():
        return lectures.create_from_text(text, title=title, filename=name)


@router.post("/sample", status_code=201)
def create_sample_lecture(lectures: Lectures) -> LectureDetail:
    """The fixed sample lecture."""
    return lectures.create_sample()


@router.delete("")
def delete_all_lectures(lectures: Lectures, confirm: bool = False) -> dict[str, int]:
    """Delete every lecture. Needs `?confirm=true`."""
    if not confirm:
        raise HTTPException(400, "this deletes every lecture; send ?confirm=true")
    return {"deleted": lectures.delete_all()}


@router.get("/{lecture_id}")
def get_lecture(lecture_id: int, lectures: Lectures) -> LectureDetail:
    with lecture_errors():
        return lectures.get(lecture_id)


@router.patch("/{lecture_id}")
def rename_lecture(lecture_id: int, body: RenameLecture, lectures: Lectures) -> LectureSummary:
    with lecture_errors():
        return lectures.rename(lecture_id, body.title)


@router.delete("/{lecture_id}", status_code=204)
def delete_lecture(lecture_id: int, lectures: Lectures) -> None:
    with lecture_errors():
        lectures.delete(lecture_id)


@router.get("/{lecture_id}/media")
def get_media(lecture_id: int, lectures: Lectures) -> FileResponse:
    """The lecture's video or audio, for the player (supports Range requests, so seeking works)."""
    with lecture_errors():
        return FileResponse(lectures.media_file(lecture_id))


@router.put("/{lecture_id}/media")
def attach_media(lecture_id: int, lectures: Lectures, file: Annotated[UploadFile, File()]) -> LectureSummary:
    """Attach a local video or audio file to the lecture."""
    with lecture_errors():
        return lectures.attach_media(lecture_id, file.filename or "", file.file)


@router.get("/{lecture_id}/versions")
def list_versions(lecture_id: int, lectures: Lectures) -> list[VersionSummary]:
    with lecture_errors():
        return lectures.list_versions(lecture_id)


@router.post("/{lecture_id}/versions", status_code=201)
def save_version(lecture_id: int, body: CreateVersion, lectures: Lectures) -> VersionSummary:
    with lecture_errors():
        return lectures.save_version(lecture_id, body.name, body.snapshot)


@router.get("/{lecture_id}/versions/{version_id}")
def get_version(lecture_id: int, version_id: int, lectures: Lectures) -> VersionDetail:
    with lecture_errors():
        return lectures.get_version(lecture_id, version_id)


@router.patch("/{lecture_id}/versions/{version_id}")
def rename_version(lecture_id: int, version_id: int, body: RenameVersion,
                   lectures: Lectures) -> VersionSummary:
    with lecture_errors():
        return lectures.rename_version(lecture_id, version_id, body.name)


@router.delete("/{lecture_id}/versions/{version_id}", status_code=204)
def delete_version(lecture_id: int, version_id: int, lectures: Lectures) -> None:
    with lecture_errors():
        lectures.delete_version(lecture_id, version_id)
