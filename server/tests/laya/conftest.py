"""Fixtures for the research side: its caches and results go to a temporary folder, and its provider layer logs
to a temporary database, so no test touches data/laya_datagen/ or data/wahy.db."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from wahy.core.ai.layer import AiLayer
from wahy.core.db import Database
from wahy.core.gpu import GpuOwner
from wahy.core.settings import Settings
from wahy.laya import cache, context


@pytest.fixture
def laya_data(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """data/laya_datagen/ for one test."""
    root = tmp_path / "laya_datagen"
    monkeypatch.setattr(cache, "DATA_DIR", root)
    import wahy.laya.__main__ as cli
    monkeypatch.setattr(cli, "DATA_DIR", root)
    return root


@pytest.fixture
def laya_core(tmp_path, laya_data) -> Iterator[dict]:
    """The research side's machinery on a temporary data folder. `make(transport)` builds the AI layer with a
    fake HTTP transport (keys set, no sleeping); without a call, the layer has no network."""
    settings = Settings(data_dir=tmp_path / "data", env_path=tmp_path / ".env", _env_file=None,
                        GEMINI_API_KEY="AIza-test-key-0000000000000000", OPENROUTER_API_KEY="sk-or-v1-testtesttesttest")
    db = Database(settings.db_path)
    db.migrate()

    def make(transport=None) -> AiLayer:
        layer = AiLayer(db, settings, GpuOwner(), transport=transport, sleep=lambda s: None)
        context.use(settings, ai=layer)
        context._state["db"] = db
        return layer

    make()
    yield {"settings": settings, "db": db, "make": make, "laya": laya_data}
    context.use(None)
    db.dispose()
