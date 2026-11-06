"""Export: a lecture's captions (SRT, VTT, ASS) and formatted text (Markdown, plain text, HTML, JSON),
written by
the engine package (engine/src/export.ts) so the web app's preview and the files are the same (ROADMAP phase
16).

    export = ExportService(db, engine, lectures, detection, editing)
    export.file(lecture_id, "srt")                          # {filename, mime, content}
    export.file(lecture_id, "md", script="standard", show={"CORRECT"})
    export.update_style(ExportStylePatch(quranBracketOpen="«"))

What an export shows is what the screen shows: the saved style (F-071), "as spoken" or "standard script"
(F-038),
and the verdict and kind filters (F-036, F-037): a finding that is filtered out keeps its words, as speech.
The
caption timing editor's edits are applied to the caption files.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any

from sqlalchemy import select

from wahy.core.db import Database
from wahy.core.engine import EngineClient
from wahy.features.detection.models import Finding
from wahy.features.detection.service import DetectionService
from wahy.features.editing.service import EditingService
from wahy.features.export.schemas import ExportStyle, ExportStylePatch
from wahy.features.lectures.models import Word
from wahy.features.lectures.service import LectureService
from wahy.features.settings.store import SettingsStore

SETTINGS_KEY = "export"
KIND_OF = {"QURAN": "quran", "HADITH": "hadith", "ADHKAR": "dhikr"}
ALL_VERDICTS = frozenset({"CORRECT", "NOT_SURE", "FALSE", "NONE"})


class ExportService:
    def __init__(
        self,
        db: Database,
        engine: EngineClient,
        lectures: LectureService,
        detection: DetectionService,
        editing: EditingService,
    ):
        self.db, self.engine, self.lectures, self.detection, self.editing = (
            db,
            engine,
            lectures,
            detection,
            editing,
        )
        self.store = SettingsStore(db)

    # ---- the saved style (F-071)
    # ---------------------------------------------------------------------------------

    def style(self) -> ExportStyle:
        return ExportStyle.model_validate(self.store.get(SETTINGS_KEY, {}))

    def update_style(self, patch: ExportStylePatch) -> ExportStyle:
        new = self.style().model_copy(update=patch.model_dump(exclude_none=True))
        new = ExportStyle.model_validate(new.model_dump())
        self.store.set(SETTINGS_KEY, new.model_dump())
        return new

    # ---- files
    # ---------------------------------------------------------------------------------------------------

    def file(
        self,
        lecture_id: int,
        fmt: str,
        *,
        script: str = "spoken",
        show: Collection[str] = ALL_VERDICTS,
        kind: str = "all",
        exported_at: str | None = None,
    ) -> dict[str, str]:
        args = self._args(lecture_id, script=script, show=show, kind=kind)
        title = self.lectures.list_one(lecture_id).title
        return self.engine.export(fmt, title=title, exportedAt=exported_at, **args)

    def captions(
        self,
        lecture_id: int,
        *,
        script: str = "spoken",
        show: Collection[str] = ALL_VERDICTS,
        kind: str = "all",
    ) -> list[dict[str, Any]]:
        """The captions as the caption files write them (the caption timing editor shows these)."""
        return self.engine.captions(**self._args(lecture_id, script=script, show=show, kind=kind))

    def _args(self, lecture_id: int, *, script: str, show: Collection[str], kind: str) -> dict[str, Any]:
        self.lectures.list_one(lecture_id)  # LectureNotFound
        with self.db.session() as s:
            words = [
                {"word": t, "start": a, "end": b}
                for t, a, b in s.execute(
                    select(Word.text, Word.start, Word.end)
                    .where(Word.lecture_id == lecture_id)
                    .order_by(Word.idx)
                )
            ]
            rows = list(
                s.scalars(
                    select(Finding)
                    .where(Finding.lecture_id == lecture_id, Finding.deleted.is_(False))
                    .order_by(Finding.idx)
                )
            )
            newest = DetectionService._newest_verdicts(s, lecture_id)
            findings = [{**r.data, "id": r.id} for r in rows]
            filtered = set(show) != ALL_VERDICTS or kind != "all"
            visible = None
            if filtered:
                visible = [
                    r.id
                    for r in rows
                    if (newest[r.id].verdict if r.id in newest else "NONE") in show
                    and (kind == "all" or KIND_OF.get(r.source_type) == kind)
                ]
        return {
            "words": words,
            "findings": findings,
            "prefs": self.style().model_dump(),
            "visibleIds": visible,
            "standardScript": script == "standard",
            "captionEdits": self.editing.caption_edits(lecture_id),
        }
