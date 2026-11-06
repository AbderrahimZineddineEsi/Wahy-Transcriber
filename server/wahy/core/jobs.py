"""The job runner (ADR 0007): every long piece of work (transcription, detection, a verification pass, a
Tafrigh run) is a job, with its status and progress saved in SQLite and one progress stream per job.

A feature registers a function for a kind of job, then submits jobs of that kind:

    def transcribe(ctx: JobContext):
        for i, chunk in enumerate(chunks):
            ctx.check()                                  # waits here while paused, raises if cancelled
            ...
            ctx.progress(stage="transcribe", done=i + 1, total=len(chunks))
        return {"words": n}                              # the job's result (JSON)

    runner.register("transcribe", transcribe)
    job = runner.submit("transcribe", {"lecture_id": 3}, lecture_id=3)   # returns at once
    runner.pause(job.id); runner.resume(job.id); runner.cancel(job.id)

Each job runs in its own thread. Pause and cancel are cooperative: they take effect the next time the job
calls `ctx.check()` (or `ctx.progress()`, which checks too), so a job checks between steps. Until then its
status is `pausing` or `cancelling`.

Statuses:

    queued ─► running ─► done | failed | cancelled
                │  ▲
     pause ─►  pausing ─► paused ─► (resume) running
     cancel ─► cancelling ─► cancelled
    server stops or restarts ─► interrupted ─► (resume, if the kind is resumable) queued ─► running ...

A resumable job saves how far it got with `ctx.save_checkpoint(state)`; when it is resumed after a restart it
reads that back from `ctx.checkpoint` and skips the work already done.

Threads and asyncio: jobs run in plain threads, while the web app's progress stream is served by asyncio.
`events()` bridges the two: a job thread hands each new snapshot to the event loop with
`loop.call_soon_threadsafe`.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import threading
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import JSON, ForeignKey, String, select, update
from sqlalchemy.orm import Mapped, mapped_column

from wahy.core.db import Base, Database, utcnow

log = logging.getLogger("wahy.jobs")

QUEUED, RUNNING, PAUSING, PAUSED, CANCELLING = "queued", "running", "pausing", "paused", "cancelling"
DONE, FAILED, CANCELLED, INTERRUPTED = "done", "failed", "cancelled", "interrupted"
FINAL = frozenset({DONE, FAILED, CANCELLED})          # nothing more can happen to the job
ENDED = FINAL | {INTERRUPTED}                         # no thread is working on it
UNFINISHED = frozenset({QUEUED, RUNNING, PAUSING, PAUSED, CANCELLING})


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), index=True)
    lecture_id: Mapped[int | None] = mapped_column(ForeignKey("lectures.id", ondelete="SET NULL"), index=True)
    params: Mapped[dict[str, Any]] = mapped_column(JSON)
    progress: Mapped[dict[str, Any]] = mapped_column(JSON)
    checkpoint: Mapped[Any | None] = mapped_column(JSON)   # the job's own resume state (see the module doc)
    result: Mapped[Any | None] = mapped_column(JSON)
    error: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class JobSnapshot(BaseModel):
    """What the web app sees of a job: the API's response and each event on its progress stream."""

    id: str
    kind: str
    status: str
    lecture_id: int | None
    params: dict[str, Any]
    progress: dict[str, Any]
    result: Any | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime


class JobError(Exception):
    """Asked for something the job can't do in its status (the API answers 409)."""


class JobNotFound(JobError, KeyError):
    pass


class JobCancelled(Exception):
    """Raised inside a job by `ctx.check()` once the job is cancelled. Jobs let it propagate."""


class JobInterrupted(Exception):
    """Raised inside a job by `ctx.check()` when the server is shutting down."""


JobFn = Callable[["JobContext"], Any]


@dataclass
class _Spec:
    fn: JobFn
    resumable: bool


_PUBLIC = tuple(JobSnapshot.model_fields)


@dataclass
class _Active:
    """A job a thread is working on. Everything in it is guarded by `cond`."""

    row: dict[str, Any]                  # the job's columns, as in the database
    spec: _Spec
    cond: threading.Condition = field(default_factory=threading.Condition)
    control: str = "run"                 # what the user asked for: run | pause | cancel | interrupt
    subscribers: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = field(default_factory=list)
    finished: threading.Event = field(default_factory=threading.Event)
    last_saved: float = 0.0
    thread: threading.Thread | None = None

    def snapshot(self) -> JobSnapshot:
        return JobSnapshot(**copy.deepcopy({k: self.row[k] for k in _PUBLIC}))


