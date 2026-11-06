"""A fake verifier for tests and offline development: answers at once, costs nothing, and is saved in the
request log like a real provider, so code built on core/ai (a verification pass, the telemetry) can be tested
end to end.

    fake = FakeVerifier(log)                                      # every item: CORRECT, complete
    fake = FakeVerifier(log, answer=lambda item: {"verdict": "FALSE"}, fail={"12"})
    fake.calls                                                     # the item ids of each request, in order

`answer(item)` returns a flat JSON answer (as Gemini or a chat model would); `fail` lists item ids whose
request fails with an AiError (`fatal_fail` ids fail as fatal); `cost_usd` is what each request is logged
as costing.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from wahy.core.ai.log import RequestLog
from wahy.core.ai.types import AiError, Answer, Call, Item, answer_from_json


def default_answer(item: Item) -> dict[str, Any]:
    return {
        "verdict": "CORRECT",
        "confidence": 0.9,
        "probabilities": {"CORRECT": 0.9, "FALSE": 0.05, "NOT_SURE": 0.05},
        "boundary_status": "COMPLETE_SPAN",
        "boundary_confidence": 0.9,
        "reason": "fake verifier",
    }


class FakeVerifier:
    name = "fake"

    def __init__(
        self,
        log: RequestLog,
        *,
        answer: Callable[[Item], dict[str, Any]] = default_answer,
        fail: set[str] | None = None,
        fatal_fail: set[str] | None = None,
        model: str = "fake-1",
        cost_usd: float = 0.0,
    ):
        self.log, self.answer, self.model, self.cost_usd = log, answer, model, cost_usd
        self.fail, self.fatal_fail = set(fail or ()), set(fatal_fail or ())
        self.calls: list[list[str]] = []

    def preview(self, items: list[Item], options: Any = None) -> dict[str, Any]:
        it = items[0]
        return {"endpoint": "fake", "model": self.model,
                "body": {"model": self.model, "finding_id": it.id, "state": it.state,
                         "questions": it.questions}}

    def verify(self, items: list[Item], *, call: Call, options: Any = None) -> list[Answer]:
        out = []
        for it in items:
            call.check()
            self.calls.append([it.id])
            request = {"model": self.model, "finding_id": it.id, "state": it.state, "questions": it.questions}
            tokens = max(1, len(json.dumps(request, ensure_ascii=False)) // 4)
            if it.id in self.fail or it.id in self.fatal_fail:
                fatal = it.id in self.fatal_fail
                rid = self.log.save(
                    provider=self.name,
                    model=self.model,
                    call=call,
                    ok=False,
                    request=request,
                    error="fake failure",
                    input_tokens=tokens,
                    latency_ms=0,
                )
                raise AiError(f"fake failure for {it.id}", fatal=fatal, request_id=rid)
            data = self.answer(it)
            rid = self.log.save(
                provider=self.name,
                model=self.model,
                call=call,
                ok=True,
                request=request,
                response=data,
                input_tokens=tokens,
                output_tokens=40,
                cost_usd=self.cost_usd,
                latency_ms=0,
            )
            a = answer_from_json(it, data, provider=self.name, model=self.model)
            a.request_id = rid
            out.append(a)
        return out
