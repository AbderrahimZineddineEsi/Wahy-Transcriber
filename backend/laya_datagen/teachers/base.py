"""Teacher = any model that answers the canonical verdict/boundary questions for an envelope.

Results are cached per (teacher, model, prompt version, envelope), so an engine edit only pays for NEW envelopes.
"""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from ..cache import JsonCache, sha

VERDICTS = ["CORRECT", "FALSE", "NOT_SURE"]


def normalize(verdict: str, probs: Optional[Dict[str, float]], conf: Optional[float]) -> Dict[str, float]:
    if probs and all(k in probs for k in VERDICTS) and sum(probs.values()) > 0:
        t = sum(float(probs[k]) for k in VERDICTS)
        return {k: float(probs[k]) / t for k in VERDICTS}
    c = min(0.99, max(0.34, float(conf if conf is not None else 0.85)))
    return {k: (c if k == verdict else (1 - c) / 2) for k in VERDICTS}


class Teacher(ABC):
    name = "teacher"
    prompt_version = "v1"

    def __init__(self, model: str):
        self.model = model
        self.cache = JsonCache(f"teacher_{self.name}")
        self.cost_usd = 0.0
        self.calls = 0

    def key(self, env: Dict[str, Any]) -> str:
        return sha(self.name, self.model, self.prompt_version, env["state"], env["questions"])

    @abstractmethod
    def _predict_uncached(self, envs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Return one {verdict, probs, boundary, reason, cost} dict per envelope, same order."""

    batch_size = 1

    def predict(self, envs: List[Dict[str, Any]], progress=None) -> List[Dict[str, Any]]:
        out: List[Optional[Dict[str, Any]]] = [None] * len(envs)
        todo = []
        for i, e in enumerate(envs):
            hit = self.cache.get(self.key(e))
            if hit is not None:
                out[i] = hit
            else:
                todo.append(i)
        for s in range(0, len(todo), self.batch_size):
            idx = todo[s:s + self.batch_size]
            t0 = time.time()
            res = self._predict_uncached([envs[i] for i in idx])
            lat = (time.time() - t0) * 1000 / len(idx)
            for i, r in zip(idx, res):
                r.update(latency_ms=round(lat), model=self.model)
                self.cache.put(self.key(envs[i]), r)
                self.cost_usd += r.get("cost", 0.0)
                out[i] = r
            self.calls += 1
            if progress:
                progress(min(len(todo), s + self.batch_size), len(todo))
        return out  # type: ignore[return-value]


def ask(model: Teacher, envs: List[Dict[str, Any]], desc: str, allow_calls: bool) -> Optional[List[Dict[str, Any]]]:
    """Answers for every envelope with a progress bar. Cached answers are always used; new model calls only when
    allow_calls (the notebook's RUN_MODELS) — otherwise None, so "Run all" never spends time or money by accident."""
    from tqdm.auto import tqdm
    new = sum(model.cache.get(model.key(e)) is None for e in envs)
    if new and not allow_calls:
        print(f"{desc}: {new} of {len(envs)} cards not answered yet — skipped (set RUN_MODELS = True in Setup to call it)")
        return None
    bar = tqdm(total=new, desc=f"{desc} ({len(envs) - new} cached)")
    out = model.predict(envs, progress=lambda d, n: (setattr(bar, "n", d), bar.refresh()))
    bar.close()
    return out
