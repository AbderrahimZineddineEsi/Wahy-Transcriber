"""What the detection API sends and receives."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from wahy.core.jobs import JobSnapshot

# "v3", "v4", "v5" or "v5:loose" (the old app's engine choice)
EngineChoice = Annotated[str, StringConstraints(pattern=r"^v[345](:loose)?$")]
Qiraah = Annotated[str, StringConstraints(pattern=r"^[A-Za-z_]{1,32}$")]


class DetectionSettings(BaseModel):
    """What a detection uses unless the request says otherwise (remembered between sessions)."""

    engine: EngineChoice = "v5"
    qiraat: Qiraah = "AUTO"
    adhkar: bool = Field(True, description="look for adhkar too")


class DetectionPatch(BaseModel):
    engine: EngineChoice | None = None
    qiraat: Qiraah | None = None
    adhkar: bool | None = None


class DetectRequest(DetectionPatch):
    """Overrides for one detection; what is left out comes from the saved settings."""


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    idx: int
    engine: str
    source_type: str
    unit_id: str | None
    display_ref: str | None
    word_start: int
    word_end: int
    data: dict[str, Any] = Field(description="the engine's whole finding object")


class FindingsOut(BaseModel):
    lecture_id: int
    count: int
    findings: list[FindingOut]


class DetectStarted(BaseModel):
    job: JobSnapshot


class SearchHit(BaseModel):
    unitId: str
    sourceType: str
    displayRef: str
    fullText: str
