"""
Unit tests for Deliverable 2: Validators for splits, edits, and outline transitions.
"""

import pytest

from backend.tafrigh.models import (
    HeadingEntry,
    OutlineState,
    SourcePosition,
    StructuralDecision,
    StructuralTag,
    TextEdit,
    TranscriptSegment,
)
from backend.tafrigh.validators import (
    validate_and_apply_edits,
    validate_and_apply_splits,
    validate_structural_transition,
)


def test_split_benchmark_case():
    text = "فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة الأول الإسلام"
    pos = SourcePosition(char_start=0, char_end=len(text), start_time=0.0, end_time=10.0)
    seg = TranscriptSegment(
        id="seg_0042",
        original_text=text,
        source_pos=pos,
        proposed_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH),
    )

    result = validate_and_apply_splits(seg, [4, 10])

    assert result.is_valid is True
    assert len(result.subsegments) == 3

    # Check exact texts
    assert result.subsegments[0].original_text == "فهذا هو الأصل الأول "
    assert result.subsegments[1].original_text == "وسنذكر الآن شروط الصلاة وهي تسعة "
    assert result.subsegments[2].original_text == "الأول الإسلام"

    # Exact string reconstruction assertion
    reconstructed = "".join(s.original_text for s in result.subsegments)
    assert reconstructed == text

    # Parent tag must be discarded
    assert seg.proposed_decision is None
    assert seg.final_decision is None

    # Subsegment IDs and parent linking
    assert result.subsegments[0].id == "seg_0042_sub_0"
    assert result.subsegments[0].parent_segment_id == "seg_0042"
    assert result.subsegments[1].id == "seg_0042_sub_1"
    assert result.subsegments[2].id == "seg_0042_sub_2"

    # Inner subsegments marked with unreliable timestamp mapping when no word timestamps
    assert "UNRELIABLE_TIMESTAMP_MAPPING" in result.subsegments[0].review_flags


def test_invalid_split_points_handling():
    text = "فهذا هو الأصل الأول"
    pos = SourcePosition(char_start=0, char_end=len(text))
    seg = TranscriptSegment(id="seg_0001", original_text=text, source_pos=pos)

    # 1. Split point 0 is invalid (must be > 0)
    res_zero = validate_and_apply_splits(seg, [0, 2])
    assert res_zero.is_valid is False
    assert "SPLIT_VALIDATION_FAILED" in seg.review_flags

    # 2. Split point out of bounds
    res_oob = validate_and_apply_splits(seg, [15])
    assert res_oob.is_valid is False

    # 3. Unsorted split points
    res_unsorted = validate_and_apply_splits(seg, [3, 1])
    assert res_unsorted.is_valid is False

    # 4. Empty split points
    res_empty = validate_and_apply_splits(seg, [])
    assert res_empty.is_valid is False

    # Original text must remain identical
    assert seg.original_text == text


def test_overlapping_and_excessive_edits():
    text = "هذه جملة تجريبية لاختبار التصحيح"
    pos = SourcePosition(char_start=0, char_end=len(text))
    seg = TranscriptSegment(id="seg_0002", original_text=text, source_pos=pos)

    # Overlapping edits: [0, 5] and [3, 7]
    edits_overlapping = [
        TextEdit(start=0, end=5, replacement="تلك"),
        TextEdit(start=3, end=7, replacement="كلمة"),
    ]
    res_overlap = validate_and_apply_edits(seg, edits_overlapping)
    assert res_overlap.is_valid is False
    assert "EDIT_CAP_EXCEEDED" in seg.review_flags
    assert len(seg.versions) == 0

    # Excessive edits: change ratio > 0.30
    # text length is 32 chars. Editing 20 chars exceeds 30%.
    edits_excessive = [
        TextEdit(start=0, end=20, replacement="استبدال كبير جدا للنص بأكمله")
    ]
    res_excess = validate_and_apply_edits(seg, edits_excessive, max_change_ratio=0.30)
    assert res_excess.is_valid is False
    assert "EDIT_CAP_EXCEEDED" in seg.review_flags
    assert len(seg.versions) == 0


def test_valid_edits_create_version():
    text = "كتب الطالب الدرس بالقدم"
    pos = SourcePosition(char_start=0, char_end=len(text))
    seg = TranscriptSegment(id="seg_0003", original_text=text, source_pos=pos)

    # Correct 'بالقدم' -> 'بالقلم' at end of sentence
    # 'كتب الطالب الدرس ' is 17 chars. 'بالقدم' is 17 to 23.
    start = text.index("بالقدم")
    end = start + len("بالقدم")

    valid_edit = TextEdit(
        start=start,
        end=end,
        replacement="بالقلم",
        reason="ASR typo: د/ل confusion",
    )
    res = validate_and_apply_edits(seg, [valid_edit])

    assert res.is_valid is True
    assert len(seg.versions) == 1
    assert seg.versions[0].corrected_text == "كتب الطالب الدرس بالقلم"
    assert seg.active_text == "كتب الطالب الدرس بالقلم"

    # Original text must remain strictly untouched
    assert seg.original_text == "كتب الطالب الدرس بالقدم"


def test_structural_transition_validation():
    outline = OutlineState()

    # 1. First segment as H1 without parent: Valid
    h1_dec = StructuralDecision(tag=StructuralTag.HEADING, level=1, parent_id=None)
    assert validate_structural_transition(h1_dec, outline).is_valid is True

    # 2. First segment as H1 with parent: Invalid
    h1_invalid_parent = StructuralDecision(tag=StructuralTag.HEADING, level=1, parent_id="any_parent")
    assert validate_structural_transition(h1_invalid_parent, outline).is_valid is False

    # 3. Direct jump to H3 when no H1/H2 exist: Invalid
    h3_jump = StructuralDecision(tag=StructuralTag.HEADING, level=3, parent_id="none")
    assert validate_structural_transition(h3_jump, outline).is_valid is False

    # 4. Leading continuation before any segment: Invalid
    cont_dec = StructuralDecision(tag=StructuralTag.CONTINUATION)
    res_cont = validate_structural_transition(cont_dec, outline)
    assert res_cont.is_valid is False
    assert res_cont.error == "LEADING_CONTINUATION"

    # 5. Orphan list item before any list intro: Invalid
    list_item_dec = StructuralDecision(tag=StructuralTag.LIST_ITEM)
    res_list = validate_structural_transition(list_item_dec, outline)
    assert res_list.is_valid is False
    assert res_list.error == "ORPHAN_LIST_ITEM"

    # Now add H1 to outline
    outline.add_heading(HeadingEntry(segment_id="h1_seg", level=1, title_text="كتاب الوضوء", parent_id=None))

    # H2 under h1_seg is Valid
    h2_dec = StructuralDecision(tag=StructuralTag.HEADING, level=2, parent_id="h1_seg")
    assert validate_structural_transition(h2_dec, outline).is_valid is True

    # H2 with wrong parent is Invalid
    h2_wrong_parent = StructuralDecision(tag=StructuralTag.HEADING, level=2, parent_id="wrong_id")
    assert validate_structural_transition(h2_wrong_parent, outline).is_valid is False

    # Add list_intro
    outline.record_decision("seg_intro", "شروط الوضوء ستة:", StructuralDecision(tag=StructuralTag.LIST_INTRO))
    # Now LIST_ITEM is Valid
    assert validate_structural_transition(list_item_dec, outline).is_valid is True
