"""Helpers for the core/ai tests: recorded provider responses (tests/fixtures/ai/*.json, in each provider's
documented reply shape) played back through httpx's MockTransport, so no test touches the network."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from wahy.core.ai.types import Call, Item

FIXTURES = Path(__file__).parent / "fixtures" / "ai"


def recorded(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


class Replay:
    """A fake provider server: answers each request with the next queued response (a function of the request,
    or a Response), and keeps every request it got."""

    def __init__(self, *answers: httpx.Response | Callable[[httpx.Request], httpx.Response]):
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not self.answers:
            raise AssertionError(f"unexpected request to {request.url}")
        answer = self.answers.pop(0)
        return answer(request) if callable(answer) else answer

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)

    def body(self, i: int = -1) -> Any:
        return json.loads(self.requests[i].content)


def ok(name: str, status: int = 200, **kw: Any) -> httpx.Response:
    return httpx.Response(status, json=recorded(name), **kw)


def item(id: str, *, prefix: str = "قال", suffix: str = "والله", **state: Any) -> Item:
    """An envelope-like item: a corpus prefix and suffix exist, so missing start/end boundaries are allowed."""
    s = {"matched_span_in_lecture": "بسم الله الرحمن الرحيم", "canonical_corpus_text": "بسم الله الرحمن الرحيم",
         "unmatched_corpus_prefix_words": prefix, "unmatched_corpus_suffix_words": suffix,
         "engine_score": 12.5, "engine_confidence_band": "HIGH", **state}
    return Item(id=id, state=s, questions={"verdict": {"type": "choice", "criteria": {
        "CORRECT": "a quote", "FALSE": "ordinary speech", "NOT_SURE": "cannot tell"}}})


class Waits:
    """Collects the waits a provider announces (`call.on_wait`) and the sleeps it does."""

    def __init__(self) -> None:
        self.announced: list[tuple[float, str]] = []
        self.slept: list[float] = []

    def call(self, **kw: Any) -> Call:
        return Call(on_wait=lambda s, why: self.announced.append((s, why)), **kw)

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)

    @property
    def total(self) -> float:
        return round(sum(self.slept), 3)
