"""The Python parsers must give what the OLD app's parsers gave (parsing_golden.json, recorded by running js/engine.js
with fixtures/make_parsing_golden.mjs). Never regenerate the golden file to make these pass."""

import json
from pathlib import Path

import pytest

from wahy.features.lectures.parsing import (
    looks_like_subtitles,
    parse_subtitles,
    round2,
    synthesize_words,
    words_from_content,
)

GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "parsing_golden.json").read_text("utf-8"))


def as_rows(words):
    return [[w.text, w.start, w.end] for w in words]


@pytest.mark.parametrize("name", GOLDEN["plain"])
def test_plain_text_gives_the_old_apps_words_and_times(name):
    case = GOLDEN["plain"][name]
    assert as_rows(synthesize_words(case["input"])) == case["words"]


@pytest.mark.parametrize("name", GOLDEN["subtitles"])
def test_subtitles_give_the_old_apps_words_and_times(name):
    case = GOLDEN["subtitles"][name]
    assert as_rows(parse_subtitles(case["input"])) == case["words"]


def test_round2_rounds_halves_up_like_javascript():
    assert round2(0.125) == 0.13          # Python's round(0.125, 2) gives 0.12
    assert round2(2.675) == 2.67          # 2.675 is really 2.67499999...: same in both languages
    assert round2(1.0) == 1.0


def test_content_that_has_cues_is_read_as_subtitles_whatever_the_file_name():
    cue = "1\n00:00:01,000 --> 00:00:02,000\nمرحبا بكم\n"
    assert looks_like_subtitles(cue)
    assert looks_like_subtitles("anything", "lecture.VTT")
    assert not looks_like_subtitles("نص عادي", "lecture.txt")
    words = words_from_content(cue)
    assert [(w.text, w.start) for w in words] == [("مرحبا", 1.0), ("بكم", 1.5)]


def test_empty_content_gives_no_words():
    assert words_from_content("   \n ") == []
