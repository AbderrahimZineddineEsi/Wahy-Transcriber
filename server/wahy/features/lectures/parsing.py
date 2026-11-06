"""Turns text a person pasted or a subtitle file into timed words (GLOSSARY: Word).

Ported from the old app (js/engine.js: `synthesizeWordsFromRawText` and `parseSubtitleFileToWords`) with the
same arithmetic, so the same input gives the same words and times, and later golden captions still match:

- plain text has no timings, so each word gets an estimated duration from its length and a pause after
  punctuation and line breaks;
- an .srt / .vtt cue has a start and an end for a whole line, so its words share that time equally.

    words = words_from_content("1\\n00:00:01,000 --> 00:00:03,000\\nبسم الله الرحمن", filename="a.srt")
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path


@dataclass(frozen=True)
class TimedWord:
    text: str
    start: float
    end: float


_TIME_RE = re.compile(
    r"(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})")
_SUBTITLE_HINT = re.compile(r"\d{2}:\d{2}[.,]\d{3}\s*-->")
_TAGS = re.compile(r"<[^>]+>")          # <i>, <c.colorE5E5E5>, <00:00:01.000> ...
_STYLES = re.compile(r"\{[^}]+\}")      # {\an8}
_SENTENCE_END = re.compile(r"[.؟!؛:]")  # tested anywhere in the word, as in the old code
_COMMA = re.compile(r"[،,]")


def round2(x: float) -> float:
    """Two decimals, rounding halves up like JavaScript's `Number(x.toFixed(2))` (Python's `round` rounds
    halves to even, which would differ on exact ties)."""
    return float(Decimal(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def synthesize_words(text: str) -> list[TimedWord]:
    """Words of plain text with estimated times (0.24 to 0.65 s a word, longer pauses at punctuation)."""
    words: list[TimedWord] = []
    now = 0.0
    for m in re.finditer(r"\S+", text):
        w = m.group(0)
        duration = min(0.65, max(0.24, len(w) * 0.065))
        start = round2(now)
        end = round2(now + duration)
        words.append(TimedWord(w, start, end))
        after = text[m.end():m.end() + 4]
        if re.search(r"[\n\r]", after):
            pause = 0.55
        elif _SENTENCE_END.search(w):
            pause = 0.48
        elif _COMMA.search(w):
            pause = 0.36
        else:
            pause = 0.04
        now = end + pause
    return words


def _seconds(h: str | None, m: str, s: str, ms: str) -> float:
    hours = int(h.replace(":", "")) if h else 0
    return hours * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def parse_subtitles(content: str) -> list[TimedWord]:
    """Words of an .srt or .vtt file. A file with no cue at all is read as plain text."""
    lines = content.replace("\r\n", "\n").split("\n")
    cues: list[tuple[float, float, str]] = []
    i = 0
    while i < len(lines):
        m = _TIME_RE.search(lines[i].strip())
        if not m:
            i += 1
            continue
        start = _seconds(*m.group(1, 2, 3, 4))
        end = _seconds(*m.group(5, 6, 7, 8))
        i += 1
        parts: list[str] = []
        while i < len(lines) and lines[i].strip() != "":
            cleaned = _STYLES.sub("", _TAGS.sub("", lines[i])).strip()
            if cleaned:
                parts.append(cleaned)
            i += 1
        text = " ".join(parts).strip()
        if text:
            cues.append((start, max(start + 0.2, end), text))

    if not cues:
        return synthesize_words(content.strip())

    words: list[TimedWord] = []
    for start, end, text in cues:
        pieces = text.split()
        step = (end - start) / len(pieces)
        for k, piece in enumerate(pieces):
            w_start = round2(start + k * step)
            w_end = round2(start + (k + 1) * step)
            words.append(TimedWord(piece, w_start, max(w_start + 0.04, w_end)))
    return words


def looks_like_subtitles(content: str, filename: str = "") -> bool:
    return Path(filename).suffix.lower() in (".srt", ".vtt") or bool(_SUBTITLE_HINT.search(content))


def words_from_content(content: str, filename: str = "") -> list[TimedWord]:
    """Subtitle cues when the content (or the file name) says it is a subtitle file, else plain text."""
    content = content.strip()
    return parse_subtitles(content) if looks_like_subtitles(content, filename) else synthesize_words(content)
