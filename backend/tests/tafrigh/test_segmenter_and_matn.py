"""
Unit tests for Deliverable 3: Stage 1 Segmentation and Stage 2 Matn Alignment.
"""

import pytest

from backend.tafrigh.matn_aligner import (
    MatnConfig,
    SequentialMatnAligner,
    normalize_arabic_for_alignment,
)
from backend.tafrigh.models import SourcePosition, TranscriptSegment
from backend.tafrigh.segmenter import segment_transcript


def test_segmentation_preserves_characters_and_atomic_quran_ayah():
    # Construct a lecture snippet with a Quran quote containing internal punctuation
    raw_text = (
        "قال الله تعالى: ﴿وَأَقِيمُوا الصَّلَاةَ وَآتُوا الزَّكَاةَ وَارْكَعُوا مَعَ الرَّاكِعِينَ﴾. "
        "وهذا أمر يفيد الوجوب. ثم قال النبي صلى الله عليه وسلم: بني الإسلام على خمس. وهذا حديث عظيم."
    )

    # Quran ayah span covers the exact bracketed verse
    quran_start = raw_text.index("﴿")
    quran_end = raw_text.index("﴾") + 1

    detection_spans = [
        {"type": "quran", "start": quran_start, "end": quran_end, "surah": 2, "ayah": 43},
        {"type": "hadith", "start": raw_text.index("بني الإسلام"), "end": raw_text.index("على خمس") + 7},
    ]

    segments = segment_transcript(raw_text, detection_spans=detection_spans, use_detection_boundaries=True)

    # 1. Total exact reconstruction
    reconstructed = "".join(s.original_text for s in segments)
    assert reconstructed == raw_text

    # 2. Qur'an ayah is not cut internally
    quran_segments = [s for s in segments if "وَأَقِيمُوا" in s.original_text]
    assert len(quran_segments) == 1
    assert "وَآتُوا الزَّكَاةَ" in quran_segments[0].original_text
    assert "وَارْكَعُوا" in quran_segments[0].original_text


def test_sequential_matn_aligner_tracking():
    matn_text = """
    كتاب الطهارة
    الأصل في الماء الطهورية
    إذا بلغ الماء قلتين لم يحمل الخبث
    باب الوضوء
    شروط الوضوء ستة
    """
    config = MatnConfig(mode="upload", raw_matn_text=matn_text)
    aligner = SequentialMatnAligner(config)

    # Line 0: كتاب الطهارة
    seg0 = TranscriptSegment(
        id="s0",
        original_text="قال المصنف رحمه الله كتاب الطهارة",
        source_pos=SourcePosition(char_start=0, char_end=33),
    )
    ev0 = aligner.align_segment(seg0)
    assert 0 in ev0.matched_line_indices
    assert ev0.is_candidate_standalone_matn is True

    # Line 1: in-order progression
    seg1 = TranscriptSegment(
        id="s1",
        original_text="الأصل في الماء الطهورية",
        source_pos=SourcePosition(char_start=34, char_end=58),
    )
    ev1 = aligner.align_segment(seg1)
    assert 1 in ev1.matched_line_indices
    assert ev1.pointer_delta >= 0

    # Line 1 repeated: shaykh re-reads line 1
    seg1_rep = TranscriptSegment(
        id="s1_rep",
        original_text="نعم، الأصل في الماء الطهورية كما ذكر المؤلف",
        source_pos=SourcePosition(char_start=59, char_end=100),
    )
    ev1_rep = aligner.align_segment(seg1_rep)
    assert 1 in ev1_rep.matched_line_indices

    # Skip line 2 to line 3: باب الوضوء
    seg3 = TranscriptSegment(
        id="s3",
        original_text="ثم انتقل رحمه الله فقال باب الوضوء",
        source_pos=SourcePosition(char_start=101, char_end=140),
    )
    ev3 = aligner.align_segment(seg3)
    assert 3 in ev3.matched_line_indices


def test_short_embedded_matn_quote_vs_standalone():
    matn_text = "إذا بلغ الماء قلتين لم يحمل الخبث وهو الأصل"
    config = MatnConfig(mode="upload", raw_matn_text=matn_text)
    aligner = SequentialMatnAligner(config)

    # Short 2-word quote mid-sentence in explanation
    sharh_seg = TranscriptSegment(
        id="s_sharh",
        original_text="وهذا الحكم معلق على قوله بلغ الماء في الحديث النبوي وليس على غيره",
        source_pos=SourcePosition(char_start=0, char_end=60),
    )
    ev_short = aligner.align_segment(sharh_seg)

    # Should NOT be flagged as standalone matn
    assert ev_short.is_candidate_standalone_matn is False


def test_matn_variant_wording_detection():
    # Canonical text has 'إذا بلغ الماء قلتين'
    matn_text = "إذا بلغ الماء قلتين لم يحمل الخبث"
    config = MatnConfig(mode="upload", raw_matn_text=matn_text)
    aligner = SequentialMatnAligner(config)

    # Spoken variant wording: 'إذا كان الماء قلتين' (كان instead of بلغ)
    seg_variant = TranscriptSegment(
        id="s_var",
        original_text="قال المصنف رحمه الله إذا كان الماء قلتين لم يحمل الخبث",
        source_pos=SourcePosition(char_start=0, char_end=55),
    )
    ev = aligner.align_segment(seg_variant)

    assert 0 in ev.matched_line_indices
    assert ev.has_variant_wording is True
    assert ev.canonical_text == "إذا بلغ الماء قلتين لم يحمل الخبث"
    assert "إذا كان الماء قلتين" in seg_variant.original_text
