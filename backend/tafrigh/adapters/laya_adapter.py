"""
Laya Adapter for AI Tafrigh Phase.
Implements the ChoiceClassifierAdapter interface by wrapping LocalLayaVerifier.
Shares the exact question structure contract as JEVAdapter.
"""

from __future__ import annotations

import os
from typing import Any, Callable, Dict, List, Optional

from ..schemas import JEVRequestConfig
from .jev_adapter import JEVAdapter


class LayaAdapter(JEVAdapter):
    """
    Adapter for local Laya engine.
    Drop-in interchangeable with JEVAdapter.
    """

    def __init__(
        self,
        checkpoint: Optional[str] = None,
        config: Optional[JEVRequestConfig] = None,
        mock_response_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ) -> None:
        super().__init__(config=config, mock_response_fn=mock_response_fn)
        self.checkpoint = checkpoint
        self.laya_instance: Optional[Any] = None

    def _get_laya_instance(self) -> Any:
        if self.laya_instance is None:
            try:
                from ...laya_engine import laya_verifier
                self.laya_instance = laya_verifier
            except (ImportError, ValueError):
                try:
                    from laya_engine import laya_verifier
                    self.laya_instance = laya_verifier
                except Exception:
                    self.laya_instance = None
        return self.laya_instance

    def predict_questions(
        self,
        state: Dict[str, Any],
        questions: Dict[str, List[str]],
    ) -> Dict[str, Any]:
        """Calls local Laya verifier or mock function."""
        if self.mock_response_fn:
            return self.mock_response_fn({"state": state, "questions": questions})

        engine = self._get_laya_instance()
        if engine is not None and hasattr(engine, "predict_decision"):
            try:
                return engine.predict_decision(state, questions)
            except Exception:
                pass

        # Fallback to default choice if Laya weights are not loaded locally
        answers: Dict[str, str] = {}
        for q, options in questions.items():
            answers[q] = options[0] if options else ""
        return {"answers": answers, "latency_ms": 1.0, "cost": 0.0}
