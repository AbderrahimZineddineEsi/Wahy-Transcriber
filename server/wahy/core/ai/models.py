"""The AI request log: core/ai saves every call to a provider here (ADR 0004); the telemetry screens read
it."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, utcnow


class AiRequest(Base):
    __tablename__ = "ai_requests"
    __table_args__ = (Index(None, "job_id"), Index(None, "created_at"))

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(16))   # gemini | openrouter | groq | laya | fake
    model: Mapped[str]
    purpose: Mapped[str] = mapped_column(String(16))    # verify | teacher | tafrigh | transcribe | chat
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    lecture_id: Mapped[int | None] = mapped_column(ForeignKey("lectures.id", ondelete="SET NULL"))
    ok: Mapped[bool]
    error: Mapped[str | None]
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cost_usd: Mapped[float | None]
    latency_ms: Mapped[int | None]
    request: Mapped[Any] = mapped_column(JSON)          # the raw payload sent, without the key
    response: Mapped[Any | None] = mapped_column(JSON)  # the raw payload received
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
