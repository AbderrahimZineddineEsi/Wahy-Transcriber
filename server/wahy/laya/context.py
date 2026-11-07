"""The server's machinery, as the research side uses it: the same settings, the same request log (data/wahy.db),
the same AI provider layer (ADR 0004) and the same engine worker (ADR 0002) as the app, built once per process.

    from wahy.laya import context
    answers = context.ai().verify("gemini", items, call=context.teacher_call())
    findings = context.engine().detect(words, {"engine": "v5"})

Every teacher request is saved in the app's request log with purpose "teacher", so the telemetry screen shows what
a labelling run cost. Tests point everything at a temporary folder with `use(Settings(data_dir=tmp))`.
"""
from __future__ import annotations

import threading
from typing import Any

from wahy.core.ai.layer import AiLayer
from wahy.core.ai.types import Call
from wahy.core.db import Database
from wahy.core.gpu import GpuOwner
from wahy.core.settings import Settings, get_settings

_lock = threading.Lock()
_state: dict[str, Any] = {}


def use(settings: Settings | None = None, *, ai: AiLayer | None = None) -> None:
    """Start over with these settings (None: the app's own) and, optionally, a ready AI layer (tests pass one
    with a fake transport). Closes nothing: call before the first use, or between tests."""
    with _lock:
        _state.clear()
        if settings is not None:
            _state["settings"] = settings
        if ai is not None:
            _state["ai"] = ai


def settings() -> Settings:
    with _lock:
        if "settings" not in _state:
            _state["settings"] = get_settings()
        return _state["settings"]


def database() -> Database:
    s = settings()
    with _lock:
        if "db" not in _state:
            db = Database(s.db_path)
            db.migrate()
            _state["db"] = db
        return _state["db"]


def gpu() -> GpuOwner:
    with _lock:
        if "gpu" not in _state:
            _state["gpu"] = GpuOwner()
        return _state["gpu"]


def ai() -> AiLayer:
    """The provider layer, logging to the app's database."""
    if "ai" in _state:
        return _state["ai"]
    layer = AiLayer(database(), settings(), gpu())
    with _lock:
        return _state.setdefault("ai", layer)


def teacher_call(**kw: Any) -> Call:
    """Who is asking: a teacher labelling cards (saved with every request)."""
    return Call(purpose="teacher", **kw)
