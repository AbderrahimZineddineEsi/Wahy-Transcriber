"""Builds the FastAPI app. Each feature mounts its own router here (see docs/rewrite/ARCHITECTURE.md).

Startup (`lifespan`): read the settings, bring the database up to date, mark the jobs the last process left
unfinished as interrupted, and create the shared machinery that routes reach through `request.app.state`:

    db      core/db.py       the SQLite database
    jobs    core/jobs.py     the job runner
    gpu     core/gpu.py      the GPU owner
    engine  core/engine.py   the engine worker client (the worker itself starts on the first call)

Shutdown: running jobs stop at their next check (they show as interrupted), the GPU is freed and the engine
worker is stopped.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from wahy.core.db import Database
from wahy.core.engine import EngineClient
from wahy.core.gpu import GpuOwner
from wahy.core.jobs import JobRunner
from wahy.core.settings import Settings, get_settings
from wahy.features.jobs.router import router as jobs_router

log = logging.getLogger("wahy")


def create_app(settings: Settings | None = None) -> FastAPI:
    """The app. Tests pass their own settings (a temporary data folder)."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        s = settings or get_settings()
        db = Database(s.db_path)
        db.migrate()
        jobs = JobRunner(db)
        jobs.recover()
        app.state.settings, app.state.db, app.state.jobs = s, db, jobs
        app.state.gpu = GpuOwner()
        app.state.engine = EngineClient.from_settings(s)
        try:
            yield
        finally:
            jobs.shutdown()
            app.state.gpu.unload()
            app.state.engine.close()
            db.dispose()

    app = FastAPI(title="Wahy-Finder", version="0.1.0", lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(jobs_router)
    return app


app = create_app()
