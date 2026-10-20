"""
Unit tests for Deliverable 5: Stage 6 Outline Repair Pass and Review Queue.
"""

import pytest

from backend.tafrigh.models import (
    HeadingEntry,
    LabelProvenance,
    OutlineState,
    SourcePosition,
    StructuralDecision,
    StructuralTag,
    TranscriptSegment,
)
from backend.tafrigh.outline_repair import run_outline_repair_pass
from backend.tafrigh.review_queue import ReviewQueueManager


def test_outline_repair_detects_and_repairs_anomalies():
    # Setup segments
    s1 = TranscriptSegment(
        id="h_1",
        original_text="كتاب الصلاة",
        source_pos=SourcePosition(char_start=0, char_end=15),
        final_decision=StructuralDecision(tag=StructuralTag.HEADING, level=1, parent_id=None),
    )
    s2 = TranscriptSegment(
        id="h_2",
        original_text="شروط الصلاة",
        source_pos=SourcePosition(char_start=16, char_end=30),
        # Corrupted parent pointer (pointing to wrong_parent instead of h_1)
        final_decision=StructuralDecision(tag=StructuralTag.HEADING, level=2, parent_id="wrong_parent"),
    )
    s3 = TranscriptSegment(
        id="s_rhetorical",
        original_text="هل تجب الصلاة على الصغير؟",
        source_pos=SourcePosition(char_start=31, char_end=60),
        # Misclassified as heading
        final_decision=StructuralDecision(tag=StructuralTag.HEADING, level=2, parent_id="h_1"),
    )

    outline = OutlineState()
    outline.add_heading(HeadingEntry(segment_id="h_1", level=1, title_text="كتاب الصلاة", parent_id=None))
    outline.add_heading(HeadingEntry(segment_id="h_2", level=2, title_text="شروط الصلاة", parent_id="wrong_parent"))
    outline.add_heading(HeadingEntry(segment_id="s_rhetorical", level=2, title_text="هل تجب الصلاة على الصغير؟", parent_id="h_1"))

    report = run_outline_repair_pass([s1, s2, s3], outline)

    assert report.repaired_count >= 1
    # Check parent of h_2 was repaired to h_1
    assert s2.final_decision.parent_id == "h_1"
    assert "OUTLINE_REPAIR_APPLIED" in s2.review_flags

    # Check rhetorical question was demoted to paragraph
    assert s3.final_decision.tag == StructuralTag.PARAGRAPH
    assert "OUTLINE_REPAIR_APPLIED" in s3.review_flags


def test_review_queue_manager_captures_and_resolves_flags():
    s1 = TranscriptSegment(
        id="seg_flagged_1",
        original_text="نص يحتوي على شك في الفصل",
        source_pos=SourcePosition(char_start=0, char_end=30),
        final_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH, confidence=0.45),
        review_flags=["LOW_CONFIDENCE"],
    )
    s2 = TranscriptSegment(
        id="seg_flagged_2",
        original_text="نص تجاوز حد التعديل",
        source_pos=SourcePosition(char_start=31, char_end=60),
        final_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH),
        review_flags=["EDIT_CAP_EXCEEDED"],
    )
    s3 = TranscriptSegment(
        id="seg_ok",
        original_text="نص سليم تماما",
        source_pos=SourcePosition(char_start=61, char_end=80),
        final_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH, confidence=0.98),
        review_flags=[],
    )

    action_log = []
    manager = ReviewQueueManager(
        [s1, s2, s3],
        confidence_threshold=0.70,
        on_review_action_callback=lambda act: action_log.append(act),
    )

    # Queue should return s1 and s2, but not s3
    items = manager.get_items()
    item_ids = [it.segment_id for it in items]
    assert "seg_flagged_1" in item_ids
    assert "seg_flagged_2" in item_ids
    assert "seg_ok" not in item_ids

    # Confirm s1
    manager.confirm_decision("seg_flagged_1", reviewer_id="user_123", note="Confirmed valid")
    assert action_log[-1]["action"] == "confirm"
    assert action_log[-1]["provenance"] == LabelProvenance.HUMAN_CONFIRMED.value

    # Correct s2 to HEADING
    manager.correct_decision(
        "seg_flagged_2",
        corrected_tag=StructuralTag.HEADING,
        corrected_level=1,
        corrected_parent=None,
        reviewer_id="user_123",
        note="Converted to H1",
    )
    assert s2.final_decision.tag == StructuralTag.HEADING
    assert action_log[-1]["action"] == "correct"
    assert action_log[-1]["provenance"] == LabelProvenance.HUMAN_CORRECTED.value
