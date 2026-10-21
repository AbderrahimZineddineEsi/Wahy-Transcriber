"""Segmentation of unpunctuated ASR output (Whisper) by pauses and a length cap."""

from backend.tafrigh.segmenter import SegmentationConfig, segment_transcript


def words_from(text, gaps):
    """Build ASR words for `text`; gaps[i] = silence before word i (seconds)."""
    out, t, pos = [], 0.0, 0
    for i, w in enumerate(text.split(" ")):
        t += gaps.get(i, 0.05)
        out.append({"word": w, "start": t, "end": t + 0.3, "char_start": pos, "char_end": pos + len(w)})
        t += 0.3
        pos += len(w) + 1
    return out


TEXT = ("الحمد لله رب العالمين والصلاة والسلام على رسول الله "
        "اليوم نتكلم عن شروط الصلاة وهي تسعة "
        "الأول الإسلام والثاني العقل والثالث التمييز")


def test_unpunctuated_text_is_cut_at_pauses_and_reconstructs_exactly():
    words = words_from(TEXT, {9: 1.2, 16: 0.9})
    segs = segment_transcript(TEXT, asr_words=words, config=SegmentationConfig())
    assert "".join(s.original_text for s in segs) == TEXT
    assert [s.cut_reason for s in segs] == ["pause", "pause", "end"]
    assert segs[1].original_text.startswith("اليوم")


def test_without_pauses_or_punctuation_old_behaviour_was_one_giant_sentence():
    segs = segment_transcript(TEXT, asr_words=words_from(TEXT, {}), config=SegmentationConfig(max_words=0))
    assert len(segs) == 1


def test_long_sentences_are_capped_at_the_longest_internal_pause():
    long_text = " ".join(f"كلمة{i}" for i in range(100))
    words = words_from(long_text, {50: 0.5})           # below the pause threshold, but the longest gap
    segs = segment_transcript(long_text, asr_words=words, config=SegmentationConfig(max_words=60))
    assert "".join(s.original_text for s in segs) == long_text
    assert len(segs) == 2 and segs[1].original_text.startswith("كلمة50") and segs[0].cut_reason == "length"


def test_pause_cuts_never_leave_tiny_fragments():
    words = words_from(TEXT, {2: 1.5})                  # pause after only two words
    segs = segment_transcript(TEXT, asr_words=words, config=SegmentationConfig(min_words=4, max_words=0))
    assert all(len(s.original_text.split()) >= 4 for s in segs)


def test_bogus_word_offsets_are_ignored_not_trusted():
    words = [{"word": "x", "start": 0, "end": 1, "char_start": 5000, "char_end": 5001}]
    segs = segment_transcript(TEXT, asr_words=words, config=SegmentationConfig(max_words=0))
    assert "".join(s.original_text for s in segs) == TEXT


def test_short_heading_between_pauses_stays_its_own_sentence():
    """Regression: with min_words=4 the heading «باب شروط الصلاة» was merged into the basmala sentence."""
    sents = ["بسم الله الرحمن الرحيم الحمد لله رب العالمين", "باب شروط الصلاة", "فهذا هو الأصل الأول وسنذكر الآن"]
    text = " ".join(sents)
    gaps, k = {}, 0
    for s in sents[:-1]:
        k += len(s.split())
        gaps[k] = 1.1
    segs = segment_transcript(text, asr_words=words_from(text, gaps))
    assert [s.original_text.strip() for s in segs] == sents


def test_long_sentences_are_cut_at_a_comma_not_mid_phrase():
    """Regression from a real lecture: the cap cut «…مطية العبد إلى | دار البقاء» although commas were available."""
    text = ("وقال عز وجل وما أموالكم ولا أولادكم بالتي تقربكم عندنا زلفى إلا من آمن وعمل صالحا "
            "إن الدنيا مطية العبد إلى دار البقاء والخلود، يجد فيها، ويجتهد، ويسارع إلى صالح الأعمال")
    segs = segment_transcript(text, asr_words=words_from(text, {}), config=SegmentationConfig(max_words=20))
    assert "".join(s.original_text for s in segs) == text
    # the clause boundary «…والخلود،» is used; never «…إلى | دار البقاء»
    assert any(s.cut_reason == "comma" and s.original_text.rstrip().endswith("والخلود،") for s in segs)
    assert not any(s.original_text.rstrip().endswith("إلى") for s in segs)


def test_no_cut_inside_a_detected_hadith():
    text = " ".join(f"كلمة{i}" for i in range(60))
    start = text.index("كلمة15")
    end = text.index("كلمة45") + len("كلمة45")
    segs = segment_transcript(text, asr_words=words_from(text, {}), detection_spans=[{"start": start, "end": end, "type": "hadith"}],
                              config=SegmentationConfig(max_words=20))
    assert any(s.source_pos.char_start <= start and end <= s.source_pos.char_end for s in segs)
