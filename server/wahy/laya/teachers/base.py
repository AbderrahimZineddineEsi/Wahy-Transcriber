"""Teacher = any model that answers the canonical verdict/boundary questions for an envelope (GLOSSARY: Teacher).

Since rewrite phase 22 every teacher is a verifier of the app's provider layer (wahy/core/ai, ADR 0004): the same
code, keys, pacing, retries and request log as a verification pass in the app, with purpose "teacher". A teacher
adds two things on top: a cache, so a card is never paid for twice, and the old answer shape the datagen reads:

    {"verdict", "probs": {CORRECT, FALSE, NOT_SURE}, "boundary", "reason", "cost", "latency_ms", "model"}

Results are cached per (teacher, model, prompt version, envelope), so an engine edit only pays for NEW envelopes.
Answers given before phase 22 (the datagen's own HTTP code) are cached under prompt version "v1"; answers given
through core/ai are "v2" (its request differs a little: the app's batch instruction and reply schema, and the
app's boundary clean-up), so the two are never mixed.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from wahy.core.ai.types import AiError, Answer, Item

from .. import context
from ..cache import JsonCache, sha

VERDICTS = ["CORRECT", "FALSE", "NOT_SURE"]
PROMPT_VERSION = "v2"           # through core/ai (phase 22)
OLD_PROMPT_VERSION = "v1"       # the datagen's own HTTP code, before phase 22


def normalize(verdict: str, probs: Optional[Dict[str, float]], conf: Optional[float]) -> Dict[str, float]:
    if probs and all(k in probs for k in VERDICTS) and sum(probs.values()) > 0:
        t = sum(float(probs[k]) for k in VERDICTS)
        return {k: float(probs[k]) / t for k in VERDICTS}
    c = min(0.99, max(0.34, float(conf if conf is not None else 0.85)))
    return {k: (c if k == verdict else (1 - c) / 2) for k in VERDICTS}


def request_costs(request_ids: List[Optional[int]]) -> Dict[int, float]:
    """request id -> its cost in USD, from the request log (core/ai saves the cost of every request)."""
    ids = sorted({i for i in request_ids if i is not None})
    if not ids:
        return {}
    from wahy.core.ai.models import AiRequest
    with context.database().session() as s:
        return {r.id: float(r.cost_usd or 0.0) for r in s.query(AiRequest).filter(AiRequest.id.in_(ids))}


class Teacher:
    name = "teacher"                # the cache folder: cache/teacher_<name>
    provider = "fake"               # the core/ai verifier that answers
    prompt_version = PROMPT_VERSION
    batch_size = 1

    def __init__(self, model: str):
        self.model = model
        self.cache = JsonCache(f"teacher_{self.name}")
        self.cost_usd = 0.0
        self.calls = 0

    def key(self, env: Dict[str, Any]) -> str:
        return sha(self.name, self.model, self.prompt_version, env["state"], env["questions"])

    # ---- what a subclass says --------------------------------------------------------------------------------

    def options(self) -> Any:
        """The verifier's options (model, prompt...)."""
        return None

    def item_state(self, env: Dict[str, Any]) -> Dict[str, Any]:
        """The state the model reads (the envelope's, unless a teacher hides some of it)."""
        return env["state"]

    # ---- asking --------------------------------------------------------------------------------------------

    def _predict_uncached(self, envs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """One {verdict, probs, boundary, reason, cost} dict per envelope, same order, from one core/ai call."""
        items = [Item(id=str(i), state=self.item_state(e), questions=e["questions"]) for i, e in enumerate(envs)]
        answers = context.ai().verify(self.provider, items, call=context.teacher_call(), options=self.options())
        costs = request_costs([a.request_id for a in answers])
        shared: Dict[Optional[int], int] = {}
        for a in answers:
            shared[a.request_id] = shared.get(a.request_id, 0) + 1
        return [self._row(a, costs.get(a.request_id, 0.0) / shared[a.request_id] if a.request_id else 0.0)
                for a in answers]

    def _row(self, a: Answer, cost: float) -> Dict[str, Any]:
        if not a.ok:
            raise AiError(f"{self.name}: no answer for a card ({a.error})", request_id=a.request_id)
        assert a.verdict is not None
        return {"verdict": a.verdict, "probs": normalize(a.verdict, a.probabilities, a.confidence),
                "boundary": a.boundary, "reason": a.reason, "cost": round(cost, 8), "request_id": a.request_id}

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
