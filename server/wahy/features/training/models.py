"""Labels: verdicts kept as training truth for Laya (GLOSSARY: Label, Gold label, Card)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class Label(Base):
    """A verdict and boundary kept as training truth. `card` holds the finding and its context as they were
    when labelled, so the label stays usable after the lecture is re-detected or deleted (the links then
    become empty)."""

    __tablename__ = "labels"
    __table_args__ = (Index(None, "finding_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int | None] = mapped_column(ForeignKey("findings.id", ondelete="SET NULL"))
    lecture_id: Mapped[int | None] = mapped_column(ForeignKey("lectures.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(String(16))    # user (gold) | teacher | lesson (from written text)
    teacher: Mapped[str | None]                         # which teacher model, when source = teacher
    verdict: Mapped[str] = mapped_column(String(16))    # CORRECT | FALSE | NOT_SURE
    boundary: Mapped[str | None] = mapped_column(String(16))
    card: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
