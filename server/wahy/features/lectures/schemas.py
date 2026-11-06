"""What the lectures API sends and receives (the web app's types are generated from these)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class WordOut(BaseModel):
    idx: int
    text: str
    start: float
    end: float


class WordEdit(BaseModel):
    text: str = Field(min_length=1, description="the corrected word (one word)")


class LectureSummary(BaseModel):
    """One row of the saved lectures list."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    source_kind: str                  # text | srt | vtt | youtube | upload | sample
    source_url: str | None
    has_media: bool
    duration_s: float | None
    language: str
    transcription_model: str | None
    word_count: int
    version_count: int
    created_at: datetime
    updated_at: datetime


class LectureDetail(LectureSummary):
    words: list[WordOut]


class CreateLecture(BaseModel):
    """Pasted text or the content of a subtitle file. Subtitle cues are recognised from the content (or from
    `filename`), anything else is plain text."""

    text: str = Field(min_length=1)
    title: str | None = None
    filename: str = ""


class RenameLecture(BaseModel):
    title: str = Field(min_length=1)


class VersionSummary(BaseModel):
    id: int
    lecture_id: int
    name: str
    created_at: datetime


class VersionDetail(VersionSummary):
    snapshot: dict[str, Any]


class CreateVersion(BaseModel):
    name: str = Field(min_length=1)
    snapshot: dict[str, Any] = Field(default_factory=dict)


class RenameVersion(BaseModel):
    name: str = Field(min_length=1)
