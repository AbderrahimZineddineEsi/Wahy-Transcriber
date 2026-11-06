"""Verdicts on findings, from a verifier or from the user (GLOSSARY: Verdict, Boundary, Verification pass)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class Verdict(Base):
    """One answer to "is this finding a real quote?". A finding can have several (one per pass, plus the
    user's override); the newest one is the one shown. Values are the old app's strings:
    verdict CORRECT | FALSE | NOT_SURE, boundary COMPLETE | MISSING_START | MISSING_END | EXTRA_START |
    EXTRA_END."""

    __tablename__ = "verdicts"
    __table_args__ = (Index(None, "finding_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    finding_id: Mapped[int] = mapped_column(ForeignKey("findings.id", ondelete="CASCADE"))
    verifier: Mapped[str] = mapped_column(String(16))   # gemini | jev | openrouter | laya | human
    model: Mapped[str | None]                            # the model or checkpoint name
    verdict: Mapped[str] = mapped_column(String(16))
    boundary: Mapped[str | None] = mapped_column(String(16))
    reason: Mapped[str | None]
    # the verification pass (a job) and the AI request that produced it; both empty for the user's own verdict
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    ai_request_id: Mapped[int | None] = mapped_column(ForeignKey("ai_requests.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
