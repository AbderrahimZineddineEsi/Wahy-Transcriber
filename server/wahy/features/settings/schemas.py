"""Shapes of the health and settings routes. A key's value never appears here: only whether it is set."""

from __future__ import annotations

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
    keys: dict[str, bool] = Field(description="provider → is its key set")
    gpu: GpuHealth
    engine: EngineHealth
    corpus: CorpusHealth
    running_jobs: int


class KeyUpdate(BaseModel):
    """`value` is the new key; an empty or missing value removes it."""

    value: str | None = None
