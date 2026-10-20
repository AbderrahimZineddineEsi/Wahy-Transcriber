"""
JEV Adapter for AI Tafrigh Phase.
Implements the ChoiceClassifierAdapter interface.
Supports both independent_questions and split_as_tag_option layouts,
with parallel and sequential execution orders.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
from typing import Any, Callable, Dict, List, Literal, Optional

import httpx

from ..models import CommentKind, StructuralTag, TranscriptSegment
from ..schemas import GeminiWindowItemSchema, JEVRequestConfig
from ..unit_of_work import UnitOfWork
from .base import ChoiceClassifierAdapter


class JEVAdapter(ChoiceClassifierAdapter):
    """Adapter for JEV (Joint Entity / Value) choice-based classification API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        config: Optional[JEVRequestConfig] = None,
        api_url: Optional[str] = None,
        mock_response_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ) -> None:
        self.api_key = api_key or os.getenv("JEV_API_KEY", "")
        self.config = config or JEVRequestConfig()
        self.api_url = api_url or "https://api.openrouter.ai/api/v1/chat/completions"
        self.mock_response_fn = mock_response_fn

    def predict_questions(
        self,
        state: Dict[str, Any],
        questions: Dict[str, List[str]],
    ) -> Dict[str, Any]:
        """Executes question classification over given dynamic choices."""
        if self.mock_response_fn:
            return self.mock_response_fn({"state": state, "questions": questions})

        # Default fallback if no mock or network
        answers: Dict[str, str] = {}
        for q, options in questions.items():
            answers[q] = options[0] if options else ""
        return {"answers": answers, "latency_ms": 10.0, "cost": 0.0}

    def _format_tag_choice(self, choice: Dict[str, Any]) -> str:
        tag = choice.get("tag", "paragraph")
        level = choice.get("level")
        parent_id = choice.get("parent_id")
        if tag == "heading" and level:
            return f"heading_{level}_{parent_id or 'none'}"
        return tag

    def _parse_tag_choice(self, chosen: str) -> Dict[str, Any]:
        if chosen == "needs_splitting":
            return {"tag": None, "level": None, "parent": None, "needsSplitting": True}
        if chosen.startswith("heading_"):
            parts = chosen.split("_")
            lvl = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
            parent = parts[2] if len(parts) > 2 and parts[2] != "none" else None
            return {"tag": StructuralTag.HEADING, "level": lvl, "parent": parent, "needsSplitting": False}
        try:
            tag_enum = StructuralTag(chosen)
        except ValueError:
            tag_enum = StructuralTag.PARAGRAPH
        return {"tag": tag_enum, "level": None, "parent": None, "needsSplitting": False}

    def classify_single_segment(
        self,
        segment: TranscriptSegment,
        uow: UnitOfWork,
    ) -> GeminiWindowItemSchema:
        state = {
            "target_text": segment.original_text,
            "context_before": [s.original_text for s in uow.context_before],
            "context_after": [s.original_text for s in uow.context_after],
            "partial_toc": uow.partial_toc,
        }

        if self.config.jev_layout == "independent_questions":
            tag_choices = [self._format_tag_choice(c) for c in uow.allowed_choices if c.get("tag") != "needs_splitting"]

            if self.config.execution_order == "sequential":
                # Step 1: Question 3 (needsSplitting)
                split_res = self.predict_questions(state, {"needsSplitting": ["true", "false"]})
                needs_splitting = split_res.get("answers", {}).get("needsSplitting") == "true"

                if needs_splitting:
                    # Skip Q1 (tag) entirely
                    typo_res = self.predict_questions(state, {"hasTypo": ["true", "false"]})
                    has_typo = typo_res.get("answers", {}).get("hasTypo") == "true"
                    return GeminiWindowItemSchema(
                        id=segment.id,
                        tag=None,
                        hasTypo=has_typo,
                        needsSplitting=True,
                    )
                else:
                    # Fire Q1 and Q2
                    q_res = self.predict_questions(
                        state,
                        {"tag": tag_choices, "hasTypo": ["true", "false"]},
                    )
                    answers = q_res.get("answers", {})
                    parsed_tag = self._parse_tag_choice(answers.get("tag", "paragraph"))
                    has_typo = answers.get("hasTypo") == "true"
                    return GeminiWindowItemSchema(
                        id=segment.id,
                        tag=parsed_tag["tag"],
                        level=parsed_tag["level"],
                        parent=parsed_tag["parent"],
                        hasTypo=has_typo,
                        needsSplitting=False,
                    )
            else:
                # Parallel execution: fire Q1, Q2, Q3 concurrently
                with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                    f_tag = executor.submit(self.predict_questions, state, {"tag": tag_choices})
                    f_typo = executor.submit(self.predict_questions, state, {"hasTypo": ["true", "false"]})
                    f_split = executor.submit(self.predict_questions, state, {"needsSplitting": ["true", "false"]})

                    res_tag = f_tag.result()
                    res_typo = f_typo.result()
                    res_split = f_split.result()

                needs_splitting = res_split.get("answers", {}).get("needsSplitting") == "true"
                has_typo = res_typo.get("answers", {}).get("hasTypo") == "true"

                if needs_splitting:
                    # Parallel tag result is strictly discarded
                    return GeminiWindowItemSchema(
                        id=segment.id,
                        tag=None,
                        hasTypo=has_typo,
                        needsSplitting=True,
                    )
                else:
                    chosen_tag = res_tag.get("answers", {}).get("tag", "paragraph")
                    parsed_tag = self._parse_tag_choice(chosen_tag)
                    return GeminiWindowItemSchema(
                        id=segment.id,
                        tag=parsed_tag["tag"],
                        level=parsed_tag["level"],
                        parent=parsed_tag["parent"],
                        hasTypo=has_typo,
                        needsSplitting=False,
                    )
        else:
            # split_as_tag_option layout
            tag_choices = [self._format_tag_choice(c) for c in uow.allowed_choices]
            if "needs_splitting" not in tag_choices:
                tag_choices.append("needs_splitting")

            q_res = self.predict_questions(
                state,
                {"tag": tag_choices, "hasTypo": ["true", "false"]},
            )
            answers = q_res.get("answers", {})
            chosen_tag = answers.get("tag", "paragraph")
            has_typo = answers.get("hasTypo") == "true"

            parsed = self._parse_tag_choice(chosen_tag)
            return GeminiWindowItemSchema(
                id=segment.id,
                tag=parsed["tag"],
                level=parsed["level"],
                parent=parsed["parent"],
                hasTypo=has_typo,
                needsSplitting=parsed["needsSplitting"],
            )

    def classify_uow(self, uow: UnitOfWork) -> List[GeminiWindowItemSchema]:
        """Classifies all target segments inside UnitOfWork."""
        results: List[GeminiWindowItemSchema] = []
        for seg in uow.target_segments:
            results.append(self.classify_single_segment(seg, uow))
        return results
