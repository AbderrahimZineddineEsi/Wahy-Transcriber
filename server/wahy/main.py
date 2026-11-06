"""Builds the FastAPI app. Each feature mounts its own router here (see docs/rewrite/ARCHITECTURE.md).

Startup (`lifespan`): read the settings, bring the database up to date, mark the jobs the last process left
unfinished as interrupted, and create the shared machinery that routes reach through `request.app.state`:

    db      core/db.py       the SQLite database
    jobs    core/jobs.py     the job runner
    gpu     core/gpu.py      the GPU owner
    engine  core/engine.py   the engine worker client (the worker itself starts on the first call)
    lectures, transcription, corpora, detection, settings_service
            the feature services (features/*/service.py)

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
from wahy.features.corpora.router import router as corpora_router
from wahy.features.corpora.service import CorporaService
from wahy.features.detection.router import router as detection_router
from wahy.features.detection.service import DetectionService
from wahy.features.jobs.router import router as jobs_router
from wahy.features.lectures.router import router as lectures_router
from wahy.features.lectures.service import LectureService
from wahy.features.settings.router import router as settings_router
from wahy.features.settings.service import SettingsService
from wahy.features.transcription.router import router as transcription_router
from wahy.features.transcription.service import TranscriptionService

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
        app.state.lectures = LectureService(db, s)
        app.state.transcription = TranscriptionService(db, s, app.state.gpu, jobs, app.state.lectures)
        app.state.corpora = CorporaService(db, s, jobs, app.state.engine)
        app.state.detection = DetectionService(db, s, jobs, app.state.engine, app.state.lectures,
                                               app.state.corpora)
        app.state.settings_service = SettingsService(s, app.state.gpu, app.state.engine, jobs,
                                                     app.state.corpora)
        try:
            yield
        finally:
            jobs.shutdown()
            app.state.gpu.unload()
            app.state.engine.close()
            db.dispose()

    app = FastAPI(title="Wahy-Finder", version="0.1.0", lifespan=lifespan)

    app.include_router(settings_router)
    app.include_router(jobs_router)
    app.include_router(lectures_router)
    app.include_router(transcription_router)
    app.include_router(corpora_router)
    app.include_router(detection_router)
    return app


app = create_app()
