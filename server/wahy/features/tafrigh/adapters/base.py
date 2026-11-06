"""
Abstract Base Adapter interfaces for Wahy-Transcriber Tafrigh phase.
Defines unified contracts for LLMs and choice-based classifiers (JEV & Laya).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from ..schemas import GeminiWindowItemSchema
from ..unit_of_work import UnitOfWork


class BaseAdapter(ABC):
    """Base interface for all Tafrigh model adapters."""

    @abstractmethod
    def classify_uow(self, uow: UnitOfWork) -> list[GeminiWindowItemSchema]:
        """Classifies the target segments inside a UnitOfWork."""
        pass


class ChoiceClassifierAdapter(BaseAdapter):
    """
    Abstract contract for choice-based classifiers.
    Implemented by both JEVAdapter and LayaAdapter.
    """

    @abstractmethod
    def predict_questions(
        self,
        state: dict[str, Any],
        questions: dict[str, list[str]],
    ) -> dict[str, Any]:
        """
        Executes question classification over given dynamic choices.
        Returns dict mapping question keys to predicted answers and metadata.
        """
        pass
