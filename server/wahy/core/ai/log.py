"""The request log: every call to a provider becomes one `AiRequest` row (ADR 0004), failed ones included, so
the telemetry screens can show what was sent, what came back, and what it cost.

    rid = log.save(provider="gemini", model="gemini-3.5-flash-lite", call=call, ok=True, request=body,
                   response=data, input_tokens=812, output_tokens=240, cost_usd=0.0008, latency_ms=1840)

Payloads are saved as sent and received, minus anything that looks like a key (`redact`). A database without
the row's job or lecture (a test, a CLI) still works: unknown ids are saved as empty.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text

from wahy.core.ai.models import AiRequest
from wahy.core.ai.types import Call, redact
from wahy.core.db import Database

log = logging.getLogger("wahy.ai")


def _clean(payload: Any) -> Any:
    """A JSON-safe copy of `payload` with keys redacted (a key can hide in a URL or an error text)."""
    if payload is None:
        return None
    dumped = json.dumps(payload, ensure_ascii=False, default=str)
    return json.loads(redact(dumped))


class RequestLog:
    def __init__(self, db: Database | None):
        self.db = db

    def save(
        self,
        *,
        provider: str,
        model: str,
        call: Call,
        ok: bool,
        request: Any,
        response: Any = None,
        error: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        cost_usd: float | None = None,
        latency_ms: int | None = None,
    ) -> int | None:
        """Save one request; returns its id (None when there is no database)."""
        if self.db is None:
            return None
        with self.db.session() as s:
            # core does not import features: the lecture is checked by table name
            job_id = (
                call.job_id
                if call.job_id and s.scalar(text("SELECT 1 FROM jobs WHERE id = :id"), {"id": call.job_id})
                else None
            )
            lecture_id = (
                call.lecture_id
                if call.lecture_id is not None
                and s.scalar(text("SELECT 1 FROM lectures WHERE id = :id"), {"id": call.lecture_id})
                else None
            )
            row = AiRequest(
                provider=provider,
                model=model or "",
                purpose=call.purpose,
                job_id=job_id,
                lecture_id=lecture_id,
                ok=ok,
                error=redact(error)[:2000] if error else None,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
                latency_ms=latency_ms,
                request=_clean(request) or {},
                response=_clean(response),
            )
            s.add(row)
            s.flush()
            return row.id
