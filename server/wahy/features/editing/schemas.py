"""What the editing API sends and receives (ROADMAP phase 16)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

SourceType = Literal["QURAN", "HADITH", "ADHKAR"]


class OpOut(BaseModel):
    """One edit in the lecture's log. `kind` is a key the web app translates; `label` is a plain English
    name."""

    id: int
    kind: str
    label: str
    params: dict[str, Any]
    created_at: datetime
    undone: bool


class EditDone(BaseModel):
    """What an edit did. The web app reads the lecture again; these are for messages and tests."""

    op: OpOut
    finding_id: int | None = Field(
        None, description="the finding the edit made or changed, when there is one"
    )
    words_changed: bool = False
    findings_changed: int = Field(0, description="findings changed, added or removed")
    removed: list[int] = Field(default_factory=list, description="findings the edit removed")
    added: list[int] = Field(default_factory=list, description="findings the edit added")


class Undone(BaseModel):
    op: OpOut


# ---- words
# ---------------------------------------------------------------------------------------------------------


class ReplaceWords(BaseModel):
    """Rewrite words `start..end` (inclusive) as `text` (F-056). `end = start - 1` inserts before `start`;
    an empty `text` deletes the words. Words that stay keep their times; new ones share the replaced words'
    time."""

    start: int = Field(ge=0)
    end: int = Field(ge=-1)
    text: str = ""


class ReplaceText(BaseModel):
    """The whole lecture text after the full-text editor (F-067). Words are separated by spaces."""

    text: str = Field(min_length=1)


# ---- findings
# ------------------------------------------------------------------------------------------------------


class AddQuote(BaseModel):
    """A missed quote over words `start..end` (inclusive) (F-053): with a corpus unit, or outside the corpus
    with
    a typed reference (`unit_id` empty or "OUTSIDE_CORPUS")."""

    start: int = Field(ge=0)
    end: int = Field(ge=0)
    unit_id: str | None = None
    source_type: SourceType = "QURAN"
    ref: str = Field("", description="the reference to show, for a quote outside the corpus")
    qiraah: str = "hafs"


class MoveEdge(BaseModel):
    op: Literal["move_edge"]
    edge: Literal["start", "end"]
    delta: int = Field(description="words: negative moves left (earlier), positive right")


class SetKind(BaseModel):
    op: Literal["set_kind"]
    kind: Literal["ayah", "hadith", "dhikr"]


class Snap(BaseModel):
    op: Literal["snap"]
    on: bool = Field(description="show the source text instead of the spoken words")


class CanonicalWords(BaseModel):
    op: Literal["canonical_words"]
    indices: list[int] = Field(min_length=1, description="positions of the picked words in the reference")
    full: bool = Field(False, description="the positions count the whole hadith (chain and takhrij too)")


class LinkReference(BaseModel):
    op: Literal["link_reference"]
    unit_id: str | None = Field(None, description="a corpus unit (a candidate, or one found by the search)")
    ref: str = Field("", description="a typed reference, when there is no unit")


class AddCandidate(BaseModel):
    op: Literal["add_candidate"]
    unit_id: str | None = None
    ref: str = ""


class RemoveCandidate(BaseModel):
    op: Literal["remove_candidate"]
    unit_id: str


class Merge(BaseModel):
    op: Literal["merge"]
    direction: Literal["previous", "next"]
    gap_type: Literal["PART_OF_QUOTE", "COMMENTARY"] = Field(
        "PART_OF_QUOTE",
        description="the words between them: part of the quote, or a commentary kept out of it",
    )


class DismissMerge(BaseModel):
    op: Literal["dismiss_merge"]
    direction: Literal["previous", "next"]


FindingEdit = Annotated[
    MoveEdge
    | SetKind
    | Snap
    | CanonicalWords
    | LinkReference
    | AddCandidate
    | RemoveCandidate
    | Merge
    | DismissMerge,
    Field(discriminator="op"),
]

DeleteIntent = Literal["ordinary_speech", "highlight_mistake", "testing"]


# ---- captions
# ------------------------------------------------------------------------------------------------------


class CaptionEdit(BaseModel):
    """One edit of the caption timing editor (F-068), anchored on a word: `split` the speech caption holding
    `word` so the second part starts there; `merge` the speech caption starting at `word` into the one before;
    `time` sets the start and/or end (seconds) of the caption starting at `word`. Quotes are locked units."""

    op: Literal["split", "merge", "time"]
    word: int = Field(ge=0)
    start: float | None = Field(None, ge=0)
    end: float | None = Field(None, ge=0)


class CaptionOut(BaseModel):
    index: int
    start: float
    end: float
    text: str
    displayText: str
    type: str = Field(description="normal | ayah | hadith | dhikr")
    findingId: int | str | None
    reference: str
    wordStartIdx: int
    wordEndIdx: int
    isAtomicCitation: bool
