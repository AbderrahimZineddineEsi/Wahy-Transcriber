"""Shared fixtures: every test gets its own data folder, so nothing touches data/wahy.db."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from wahy.core.db import Database
from wahy.core.jobs import JobRunner
from wahy.core.settings import KEY_FIELDS, Settings


@pytest.fixture(autouse=True)
def _no_real_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keys from the shell must not leak into tests."""
    for name in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "JEV_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    assert len(KEY_FIELDS) == 4


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data", _env_file=None)


@pytest.fixture
def db(settings: Settings) -> Iterator[Database]:
    database = Database(settings.db_path)
    database.migrate()
    yield database
    database.dispose()


@pytest.fixture
def runner(db: Database) -> Iterator[JobRunner]:
    jobs = JobRunner(db, progress_save_interval=0.0)
    yield jobs
    jobs.shutdown(timeout=2)
