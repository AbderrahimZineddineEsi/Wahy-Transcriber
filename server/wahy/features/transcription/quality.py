"""A quick check of an Arabic transcript for the two mistakes speech recognition makes on a silent or noisy
stretch (N-009): a run of Latin-script words (Whisper "hears" English, for example "Thank you for watching")
and a repetition loop (the same word or phrase over and over).

    warnings = check_transcript(words)     # [] when nothing looks wrong

A warning is only a flag for the person to look at that stretch; the words are never changed.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from wahy.features.lectures.parsing import TimedWord

MIN_LATIN_RUN = 4          # one English term in a khutba is normal; four words in a row are not
MIN_WORD_REPEATS = 6       # "نعم نعم نعم نعم نعم نعم"
MIN_PHRASE_REPEATS = 4     # a 2-6 word phrase four times in a row
MAX_PHRASE_WORDS = 6

_LATIN = re.compile(r"[A-Za-z]")
_ARABIC = re.compile(r"[؀-ۿ]")
_MARKS = re.compile(r"[ً-ْٰـ]|[^\w]", re.UNICODE)    # diacritics, tatweel, punctuation


@dataclass(frozen=True)
class TranscriptWarning:
    kind: str                # "latin_run" | "repetition"
    start_idx: int           # first word (index in the transcript)
    end_idx: int             # last word, inclusive
    start_s: float
    end_s: float
    sample: str              # the words, cut to 80 characters
    repeats: int | None = None


def _is_latin(text: str) -> bool:
    return len(_LATIN.findall(text)) > len(_ARABIC.findall(text))


def _flag(kind: str, words: Sequence[TimedWord], a: int, b: int,
          repeats: int | None = None) -> TranscriptWarning:
    sample = " ".join(w.text for w in words[a:b + 1])
    return TranscriptWarning(kind, a, b, words[a].start, words[b].end, sample[:80], repeats)


def check_transcript(words: Sequence[TimedWord]) -> list[TranscriptWarning]:
    found = _latin_runs(words) + _repetitions(words)
    return sorted(found, key=lambda w: (w.start_idx, w.kind))


def _latin_runs(words: Sequence[TimedWord]) -> list[TranscriptWarning]:
    out, i = [], 0
    while i < len(words):
        if not _is_latin(words[i].text):
            i += 1
            continue
        j = i
        while j + 1 < len(words) and _is_latin(words[j + 1].text):
            j += 1
        if j - i + 1 >= MIN_LATIN_RUN:
            out.append(_flag("latin_run", words, i, j))
        i = j + 1
    return out


def _repetitions(words: Sequence[TimedWord]) -> list[TranscriptWarning]:
    keys = [_MARKS.sub("", w.text) for w in words]
    out, i = [], 0
    while i < len(keys):
        best = None                                   # (total words covered, phrase length, repeats)
        for n in range(1, MAX_PHRASE_WORDS + 1):
            if not keys[i]:
                break
            phrase = keys[i:i + n]
            if len(phrase) < n:
                break
            repeats = 1
            while keys[i + repeats * n:i + (repeats + 1) * n] == phrase:
                repeats += 1
            need = MIN_WORD_REPEATS if n == 1 else MIN_PHRASE_REPEATS
            if repeats >= need and (best is None or repeats * n > best[0]):
                best = (repeats * n, n, repeats)
        if best:
            covered, _n, repeats = best
            out.append(_flag("repetition", words, i, i + covered - 1, repeats))
            i += covered
        else:
            i += 1
    return out
