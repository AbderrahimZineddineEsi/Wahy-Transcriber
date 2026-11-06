"""Tafrigh runs on disk: one folder per run in `data/tafrigh_runs/` (GLOSSARY: Tafrigh run).

    store = RunStore(settings.tafrigh_runs_dir)
    session = store.load("run_0123456789ab")      # None when there is no such run
    store.save(session)                           # after a run, and after every review action
    store.clone(session, name="copy")             # "save as new": a copy with its own id and folder

A run folder holds `session.json` (everything the review and the renders need: sentences, outline, spans,
manifest, render settings, and `meta`: lecture, name, dates), `meta.json` (the same `meta` plus a few numbers, so
the list of runs does not read every session), and the run logger's files (`manifest.json`, `requests.jsonl`,
`results.jsonl`, `report.json`, `report.md`). Because the review writes `session.json` after every action, the
review survives a restart: the old app kept runs in memory and only looked for a copy on disk when asked.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import LectureSpan, OutlineState, TranscriptSegment
from .renderer import RenderConfig
from .review_queue import ReviewQueueManager

RUN_ID = re.compile(r"^run_[0-9a-f]{12}$")
SESSION_FILE, META_FILE = "session.json", "meta.json"


class RunNotFound(KeyError):
    pass


def new_run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass
class RunSession:
    """A finished Tafrigh run, in memory: what the review actions change and the renders read."""

    run_id: str
    dir: Path
    segments: list[TranscriptSegment]
    outline_state: OutlineState
    lecture_spans: list[LectureSpan]
    manifest: dict[str, Any]
    render_cfg: RenderConfig
    meta: dict[str, Any]
    manager: ReviewQueueManager = field(init=False)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def __post_init__(self) -> None:
        self.manager = ReviewQueueManager(self.segments)

    def summary(self) -> dict[str, Any]:
        """The row of the saved-runs list."""
        m = self.manifest
        reviewed = sum(1 for s in self.segments if s.trace.get("review"))
        return {
            "run_id": self.run_id,
            "lecture_id": self.meta.get("lecture_id"),
            "name": self.meta.get("name") or self.run_id,
            "created_at": self.meta.get("created_at"),
            "copied_from": self.meta.get("copied_from"),
            "job_id": self.meta.get("job_id"),
            "num_segments": len(self.segments),
            "needs_review": len(self.manager.get_items()),
            "reviewed": reviewed,
            "processing_mode": m.get("processing_mode"),
            "window_size": m.get("window_size"),
            "model_candidate": m.get("model_candidate"),
            "model_name": m.get("gemini_route") or m.get("model_name"),
            "typo_strategy": m.get("typo_strategy"),
            "target_range": m.get("target_range"),
            "stopped": bool(m.get("cancelled")),
            "total_cost_usd": m.get("total_cost_usd", 0.0),
            "requests_sent": m.get("requests_sent", 0),
            "wall_clock_seconds": m.get("wall_clock_seconds"),
        }


class RunStore:
    def __init__(self, base: Path):
        self.base = Path(base)
        self._guard = threading.Lock()
        self._cache: dict[str, RunSession] = {}

    # ---- paths ---------------------------------------------------------------------------------------------

    def path(self, run_id: str) -> Path:
        """The run's folder. The id is checked first: it comes from the URL and is used as a folder name."""
        if not RUN_ID.fullmatch(run_id or ""):
            raise RunNotFound(run_id)
        return self.base / run_id

    # ---- read ----------------------------------------------------------------------------------------------

    def load(self, run_id: str) -> RunSession:
        """The run, from memory or from its folder. Raises RunNotFound."""
        folder = self.path(run_id)
        with self._guard:
            cached = self._cache.get(run_id)
            if cached is not None:
                return cached
            file = folder / SESSION_FILE
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise RunNotFound(run_id) from None
            session = RunSession(
                run_id=run_id,
                dir=folder,
                segments=[TranscriptSegment.model_validate(x) for x in data["segments"]],
                outline_state=OutlineState.model_validate(data["outline_state"]),
                lecture_spans=[LectureSpan.model_validate(x) for x in data["lecture_spans"]],
                manifest=data["manifest"],
                render_cfg=RenderConfig.model_validate(data.get("render_cfg") or {}),
                meta=data.get("meta") or {},
            )
            self._cache[run_id] = session
            return session

    def list(self, lecture_id: int | None = None) -> list[dict[str, Any]]:
        """The saved runs, newest first (from each folder's meta.json)."""
        rows: list[dict[str, Any]] = []
        if not self.base.is_dir():
            return rows
        for folder in self.base.iterdir():
            if not RUN_ID.fullmatch(folder.name):
                continue
            try:
                row = json.loads((folder / META_FILE).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if lecture_id is None or row.get("lecture_id") == lecture_id:
                rows.append(row)
        rows.sort(key=lambda r: (r.get("created_at") or "", r.get("run_id") or ""), reverse=True)
        return rows

    # ---- write ---------------------------------------------------------------------------------------------

    def save(self, session: RunSession) -> None:
        """Write the session (atomically: a crash in the middle leaves the previous file)."""
        with session.lock:
            payload = {
                "run_id": session.run_id,
                "manifest": session.manifest,
                "segments": [s.model_dump(mode="json") for s in session.segments],
                "outline_state": session.outline_state.model_dump(mode="json"),
                "lecture_spans": [s.model_dump(mode="json") for s in session.lecture_spans],
                "render_cfg": session.render_cfg.model_dump(mode="json"),
                "meta": session.meta,
            }
            session.dir.mkdir(parents=True, exist_ok=True)
            _write_json(session.dir / SESSION_FILE, payload)
            _write_json(session.dir / META_FILE, session.summary())
        with self._guard:
            self._cache[session.run_id] = session

    def clone(self, session: RunSession, *, name: str | None = None) -> RunSession:
        """"Save as a new version": a copy with its own id and folder; review edits made in the copy leave the
        original as it is."""
        with session.lock:
            new_id = new_run_id()
            target = self.path(new_id)
            shutil.copytree(session.dir, target)
            copy = RunSession(
                run_id=new_id,
                dir=target,
                segments=[s.model_copy(deep=True) for s in session.segments],
                outline_state=session.outline_state.model_copy(deep=True),
                lecture_spans=[s.model_copy(deep=True) for s in session.lecture_spans],
                manifest={**session.manifest, "run_id": new_id, "copied_from": session.run_id},
                render_cfg=session.render_cfg.model_copy(deep=True),
                meta={
                    **session.meta,
                    "name": name or f"{session.meta.get('name') or session.run_id} (نسخة)",
                    "created_at": now_iso(),
                    "copied_from": session.run_id,
                },
            )
        self.save(copy)
        return copy

    def delete(self, run_id: str) -> None:
        folder = self.path(run_id)
        with self._guard:
            self._cache.pop(run_id, None)
        if not folder.is_dir():
            raise RunNotFound(run_id)
        shutil.rmtree(folder)

    def forget_cache(self) -> None:
        """Drop the in-memory sessions (tests use it to show that everything comes back from disk)."""
        with self._guard:
            self._cache.clear()


def _write_json(path: Path, payload: Any) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
