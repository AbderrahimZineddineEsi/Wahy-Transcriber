"""
Model output schemas and request contracts for AI Tafrigh Phase.
Separates external model I/O definitions from core internal domain models.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from .models import CommentKind, StructuralTag


class GeminiSingleOutputSchema(BaseModel):
    tag: StructuralTag | None = None
    level: int | None = None
    parent: str | None = None
    commentKind: CommentKind | None = None
    hasTypo: bool = False
    needsSplitting: bool = False
    splitPoints: list[int] = Field(default_factory=list)
    # raw model edits; word-indexed {wordStart, wordEnd, original, replacement} — resolved by edit_resolver
    edits: list[Any] = Field(default_factory=list)
    confidence: float | None = None
    trace: dict[str, Any] = Field(default_factory=dict)   # provider-specific answers/confidences for the UI


class GeminiWindowItemSchema(GeminiSingleOutputSchema):
    id: str


class GeminiWindowOutputSchema(BaseModel):
    decisions: list[GeminiWindowItemSchema] = Field(default_factory=list)


class JEVRequestConfig(BaseModel):
    jev_layout: Literal["independent_questions", "split_as_tag_option"] = "independent_questions"
    # combined: the three questions in one request (the state is sent once instead of three times)
    execution_order: Literal["parallel", "sequential", "combined"] = "parallel"
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
    jev_execution_order: Literal["parallel", "sequential", "combined"] = "parallel"
    typo_strategy: Literal["gated", "always_correct", "asr_confidence_gated", "off"] = "gated"
    # Tested on a real run: cutting at every Quran/hadith edge broke sentences mid-way ("قال الله تعالى والعصر | إن الإنسان…").
    # Detections are still attached to segments as signals and still forbid punctuation cuts inside an ayah.
    use_detection_boundaries: bool = False
    max_edit_change_ratio: float = 0.30
