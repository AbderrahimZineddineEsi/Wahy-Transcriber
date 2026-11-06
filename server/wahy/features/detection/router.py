"""HTTP for detection: start a detection job on a lecture, read its findings, the detection settings, and
corpus search. It only translates HTTP to `DetectionService` calls."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from wahy.core.engine import EngineError
from wahy.features.detection.schemas import (
    DetectionPatch,
    DetectionSettings,
    DetectRequest,
    DetectStarted,
    FindingsOut,
    SearchHit,
)
from wahy.features.detection.service import BadSearch, DetectionService
from wahy.features.lectures.service import LectureNotFound

router = APIRouter(tags=["detection"])


def get_detection(request: Request) -> DetectionService:
    return request.app.state.detection


Detection = Annotated[DetectionService, Depends(get_detection)]


@contextmanager
def detection_errors() -> Iterator[None]:
    try:
        yield
    except LectureNotFound as e:
        raise HTTPException(404, f"no lecture {e}") from None
    except BadSearch as e:
        raise HTTPException(422, str(e)) from None
    except EngineError as e:
        raise HTTPException(503, f"the engine failed: {e}") from None


@router.post("/api/lectures/{lecture_id}/detect", status_code=202)
def detect(lecture_id: int, service: Detection, body: DetectRequest | None = None) -> DetectStarted:
    """Find the quotes in a lecture (replacing its findings; earlier ones are kept as a lecture version).
    Returns the job; follow it at GET /api/jobs/{id}/events."""
    body = body or DetectRequest()
    with detection_errors():
        return DetectStarted(job=service.start(lecture_id, engine=body.engine, qiraat=body.qiraat,
                                               adhkar=body.adhkar))


@router.get("/api/lectures/{lecture_id}/findings")
def lecture_findings(lecture_id: int, service: Detection) -> FindingsOut:
    with detection_errors():
        return service.findings(lecture_id)


@router.get("/api/detection/settings")
def get_detection_settings(service: Detection) -> DetectionSettings:
    return service.get_settings()


@router.patch("/api/detection/settings")
def update_detection_settings(body: DetectionPatch, service: Detection) -> DetectionSettings:
    """Change the engine choice, the Qira'ah or the adhkar switch used by the next detection."""
    return service.update_settings(body.model_dump())


@router.get("/api/corpus/search")
def search_corpus(service: Detection, q: str = "", kind: Annotated[str, Query()] = "ALL",
                  limit: int = 30) -> list[SearchHit]:
    """Corpus units (ayat, hadiths, adhkar, custom quotes) whose reference or text contains `q`. An empty `q`
    lists the first units. The first call starts the engine worker, which takes a few seconds."""
    with detection_errors():
        return service.search(q, kind=kind, limit=limit)
