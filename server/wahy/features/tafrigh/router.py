"""HTTP for Tafrigh: preview, estimate, start a run (a job: pause, resume and cancel it at /api/jobs/{id}/...,
stop it here), and the saved runs (list, read, rename, delete, clone, review, export, compare). It only translates
HTTP to `TafrighService` calls."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request

from wahy.core.ai.types import AiError
from wahy.core.jobs import JobError, JobNotFound
from wahy.features.lectures.service import LectureNotFound

from .api_schemas import (
    TafrighCloneIn,
    TafrighCompareIn,
    TafrighCompareOut,
    TafrighEstimate,
    TafrighExportedFile,
    TafrighGeminiModels,
    TafrighPreview,
    TafrighPreviewRequest,
    TafrighReviewIn,
    TafrighRunDetail,
    TafrighRunPatch,
    TafrighRunRequest,
    TafrighRunSummary,
    TafrighStarted,
)
from .service import NoSentences, SegmentNotFound, TafrighError, TafrighService
from .store import RunNotFound

router = APIRouter(tags=["tafrigh"])


def get_tafrigh(request: Request) -> TafrighService:
    return request.app.state.tafrigh


Tafrigh = Annotated[TafrighService, Depends(get_tafrigh)]


@contextmanager
def tafrigh_errors() -> Iterator[None]:
    try:
        yield
    except LectureNotFound as e:
        raise HTTPException(404, f"no lecture {e}") from None
    except RunNotFound as e:
        raise HTTPException(404, f"no Tafrigh run {e}") from None
    except SegmentNotFound as e:
        raise HTTPException(404, f"no sentence {e} in this run") from None
    except JobNotFound as e:
        raise HTTPException(404, f"no job {e}") from None
    except JobError as e:
        raise HTTPException(409, str(e)) from None
    except (NoSentences, TafrighError) as e:
        raise HTTPException(422, str(e)) from None
    except AiError as e:
        raise HTTPException(503 if e.fatal else 502, str(e)) from None


@router.get("/api/tafrigh/models")
def gemini_models(service: Tafrigh) -> TafrighGeminiModels:
    """The Gemini models the saved key can call."""
    with tafrigh_errors():
        return service.models()


@router.post("/api/lectures/{lecture_id}/tafrigh/preview")
def preview(lecture_id: int, service: Tafrigh, body: TafrighPreviewRequest | None = None) -> TafrighPreview:
    """The sentences a run would classify, with statistics, before any model call (F-106, F-107)."""
    with tafrigh_errors():
        return TafrighPreview.model_validate(service.preview(lecture_id, body or TafrighPreviewRequest()))


@router.post("/api/lectures/{lecture_id}/tafrigh/estimate")
def estimate(lecture_id: int, service: Tafrigh, body: TafrighRunRequest | None = None) -> TafrighEstimate:
    """Requests and tokens of a run for each mode, without calling a model (F-114)."""
    with tafrigh_errors():
        return service.estimate(lecture_id, body or TafrighRunRequest())


@router.post("/api/lectures/{lecture_id}/tafrigh/runs", status_code=202)
def start_run(lecture_id: int, service: Tafrigh, body: TafrighRunRequest | None = None) -> TafrighStarted:
    """Start a Tafrigh run (F-110 to F-113, F-115). Returns the job; follow it at GET /api/jobs/{id}/events."""
    with tafrigh_errors():
        return TafrighStarted(job=service.start(lecture_id, body or TafrighRunRequest()))


@router.post("/api/tafrigh/jobs/{job_id}/stop")
def stop_run(job_id: str, service: Tafrigh) -> TafrighStarted:
    """Stop a running Tafrigh job now and keep the sentences that are finished (cancel keeps nothing)."""
    with tafrigh_errors():
        return TafrighStarted(job=service.stop(job_id))


@router.get("/api/tafrigh/runs")
def list_runs(service: Tafrigh, lecture_id: int | None = None) -> list[TafrighRunSummary]:
    """Saved Tafrigh runs, newest first (F-121)."""
    return service.runs(lecture_id)


@router.get("/api/tafrigh/runs/{run_id}")
def get_run(run_id: str, service: Tafrigh) -> TafrighRunDetail:
    with tafrigh_errors():
        return service.detail(run_id)


@router.patch("/api/tafrigh/runs/{run_id}")
def rename_run(run_id: str, body: TafrighRunPatch, service: Tafrigh) -> TafrighRunSummary:
    with tafrigh_errors():
        return service.rename(run_id, body.name)


@router.delete("/api/tafrigh/runs/{run_id}", status_code=204)
def delete_run(run_id: str, service: Tafrigh) -> None:
    with tafrigh_errors():
        service.delete(run_id)


@router.post("/api/tafrigh/runs/{run_id}/clone", status_code=201)
def clone_run(run_id: str, service: Tafrigh, body: TafrighCloneIn | None = None) -> TafrighRunSummary:
    """"Save as new": a copy with its own id, so review edits in the copy leave this run as it is (F-121)."""
    with tafrigh_errors():
        return service.clone(run_id, body.name if body else None)


@router.post("/api/tafrigh/runs/{run_id}/review")
def review(run_id: str, body: TafrighReviewIn, service: Tafrigh) -> TafrighRunDetail:
    """Confirm, relabel or reject one sentence. Saved at once; the run is returned re-rendered (F-119)."""
    with tafrigh_errors():
        return service.review(run_id, body)


@router.get("/api/tafrigh/runs/{run_id}/export")
def export_run(run_id: str, service: Tafrigh, format: Literal["md", "html", "json"] = "md") -> TafrighExportedFile:
    with tafrigh_errors():
        return service.export(run_id, format)


@router.post("/api/tafrigh/compare")
def compare(body: TafrighCompareIn, service: Tafrigh) -> TafrighCompareOut:
    """Saved runs side by side: settings, cost, and the sentences they label differently (F-122)."""
    with tafrigh_errors():
        return service.compare(body.run_ids)
