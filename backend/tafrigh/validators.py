"""
Validators for splits, edits, and structural outline transitions.
Enforces non-negotiable engineering guardrails:
- Exact text reconstruction on segment splitting.
- Bounded edits with immutable source text and version history.
- Tree-consistent heading hierarchies and valid list/continuation transitions.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .models import (
    LabelProvenance,
    OutlineState,
    SegmentVersion,
    SourcePosition,
    StructuralDecision,
    StructuralTag,
    TextEdit,
    TranscriptSegment,
)


class ValidationResult(BaseModel):
    is_valid: bool
    error: Optional[str] = None
    subsegments: List[TranscriptSegment] = Field(default_factory=list)
    created_version: Optional[SegmentVersion] = None
    rejected_proposal: Optional[Dict[str, Any]] = None


def validate_and_apply_splits(
    segment: TranscriptSegment,
    split_points: List[int],
) -> ValidationResult:
    """
    Validates split points (0-based word indices where each index marks the first
    word of a new subsegment) and produces subsegments whose concatenation matches
    the original text exactly.
    """
    # Check non-empty
    if not split_points:
        segment.review_flags.append("SPLIT_VALIDATION_FAILED")
        return ValidationResult(
            is_valid=False,
            error="split_points cannot be empty for splitting",
            subsegments=[],
        )

    # Check strictly sorted and unique
    if split_points != sorted(set(split_points)):
        segment.review_flags.append("SPLIT_VALIDATION_FAILED")
        return ValidationResult(
            is_valid=False,
            error="split_points must be strictly sorted ascending unique indices",
            subsegments=[],
        )

    # Check bounds
    num_tokens = len(segment.tokens)
    if num_tokens == 0:
        segment.review_flags.append("SPLIT_VALIDATION_FAILED")
        return ValidationResult(
            is_valid=False,
            error="Segment has no tokens to split",
            subsegments=[],
        )

    for pt in split_points:
        if not (0 < pt < num_tokens):
            segment.review_flags.append("SPLIT_VALIDATION_FAILED")
            return ValidationResult(
                is_valid=False,
                error=f"Split point {pt} is out of bounds (must be between 1 and {num_tokens - 1})",
                subsegments=[],
            )

    # Slice character ranges using tokens[split_point].char_start
    raw_text = segment.original_text
    char_boundaries = [0] + [segment.tokens[pt].char_start for pt in split_points] + [len(raw_text)]

    sub_texts: List[str] = []
    subsegments: List[TranscriptSegment] = []

    # Check if word-level timestamps exist on tokens
    has_word_timestamps = any(t.confidence is not None for t in segment.tokens)

    for i in range(len(char_boundaries) - 1):
        local_start = char_boundaries[i]
        local_end = char_boundaries[i + 1]
        sub_text = raw_text[local_start:local_end]
        sub_texts.append(sub_text)

        global_char_start = segment.source_pos.char_start + local_start
        global_char_end = segment.source_pos.char_start + local_end

        # Timestamp mapping
        sub_flags: List[str] = []
        mapping_reliable = True
        sub_start_time = None
        sub_end_time = None

        if i == 0:
            sub_start_time = segment.source_pos.start_time
        if i == len(char_boundaries) - 2:
            sub_end_time = segment.source_pos.end_time

        # If only segment start/end timestamps exist, inner timestamps are marked unreliable
        if (
            segment.source_pos.start_time is not None
            and segment.source_pos.end_time is not None
            and not has_word_timestamps
        ):
            # Proportional estimate marked as unreliable
            duration = segment.source_pos.end_time - segment.source_pos.start_time
            total_len = max(1, len(raw_text))
            sub_start_time = round(segment.source_pos.start_time + (local_start / total_len) * duration, 2)
            sub_end_time = round(segment.source_pos.start_time + (local_end / total_len) * duration, 2)
            mapping_reliable = False
            sub_flags.append("UNRELIABLE_TIMESTAMP_MAPPING")

        sub_pos = SourcePosition(
            char_start=global_char_start,
            char_end=global_char_end,
            start_time=sub_start_time,
            end_time=sub_end_time,
            mapping_reliable=mapping_reliable,
        )

        sub_id = f"{segment.id}_sub_{i}"
        sub_seg = TranscriptSegment(
            id=sub_id,
            parent_segment_id=segment.id,
            original_text=sub_text,
            source_pos=sub_pos,
            review_flags=sub_flags,
        )
        subsegments.append(sub_seg)

    # Exact Reconstruction Assertion
    reconstructed = "".join(sub_texts)
    if reconstructed != segment.original_text:
        segment.review_flags.append("SPLIT_VALIDATION_FAILED")
        return ValidationResult(
            is_valid=False,
            error=f"Exact reconstruction mismatch: '{reconstructed}' != '{segment.original_text}'",
            subsegments=[],
        )

    # Discard mixed tag from parent segment
    segment.proposed_decision = None
    segment.final_decision = None

    return ValidationResult(is_valid=True, subsegments=subsegments)


def validate_and_apply_edits(
    segment: TranscriptSegment,
    edits: List[TextEdit],
    max_change_ratio: float = 0.30,
) -> ValidationResult:
    """
    Validates typo edits and applies them from right to left to create
    a new version in segment.versions, strictly leaving segment.original_text unchanged.
    """
    if not edits:
        return ValidationResult(is_valid=True)

    # Sort edits by start ascending
    sorted_edits = sorted(edits, key=lambda e: (e.start, e.end))
    text_len = len(segment.original_text)

    # Check bounds and non-overlap
    for i, e in enumerate(sorted_edits):
        if not (0 <= e.start <= e.end <= text_len):
            segment.review_flags.append("EDIT_CAP_EXCEEDED")
            return ValidationResult(
                is_valid=False,
                error=f"Edit span [{e.start}, {e.end}] is out of bounds for text of length {text_len}",
                rejected_proposal={"edits": [ed.model_dump() for ed in edits]},
            )
        if i > 0:
            prev_e = sorted_edits[i - 1]
            if prev_e.end > e.start:
                segment.review_flags.append("EDIT_CAP_EXCEEDED")
                return ValidationResult(
                    is_valid=False,
                    error=f"Overlapping edits detected: [{prev_e.start}, {prev_e.end}] and [{e.start}, {e.end}]",
                    rejected_proposal={"edits": [ed.model_dump() for ed in edits]},
                )

    # Character change ratio
    total_change = sum(max(e.end - e.start, len(e.replacement)) for e in sorted_edits)
    change_ratio = total_change / max(1, text_len)

    if change_ratio > max_change_ratio:
        segment.review_flags.append("EDIT_CAP_EXCEEDED")
        return ValidationResult(
            is_valid=False,
            error=f"Change ratio {change_ratio:.3f} exceeds cap {max_change_ratio:.3f}",
            rejected_proposal={"edits": [ed.model_dump() for ed in edits], "change_ratio": change_ratio},
        )

    # Apply spans from right to left on segment.original_text
    chars = list(segment.original_text)
    for e in reversed(sorted_edits):
        chars[e.start : e.end] = list(e.replacement)
    corrected_text = "".join(chars)

    version_id = f"ver_{uuid.uuid4().hex[:8]}"
    new_version = SegmentVersion(
        version_id=version_id,
        edits=sorted_edits,
        corrected_text=corrected_text,
        provenance=LabelProvenance.MODEL_PROPOSED,
    )
    segment.versions.append(new_version)
    segment.active_version_id = version_id

    return ValidationResult(is_valid=True, created_version=new_version)


def validate_structural_transition(
    decision: StructuralDecision,
    outline_state: OutlineState,
) -> ValidationResult:
    """
    Validates structural tags and hierarchy consistency against the current OutlineState.
    """
    if decision.tag == StructuralTag.HEADING:
        if decision.level is None or decision.level < 1:
            return ValidationResult(
                is_valid=False,
                error=f"Heading must have integer level >= 1, got {decision.level}",
            )
        if decision.level == 1:
            if decision.parent_id is not None:
                return ValidationResult(
                    is_valid=False,
                    error=f"Level 1 heading must have parent_id=None, got {decision.parent_id}",
                )
        else:
            required_parent_level = decision.level - 1
            if required_parent_level not in outline_state.active_spine:
                return ValidationResult(
                    is_valid=False,
                    error=f"Heading level {decision.level} has no open parent level {required_parent_level} in spine",
                )
            expected_parent_id = outline_state.active_spine[required_parent_level].segment_id
            if decision.parent_id != expected_parent_id:
                return ValidationResult(
                    is_valid=False,
                    error=f"Heading parent_id {decision.parent_id} does not match expected parent {expected_parent_id}",
                )
    else:
        # Non-heading must not have level or parent_id
        if decision.level is not None or decision.parent_id is not None:
            return ValidationResult(
                is_valid=False,
                error=f"Non-heading tag '{decision.tag}' cannot have level or parent_id",
            )

    if decision.tag == StructuralTag.LIST_ITEM:
        if not outline_state.in_list_context:
            return ValidationResult(is_valid=False, error="ORPHAN_LIST_ITEM")

    if decision.tag == StructuralTag.CONTINUATION:
        if outline_state.last_segment_tag is None:
            return ValidationResult(is_valid=False, error="LEADING_CONTINUATION")

    return ValidationResult(is_valid=True)
