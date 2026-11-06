"""The findings the engine produced for a lecture (GLOSSARY: Finding)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class Finding(Base):
    """One finding. The columns are what the app filters and sorts on; `data` is the engine's whole finding
    object (segments, candidateRefs, embeddedQuran, ...), kept as it came so envelopes and exports see exactly
    what the engine produced."""

    __tablename__ = "findings"
    __table_args__ = (UniqueConstraint("lecture_id", "idx"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lecture_id: Mapped[int] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    idx: Mapped[int]                                   # order within the lecture, as the engine returned them
    engine: Mapped[str] = mapped_column(String(16))     # the engine choice: v3, v4, v5, v5:loose
    source_type: Mapped[str] = mapped_column(String(16))  # QURAN | HADITH | ADHKAR | CUSTOM
    unit_id: Mapped[str | None]
    display_ref: Mapped[str | None]
    word_start: Mapped[int]                             # first and last word idx, inclusive
    word_end: Mapped[int]
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    # deleted in the editor (features/editing). The row stays, so undo brings it back with its verdicts and
    # labels.
    deleted: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
