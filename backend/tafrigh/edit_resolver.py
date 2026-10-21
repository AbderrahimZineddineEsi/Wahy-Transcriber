"""
Turns model-proposed typo corrections into verified character edits.

Models address words by index ([3] word) and must quote the words they replace. An edit is applied only when
the quoted words really are at those indices, and never inside a detected quotation (ayah / hadith / dhikr):
those are displayed from the corpus text instead. Character offsets from a model are never trusted on their own;
a real run showed Gemini aiming at «تقدربكم» with offsets that landed on «أولادكم ب…» and corrupting an ayah.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .models import TextEdit, TranscriptSegment

_TASHKEEL = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_EDGE_PUNCT = "،,.؛;:؟?!«»\"'()[]﴾﴿"
MAX_REPLACEMENT_WORDS_DELTA = 2


def _norm(text: str) -> str:
    t = _TASHKEEL.sub("", text or "")
    t = re.sub("[إأآٱ]", "ا", t).replace("ى", "ي").replace("ة", "ه")
    return " ".join(w.strip(_EDGE_PUNCT) for w in t.split() if w.strip(_EDGE_PUNCT))


def _get(edit: Any, *names: str) -> Any:
    for n in names:
        v = edit.get(n) if isinstance(edit, dict) else getattr(edit, n, None)
        if v is not None:
            return v
    return None


def resolve_model_edits(
    segment: TranscriptSegment,
    raw_edits: List[Any],
    protected: Optional[List[Tuple[int, int]]] = None,
) -> Tuple[List[TextEdit], List[Dict[str, Any]]]:
    """Returns (accepted char-level edits relative to segment.original_text, rejected edits with a reason).
    `protected` are char ranges (relative to the segment) that must not be edited."""
    protected = protected or []
    tokens = segment.tokens
    text = segment.original_text
    accepted: List[TextEdit] = []
    rejected: List[Dict[str, Any]] = []

    for e in raw_edits or []:
        replacement = str(_get(e, "replacement") or "").strip()
        original = _get(e, "original", "original_text")
        reason = _get(e, "reason")
        w_start, w_end = _get(e, "wordStart", "word_start"), _get(e, "wordEnd", "word_end")
        record = {"original": original, "replacement": replacement, "reason": reason}

        if w_start is not None:
            try:
                w_start, w_end = int(w_start), int(w_end if w_end is not None else w_start)
            except (TypeError, ValueError):
                rejected.append({**record, "why": "bad_word_index"})
                continue
            if not (0 <= w_start <= w_end < len(tokens)):
                rejected.append({**record, "why": "word_index_out_of_range"})
                continue
            first, last = tokens[w_start], tokens[w_end]
            start, end = first.char_start, last.char_end
            # keep punctuation glued to the edge words (the model is asked about words, not commas)
            while start < end and text[start] in _EDGE_PUNCT:
                start += 1
            while end > start and text[end - 1] in _EDGE_PUNCT:
                end -= 1
        else:
            start, end = _get(e, "start"), _get(e, "end")
            if start is None or end is None or original is None:
                rejected.append({**record, "why": "char_offsets_without_quoted_original"})
                continue
            start, end = int(start), int(end)

        span = text[start:end] if 0 <= start <= end <= len(text) else None
        record.update({"span": span, "start": start, "end": end})
        if span is None:
            rejected.append({**record, "why": "out_of_bounds"})
            continue
        if original is None or _norm(str(original)) != _norm(span):
            rejected.append({**record, "why": "quoted_original_does_not_match_text"})
            continue
        if not replacement or _norm(replacement) == _norm(span):
            rejected.append({**record, "why": "no_change"})
            continue
        if abs(len(replacement.split()) - len(span.split())) > MAX_REPLACEMENT_WORDS_DELTA:
            rejected.append({**record, "why": "replacement_too_different"})
            continue
        if any(start < p_end and p_start < end for p_start, p_end in protected):
            rejected.append({**record, "why": "inside_detected_quotation"})
            continue
        if any(start < a.end and a.start < end for a in accepted):
            rejected.append({**record, "why": "overlaps_another_edit"})
            continue
        accepted.append(TextEdit(start=start, end=end, replacement=replacement, reason=reason))
    return accepted, rejected
