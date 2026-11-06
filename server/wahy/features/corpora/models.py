"""The two editable parts of the corpus, kept in the database: the adhkar list and the custom quotes
(GLOSSARY: Corpus, Dhikr, Custom quote). The Quran and the hadith collections are files (ADR 0005)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Index
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class Dhikr(Base):
    """One dhikr. Every row is editable and deletable. The 18 initial rows are seeded once (see
    CorporaService.seed_adhkar); `is_custom` only records that the user added the row. The engine gets them as
    {id, category, ref, t} (plus `isCustom` for the user's additions), in `position` order."""

    __tablename__ = "adhkar"
    __table_args__ = (Index(None, "position"),)

    id: Mapped[str] = mapped_column(primary_key=True)        # "Adhkar:tahlil", "Adhkar:custom_3f2a..."
    category: Mapped[str]
    ref: Mapped[str]
    t: Mapped[str]                                           # the vocalised text
    is_custom: Mapped[bool] = mapped_column(default=False)
    position: Mapped[int]                                    # additions first (negative), then initial
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class CustomQuote(Base):
    """A text outside the corpus that the engine finds like any hadith (the old app's "outside hadith")."""

    __tablename__ = "custom_quotes"

    id: Mapped[str] = mapped_column(primary_key=True)        # "Outside:<hex>"
    ref: Mapped[str]
    t: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
