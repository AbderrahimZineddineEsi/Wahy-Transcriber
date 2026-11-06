"""HTTP for verification: the verifier settings and prompt texts, estimate and preview a pass, start one (a
job:
pause, resume and cancel it at /api/jobs/{id}/...), its metrics, the user's verdict, approve all, and expand a
clipped finding. It only translates HTTP to `VerificationService` calls."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from wahy.core.ai.types import AiError
from wahy.core.engine import EngineError
from wahy.core.jobs import JobNotFound
from wahy.features.lectures.service import LectureNotFound
from wahy.features.verification.schemas import (
    Approved,
    Estimate,
    Expanded,
    ExpandIn,
    OptionsPatch,
    PassMetrics,
    PassOptions,
    PassRequest,
    PassStarted,
    Preview,
    PreviewRequest,
    PromptCatalog,
    VerdictIn,
    VerdictSaved,
)
from wahy.features.verification.service import (
    FindingNotFound,
    NothingToVerify,
    PassRunning,
    VerificationError,
    VerificationService,
)

router = APIRouter(tags=["verification"])


def get_verification(request: Request) -> VerificationService:
    return request.app.state.verification


Verification = Annotated[VerificationService, Depends(get_verification)]


@contextmanager
def verification_errors() -> Iterator[None]:
    try:
        yield
    except LectureNotFound as e:
        raise HTTPException(404, f"no lecture {e}") from None
    except FindingNotFound as e:
        raise HTTPException(404, str(e.args[0] if e.args else e)) from None
    except JobNotFound as e:
        raise HTTPException(404, f"no job {e}") from None
    except NothingToVerify as e:
        raise HTTPException(422, str(e)) from None
    except PassRunning as e:
        raise HTTPException(409, str(e)) from None
    except VerificationError as e:
        raise HTTPException(422, str(e)) from None
    except AiError as e:
        raise HTTPException(503 if e.fatal else 502, str(e)) from None
    except EngineError as e:
        raise HTTPException(503, f"the engine failed: {e}") from None


@router.get("/api/verification/settings")
def get_verifier_settings(service: Verification) -> PassOptions:
    """The verifier settings a pass uses unless it sends its own (F-085)."""
    return service.get_options()


@router.patch("/api/verification/settings")
def update_verifier_settings(body: OptionsPatch, service: Verification) -> PassOptions:
    return service.update_options(body)


@router.get("/api/verification/prompts")
def prompt_catalog(service: Verification) -> PromptCatalog:
    """The prompt presets, the optional rules and the default system prompt (F-086)."""
    return service.prompt_catalog()


@router.post("/api/lectures/{lecture_id}/verification/estimate")
def estimate_pass(lecture_id: int, service: Verification, body: PassRequest | None = None) -> Estimate:
    """Findings, requests, tokens, cost and time of a pass, before it runs (F-087)."""
    with verification_errors():
        return service.estimate(lecture_id, body or PassRequest())


@router.post("/api/lectures/{lecture_id}/verification/preview")
def preview_request(lecture_id: int, body: PreviewRequest, service: Verification) -> Preview:
    """The exact request the verifier would get for one finding, not sent (F-086)."""
    with verification_errors():
        return service.preview(lecture_id, body)


@router.post("/api/lectures/{lecture_id}/verification", status_code=202)
def start_pass(lecture_id: int, service: Verification, body: PassRequest | None = None) -> PassStarted:
    """Start a verification pass over the selected findings (F-084, F-088). Returns the job; follow it at
    GET /api/jobs/{id}/events and pause, resume or cancel it there."""
    with verification_errors():
        return PassStarted(job=service.start(lecture_id, body or PassRequest()))


@router.get("/api/verification/passes/{job_id}")
def pass_metrics(job_id: str, service: Verification) -> PassMetrics:
    """A pass's numbers (F-089), also while it runs."""
    with verification_errors():
        return service.metrics(job_id)


@router.put("/api/findings/{finding_id}/verdict")
def set_verdict(finding_id: int, body: VerdictIn, service: Verification) -> VerdictSaved:
    """The user's verdict on a finding, saved as a gold label (F-065)."""
    with verification_errors():
        return service.set_verdict(finding_id, body)


@router.post("/api/lectures/{lecture_id}/verification/approve")
def approve_all(lecture_id: int, service: Verification) -> Approved:
    """Accept every AI verdict of the lecture as the user's, as gold labels (F-091). The web app asks
    first."""
    with verification_errors():
        return service.approve_all(lecture_id)


@router.post("/api/findings/{finding_id}/expand")
def expand_finding(finding_id: int, request: Request, body: ExpandIn | None = None) -> Expanded:
    """Grow a finding over the words its start or end is missing (the old editor's auto-heal). It is an edit:
    features/editing does it, so undo can shrink it back."""
    from wahy.features.editing.router import editing_errors

    with editing_errors():
        return request.app.state.editing.expand(finding_id, body or ExpandIn())
