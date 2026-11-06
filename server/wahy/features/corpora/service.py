"""The corpus the engine searches (GLOSSARY: Corpus): the hadith source in use, the adhkar list and the custom
quotes.

    corpora = CorporaService(db, settings, jobs, engine)
    corpora.engine_adhkar()            # [{id, category, ref, t, isCustom?}] as the engine takes them
    corpora.engine_custom_quotes()     # [{id, book, ref, t}]
    corpora.start_prepare("open_hadith_data")     # a job: download (or reuse the cached zip), convert
    corpora.activate("open_hadith_data")          # the engine now searches those hadiths

What it keeps where (ADR 0005): the adhkar and custom quotes in the database; the Quran and the hadith
collections in files (data/corpus.json and data/corpora/); which hadith source is active in the settings
table.
The engine worker loads the corpus once, so switching the hadith source restarts it (the next call is slow).
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from wahy.core.db import Database
from wahy.core.engine import EngineClient
from wahy.core.jobs import JobContext, JobRunner, JobSnapshot
from wahy.core.settings import Settings
from wahy.features.corpora.models import CustomQuote, Dhikr
from wahy.features.corpora.schemas import CorpusInfo, DhikrIn, DhikrOut, QuoteIn, QuoteOut, SourceOut
from wahy.features.corpora.sources import BUILTIN, AlreadyPreparing, SourceStore, UnknownSource
from wahy.features.settings.store import SettingsStore

BUILTIN_ADHKAR: list[dict[str, str]] = json.loads(
    (Path(__file__).with_name("builtin_adhkar.json")).read_text(encoding="utf-8"))
SOURCE_KEY = "corpora.hadith_source"
MIN_QUOTE_CHARS = 4

_MARKS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")


class CorporaError(Exception):
    pass


class NotFound(CorporaError, KeyError):
    """No such dhikr or custom quote."""


class BadInput(CorporaError, ValueError):
    """The text or reference is unusable (too short...)."""


class Conflict(CorporaError):
    """Not allowed now: editing a built-in dhikr, activating a source that is not ready."""


def normalise(text: str) -> str:
    """Letters without marks and with the alef, yaa and taa marbuta forms folded: only to tell whether two
    texts are the same (the engine has its own, finer normaliser)."""
    t = _MARKS.sub("", text)
    t = re.sub("[أإآٱ]", "ا", t).replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", t).strip()


class CorporaService:
    def __init__(self, db: Database, settings: Settings, jobs: JobRunner, engine: EngineClient, *,
                 sources: SourceStore | None = None):
        self.db, self.settings, self.jobs, self.engine = db, settings, jobs, engine
        self.sources = sources or SourceStore(settings.data_dir)
        self.store = SettingsStore(db)
        jobs.register("corpus_prepare", self.run_prepare_job)
        self.seed_adhkar()
        self.engine.use_hadiths(self.sources.hadiths_path(self.active_source()))

    # ---- hadith sources ------------------------------------------------------------------------------------

    def active_source(self) -> str:
        """The hadith source in use. A source whose prepared file is gone counts as the built-in one."""
        chosen = self.store.get(SOURCE_KEY, BUILTIN)
        return chosen if self.sources.is_ready(chosen) else BUILTIN

    def list_sources(self) -> list[SourceOut]:
        active = self.active_source()
        return [SourceOut(**row, active=row["id"] == active) for row in self.sources.describe()]

    def start_prepare(self, source_id: str, *, redownload: bool = False) -> JobSnapshot:
        """Download (or reuse the cached zip) and convert a source, as a job."""
        self.sources.require_prepared_kind(source_id)
        if any(r["preparing_job"] for r in self.sources.describe() if r["id"] == source_id):
            raise AlreadyPreparing(f"{source_id} is already being prepared")
        return self.jobs.submit("corpus_prepare", {"source_id": source_id, "redownload": redownload})

    def run_prepare_job(self, ctx: JobContext) -> dict[str, Any]:
        source_id = ctx.params["source_id"]
        if ctx.params.get("redownload"):
            self.sources.zip_path(source_id).unlink(missing_ok=True)
        ctx.progress(stage="prepare", source_id=source_id, percent=0)
        summary = self.sources.prepare(
            source_id, ctx.job_id, lambda pct, msg: ctx.progress(stage="prepare", percent=round(pct, 1),
                                                                 message=msg), ctx.check)
        # a source being prepared again while it is the active one: the worker must read the new file
        if self.active_source() == source_id:
            self.engine.close()
        return summary

    def save_upload(self, source_id: str, data: bytes) -> JobSnapshot:
        """Keep a zip downloaded by hand and prepare the source from it."""
        self.sources.save_upload(source_id, data)
        return self.start_prepare(source_id)

    def delete_source(self, source_id: str, *, keep_download: bool = False) -> None:
        was_active = self.active_source() == source_id
        self.sources.delete(source_id, keep_download=keep_download)
        if was_active:
            self.activate(BUILTIN)

    def activate(self, source_id: str) -> SourceOut:
        """Make the engine search this hadith source. A source that is not prepared is refused."""
        if source_id not in {r["id"] for r in self.sources.describe()}:
            raise UnknownSource(source_id)
        if not self.sources.is_ready(source_id):
            raise Conflict(f"{source_id} is not prepared yet; prepare it first")
        self.store.set(SOURCE_KEY, source_id)
        self.engine.use_hadiths(self.sources.hadiths_path(source_id))
        return next(s for s in self.list_sources() if s.id == source_id)

    def info(self) -> CorpusInfo:
        """What the engine has loaded (starts the worker, so the first call takes seconds)."""
        e = self.engine.info()
        with self.db.session() as s:
            adhkar = s.scalar(select(func.count(Dhikr.id))) or 0
            quotes = s.scalar(select(func.count(CustomQuote.id))) or 0
        return CorpusInfo(quran=e["quran"], hadiths=e["hadiths"], adhkar=adhkar, custom_quotes=quotes,
                          hadith_source=self.active_source(), fingerprint=e["fingerprint"])

    # ---- adhkar --------------------------------------------------------------------------------------------

    def seed_adhkar(self) -> None:
        """Put the built-in adhkar in the table (and bring their text up to date). The user's own are never
        touched, so they survive updates (F-077)."""
        with self.db.session() as s:
            have = {d.id: d for d in s.scalars(select(Dhikr).where(Dhikr.is_custom.is_(False)))}
            for position, item in enumerate(BUILTIN_ADHKAR):
                row = have.get(item["id"])
                if row is None:
                    s.add(Dhikr(id=item["id"], category=item["category"], ref=item["ref"], t=item["t"],
                                is_custom=False, position=position))
                else:
                    row.category, row.ref, row.t, row.position = (item["category"], item["ref"], item["t"],
                                                                  position)
            gone = set(have) - {item["id"] for item in BUILTIN_ADHKAR}
            for old in gone:
                s.delete(have[old])

    def list_adhkar(self) -> list[DhikrOut]:
        with self.db.session() as s:
            rows = s.scalars(select(Dhikr).order_by(Dhikr.position, Dhikr.created_at))
            return [DhikrOut.model_validate(r) for r in rows]

    def add_dhikr(self, body: DhikrIn) -> DhikrOut:
        with self.db.session() as s:
            first = s.scalar(select(func.min(Dhikr.position))) or 0
            row = Dhikr(id=f"Adhkar:custom_{uuid.uuid4().hex[:10]}", category=body.category, ref=body.ref,
                        t=body.t, is_custom=True, position=min(first, 0) - 1)
            s.add(row)
            s.flush()
            return DhikrOut.model_validate(row)

    def update_dhikr(self, dhikr_id: str, body: DhikrIn) -> DhikrOut:
        with self.db.session() as s:
            row = self._custom_dhikr(s, dhikr_id)
            row.category, row.ref, row.t = body.category, body.ref, body.t
            return DhikrOut.model_validate(row)

    def delete_dhikr(self, dhikr_id: str) -> None:
        with self.db.session() as s:
            s.delete(self._custom_dhikr(s, dhikr_id))

    @staticmethod
    def _custom_dhikr(s, dhikr_id: str) -> Dhikr:
        row = s.get(Dhikr, dhikr_id)
        if row is None:
            raise NotFound(dhikr_id)
        if not row.is_custom:
            raise Conflict("built-in adhkar cannot be edited or deleted; turn adhkar detection off instead")
        return row

    def engine_adhkar(self) -> list[dict[str, Any]]:
        """The list as the engine takes it: customs first, then the built-ins in their own order."""
        out = []
        for d in self.list_adhkar():
            item: dict[str, Any] = {"id": d.id, "category": d.category, "ref": d.ref, "t": d.t}
            if d.is_custom:
                item["isCustom"] = True
            out.append(item)
        return out

    # ---- custom quotes -------------------------------------------------------------------------------------

    def list_quotes(self) -> list[QuoteOut]:
        with self.db.session() as s:
            rows = s.scalars(select(CustomQuote).order_by(CustomQuote.created_at.desc(), CustomQuote.id))
            return [QuoteOut.model_validate(r) for r in rows]

    def add_quote(self, body: QuoteIn) -> QuoteOut:
        """Add a text the engine should find. The same text again (ignoring marks) only updates the reference
        label, as in the old app."""
        if len(body.t) < MIN_QUOTE_CHARS:
            raise BadInput(f"the text must be at least {MIN_QUOTE_CHARS} characters")
        ref = body.ref or "حديث خارج القاعدة"
        norm = normalise(body.t)
        with self.db.session() as s:
            for existing in s.scalars(select(CustomQuote)):
                if normalise(existing.t) == norm:
                    if body.ref and body.ref != "حديث خارج القاعدة":
                        existing.ref = ref
                    return QuoteOut.model_validate(existing)
            row = CustomQuote(id=f"Outside:{uuid.uuid4().hex[:12]}", ref=ref, t=body.t)
            s.add(row)
            s.flush()
            return QuoteOut.model_validate(row)

    def update_quote(self, quote_id: str, body: QuoteIn) -> QuoteOut:
        if len(body.t) < MIN_QUOTE_CHARS:
            raise BadInput(f"the text must be at least {MIN_QUOTE_CHARS} characters")
        with self.db.session() as s:
            row = s.get(CustomQuote, quote_id)
            if row is None:
                raise NotFound(quote_id)
            row.t, row.ref = body.t, body.ref or row.ref
            return QuoteOut.model_validate(row)

    def delete_quote(self, quote_id: str) -> None:
        with self.db.session() as s:
            row = s.get(CustomQuote, quote_id)
            if row is None:
                raise NotFound(quote_id)
            s.delete(row)

    def engine_custom_quotes(self) -> list[dict[str, Any]]:
        # newest first, as the old app listed them
        return [{"id": q.id, "book": "OutsideCorpus", "ref": q.ref, "t": q.t} for q in self.list_quotes()]
