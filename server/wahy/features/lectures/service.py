"""Lectures: what each user action does, in one call per action. The router only turns HTTP into these calls
(GLOSSARY: Lecture, Word, Lecture version).

    lectures = LectureService(db, settings)
    lecture = lectures.create_from_text(srt_content, filename="a.srt")   # a file: its own timings
    lectures.get(lecture.id).words
    lectures.save_version(lecture.id, "after v4", snapshot)

Lectures made from a YouTube link or an uploaded file start empty (`create_empty`) and get their words when
the transcription job finishes (`replace_words`); that job belongs to features/transcription, which depends
on this module, never the other way round.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO

from sqlalchemy import Select, delete, func, insert, select
from sqlalchemy.orm import Session

from wahy.core.db import Database, utcnow
from wahy.core.settings import Settings
from wahy.features.lectures.media import MediaStore
from wahy.features.lectures.models import Lecture, LectureVersion, Word
from wahy.features.lectures.parsing import TimedWord, looks_like_subtitles, words_from_content
from wahy.features.lectures.schemas import (
    LectureDetail,
    LectureSummary,
    VersionDetail,
    VersionSummary,
    WordOut,
)

SAMPLE_TITLE = "محاضرة تجريبية — آيات وأحاديث وأذكار"
SAMPLE_TEXT_PATH = Path(__file__).with_name("sample_lecture.txt")


@dataclass(frozen=True)
class LectureSource:
    title: str
    source_kind: str
    source_url: str | None
    media_path: str | None          # relative to the media folder


class LectureError(Exception):
    """The request can't be done in the lecture's current state (the API answers 409)."""


class LectureNotFound(LectureError, KeyError):
    pass


class VersionNotFound(LectureError, KeyError):
    pass


class BadLectureInput(LectureError, ValueError):
    """The input is unusable (the API answers 422)."""


def _title_from(text: str) -> str:
    first = " ".join(text.split()[:6])
    return first or "Untitled"


class LectureService:
    def __init__(self, db: Database, settings: Settings, media: MediaStore | None = None):
        self.db = db
        self.settings = settings
        self.media = media or MediaStore(settings.media_dir)

    # ---- creating ------------------------------------------------------------------------------------------

    def create_from_text(self, text: str, *, title: str | None = None, filename: str = "") -> LectureDetail:
        """Pasted text, or the content of a .txt / .srt / .vtt file. Subtitle cues keep their times; plain
        text gets estimated ones."""
        content = text.strip()
        if not content:
            raise BadLectureInput("the text is empty")
        words = words_from_content(content, filename)
        if not words:
            raise BadLectureInput("no words found in the text")
        if looks_like_subtitles(content, filename):
            kind = "vtt" if content.lstrip("﻿").startswith("WEBVTT") or filename.lower().endswith(".vtt") \
                else "srt"
        else:
            kind = "text"
        title = (title or "").strip() or (Path(filename).stem if filename else "") or _title_from(content)
        lecture_id = self._create(title, kind)
        self.replace_words(lecture_id, words)
        return self.get(lecture_id)

    def create_sample(self) -> LectureDetail:
        """The fixed sample lecture (verses, hadith and adhkar), the same every time."""
        text = SAMPLE_TEXT_PATH.read_text("utf-8")
        lecture_id = self._create(SAMPLE_TITLE, "sample")
        self.replace_words(lecture_id, words_from_content(text))
        return self.get(lecture_id)

    def create_empty(self, *, title: str, source_kind: str, source_url: str | None = None,
                     media_path: str | None = None) -> int:
        """A lecture that has no words yet (a transcription will fill it). Returns its id."""
        return self._create(title, source_kind, source_url=source_url, media_path=media_path)

    def _create(self, title: str, source_kind: str, *, source_url: str | None = None,
                media_path: str | None = None) -> int:
        with self.db.session() as s:
            lecture = Lecture(title=title, source_kind=source_kind, source_url=source_url,
                              media_path=media_path)
            s.add(lecture)
            s.flush()
            return lecture.id

    # ---- reading -------------------------------------------------------------------------------------------

    def list(self) -> list[LectureSummary]:
        """Newest first."""
        with self.db.session() as s:
            rows = s.execute(self._summaries().order_by(Lecture.created_at.desc(), Lecture.id.desc()))
            return [self._summary(*row) for row in rows]

    def get(self, lecture_id: int) -> LectureDetail:
        with self.db.session() as s:
            row = s.execute(self._summaries().where(Lecture.id == lecture_id)).first()
            if row is None:
                raise LectureNotFound(lecture_id)
            words = s.execute(select(Word.idx, Word.text, Word.start, Word.end)
                              .where(Word.lecture_id == lecture_id).order_by(Word.idx))
            summary = self._summary(*row)
            return LectureDetail(**summary.model_dump(),
                                 words=[WordOut(idx=i, text=t, start=a, end=b) for i, t, a, b in words])

    def media_file(self, lecture_id: int) -> Path:
        """The lecture's media on disk (for the player), or LectureNotFound when it has none."""
        with self.db.session() as s:
            lecture = self._lecture(s, lecture_id)
            rel = lecture.media_path
        if not rel:
            raise LectureNotFound(f"lecture {lecture_id} has no media")
        path = self.media.path(rel)
        if not path.exists():
            raise LectureNotFound(f"the media file of lecture {lecture_id} is missing")
        return path

    def source(self, lecture_id: int) -> LectureSource:
        """Where the lecture came from, for the transcription job."""
        with self.db.session() as s:
            lecture = self._lecture(s, lecture_id)
            return LectureSource(lecture.title, lecture.source_kind, lecture.source_url, lecture.media_path)

    @staticmethod
    def _summaries() -> Select[Any]:
        words = select(func.count(Word.id)).where(Word.lecture_id == Lecture.id).scalar_subquery()
        versions = (select(func.count(LectureVersion.id))
                    .where(LectureVersion.lecture_id == Lecture.id).scalar_subquery())
        return select(Lecture, words, versions)

    @staticmethod
    def _summary(lecture: Lecture, word_count: int, version_count: int) -> LectureSummary:
        return LectureSummary(
            id=lecture.id, title=lecture.title, source_kind=lecture.source_kind,
            source_url=lecture.source_url, has_media=bool(lecture.media_path), duration_s=lecture.duration_s,
            language=lecture.language, transcription_model=lecture.transcription_model,
            word_count=word_count, version_count=version_count, created_at=lecture.created_at,
            updated_at=lecture.updated_at)

    @staticmethod
    def _lecture(s: Session, lecture_id: int) -> Lecture:
        lecture = s.get(Lecture, lecture_id)
        if lecture is None:
            raise LectureNotFound(lecture_id)
        return lecture

    # ---- changing ------------------------------------------------------------------------------------------

    def rename(self, lecture_id: int, title: str) -> LectureSummary:
        title = title.strip()
        if not title:
            raise BadLectureInput("the title is empty")
        with self.db.session() as s:
            self._lecture(s, lecture_id).title = title
        return self.list_one(lecture_id)

    def replace_words(self, lecture_id: int, words: Sequence[TimedWord], *, duration_s: float | None = None,
                      transcription_model: str | None = None) -> None:
        """Save the lecture's words (replacing any it has). `idx` counts from 0 in transcript order."""
        rows = [dict(lecture_id=lecture_id, idx=i, text=w.text, start=w.start, end=w.end)
                for i, w in enumerate(words)]
        with self.db.session() as s:
            lecture = self._lecture(s, lecture_id)
            s.execute(delete(Word).where(Word.lecture_id == lecture_id))
            for i in range(0, len(rows), 5000):         # SQLite limits the variables in one statement
                s.execute(insert(Word), rows[i:i + 5000])
            if duration_s is not None:
                lecture.duration_s = duration_s
            elif rows and lecture.duration_s is None:
                lecture.duration_s = rows[-1]["end"]
            if transcription_model is not None:
                lecture.transcription_model = transcription_model
            lecture.updated_at = utcnow()

    def set_media(self, lecture_id: int, media_path: str, *, duration_s: float | None = None,
                  title_if_untitled: str | None = None) -> None:
        """Record the lecture's media file (a download or an attachment). A lecture still titled with its own
        link (nobody named it) takes the video's title."""
        with self.db.session() as s:
            lecture = self._lecture(s, lecture_id)
            lecture.media_path = media_path
            if duration_s:
                lecture.duration_s = duration_s
            if title_if_untitled and lecture.title == (lecture.source_url or ""):
                lecture.title = title_if_untitled
            lecture.updated_at = utcnow()

    def attach_media(self, lecture_id: int, filename: str, stream: BinaryIO) -> LectureSummary:
        """Attach a local video or audio file to the lecture, for example one made from text (F-026)."""
        with self.db.session() as s:
            self._lecture(s, lecture_id)
        new = self.media.save_upload(stream, filename)
        with self.db.session() as s:
            lecture = self._lecture(s, lecture_id)
            old, lecture.media_path = lecture.media_path, new
            lecture.updated_at = utcnow()
        self._drop_media_if_unused(old)
        return self.list_one(lecture_id)

    def delete(self, lecture_id: int) -> None:
        """Delete the lecture with its words and versions (and its media, unless another lecture uses it)."""
        with self.db.session() as s:
            lecture = self._lecture(s, lecture_id)
            media = lecture.media_path
            s.delete(lecture)
        self._drop_media_if_unused(media)

    def delete_all(self) -> int:
        """Delete every lecture. Returns how many there were."""
        with self.db.session() as s:
            media = list(s.scalars(select(Lecture.media_path).where(Lecture.media_path.is_not(None))))
            count = s.scalar(select(func.count(Lecture.id))) or 0
            s.execute(delete(Lecture))
        for m in set(media):
            self._drop_media_if_unused(m)
        return count

    def _drop_media_if_unused(self, media_path: str | None) -> None:
        if not media_path:
            return
        with self.db.session() as s:
            used = s.scalar(select(func.count(Lecture.id)).where(Lecture.media_path == media_path))
        if not used:
            self.media.remove(media_path)

    def list_one(self, lecture_id: int) -> LectureSummary:
        with self.db.session() as s:
            row = s.execute(self._summaries().where(Lecture.id == lecture_id)).first()
            if row is None:
                raise LectureNotFound(lecture_id)
            return self._summary(*row)

    # ---- versions ------------------------------------------------------------------------------------------

    def save_version(self, lecture_id: int, name: str, snapshot: dict[str, Any]) -> VersionSummary:
        """Save a snapshot of the lecture's findings and verdicts under `name`."""
        with self.db.session() as s:
            self._lecture(s, lecture_id)
            version = LectureVersion(lecture_id=lecture_id, name=name.strip() or "version", snapshot=snapshot)
            s.add(version)
            s.flush()
            return VersionSummary.model_validate(version, from_attributes=True)

    def list_versions(self, lecture_id: int) -> list[VersionSummary]:
        """Oldest first."""
        with self.db.session() as s:
            self._lecture(s, lecture_id)
            rows = s.scalars(select(LectureVersion).where(LectureVersion.lecture_id == lecture_id)
                             .order_by(LectureVersion.id))
            return [VersionSummary.model_validate(v, from_attributes=True) for v in rows]

    def get_version(self, lecture_id: int, version_id: int) -> VersionDetail:
        with self.db.session() as s:
            version = self._version(s, lecture_id, version_id)
            return VersionDetail.model_validate(version, from_attributes=True)

    def rename_version(self, lecture_id: int, version_id: int, name: str) -> VersionSummary:
        name = name.strip()
        if not name:
            raise BadLectureInput("the name is empty")
        with self.db.session() as s:
            version = self._version(s, lecture_id, version_id)
            version.name = name
            return VersionSummary.model_validate(version, from_attributes=True)

    def delete_version(self, lecture_id: int, version_id: int) -> None:
        """Delete a version. A lecture always keeps at least one."""
        with self.db.session() as s:
            version = self._version(s, lecture_id, version_id)
            count = s.scalar(select(func.count(LectureVersion.id))
                             .where(LectureVersion.lecture_id == lecture_id))
            if count <= 1:
                raise LectureError("the last version of a lecture can't be deleted")
            s.delete(version)

    @staticmethod
    def _version(s: Session, lecture_id: int, version_id: int) -> LectureVersion:
        version = s.get(LectureVersion, version_id)
        if version is None or version.lecture_id != lecture_id:
            raise VersionNotFound(version_id)
        return version

