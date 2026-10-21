"""
In-memory progress tracker for long-running transcription jobs.
The frontend sends a job_id with /api/transcribe and polls /api/transcribe/progress/{job_id}.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional

_LOCK = threading.Lock()
_JOBS: Dict[str, Dict[str, Any]] = {}
_MAX_JOBS = 50


def set_progress(
    job_id: Optional[str], stage: str, percent: Optional[float] = None, message: str = "",
    details: Optional[Dict[str, Any]] = None,
) -> None:
    """stage: download | audio | transcribe | done | error.  percent is 0-100 within the stage, or None if unknown."""
    if not job_id:
        return
    with _LOCK:
        if len(_JOBS) >= _MAX_JOBS and job_id not in _JOBS:
            oldest = min(_JOBS, key=lambda k: _JOBS[k]["updated"])
            _JOBS.pop(oldest, None)
        _JOBS[job_id] = {
            "stage": stage,
            "percent": None if percent is None else max(0.0, min(100.0, float(percent))),
            "message": message,
            "details": details or {},
            "updated": time.time(),
        }


def get_progress(job_id: str) -> Dict[str, Any]:
    with _LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else {"stage": "unknown", "percent": None, "message": ""}


# --- run control: the UI asks a running job to pause / resume / stop / cancel; the job polls get_control between steps.
# stop = end now and keep what's done; cancel = end now and discard the run. Both are final.
_CONTROL: Dict[str, str] = {}


def set_control(job_id: str, action: str) -> str:
    state = {"pause": "pause", "resume": "run", "stop": "stop", "cancel": "cancel"}.get(action)
    if not state:
        raise ValueError(f"unknown action {action!r}")
    with _LOCK:
        if _CONTROL.get(job_id) in ("stop", "cancel"):      # final
            return _CONTROL[job_id]
        _CONTROL[job_id] = state
        return state


def get_control(job_id: Optional[str]) -> str:
    if not job_id:
        return "run"
    with _LOCK:
        return _CONTROL.get(job_id, "run")


def clear_control(job_id: Optional[str]) -> None:
    with _LOCK:
        _CONTROL.pop(job_id or "", None)
