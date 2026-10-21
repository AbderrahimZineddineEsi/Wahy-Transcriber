"""Verified word-indexed edits, and quotations rendered from their source."""

from backend.tafrigh.edit_resolver import resolve_model_edits
from backend.tafrigh.models import SourcePosition, StructuralDecision, StructuralTag, TranscriptSegment
from backend.tafrigh.renderer import RenderConfig, render_to_markdown, segment_markdown_text
from backend.tafrigh.validators import validate_and_apply_edits

REAL = "وقال عز وجل وما أموالكم ولا أولادكم بالتي تقدربكم عندنا زلفا إلا من آمن وعمر صالحا"


def seg(text, base=0, signals=None, tag=StructuralTag.PARAGRAPH):
    s = TranscriptSegment(id="s1", original_text=text, source_pos=SourcePosition(char_start=base, char_end=base + len(text)),
                          detection_signals=signals or [])
    s.final_decision = StructuralDecision(tag=tag)
    return s


def test_the_real_corruption_is_now_rejected():
    """Gemini's edit from the real run: right intent, offsets pointing at «أولادكم ب…», no quoted original."""
    s = seg(REAL)
    accepted, rejected = resolve_model_edits(s, [{"start": 30, "end": 39, "replacement": "تقربكم"}])
    assert accepted == [] and rejected[0]["why"] == "char_offsets_without_quoted_original"


def test_word_indexed_edit_lands_exactly_on_the_quoted_word():
    s = seg(REAL)
    idx = REAL.split().index("تقدربكم")
    accepted, rejected = resolve_model_edits(s, [{"wordStart": idx, "wordEnd": idx, "original": "تقدربكم", "replacement": "تقربكم"}])
    assert not rejected
    validate_and_apply_edits(s, accepted)
    assert s.versions[-1].corrected_text == REAL.replace("تقدربكم", "تقربكم")


def test_wrong_quoted_original_is_rejected():
    s = seg(REAL)
    accepted, rejected = resolve_model_edits(s, [{"wordStart": 5, "wordEnd": 5, "original": "تقدربكم", "replacement": "تقربكم"}])
    assert not accepted and rejected[0]["why"] == "quoted_original_does_not_match_text"


def test_no_edit_inside_a_detected_quotation():
    s = seg(REAL)
    a = REAL.index("وما")
    idx = REAL.split().index("تقدربكم")
    accepted, rejected = resolve_model_edits(s, [{"wordStart": idx, "wordEnd": idx, "original": "تقدربكم", "replacement": "تقربكم"}],
                                             protected=[(a, len(REAL))])
    assert not accepted and rejected[0]["why"] == "inside_detected_quotation"


def test_punctuation_next_to_a_corrected_word_is_kept():
    text = "قال الشيخ هذا كلام الصحيخ، ثم سكت"
    s = seg(text)
    i = text.split().index("الصحيخ،")
    accepted, _ = resolve_model_edits(s, [{"wordStart": i, "wordEnd": i, "original": "الصحيخ", "replacement": "الصحيح"}])
    validate_and_apply_edits(s, accepted)
    assert s.versions[-1].corrected_text == "قال الشيخ هذا كلام الصحيح، ثم سكت"


ASR = "قال الله تعالى والعصر إن الإنسان لفي خسر فهذه سورة عظيمة"


def asr_signals(base=0):
    out = []
    for unit, words, canon in [("103:1", "والعصر", "وَالْعَصْرِ"), ("103:2", "إن الإنسان لفي خسر", "إِنَّ الْإِنسَانَ لَفِي خُسْرٍ")]:
        a = ASR.index(words)
        out.append({"start": base + a, "end": base + a + len(words), "type": "quran", "unit_id": unit,
                    "ref": f"العصر: {unit.split(':')[1]}", "canonical": canon, "band": "VERIFIED"})
    return out


def test_consecutive_ayat_render_from_the_mushaf_as_one_quote_with_a_range():
    md = segment_markdown_text(seg(ASR, base=100, signals=asr_signals(100)), RenderConfig())
    assert md == "قال الله تعالى ﴿وَالْعَصْرِ ۝ إِنَّ الْإِنسَانَ لَفِي خُسْرٍ﴾ [العصر: 1-2] فهذه سورة عظيمة"


def test_hadith_keeps_spoken_words_and_candidates_are_marked():
    text = "قال النبي إنما الأعمال بالنيات وهذا أصل"
    a = text.index("إنما")
    b = text.index(" وهذا")
    sig = [{"start": a, "end": b, "type": "hadith", "ref": "البخاري 1", "band": "CANDIDATE", "canonical": "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ"}]
    md = render_to_markdown([seg(text, signals=sig)])
    assert "«إنما الأعمال بالنيات» [البخاري 1؟]" in md


def test_quote_style_comes_from_the_user_preferences():
    md = segment_markdown_text(seg(ASR, signals=asr_signals()), RenderConfig(quran_open="(", quran_close=")", show_quote_refs=False))
    assert "(وَالْعَصْرِ ۝ إِنَّ الْإِنسَانَ لَفِي خُسْرٍ)" in md and "[العصر" not in md
