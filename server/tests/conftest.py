"""Shared fixtures: every test gets its own data folder, so nothing touches data/wahy.db."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from wahy.core.db import Database
from wahy.core.jobs import JobRunner
from wahy.core.settings import KEY_FIELDS, Settings
from wahy.main import create_app


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--live", action="store_true", help="also run the tests marked `live` (network, real models)")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--live"):
        return
    skip = pytest.mark.skip(reason="live test: run with --live")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def _no_real_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keys from the shell must not leak into tests."""
    for name in ("GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "JEV_API_KEY", "WAHY_ACCESS_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    assert len(KEY_FIELDS) == 4


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data", env_path=tmp_path / ".env", _env_file=None)


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


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    """The whole app on a temporary data folder. `client.app.state` holds the services, so a test can swap in
    fakes (for example `client.app.state.transcription.backends`)."""
    with TestClient(create_app(settings)) as c:
        yield c
