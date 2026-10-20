"""
Unit tests for Deliverable 1: Data Model and Schemas.
"""

import pytest
from pydantic import ValidationError

from backend.tafrigh.models import (
    CommentKind,
    HeadingEntry,
    OutlineState,
    SourcePosition,
    StructuralDecision,
    StructuralTag,
    TOCConfig,
    TranscriptSegment,
    WordToken,
    tokenize_words,
)
from backend.tafrigh.schemas import (
    GeminiSingleOutputSchema,
    GeminiWindowItemSchema,
    GeminiWindowOutputSchema,
    JEVRequestConfig,
)


def test_immutable_source_text_and_position():
    pos = SourcePosition(char_start=0, char_end=15, start_time=1.0, end_time=2.5)
    seg = TranscriptSegment(
        id="seg_0001",
        original_text="فهذا هو الأصل",
        source_pos=pos,
    )

    # Attempting to reassign original_text must raise ValueError
    with pytest.raises(ValueError, match="immutable"):
        seg.original_text = "تعديل غير مسموح"

    # Attempting to reassign source_pos must raise ValueError
    with pytest.raises(ValueError, match="immutable"):
        seg.source_pos = SourcePosition(char_start=0, char_end=20)

    # Attempting to mutate source_pos in-place must raise ValidationError / FrozenInstanceError
    with pytest.raises(ValidationError):
        seg.source_pos.char_start = 5


def test_tokenization_exact_character_spans():
    text = "فهذا هو الأصل الأول وسنذكر الآن شروط الصلاة وهي تسعة الأول الإسلام"
    tokens = tokenize_words(text)

    assert len(tokens) == 12

    # Check each token text matches slicing original_text
    for token in tokens:
        assert text[token.char_start : token.char_end] == token.text

    assert tokens[0].text == "فهذا"
    assert tokens[0].char_start == 0
    assert tokens[0].char_end == 4

    assert tokens[4].text == "وسنذكر"
    assert tokens[10].text == "الأول"
    assert tokens[11].text == "الإسلام"

    # Automatic tokenization when constructing TranscriptSegment
    pos = SourcePosition(char_start=100, char_end=100 + len(text))
    seg = TranscriptSegment(
        id="seg_0042",
        original_text=text,
        source_pos=pos,
    )
    assert len(seg.tokens) == 12
    assert seg.tokens[4].text == "وسنذكر"


def test_outline_state_heading_hierarchy_and_allowed_choices():
    outline = OutlineState()

    # Initial allowed choices
    choices = outline.get_allowed_structural_choices()
    tags = {c["tag"] for c in choices}
    assert StructuralTag.PARAGRAPH.value in tags
    assert StructuralTag.LIST_INTRO.value in tags
    assert StructuralTag.MATN_SECTION.value in tags
    assert StructuralTag.COMMENT.value in tags
    # Level 1 heading is allowed initially
    h1_choices = [c for c in choices if c["tag"] == StructuralTag.HEADING.value and c["level"] == 1]
    assert len(h1_choices) == 1
    assert h1_choices[0]["parent_id"] is None

    # Level 2 and Level 3 headings should NOT be present initially
    assert not any(c["tag"] == StructuralTag.HEADING.value and c["level"] > 1 for c in choices)

    # Add a Level 1 heading
    h1 = HeadingEntry(segment_id="seg_01", level=1, title_text="كتاب الصلاة", parent_id=None)
    outline.add_heading(h1)

    choices_after_h1 = outline.get_allowed_structural_choices()
    h2_choices = [c for c in choices_after_h1 if c["tag"] == StructuralTag.HEADING.value and c["level"] == 2]
    assert len(h2_choices) == 1
    assert h2_choices[0]["parent_id"] == "seg_01"

    # Still no Level 3 heading allowed since no Level 2 heading exists yet
    assert not any(c["tag"] == StructuralTag.HEADING.value and c["level"] == 3 for c in choices_after_h1)

    # Add a Level 2 heading
    h2 = HeadingEntry(segment_id="seg_05", level=2, title_text="شروط الصلاة", parent_id="seg_01")
    outline.add_heading(h2)

    choices_after_h2 = outline.get_allowed_structural_choices()
    h3_choices = [c for c in choices_after_h2 if c["tag"] == StructuralTag.HEADING.value and c["level"] == 3]
    assert len(h3_choices) == 1
    assert h3_choices[0]["parent_id"] == "seg_05"


def test_outline_state_partial_toc_filtering():
    outline = OutlineState()

    # Create Book 1 with two chapters and deep subsections
    outline.add_heading(HeadingEntry(segment_id="h_1", level=1, title_text="كتاب الطهارة", parent_id=None))
    outline.add_heading(HeadingEntry(segment_id="h_2", level=2, title_text="باب الوضوء", parent_id="h_1"))
    outline.add_heading(HeadingEntry(segment_id="h_3", level=3, title_text="فصل في النية", parent_id="h_2"))

    # Create Book 2 with a chapter
    outline.add_heading(HeadingEntry(segment_id="h_4", level=1, title_text="كتاب الصلاة", parent_id=None))
    outline.add_heading(HeadingEntry(segment_id="h_5", level=2, title_text="باب المواقيت", parent_id="h_4"))
    outline.add_heading(HeadingEntry(segment_id="h_6", level=3, title_text="وقت الفجر", parent_id="h_5"))

    toc = outline.get_partial_toc(TOCConfig(max_level1_headings=10, recent_level2_siblings_count=2))
    toc_ids = [item["segment_id"] for item in toc]

    # Should contain all level 1 headings
    assert "h_1" in toc_ids
    assert "h_4" in toc_ids

    # Under active level 1 ("h_4"), should contain its level 2 child ("h_5")
    assert "h_5" in toc_ids

    # Deep level 3 headings must NOT be in partial TOC to avoid clutter
    assert "h_3" not in toc_ids
    assert "h_6" not in toc_ids


def test_schemas_validation():
    item = GeminiWindowItemSchema(
        id="seg_0042",
        tag=StructuralTag.PARAGRAPH,
        hasTypo=False,
        needsSplitting=True,
        splitPoints=[4, 10],
    )
    assert item.id == "seg_0042"
    assert item.needsSplitting is True
    assert item.splitPoints == [4, 10]

    window = GeminiWindowOutputSchema(decisions=[item])
    assert len(window.decisions) == 1
    assert window.decisions[0].tag == StructuralTag.PARAGRAPH

    jev_cfg = JEVRequestConfig(jev_layout="split_as_tag_option", execution_order="sequential")
    assert jev_cfg.jev_layout == "split_as_tag_option"
    assert jev_cfg.execution_order == "sequential"
