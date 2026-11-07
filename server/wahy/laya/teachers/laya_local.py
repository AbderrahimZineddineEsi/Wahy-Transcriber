"""Zero-shot (or fine-tuned) Laya as a teacher: the app's local Laya (wahy/core/ai/laya_local.py, through the GPU
owner). Used as the baseline in the benchmark, not as a label source.

`hide_engine_fields` scores a model trained without the engine's own fields: they are taken out of the state."""
from __future__ import annotations

from typing import Any, Dict

from wahy.core.ai.laya_local import LayaOptions

from ..export import ENGINE_STATE_KEYS
from .base import Teacher


class LayaLocal(Teacher):
    name = "laya"
    provider = "laya"

    def __init__(self, model: str = "convaiinnovations/laya-multilingual", hide_engine_fields: bool = False,
                 device: str = "cpu"):
        super().__init__(model + ("|agnostic" if hide_engine_fields else ""))
        self.hide = hide_engine_fields
        self._path = model
        self._device = device

    def options(self) -> LayaOptions:
        return LayaOptions(checkpoint=self._path, device=self._device)

    def item_state(self, env: Dict[str, Any]) -> Dict[str, Any]:
        return {k: v for k, v in env["state"].items() if not (self.hide and k in ENGINE_STATE_KEYS)}
