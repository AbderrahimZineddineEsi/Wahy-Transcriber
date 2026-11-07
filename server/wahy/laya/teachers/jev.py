"""JEV (OpenRouter's Decisions API) as a teacher: the app's JEV verifier (wahy/core/ai/openrouter.py). It reads the
envelope as it is, with no prompt."""
from __future__ import annotations

from wahy.core.ai.openrouter import JevOptions

from .base import Teacher


class JevTeacher(Teacher):
    name = "jev"
    provider = "jev"

    def __init__(self, model: str = "typesafe/jev-1.14"):
        super().__init__(model)

    def options(self) -> JevOptions:
        return JevOptions(model=self.model)
