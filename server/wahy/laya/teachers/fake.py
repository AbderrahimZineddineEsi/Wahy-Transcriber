"""The fake teacher: the app's fake verifier (wahy/core/ai/fake.py). Instant, free and offline, saved in the
request log like a real one, so a labelling run can be tried end to end before spending anything."""
from __future__ import annotations

from .base import Teacher


class FakeTeacher(Teacher):
    name = "fake"
    provider = "fake"

    def __init__(self, model: str = "fake-1"):
        super().__init__(model)
