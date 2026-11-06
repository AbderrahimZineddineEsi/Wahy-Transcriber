"""
Data models for AI Tafrigh Phase.
Defines immutable transcript segments, word tokens, structural decisions,
outline state, dynamic choice generation, versions, and lecture spans.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StructuralTag(StrEnum):
    PARAGRAPH = "paragraph"
    LIST_INTRO = "list_intro"
    LIST_ITEM = "list_item"
    HEADING = "heading"
    MATN_SECTION = "matn_section"
    CONTINUATION = "continuation"
    COMMENT = "comment"


class CommentKind(StrEnum):
    SNEEZE = "sneeze"
    STUDENT_QUESTION = "student_question"
    INTERRUPTION = "interruption"
    ATTENDEE_EXCHANGE = "attendee_exchange"
    OTHER_INCIDENTAL = "other_incidental"


class LabelProvenance(StrEnum):
    MODEL_PROPOSED = "model_proposed"
    HUMAN_CONFIRMED = "human_confirmed"
    HUMAN_CORRECTED = "human_corrected"
    GOLD = "gold"


class WordToken(BaseModel):
    model_config = ConfigDict(frozen=True)

    word_index: int
    text: str
    char_start: int
    char_end: int
    confidence: float | None = None


class SourcePosition(BaseModel):
    model_config = ConfigDict(frozen=True)

    char_start: int
    char_end: int
    start_time: float | None = None
    end_time: float | None = None
    mapping_reliable: bool = True


class TextEdit(BaseModel):
    start: int
    end: int
    replacement: str
    is_valid_word_substitution: bool | None = None
    reason: str | None = None
    is_synthetic: bool = False


class SegmentVersion(BaseModel):
    version_id: str
    edits: list[TextEdit] = Field(default_factory=list)
    corrected_text: str
    provenance: LabelProvenance
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    reviewer_note: str | None = None


class StructuralDecision(BaseModel):
    tag: StructuralTag
    level: int | None = None
    parent_id: str | None = None
    comment_kind: CommentKind | None = None
    confidence: float | None = None


class MatnMatchEvidence(BaseModel):
    matched_line_indices: list[int] = Field(default_factory=list)
    coverage_ratio: float = 0.0
    similarity_score: float = 0.0
    starts_at_segment_boundary: bool = True
    word_count: int = 0
    pointer_delta: int = 0
    canonical_text: str = ""
    has_variant_wording: bool = False
    is_candidate_standalone_matn: bool = False


def tokenize_words(text: str) -> list[WordToken]:
    """
    Tokenizes text into whitespace-delimited tokens while recording exact
    character offsets. Punctuation attached to words stays with the token.
    """
    tokens: list[WordToken] = []
    for idx, match in enumerate(re.finditer(r"\S+", text)):
        tokens.append(
            WordToken(
                word_index=idx,
                text=match.group(0),
                char_start=match.start(),
                char_end=match.end(),
                confidence=None,
            )
        )
    return tokens


class TranscriptSegment(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    id: str
    parent_segment_id: str | None = None
    original_text: str
    source_pos: SourcePosition
    tokens: list[WordToken] = Field(default_factory=list)
    detection_signals: list[dict[str, Any]] = Field(default_factory=list)
    matn_evidence: MatnMatchEvidence | None = None
    proposed_decision: StructuralDecision | None = None
    final_decision: StructuralDecision | None = None
    versions: list[SegmentVersion] = Field(default_factory=list)
    active_version_id: str | None = None
    review_flags: list[str] = Field(default_factory=list)
    cut_reason: str | None = None   # why the segmenter ended this sentence (punctuation | pause | length | detection | end)
    # what happened to this sentence: model answers + confidences, splits, proposed/applied/rejected edits, quotes
    trace: dict[str, Any] = Field(default_factory=dict)

    def __init__(self, **data: Any) -> None:
        if "original_text" in data and ("tokens" not in data or not data["tokens"]):
            data["tokens"] = tokenize_words(data["original_text"])
        super().__init__(**data)

    def __setattr__(self, name: str, value: Any) -> None:
        if name in ("original_text", "source_pos") and name in self.__dict__:
            raise ValueError(f"Field '{name}' is immutable and cannot be modified.")
        super().__setattr__(name, value)

    @property
    def active_text(self) -> str:
        """Returns the active corrected text if a version is selected, else original_text."""
        if self.active_version_id and self.versions:
            for v in self.versions:
                if v.version_id == self.active_version_id:
                    return v.corrected_text
            return self.versions[-1].corrected_text
        if self.versions:
            return self.versions[-1].corrected_text
        return self.original_text


class LectureSpan(BaseModel):
    span_id: str
    span_type: Literal["matn", "sharh", "plain"]
    segment_ids: list[str] = Field(default_factory=list)
    spoken_text: str
    canonical_matn_text: str | None = None
    matn_line_range: tuple[int, int] | None = None
    has_variant_wording: bool = False


class HeadingEntry(BaseModel):
    segment_id: str
    level: int
    title_text: str
    parent_id: str | None = None


class TOCConfig(BaseModel):
    max_level1_headings: int = 50
    recent_level2_siblings_count: int = 5
    include_active_branch: bool = True


class OutlineState(BaseModel):
    headings: list[HeadingEntry] = Field(default_factory=list)
    last_confirmed_heading_id: str | None = None
    active_spine: dict[int, HeadingEntry] = Field(default_factory=dict)
    last_segment_tag: StructuralTag | None = None
    in_list_context: bool = False

    def add_heading(self, heading: HeadingEntry) -> None:
        self.headings.append(heading)
        self.last_confirmed_heading_id = heading.segment_id
        self.last_segment_tag = StructuralTag.HEADING
        self.in_list_context = False

        # Update active spine: set level L, clear levels > L
        lvl = heading.level
        self.active_spine[lvl] = heading
        keys_to_remove = [k for k in self.active_spine.keys() if k > lvl]
        for k in keys_to_remove:
            del self.active_spine[k]

    def record_decision(self, segment_id: str, text: str, decision: StructuralDecision) -> None:
        """Updates outline state based on a validated decision."""
        if decision.tag == StructuralTag.HEADING:
            if decision.level is None:
                raise ValueError("Heading decision must have a level.")
            self.add_heading(
                HeadingEntry(
                    segment_id=segment_id,
                    level=decision.level,
                    title_text=text.strip(),
                    parent_id=decision.parent_id,
                )
            )
        elif decision.tag in (StructuralTag.LIST_INTRO, StructuralTag.LIST_ITEM):
            self.last_segment_tag = decision.tag
            self.in_list_context = True
        elif decision.tag == StructuralTag.CONTINUATION:
            # tag remains logically continuation, in_list_context is unchanged
            self.last_segment_tag = StructuralTag.CONTINUATION
        elif decision.tag == StructuralTag.COMMENT:
            # Comment does not close list context or alter substantive spine
            pass
        else:
            # paragraph, matn_section
            self.last_segment_tag = decision.tag
            self.in_list_context = False

    def get_partial_toc(self, config: TOCConfig | None = None) -> list[dict[str, Any]]:
        """
        Returns all Level-1 headings plus relevant Level-2 headings
        (under current Level-1 and recent Level-2 siblings), omitting deep clutter.
        """
        cfg = config or TOCConfig()
        if not self.headings:
            return []

        active_h1 = self.active_spine.get(1)
        active_h1_id = active_h1.segment_id if active_h1 else None

        # Level 1 headings up to limit
        level1_headings = [h for h in self.headings if h.level == 1][: cfg.max_level1_headings]
        level1_ids = {h.segment_id for h in level1_headings}

        # Level 2 headings under the active level 1
        active_h2_children = [
            h for h in self.headings if h.level == 2 and h.parent_id == active_h1_id
        ]
        recent_h2_children = active_h2_children[-cfg.recent_level2_siblings_count :]

        # Include the most recent level 2 heading if not already in recent_h2_children
        all_h2 = [h for h in self.headings if h.level == 2]
        most_recent_h2 = all_h2[-1] if all_h2 else None

        selected_h2_ids = {h.segment_id for h in recent_h2_children}
        if most_recent_h2 and most_recent_h2.segment_id not in selected_h2_ids:
            recent_h2_children.append(most_recent_h2)
            selected_h2_ids.add(most_recent_h2.segment_id)

        # Assemble in original order
        selected_headings: list[HeadingEntry] = []
        for h in self.headings:
            if h.segment_id in level1_ids or h.segment_id in selected_h2_ids:
                selected_headings.append(h)

        return [
            {
                "segment_id": h.segment_id,
                "level": h.level,
                "title_text": h.title_text,
                "parent_id": h.parent_id,
            }
            for h in selected_headings
        ]

    def get_allowed_structural_choices(self, include_split_option: bool = False) -> list[dict[str, Any]]:
        """
        Dynamically generates valid tag/level/parent choices based on current outline state.
        """
        choices: list[dict[str, Any]] = [
            {"tag": StructuralTag.PARAGRAPH.value, "level": None, "parent_id": None},
            {"tag": StructuralTag.LIST_INTRO.value, "level": None, "parent_id": None},
            {"tag": StructuralTag.MATN_SECTION.value, "level": None, "parent_id": None},
            {"tag": StructuralTag.COMMENT.value, "level": None, "parent_id": None},
        ]

        if self.in_list_context:
            choices.append({"tag": StructuralTag.LIST_ITEM.value, "level": None, "parent_id": None})

        # nothing "continues" a heading: the text after a heading starts its own block
        if self.last_segment_tag is not None and self.last_segment_tag != StructuralTag.HEADING:
            choices.append({"tag": StructuralTag.CONTINUATION.value, "level": None, "parent_id": None})

        # Dynamic headings
        # Level 1 heading is always valid (parent=None)
        choices.append({"tag": StructuralTag.HEADING.value, "level": 1, "parent_id": None})

        # For each open level L in active_spine, can add heading at L+1 with parent=active_spine[L].segment_id
        for lvl, entry in sorted(self.active_spine.items()):
            child_choice = {
                "tag": StructuralTag.HEADING.value,
                "level": lvl + 1,
                "parent_id": entry.segment_id,
            }
            if child_choice not in choices:
                choices.append(child_choice)

        if include_split_option:
            choices.append({"tag": "needs_splitting", "level": None, "parent_id": None})

        return choices
