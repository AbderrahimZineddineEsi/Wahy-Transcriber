"""The editor's per-lecture operation log, and the caption timing editor's edits (ROADMAP phase 16)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class EditOp(Base):
    """One edit of a lecture, in the order they were made. `undo` holds what undoing it needs: the words it
    replaced, the findings as they were before, the findings it added, the caption edits before it, and the
    verdicts
    and labels it saved. Undo takes the newest edit that is not undone yet, restores that, and marks it
    undone.
    The log starts again when the lecture is detected again (the findings it points at are gone)."""

    __tablename__ = "edit_ops"
    __table_args__ = (Index(None, "lecture_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    lecture_id: Mapped[int] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))  # add_quote, move_edge, replace_words, caption_split, ...
    label: Mapped[str]  # what the undo button names, for example "Delete finding"
    params: Mapped[dict[str, Any]] = mapped_column(JSON)
    undo: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    undone_at: Mapped[datetime | None]


class CaptionEdits(Base):
    """The caption timing editor's edits of one lecture, in order (engine/src/captions.ts CaptionEdit: split,
    merge, time), each anchored on a word so they survive a rebuild of the captions."""

    __tablename__ = "caption_edits"

    lecture_id: Mapped[int] = mapped_column(ForeignKey("lectures.id", ondelete="CASCADE"), primary_key=True)
    edits: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
