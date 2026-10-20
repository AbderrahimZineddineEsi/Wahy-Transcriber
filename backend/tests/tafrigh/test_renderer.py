"""
Unit tests for Deliverable 9: Stage 7 Deterministic Renderer.
"""

import time
import pytest

from backend.tafrigh.models import (
    CommentKind,
    HeadingEntry,
    MatnMatchEvidence,
    OutlineState,
    SourcePosition,
    StructuralDecision,
    StructuralTag,
    TranscriptSegment,
)
from backend.tafrigh.renderer import (
    RenderConfig,
    render_to_html,
    render_to_markdown,
    render_to_structured_json,
)


def test_matn_and_sharh_blocks_rendering():
    s1 = TranscriptSegment(
        id="s1",
        original_text="قال المصنف كتاب الطهارة الأصل في الماء الطهورية",
        source_pos=SourcePosition(char_start=0, char_end=46),
        final_decision=StructuralDecision(tag=StructuralTag.MATN_SECTION),
        matn_evidence=MatnMatchEvidence(
            canonical_text="كتاب الطهارة: الأصل في الماء الطهورية",
            has_variant_wording=True,
        ),
    )
    s2 = TranscriptSegment(
        id="s2",
        original_text="وهذا إجماع من أهل العلم نقله ابن المنذر وغيره.",
        source_pos=SourcePosition(char_start=47, char_end=93),
        final_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH),
    )

    md = render_to_markdown([s1, s2])

    assert "**المتن:**" in md
    assert "قال المصنف كتاب الطهارة" in md
    assert "**الشرح:**" in md
    assert "وهذا إجماع من أهل العلم" in md

    # Canonical matn display source option
    cfg_canonical = RenderConfig(matn_display_source="canonical")
    md_canon = render_to_markdown([s1, s2], config=cfg_canonical)
    assert "كتاب الطهارة: الأصل في الماء الطهورية" in md_canon


def test_continuation_merges_inline():
    s1 = TranscriptSegment(
        id="s1",
        original_text="شروط الصلاة تسعة",
        source_pos=SourcePosition(char_start=0, char_end=16),
        final_decision=StructuralDecision(tag=StructuralTag.LIST_INTRO),
    )
    s2 = TranscriptSegment(
        id="s2",
        original_text="الأول الإسلام",
        source_pos=SourcePosition(char_start=17, char_end=30),
        final_decision=StructuralDecision(tag=StructuralTag.LIST_ITEM),
    )
    s3 = TranscriptSegment(
        id="s3",
        original_text="وضده الكفر.",
        source_pos=SourcePosition(char_start=31, char_end=42),
        final_decision=StructuralDecision(tag=StructuralTag.CONTINUATION),
    )

    md = render_to_markdown([s1, s2, s3])

    # s3 must merge into s2's list_item line without creating an additional bullet point
    bullet_lines = [l for l in md.splitlines() if l.startswith("- ")]
    assert len(bullet_lines) == 1
    assert "الأول الإسلام وضده الكفر." in bullet_lines[0]


def test_comment_rendered_with_kind_metadata_and_never_omitted():
    s1 = TranscriptSegment(
        id="s1",
        original_text="أثابكم الله ونفع بكم، هل يجوز الجمع في المطر؟",
        source_pos=SourcePosition(char_start=0, char_end=44),
        final_decision=StructuralDecision(
            tag=StructuralTag.COMMENT,
            comment_kind=CommentKind.STUDENT_QUESTION,
        ),
    )

    # Aside box style
    md_aside = render_to_markdown([s1], config=RenderConfig(comment_style="aside_box"))
    assert "*[سؤال طالب]*" in md_aside
    assert "أثابكم الله" in md_aside

    # Dimmed inline style
    md_inline = render_to_markdown([s1], config=RenderConfig(comment_style="dimmed_inline"))
    assert "(سؤال طالب: أثابكم الله" in md_inline

    # HTML output with data-comment-kind
    html_out = render_to_html([s1])
    assert 'class="tafrigh-comment"' in html_out
    assert 'data-comment-kind="student_question"' in html_out
    assert "سؤال طالب" in html_out


def test_re_rendering_performance_under_10ms():
    segments = []
    for i in range(100):
        segments.append(
            TranscriptSegment(
                id=f"s_{i}",
                original_text=f"جملة رقم {i} من شرح الدرس الفقهي.",
                source_pos=SourcePosition(char_start=i * 30, char_end=(i + 1) * 30),
                final_decision=StructuralDecision(tag=StructuralTag.PARAGRAPH),
            )
        )

    t0 = time.perf_counter()
    render_to_markdown(segments, config=RenderConfig(comment_style="dimmed_inline"))
    render_to_html(segments)
    render_to_structured_json(segments)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    # 100 segments rendering to MD + HTML + JSON should be well under 10ms
    assert elapsed_ms < 10.0
