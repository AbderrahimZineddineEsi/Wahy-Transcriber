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
    __table_args__ = (Index(None, "finding_id"), Index(None, "key", unique=True))

    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int | None] = mapped_column(ForeignKey("findings.id", ondelete="SET NULL"))
    lecture_id: Mapped[int | None] = mapped_column(ForeignKey("lectures.id", ondelete="SET NULL"))
    # user (gold) | teacher | lesson (from written text) | legacy (the old app's training bank, imported) |
    # tafrigh (a Tafrigh run's sentence saved for Laya, F-120)
    source: Mapped[str] = mapped_column(String(16))
    teacher: Mapped[str | None]  # which teacher model, when source = teacher
    # verification (a verdict on a finding) | tafrigh_structure | tafrigh_split (a Tafrigh example)
    task: Mapped[str] = mapped_column(String(32), default="verification", server_default="verification")
    # where an imported or saved row came from, so saving it again replaces it: "legacy:<row id>",
    # "tafrigh:<run id>:<task>:<sentence id>"; empty for the user's labels (one per finding)
    key: Mapped[str | None]
    verdict: Mapped[str | None] = mapped_column(String(16))  # CORRECT | FALSE | NOT_SURE (none for Tafrigh)
    boundary: Mapped[str | None] = mapped_column(String(16))
    card: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
