"""What the telemetry API sends: the AI request log and one request with its payloads."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class HumanVerdict(BaseModel):
    verdict: str
    boundary: str | None


class RequestFinding(BaseModel):
    """A finding a request judged, with the verdict it got from that request and the user's correction, if
    any."""

    finding_id: int
    display_ref: str | None
    source_type: str | None
    verdict: str | None = Field(None, description="the verdict this request gave (none for a failed request)")
    boundary: str | None = None
    confidence: float | None = None
    probabilities: dict[str, float] | None = None
    human: HumanVerdict | None = Field(None, description="the user's newest verdict on the finding, if any")


class RequestRow(BaseModel):
    id: int
    created_at: datetime
    provider: str
    model: str
    purpose: str
    job_id: str | None
    lecture_id: int | None
    ok: bool
    error: str | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    latency_ms: int | None
    context_chars: int = Field(description="size of the request payload, in characters")
    findings: list[RequestFinding]


class RequestPage(BaseModel):
    total: int
    total_cost_usd: float = Field(description="the cost of every request that matches the filter")
    items: list[RequestRow]


class RequestDetail(RequestRow):
    request: Any = Field(description="the exact payload sent (keys removed)")
    response: Any | None = Field(description="the payload received")


class Cleared(BaseModel):
    deleted: int
