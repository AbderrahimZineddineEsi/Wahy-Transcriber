"""HTTP for jobs: list them, read one, pause / resume / cancel, and follow one with a progress stream
(server-sent events). Jobs are started by the feature that owns the work (for example POST /api/lectures
starts a transcription), so there is no "create a job" route here."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from wahy.core.jobs import JobError, JobNotFound, JobRunner, JobSnapshot

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def get_runner(request: Request) -> JobRunner:
    return request.app.state.jobs


Runner = Annotated[JobRunner, Depends(get_runner)]


def _or_http(action, job_id: str) -> JobSnapshot:
    try:
        return action(job_id)
    except JobNotFound:
        raise HTTPException(404, f"no job {job_id}") from None
    except JobError as e:
        raise HTTPException(409, str(e)) from None


@router.get("")
def list_jobs(runner: Runner, lecture_id: int | None = None, kind: str | None = None,
              limit: int = 50) -> list[JobSnapshot]:
    return runner.list(lecture_id=lecture_id, kind=kind, limit=min(limit, 500))


@router.get("/{job_id}")
def get_job(job_id: str, runner: Runner) -> JobSnapshot:
    return _or_http(runner.get, job_id)


@router.post("/{job_id}/pause")
def pause_job(job_id: str, runner: Runner) -> JobSnapshot:
    return _or_http(runner.pause, job_id)


@router.post("/{job_id}/resume")
def resume_job(job_id: str, runner: Runner) -> JobSnapshot:
    return _or_http(runner.resume, job_id)


@router.post("/{job_id}/cancel")
def cancel_job(job_id: str, runner: Runner) -> JobSnapshot:
    return _or_http(runner.cancel, job_id)


STREAM_DOC = "One `data:` line per change, each a JobSnapshot as JSON; the stream ends when the job ends."


@router.get("/{job_id}/events", response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {}}, "description": STREAM_DOC}})
async def job_events(job_id: str, runner: Runner) -> StreamingResponse:
    """The job's progress stream. In the browser: `new EventSource("/api/jobs/<id>/events")`."""
    _or_http(runner.get, job_id)                      # a 404 now, not an empty stream

    async def stream() -> AsyncIterator[str]:
        async for snap in runner.events(job_id):
            yield f"event: job\ndata: {snap.model_dump_json()}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
