"""
Model output schemas and request contracts for AI Tafrigh Phase.
Separates external model I/O definitions from core internal domain models.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from .models import CommentKind, StructuralTag, TextEdit


class GeminiSingleOutputSchema(BaseModel):
    tag: Optional[StructuralTag] = None
    level: Optional[int] = None
    parent: Optional[str] = None
    commentKind: Optional[CommentKind] = None
    hasTypo: bool = False
    needsSplitting: bool = False
    splitPoints: List[int] = Field(default_factory=list)
    edits: List[TextEdit] = Field(default_factory=list)
    confidence: Optional[float] = None


class GeminiWindowItemSchema(GeminiSingleOutputSchema):
    id: str


class GeminiWindowOutputSchema(BaseModel):
    decisions: List[GeminiWindowItemSchema] = Field(default_factory=list)


class JEVRequestConfig(BaseModel):
    jev_layout: Literal["independent_questions", "split_as_tag_option"] = "independent_questions"
    execution_order: Literal["parallel", "sequential"] = "parallel"
    batch_questions_in_single_request: bool = False


class PipelineConfig(BaseModel):
    processing_mode: Literal["per_sentence", "windowed"] = "per_sentence"

    @field_validator("model_candidate", mode="before")
    @classmethod
    def _normalize_model_candidate(cls, v):
        if isinstance(v, str):
            aliases = {
                "jev_independent": "jev_hybrid",
                "jev": "jev_hybrid",
                "laya_only": "laya_hybrid",
                "laya": "laya_hybrid",
                "gemini": "gemini_all",
            }
            return aliases.get(v, v)
        return v
    window_size: int = 20
    context_before: int = 3
    context_after: int = 3
    model_candidate: Literal["gemini_all", "jev_hybrid", "laya_hybrid"] = "gemini_all"
    jev_layout: Literal["independent_questions", "split_as_tag_option"] = "independent_questions"
    jev_execution_order: Literal["parallel", "sequential"] = "parallel"
    typo_strategy: Literal["gated", "always_correct", "asr_confidence_gated"] = "gated"
    use_detection_boundaries: bool = True
    max_edit_change_ratio: float = 0.30
