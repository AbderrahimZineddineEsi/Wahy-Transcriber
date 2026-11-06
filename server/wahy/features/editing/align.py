"""Word timings across a text edit, and moving word positions after one (ROADMAP phase 16).

`retime(old, new_texts)` is the old editor's alignAndRetimeWords (js/editor.js), moved as it was: a longest
common
subsequence (LCS) of the old and new words decides which words stayed. A word that stayed keeps its own start
and
end; a run of changed words takes the times of the run it replaced (one for one when the lengths match, else
spread
evenly over the replaced run's time). `replace_span` is replaceWordRange's timing part: only the edited span
is
aligned, so an edit in a 2-hour lecture stays cheap.

    old = [W("قال", 0.0, 0.3), W("الله", 0.4, 0.7), W("تعالي", 0.8, 1.1)]
    retime(old, ["قال", "الله", "تعالى"])   →  the third word is new, and takes 0.8-1.1, the time of «تعالي»

`Shift` moves positions after an edit: word positions (wordStartIdx...), engine token positions (segments,
gaps,
which count tokens, and a word can hold 0, 1 or more tokens) and characters (charStart...).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from wahy.features.lectures.parsing import TimedWord

# engine/src/v3.js WORD_TOKEN_RE and the marks its normaliser drops (a token of marks only is not a token)
TOKEN_RE = re.compile("[ؐ-ؚء-ٰٟٱ-ۓەۖ-ۭ]+")
ONLY_MARKS_RE = re.compile("^[ؐ-ًؚ-ٰٟۖ-ۭ]+$")


def token_count(word: str) -> int:
    """How many engine tokens a word holds (engine/src/captions.ts tokenWordMap counts the same)."""
    return sum(1 for m in TOKEN_RE.finditer(word.strip()) if not ONLY_MARKS_RE.match(m.group(0)))


def _r2(x: float) -> float:
    return float(f"{x:.2f}")


def retime(old: Sequence[TimedWord], new: Sequence[str]) -> list[TimedWord]:
    """The new words with times taken from the old ones (the module docstring)."""
    n, m = len(old), len(new)
    if m == 0:
        return []
    if n == 0:
        return [TimedWord(w, _r2(i * 0.4), _r2((i + 1) * 0.4)) for i, w in enumerate(new)]
    # LCS table, then walk back for the matched pairs
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n):
        o = old[i].text
        row, nxt = dp[i], dp[i + 1]
        for j in range(m):
            nxt[j + 1] = row[j] + 1 if o == new[j] else max(nxt[j], row[j + 1])
    pairs: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        if old[i - 1].text == new[j - 1]:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    pairs.reverse()

    anchors = [(-1, -1), *pairs, (n, m)]
    out: list[TimedWord | None] = [None] * m
    for k in range(len(anchors) - 1):
        o0, n0 = anchors[k]
        o1, n1 = anchors[k + 1]
        if n1 < m and k + 1 < len(anchors) - 1:
            out[n1] = TimedWord(new[n1], float(old[o1].start), float(old[o1].end))
        new_gap, old_gap = n1 - n0 - 1, o1 - o0 - 1
        if new_gap <= 0:
            continue
        if old_gap == new_gap:
            for g in range(new_gap):
                out[n0 + 1 + g] = TimedWord(
                    new[n0 + 1 + g], float(old[o0 + 1 + g].start), float(old[o0 + 1 + g].end)
                )
        else:
            # new words live inside the time the replaced words occupied (never before the span or after it)
            t0 = float(old[o0].end) if o0 >= 0 else float(old[0].start)
            t1 = float(old[o1].start) if o1 < n else float(old[-1].end)
            span = max(0.08 * new_gap, t1 - t0)
            step = span / new_gap
            for g in range(new_gap):
                s = _r2(t0 + g * step)
                e = _r2(max(s + 0.04, t0 + (g + 1) * step))
                out[n0 + 1 + g] = TimedWord(new[n0 + 1 + g], s, e)
    result: list[TimedWord] = []
    for idx in range(m):
        w = out[idx]
        if w is None:
            prev_end = result[-1].end if result else 0.0
            w = TimedWord(new[idx], _r2(prev_end), _r2(prev_end + 0.35))
        result.append(w)
    return result


def replace_span(words: Sequence[TimedWord], start: int, end: int, new: Sequence[str]) -> list[TimedWord]:
    """The timed words that replace `words[start..end]` (inclusive; `end = start - 1` inserts before
    `start`)."""
    old = list(words[start : end + 1])
    if not new:
        return []
    if old:
        return retime(old, new)
    # pure insertion: spread the new words over the silence between the neighbours
    t0 = float(words[start - 1].end) if start > 0 else 0.0
    t1 = float(words[start].start) if start < len(words) else t0 + 0.35 * len(new)
    step = max(0.04, (t1 - t0) / len(new))
    return [TimedWord(w, _r2(t0 + k * step), _r2(t0 + (k + 1) * step)) for k, w in enumerate(new)]


@dataclass(frozen=True)
class Shift:
    """Positions before an edit → positions after it, for an edit that replaced words `start..end` (inclusive)
    with `added` words. Tokens and characters are counted the way the engine reads the transcript (each word
    trimmed, joined with single spaces)."""

    start: int
    end: int
    added: int
    tok_start: int  # first token of the edited span
    tok_old: int  # tokens in the replaced words
    tok_new: int  # tokens in the new words
    char_end_old: int  # first character after the replaced words, before the edit
    char_delta: int

    @classmethod
    def of(cls, words: Sequence[str], start: int, end: int, new: Sequence[str]) -> Shift:
        before = list(words[:start])
        old = list(words[start : end + 1])
        joined = lambda ws: sum(len(w.strip()) + 1 for w in ws)  # noqa: E731 - each word plus its space
        return cls(
            start=start,
            end=end,
            added=len(new),
            tok_start=sum(token_count(w) for w in before),
            tok_old=sum(token_count(w) for w in old),
            tok_new=sum(token_count(w) for w in new),
            char_end_old=joined(before) + joined(old),
            char_delta=joined(new) - joined(old),
        )

    @property
    def delta(self) -> int:
        return self.added - (self.end - self.start + 1)

    def word(self, i: int) -> int:
        """A word position (first or last word of something)."""
        if i < self.start:
            return i
        if i > self.end:
            return i + self.delta
        return self.start + min(i - self.start, max(0, self.added - 1))

    def word_after(self, i: int) -> int:
        """A word position used as an anchor ("the caption starting at word i"): inside the span → -1."""
        if i < self.start:
            return i
        if i > self.end:
            return i + self.delta
        return -1

    def tok(self, t: int) -> int:
        """A token position that starts something."""
        if t < self.tok_start:
            return t
        if t >= self.tok_start + self.tok_old:
            return t + self.tok_new - self.tok_old
        return self.tok_start + min(t - self.tok_start, max(0, self.tok_new - 1))

    def tok_end(self, t: int) -> int:
        """A token position that ends something (exclusive)."""
        if t <= self.tok_start:
            return t
        if t > self.tok_start + self.tok_old:
            return t + self.tok_new - self.tok_old
        return self.tok_start + min(t - self.tok_start, self.tok_new)

    def char(self, c: int) -> int:
        return c + self.char_delta if c >= self.char_end_old else c

    def finding(self, data: dict[str, Any]) -> dict[str, Any]:
        """A finding's data with every position moved (a copy)."""
        d = dict(data)
        for k in ("wordStartIdx", "wordEndIdx"):
            if isinstance(d.get(k), int):
                d[k] = self.word(d[k])
        if isinstance(d.get("tStart"), int):
            d["tStart"] = self.tok(d["tStart"])
        if isinstance(d.get("tEnd"), int):
            d["tEnd"] = self.tok_end(d["tEnd"])
        for k in ("segments", "commentaryGaps"):
            if isinstance(d.get(k), list):
                d[k] = [
                    [self.tok(r[0]), self.tok_end(r[1])] for r in d[k] if isinstance(r, list) and len(r) == 2
                ]
        if isinstance(d.get("embeddedQuran"), list):
            d["embeddedQuran"] = [
                {**r, "tStart": self.tok(r["tStart"]), "tEnd": self.tok_end(r["tEnd"])}
                for r in d["embeddedQuran"]
                if isinstance(r, dict) and "tStart" in r
            ]
        for k in ("charStart", "charEnd", "startIndex", "endIndex"):
            if isinstance(d.get(k), int):
                d[k] = self.char(d[k])
        return d
