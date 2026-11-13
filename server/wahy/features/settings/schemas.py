"""Shapes of the health and settings routes. A key's value never appears here: only whether it is set."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class GpuHealth(BaseModel):
    card: str | None = Field(None, description="the NVIDIA card's name, or null when there is none")
    total_mb: int | None = None
    free_mb: int | None = None
    resident: str | None = Field(None, description="the model loaded on the GPU now")
    in_use: str | None = Field(None, description="the model a job is using now")
    waiting: list[str] = []


class EngineHealth(BaseModel):
    running: bool
    starts: int
    calls: int


class CorpusHealth(BaseModel):
    ready: bool = Field(description="the Quran and hadith corpus file exists")
    hadith_source: str


class Health(BaseModel):
    status: str
    edition: Literal["studio", "tadqeeq"] = Field(description="studio: research app; tadqeeq: the product")
    keys: dict[str, bool] = Field(description="provider → is its key set")
    gpu: GpuHealth
    engine: EngineHealth
    corpus: CorpusHealth
    running_jobs: int


class KeyUpdate(BaseModel):
    """`value` is the new key; an empty or missing value removes it."""

    value: str | None = None


# ---- AI providers (core/ai) --------------------------------------------------------------------------------

class OpenRouterModel(BaseModel):
    """One model of OpenRouter's live catalog. Prices are $ per million tokens."""

    id: str
    name: str
    context_length: int
    prompt_price_per_m: float
    completion_price_per_m: float
    description: str = ""
    free: bool
    jev: bool
    gemini: bool
    chinese: bool
    json_mode: bool = Field(description="the model accepts JSON mode (response_format)")


class GeminiModels(BaseModel):
    models: list[str] = Field(description="the models this key can call with generateContent")
    recommended: str | None


class LayaEnvelope(BaseModel):
    version: int = Field(description="the envelope version the checkpoint was trained on (1, 2 or 3)")
    options: dict[str, Any]
    questions: list[str] | None
    max_len: int | None = None
    head_max_len: int | None = None


class LayaStatusOut(BaseModel):
    loaded: bool
    checkpoint: str
    device: str | None = Field(None, description="cuda or cpu while loaded")
    envelope: LayaEnvelope | None
    vram: dict[str, Any]
    installed: bool = Field(description="the laya package and torch are installed (uv sync --extra laya)")


class LayaLoad(BaseModel):
    """`checkpoint`: a Hugging Face repo or a local folder (default: the one selected). `device`: auto, cuda
    or cpu."""

    checkpoint: str | None = None
    device: str | None = None
