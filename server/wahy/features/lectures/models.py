"""Tables for lectures, their transcript words and their saved versions (GLOSSARY: Lecture, Word, Lecture
version)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class Lecture(Base):
    __tablename__ = "lectures"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    # how it came in: text | srt | vtt | youtube | upload | sample
    source_kind: Mapped[str] = mapped_column(String(16))
    source_url: Mapped[str | None]                 # the YouTube link, when there is one
    media_path: Mapped[str | None]                 # relative to settings.media_dir
    duration_s: Mapped[float | None]
    language: Mapped[str] = mapped_column(String(8), default="ar")
    # which model produced the words, for example "groq:whisper-large-v3-turbo"; None for text lectures
    transcription_model: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Word(Base):
    """One transcript token. `idx` is its position in the transcript, which findings refer to
    (wordStartIdx...)."""

    __tablename__ = "words"
    __table_args__ = (UniqueConstraint("lecture_id", "idx"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lecture_id: Mapped[int] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    idx: Mapped[int]
    text: Mapped[str]
    start: Mapped[float]
    end: Mapped[float]


class LectureVersion(Base):
    """A saved snapshot of a lecture's findings and verdicts, so two passes over the same lecture can be
    compared. The snapshot is one JSON document: versions are read whole and never queried inside."""

    __tablename__ = "lecture_versions"
    __table_args__ = (Index(None, "lecture_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lecture_id: Mapped[int] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    name: Mapped[str]
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
