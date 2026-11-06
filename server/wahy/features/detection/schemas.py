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


class VerdictOut(BaseModel):
    """The newest verdict on a finding (a verifier's or the user's). Values are the old app's strings."""

    model_config = ConfigDict(from_attributes=True)

    verdict: str = Field(description="CORRECT | FALSE | NOT_SURE")
    boundary: str | None = Field(
        None, description="COMPLETE | MISSING_START | MISSING_END | EXTRA_START | EXTRA_END")
    verifier: str
    model: str | None = None
    confidence: float | None = Field(None, description="the verifier's confidence in the verdict, 0 to 1")
    details: dict[str, Any] | None = Field(
        None, description="probabilities, boundary source, passage and merge suggestion (verification)")


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
    verdict: VerdictOut | None = Field(None, description="the newest verdict, or none when it is unverified")


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


class Suggestion(SearchHit):
    """A unit ranked for a missed quote's words (F-052)."""

    score: float
    words: list[str] = Field(description="the unit's words, as the full-text preview shows them")
    matched: list[int] = Field(description="positions in `words` that the selected words match")


class UnitFull(BaseModel):
    words: list[str]
    matnStart: int
    matnEnd: int


class UnitWords(BaseModel):
    """One corpus unit's words (F-050, F-062): its matn (an ayah's words), and for a hadith its whole text
    with the chain of narrators, where `matnStart..matnEnd` (end exclusive) is the matn."""

    ref: str
    words: list[str]
    full: UnitFull | None = None