class JobContext:
    """What a running job gets: its parameters, progress reporting, pause and cancel checks, and its
    checkpoint."""

    def __init__(self, runner: JobRunner, active: _Active):
        self._runner = runner
        self._a = active

    @property
    def job_id(self) -> str:
        return self._a.row["id"]

    @property
    def params(self) -> dict[str, Any]:
        return self._a.row["params"]

    @property
    def lecture_id(self) -> int | None:
        return self._a.row["lecture_id"]

    @property
    def checkpoint(self) -> Any | None:
        """The state last saved with `save_checkpoint`, or None for a fresh job."""
        return self._a.row["checkpoint"]

    def check(self) -> None:
        """Call between steps: returns at once while the job runs, waits while it is paused, and raises
        JobCancelled (or JobInterrupted) when it must stop."""
        self._runner._check(self._a)

    def progress(self, **fields: Any) -> None:
        """Merge `fields` into the job's progress, for example `ctx.progress(stage="transcribe", done=3,
        total=10)`. `percent` is filled in from done/total when not given. Also checks for pause and
        cancel."""
        self._runner._progress(self._a, fields)
        self.check()

    def save_checkpoint(self, state: Any) -> None:
        """Save how far the job got (JSON). Saved at once, so it survives a crash right after."""
        self._runner._save_checkpoint(self._a, state)


