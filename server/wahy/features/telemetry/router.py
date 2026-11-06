"""HTTP for telemetry: the AI request log, one request's payloads, and clearing the log. It only translates
HTTP
to `TelemetryService` calls."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from wahy.features.telemetry.schemas import Cleared, RequestDetail, RequestPage
from wahy.features.telemetry.service import RequestNotFound, TelemetryService

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


def get_telemetry(request: Request) -> TelemetryService:
    return request.app.state.telemetry


Telemetry = Annotated[TelemetryService, Depends(get_telemetry)]


@router.get("/requests")
def list_requests(
    service: Telemetry,
    lecture_id: int | None = None,
    job_id: str | None = None,
    provider: str | None = None,
    purpose: str | None = None,
    ok: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RequestPage:
    """Every AI request, newest first (F-095): provider, model, the findings it judged with their verdicts and
    the user's corrections, tokens, latency and cost. Filter by lecture, pass (job), provider or purpose."""
    return service.requests(
        lecture_id=lecture_id,
        job_id=job_id,
        provider=provider,
        purpose=purpose,
        ok=ok,
        limit=limit,
        offset=offset,
    )


@router.get("/requests/{request_id}")
def get_request(request_id: int, service: Telemetry) -> RequestDetail:
    """One request with the exact payload sent and the payload received (F-096)."""
    try:
        return service.request(request_id)
    except RequestNotFound:
        raise HTTPException(404, f"no AI request {request_id}") from None


@router.delete("/requests")
def clear_requests(service: Telemetry, lecture_id: int | None = None) -> Cleared:
    """Clear the request log (of one lecture, or all). Verdicts stay."""
    return Cleared(deleted=service.clear(lecture_id=lecture_id))
