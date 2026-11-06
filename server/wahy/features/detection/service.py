"""Detection: a lecture's words in, findings out, as a job (ADR 0007), through the engine worker (ADR 0002).

    detection = DetectionService(db, settings, jobs, engine, lectures, corpora)
    job = detection.start(lecture_id, engine="v5:loose")      # follow it at /api/jobs/<id>/events
    detection.findings(lecture_id)                            # what the last detection saved
    detection.search("البقرة: 255", kind="QURAN")             # corpus search for the reference picker

The job's stages: `load` (the lecture's words), `detect` (one call to the engine, which can take a while on
the first run: the worker builds its matcher), `save`. Its result:

    {"engine": "v5", "count": 8, "by_type": {"QURAN": 6, "HADITH": 2}, "word_count": 280,
     "hadith_source": "wahy_default"}

Running again replaces the findings; when there were some, they are first kept as a lecture version, so two
detections can be compared (F-044).

Search and detection build the engine with the same options on purpose: the worker keeps one matcher per
option set (hundreds of MB), and a search with other options would build a second one.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, insert, select

from wahy.core.db import Database
from wahy.core.engine import EngineClient
from wahy.core.jobs import JobContext, JobRunner, JobSnapshot
from wahy.core.settings import Settings
from wahy.features.corpora.service import CorporaService
from wahy.features.detection.models import Finding
from wahy.features.detection.schemas import DetectionSettings, FindingOut, FindingsOut, SearchHit, VerdictOut
from wahy.features.lectures.models import Word
from wahy.features.lectures.service import LectureService
from wahy.features.settings.store import SettingsStore
from wahy.features.verification.models import Verdict

SETTINGS_KEY = "detection"
SEARCH_KINDS = ("ALL", "QURAN", "HADITH", "ADHKAR")


class DetectionError(Exception):
    pass


class NothingToDetect(DetectionError):
    """The lecture has no words yet."""


class BadSearch(DetectionError, ValueError):
    pass


def split_choice(choice: str) -> tuple[str, str]:
    """"v5:loose" → ("v5", "loose"); "v4" → ("v4", "normal")."""
    engine, _, profile = choice.partition(":")
    return engine, profile or "normal"


class DetectionService:
    def __init__(self, db: Database, settings: Settings, jobs: JobRunner, engine: EngineClient,
                 lectures: LectureService, corpora: CorporaService):
        self.db, self.settings, self.jobs, self.engine = db, settings, jobs, engine
        self.lectures, self.corpora = lectures, corpora
        self.store = SettingsStore(db)
        jobs.register("detect", self.run_job)

    # ---- settings ------------------------------------------------------------------------------------------

    def get_settings(self) -> DetectionSettings:
        return DetectionSettings.model_validate(self.store.get(SETTINGS_KEY, {}))

    def update_settings(self, patch: dict[str, Any]) -> DetectionSettings:
        new = self.get_settings().model_copy(update={k: v for k, v in patch.items() if v is not None})
        new = DetectionSettings.model_validate(new.model_dump())     # validate the merged result
        self.store.set(SETTINGS_KEY, new.model_dump())
        return new

    def engine_options(self, *, engine: str | None = None, qiraat: str | None = None,
                       adhkar: bool | None = None) -> dict[str, Any]:
        """The options for the engine worker: the saved settings, overridden by what is given."""
        saved = self.get_settings()
        name, profile = split_choice(engine or saved.engine)
        use_adhkar = saved.adhkar if adhkar is None else adhkar
        return {"engine": name, "profile": profile, "qiraat": qiraat or saved.qiraat,
                "adhkar": self.corpora.engine_adhkar() if use_adhkar else [],
                "customQuotes": self.corpora.engine_custom_quotes()}

    # ---- the job -------------------------------------------------------------------------------------------

    def start(self, lecture_id: int, *, engine: str | None = None, qiraat: str | None = None,
              adhkar: bool | None = None) -> JobSnapshot:
        """Detect in a lecture, in the background. What is left out comes from the saved settings."""
        self.lectures.list_one(lecture_id)                      # LectureNotFound
        saved = self.get_settings()
        params = {"engine": engine or saved.engine, "qiraat": qiraat or saved.qiraat,
                  "adhkar": saved.adhkar if adhkar is None else adhkar}
        return self.jobs.submit("detect", params, lecture_id=lecture_id)

    def run_job(self, ctx: JobContext) -> dict[str, Any]:
        lecture_id = ctx.lecture_id
        assert lecture_id is not None
        choice = ctx.params["engine"]
        ctx.progress(stage="load", stages=["load", "detect", "save"], engine=choice, percent=0)
        words = self._words(lecture_id)
        if not words:
            raise NothingToDetect("the lecture has no words; transcribe it or add text first")
        ctx.progress(stage="detect", percent=None)
        options = self.engine_options(engine=choice, qiraat=ctx.params["qiraat"], adhkar=ctx.params["adhkar"])
        findings = self.engine.detect(words, options)
        ctx.progress(stage="save", percent=None)
        self._replace_findings(lecture_id, choice, findings)
        ctx.progress(stage="save", percent=100)
        return {"engine": choice, "count": len(findings),
                "by_type": dict(Counter(f.get("sourceType") for f in findings)), "word_count": len(words),
                "hadith_source": self.corpora.active_source()}

    def _words(self, lecture_id: int) -> list[dict[str, Any]]:
        with self.db.session() as s:
            rows = s.execute(select(Word.text, Word.start, Word.end).where(Word.lecture_id == lecture_id)
                             .order_by(Word.idx))
            return [{"word": t, "start": start, "end": end} for t, start, end in rows]

    def _replace_findings(self, lecture_id: int, choice: str, findings: list[dict[str, Any]]) -> None:
        old = self.findings(lecture_id)
        if old.count:
            stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M")
            self.lectures.save_version(
                lecture_id, f"before re-detect ({old.findings[0].engine}) {stamp}",
                {"engine": old.findings[0].engine, "findings": [f.data for f in old.findings]})
        rows = [dict(lecture_id=lecture_id, idx=i, engine=choice, source_type=str(f.get("sourceType")),
                     unit_id=f.get("unitId"), display_ref=f.get("displayRef"),
                     word_start=int(f.get("wordStartIdx", 0)), word_end=int(f.get("wordEndIdx", 0)), data=f)
                for i, f in enumerate(findings)]
        with self.db.session() as s:
            s.execute(delete(Finding).where(Finding.lecture_id == lecture_id))
            for i in range(0, len(rows), 500):
                s.execute(insert(Finding), rows[i:i + 500])

    # ---- what the web app reads ----------------------------------------------------------------------------

    def findings(self, lecture_id: int) -> FindingsOut:
        self.lectures.list_one(lecture_id)                      # LectureNotFound
        with self.db.session() as s:
            rows = s.scalars(select(Finding).where(Finding.lecture_id == lecture_id).order_by(Finding.idx))
            newest = self._newest_verdicts(s, lecture_id)
            items = [FindingOut.model_validate(r).model_copy(update={"verdict": newest.get(r.id)})
                     for r in list(rows)]
        return FindingsOut(lecture_id=lecture_id, count=len(items), findings=items)

    @staticmethod
    def _newest_verdicts(s: Any, lecture_id: int) -> dict[int, VerdictOut]:
        """finding id → its newest verdict (the highest id wins: a later override beats an earlier pass)."""
        newest = (select(func.max(Verdict.id)).join(Finding, Finding.id == Verdict.finding_id)
                  .where(Finding.lecture_id == lecture_id).group_by(Verdict.finding_id))
        rows = s.scalars(select(Verdict).where(Verdict.id.in_(newest)))
        return {v.finding_id: VerdictOut.model_validate(v) for v in rows}

    def search(self, text: str, *, kind: str = "ALL", limit: int = 30) -> list[SearchHit]:
        """Corpus units whose reference or text contains `text` (F-061)."""
        if kind not in SEARCH_KINDS:
            raise BadSearch(f"unknown kind {kind!r} ({', '.join(SEARCH_KINDS)})")
        options = {**self.engine_options(), "kind": kind, "limit": max(1, min(limit, 200))}
        return [SearchHit(**hit) for hit in self.engine.search(text, options)]