class JobRunner:
    def __init__(self, db: Database, *, progress_save_interval: float = 0.5):
        self.db = db
        self.progress_save_interval = progress_save_interval
        self._specs: dict[str, _Spec] = {}
        self._active: dict[str, _Active] = {}
        self._lock = threading.Lock()                   # guards _active only

    # ---- setup ---------------------------------------------------------------------------------------------

    def register(self, kind: str, fn: JobFn, *, resumable: bool = False) -> None:
        """Declare what runs for jobs of `kind`. `resumable`: the function can continue an interrupted job
        from `ctx.checkpoint`."""
        self._specs[kind] = _Spec(fn, resumable)

    def recover(self) -> list[str]:
        """Call once at startup: jobs the last server process left unfinished become `interrupted` (or
        `cancelled`, if the user had already asked to cancel them). Returns their ids."""
        now = utcnow()
        with self.db.session() as s:
            ids = list(s.scalars(select(Job.id).where(Job.status.in_(UNFINISHED))))
            s.execute(update(Job).where(Job.status == CANCELLING)
                      .values(status=CANCELLED, finished_at=now, updated_at=now))
            s.execute(update(Job).where(Job.status.in_(UNFINISHED))
                      .values(status=INTERRUPTED, error="the server stopped while this job was running",
                              updated_at=now))
        if ids:
            log.info("jobs interrupted by the last shutdown: %s", ", ".join(ids))
        return ids

    def shutdown(self, timeout: float = 5.0) -> None:
        """Ask every running job to stop at its next check; they end as `interrupted`. Waits up to
        `timeout`."""
        with self._lock:
            active = list(self._active.values())
        for a in active:
            with a.cond:
                a.control = "interrupt"
                a.cond.notify_all()
        deadline = time.monotonic() + timeout
        for a in active:
            a.finished.wait(max(0.0, deadline - time.monotonic()))

    # ---- what callers do -----------------------------------------------------------------------------------

    def submit(self, kind: str, params: dict[str, Any] | None = None, *,
               lecture_id: int | None = None) -> JobSnapshot:
        """Save a new job and start it. Returns at once."""
        spec = self._specs.get(kind)
        if spec is None:
            known = ", ".join(sorted(self._specs)) or "none"
            raise JobError(f"unknown job kind {kind!r} (registered: {known})")
        now = utcnow()
        row = dict(id=uuid.uuid4().hex, kind=kind, status=QUEUED, lecture_id=lecture_id, params=params or {},
                   progress={}, checkpoint=None, result=None, error=None, created_at=now, started_at=None,
                   finished_at=None, updated_at=now)
        with self.db.session() as s:
            s.add(Job(**row))
        return self._start(_Active(row=row, spec=spec))

    def get(self, job_id: str) -> JobSnapshot:
        a = self._find_active(job_id)
        if a is not None:
            with a.cond:
                return a.snapshot()
        with self.db.session() as s:
            job = s.get(Job, job_id)
            if job is None:
                raise JobNotFound(job_id)
            return _snapshot_of(job)

    def list(self, *, lecture_id: int | None = None, kind: str | None = None,
             limit: int = 50) -> list[JobSnapshot]:
        """Newest first."""
        q = select(Job).order_by(Job.created_at.desc()).limit(limit)
        if lecture_id is not None:
            q = q.where(Job.lecture_id == lecture_id)
        if kind is not None:
            q = q.where(Job.kind == kind)
        with self.db.session() as s:
            rows = [_snapshot_of(j) for j in s.scalars(q)]
        return [self.get(r.id) if r.status not in ENDED else r for r in rows]   # running: live progress

    def pause(self, job_id: str) -> JobSnapshot:
        a = self._require_active(job_id, "pause")
        with a.cond:
            if a.control == "run" and a.row["status"] in (QUEUED, RUNNING):
                a.control = "pause"
                self._set(a, status=PAUSING)
            return a.snapshot()

    def resume(self, job_id: str) -> JobSnapshot:
        """Continue a paused job, or restart an interrupted one from its checkpoint (resumable kinds only)."""
        a = self._find_active(job_id)
        if a is not None:
            with a.cond:
                if a.control == "pause":
                    a.control = "run"
                    if a.row["status"] == PAUSING:      # it never reached a check, so it never stopped
                        self._set(a, status=RUNNING)
                    a.cond.notify_all()
                return a.snapshot()
        with self.db.session() as s:
            job = s.get(Job, job_id)
            if job is None:
                raise JobNotFound(job_id)
            if job.status != INTERRUPTED:
                raise JobError(f"job {job_id} is {job.status}; only a paused or interrupted job can be "
                               "resumed")
            spec = self._specs.get(job.kind)
            if spec is None or not spec.resumable:
                raise JobError(f"a {job.kind} job can't continue after a restart; start a new one")
            row = {c: getattr(job, c) for c in _COLUMNS}
        row.update(status=QUEUED, error=None)
        a = _Active(row=row, spec=spec)
        with a.cond:
            self._save(a)
        return self._start(a)

    def cancel(self, job_id: str) -> JobSnapshot:
        a = self._find_active(job_id)
        if a is not None:
            with a.cond:
                if a.control in ("run", "pause") and a.row["status"] not in ENDED:
                    a.control = "cancel"
                    self._set(a, status=CANCELLING)
                    a.cond.notify_all()
                return a.snapshot()
        with self.db.session() as s:                    # an interrupted job has no thread: cancel it directly
            job = s.get(Job, job_id)
            if job is None:
                raise JobNotFound(job_id)
            if job.status != INTERRUPTED:
                raise JobError(f"job {job_id} is already {job.status}")
            job.status, job.finished_at, job.updated_at = CANCELLED, utcnow(), utcnow()
            return _snapshot_of(job)

    def wait(self, job_id: str, timeout: float | None = None) -> JobSnapshot:
        """Block until the job has ended (or `timeout` passes) and return its snapshot."""
        a = self._find_active(job_id)
        if a is not None:
            a.finished.wait(timeout)
        return self.get(job_id)

    async def events(self, job_id: str) -> AsyncIterator[JobSnapshot]:
        """The job's progress stream: its snapshot now, then a new one at every change, ending once the job
        has ended. A slow reader skips intermediate snapshots, never the last one."""
        a = self._find_active(job_id)
        if a is None:
            yield self.get(job_id)
            return
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[JobSnapshot] = asyncio.Queue()
        sub = (loop, queue)
        with a.cond:
            first = a.snapshot()
            if first.status not in ENDED:
                a.subscribers.append(sub)
        try:
            yield first
            last = first
            while last.status not in ENDED:
                last = await queue.get()
                while not queue.empty():                # coalesce: only the newest snapshot matters
                    last = queue.get_nowait()
                yield last
        finally:
            with a.cond:
                if sub in a.subscribers:
                    a.subscribers.remove(sub)

    # ---- inside the job thread -----------------------------------------------------------------------------

    def _start(self, a: _Active) -> JobSnapshot:
        with self._lock:
            self._active[a.row["id"]] = a
        a.thread = threading.Thread(target=self._run, args=(a,), daemon=True,
                                    name=f"job-{a.row['kind']}-{a.row['id'][:8]}")
        with a.cond:
            snap = a.snapshot()
        a.thread.start()
        return snap

    def _run(self, a: _Active) -> None:
        ctx = JobContext(self, a)
        outcome: dict[str, Any]
        try:
            self._check(a)
            with a.cond:
                self._set(a, status=RUNNING, started_at=a.row["started_at"] or utcnow())
            result = a.spec.fn(ctx)
            outcome = dict(status=DONE, result=result)
        except JobCancelled:
            outcome = dict(status=CANCELLED)
        except JobInterrupted:
            outcome = dict(status=INTERRUPTED, error="the server stopped while this job was running")
        except Exception as e:
            log.exception("job %s (%s) failed", a.row["id"], a.row["kind"])
            outcome = dict(status=FAILED, error=f"{type(e).__name__}: {e}")
        if outcome["status"] in FINAL:
            outcome["finished_at"] = utcnow()
        try:
            with a.cond:
                try:
                    self._set(a, **outcome)
                except Exception as e:              # e.g. a result that isn't JSON
                    log.exception("job %s: could not save its outcome", a.row["id"])
                    self._set(a, status=FAILED, result=None, error=f"could not save the result: {e}")
        finally:
            with self._lock:
                self._active.pop(a.row["id"], None)
            a.finished.set()

    def _check(self, a: _Active) -> None:
        with a.cond:
            while True:
                if a.control == "cancel":
                    raise JobCancelled()
                if a.control == "interrupt":
                    raise JobInterrupted()
                if a.control == "pause":
                    if a.row["status"] != PAUSED:
                        self._set(a, status=PAUSED)
                    a.cond.wait()
                    continue
                if a.row["status"] in (PAUSING, PAUSED):
                    self._set(a, status=RUNNING)
                return

    def _progress(self, a: _Active, fields: dict[str, Any]) -> None:
        with a.cond:
            progress = {**a.row["progress"], **fields}
            if "percent" not in fields and progress.get("total"):
                progress["percent"] = round(100.0 * (progress.get("done") or 0) / progress["total"], 1)
            due = time.monotonic() - a.last_saved >= self.progress_save_interval
            self._set(a, save=due, progress=progress)

    def _save_checkpoint(self, a: _Active, state: Any) -> None:
        with a.cond:
            self._set(a, checkpoint=state)

    # ---- state changes: always under a.cond ----------------------------------------------------------------

    def _set(self, a: _Active, *, save: bool = True, **changes: Any) -> None:
        """Apply changes to the job, save them (unless `save` is False: throttled progress) and tell the
        subscribers. Saving under the job's lock keeps the database in the same order as the changes."""
        a.row.update(changes, updated_at=utcnow())
        if save:
            self._save(a)
        snap = a.snapshot()
        for loop, queue in list(a.subscribers):
            try:
                loop.call_soon_threadsafe(queue.put_nowait, snap)
            except RuntimeError:                        # that event loop has closed: the reader is gone
                a.subscribers.remove((loop, queue))

    def _save(self, a: _Active) -> None:
        values = {k: v for k, v in a.row.items() if k != "id"}
        with self.db.session() as s:
            s.execute(update(Job).where(Job.id == a.row["id"]).values(**values))
        a.last_saved = time.monotonic()

    def _find_active(self, job_id: str) -> _Active | None:
        with self._lock:
            return self._active.get(job_id)

    def _require_active(self, job_id: str, action: str) -> _Active:
        a = self._find_active(job_id)
        if a is None:
            status = self.get(job_id).status                 # raises JobNotFound
            raise JobError(f"job {job_id} is {status}; it can't {action}")
        return a


_COLUMNS = tuple(c.name for c in Job.__table__.columns)


def _snapshot_of(job: Job) -> JobSnapshot:
    return JobSnapshot(**{k: getattr(job, k) for k in _PUBLIC})
