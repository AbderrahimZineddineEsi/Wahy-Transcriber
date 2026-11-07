"""Any OpenRouter chat model as a teacher: the app's chat verifier (wahy/core/ai/openrouter.py: JSON mode, model
catalog, live prices) with the teacher's own system prompt."""
from __future__ import annotations

from wahy.core.ai.openrouter import ChatOptions

from .base import Teacher

SYSTEM = ("You are an expert Arabic Islamic text verifier. Given the JSON `state` and `questions`, determine whether "
          "`matched_span_in_lecture` is a genuine quotation or ordinary speech, and determine boundary status.")


class OpenRouterChatTeacher(Teacher):
    name = "orchat"
    provider = "openrouter"

    def __init__(self, model: str):
        super().__init__(model)

    def options(self) -> ChatOptions:
        return ChatOptions(model=self.model, system_prompt=SYSTEM, max_tokens=800)
