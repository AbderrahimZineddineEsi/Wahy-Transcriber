"""
Laya Adapter for AI Tafrigh Phase.
The same questions as JEVAdapter, answered by the local Laya model through `core/ai` (`ai.laya.predict`, which asks
the GPU owner for the model). Drop-in interchangeable with JEVAdapter.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from wahy.core.ai.layer import AiLayer
from wahy.core.ai.types import Call

from ..schemas import JEVRequestConfig
from .jev_adapter import JEVAdapter


class LayaAdapter(JEVAdapter):
    def __init__(
        self,
        ai: AiLayer | None = None,
        call: Call | None = None,
        config: JEVRequestConfig | None = None,
        mock_response_fn: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(ai=ai, call=call, config=config, mock_response_fn=mock_response_fn, model="laya")

    @property
    def is_live(self) -> bool:
        return self.ai is not None and self.ai.ready()["laya"]

    def ask(self, state: dict[str, Any], payload: dict[str, Any]) -> tuple[dict[str, Any], float, int, int]:
        assert self.ai is not None
        answers = self.ai.laya.predict(state, payload, call=self.call)
        return answers, 0.0, 0, 0
