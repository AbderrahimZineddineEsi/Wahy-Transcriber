"""What the training routes send and receive (F-100, F-101, F-103, F-104, F-120)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# where a training row came from (its lineage), as the screen filters it
Origin = Literal["user", "legacy", "tafrigh", "ai"]
Task = Literal["verification", "tafrigh_structure", "tafrigh_split"]


class TrainingRow(BaseModel):
    """One row of the training data: a label (the user's, an imported one, a Tafrigh example) or a verifier's
    newest verdict on a finding that has no label of the user's."""

    id: str = Field(description='"label:<id>" or "verdict:<id>"')
    origin: Origin
    action: str | None = Field(
        None,
        description="for the user's labels, how it was given: SET (verdict buttons), "
        "VALIDATE_ALL (approve all), "
        "ORDINARY_SPEECH (a finding deleted as ordinary speech), MISSED_QUOTE (a quote added by hand)",
    )
    gold: bool = Field(description="a label given by a person (the user, a reviewed legacy or Tafrigh row)")
    task: Task
    reference: str | None
    source_type: str | None
    text: str = Field(description="the spoken words (a Tafrigh row: the sentence)")
    verdict: str | None = Field(description="the row's answer: a verdict, or a Tafrigh row's tag")
    ai_verdict: str | None = Field(description="what a verifier said before the user's label, if anything")
    boundary: str | None
    ref_issue: bool = Field(False, description="N-007: the user said the reference is wrong or incomplete")
    typo: bool = Field(False, description="a Tafrigh example whose sentence got a typo fix")
    provider: str | None = Field(None, description="the verifier or model the row came from")
    lecture_id: int | None
    lecture_title: str | None
    finding_id: int | None
    run_id: str | None = None
    created_at: datetime


class TrainingCounts(BaseModel):
    """F-100 and F-104's counters, over every row."""

    total: int
    correct: int
    false: int
    not_sure: int
    clipped: int = Field(description="verification rows whose boundary is not complete")
    gold: int
    ai: int
    missed: int = Field(description="missed quotes added by hand")
    segmentation: int = Field(description="Tafrigh sentence examples")
    typo: int = Field(description="Tafrigh examples with a typo fix")


class TrainingPage(BaseModel):
    counts: TrainingCounts
    rows: list[TrainingRow]
    matching: int = Field(description="rows that match the filters (more than `rows` when over the limit)")


class TrainingRowJson(BaseModel):
    """What the row writes to its JSONL file (the inspector)."""

    id: str
    row: dict


class Imported(BaseModel):
    imported: int = Field(description="rows added")
    replaced: int = Field(description="rows that were already there (same id), saved again")
    skipped: int = Field(description="lines that are not training rows")
    files: list[str] = Field(default_factory=list, description="the files read (import from data/legacy/)")


class Cleared(BaseModel):
    deleted: int


class TafrighSaveIn(BaseModel):
    segment_ids: list[str] = Field(min_length=1)
    note: str | None = None


class TafrighSaved(BaseModel):
    """A Tafrigh run's sentences saved for Laya (F-120). Saving the run again replaces them."""

    run_id: str
    segment_ids: list[str]
    sentences: int
    count: int = Field(description="examples (a sentence that was split also gives its parent's example)")
    by_source: dict[str, int]
    note: str | None = None
    saved_at: datetime | None = None
