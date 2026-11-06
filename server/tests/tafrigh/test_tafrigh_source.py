"""The text Tafrigh reads, built from words and findings (port of the browser's tafrighSource)."""

from wahy.features.tafrigh.segmenter import segment_transcript
from wahy.features.tafrigh.source import build_source, quote_findings

WORDS = [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4}
         for i, w in enumerate("قال الله تعالى قل هو الله احد ثم شرح الشيخ المعنى".split())]


def finding(a, b, **kw):
    return {"wordStartIdx": a, "wordEndIdx": b, "sourceType": "QURAN", "unitId": "112:1", "displayRef": "الإخلاص: 1",
            "confidenceBand": "HIGH", "canonicalText": "قل هو الله أحد", **kw}


def test_raw_findings_marks_each_quote_by_its_character_range():
    src = build_source(WORDS, [finding(3, 6)], "raw_findings")
    (span,) = src["detection_spans"]
    assert src["raw_text"][span["start"]:span["end"]] == "قل هو الله احد"
    assert span["type"] == "quran" and span["ref"] == "الإخلاص: 1" and src["use_detection_boundaries"] is True


def test_raw_text_marks_nothing_and_corrected_writes_the_quote_from_its_source():
    raw = build_source(WORDS, [finding(3, 6)], "raw")
    assert raw["detection_spans"] == [] and raw["use_detection_boundaries"] is False
    corrected = build_source(WORDS, [finding(3, 6)], "corrected")
    assert "قل هو الله أحد" in corrected["raw_text"] and "احد" not in corrected["raw_text"].split()
    (span,) = corrected["detection_spans"]
    assert corrected["raw_text"][span["start"]:span["end"]] == "قل هو الله أحد"
    # the sentences cut around the quote come out as the quote on its own
    segs = segment_transcript(corrected["raw_text"], corrected["asr_words"], corrected["detection_spans"], True)
    assert any(s.original_text.strip() == "قل هو الله أحد" for s in segs)


def test_rejected_and_overlapping_findings_are_not_sent_as_quotes():
    rejected = finding(3, 6, verdict="FALSE")
    first, overlapping = finding(0, 2), finding(1, 4)
    assert quote_findings(WORDS, [rejected, overlapping, first]) == [first]
    assert quote_findings(WORDS, [finding(3, 99)]) == []
