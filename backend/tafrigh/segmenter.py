"""
Stage 1 Segmentation module for Wahy-Transcriber.
Segments raw ASR transcripts using punctuation and Qur'an/Hadith/Matn detection boundaries.
Enforces 100% exact text reconstruction and non-splitting of atomic Qur'an ayat.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel

from .models import SourcePosition, TranscriptSegment, tokenize_words

# Standard Arabic and Latin sentence terminators
PUNCTUATION_SPLIT_RE = re.compile(r"([.؟!؛\n]+)")

PRIORITY_MAP = {
    "matn": 4,
    "quran": 3,
    "hadith": 2,
    "punctuation": 1,
}


def find_punctuation_cut_points(raw_text: str) -> List[int]:
    """
    Finds cut points immediately after sentence-ending punctuation marks
    and any following whitespace.
    """
    cut_points: List[int] = []
    text_len = len(raw_text)

    for match in PUNCTUATION_SPLIT_RE.finditer(raw_text):
        end_idx = match.end()
        # Include any immediate trailing whitespace so the next sentence starts clean
        while end_idx < text_len and raw_text[end_idx] in (" ", "\t"):
            end_idx += 1
        if 0 < end_idx < text_len:
            cut_points.append(end_idx)

    return cut_points


def resolve_detection_boundaries(
    raw_text: str,
    detection_spans: List[Dict[str, Any]],
) -> Tuple[List[int], List[Tuple[int, int]]]:
    """
    Extracts start and end boundaries of detection spans, resolving overlaps by priority:
    Matn > Quran > Hadith.
    Returns:
      - candidate cut points from detection boundaries
      - atomic ranges (e.g. Qur'an ayat) where internal splitting is prohibited.
    """
    if not detection_spans:
        return [], []

    # Sort spans by priority descending, then length descending
    sorted_spans = sorted(
        detection_spans,
        key=lambda s: (
            PRIORITY_MAP.get(str(s.get("type", "")).lower(), 0),
            (int(s.get("end", 0)) - int(s.get("start", 0))),
        ),
        reverse=True,
    )

    boundaries: List[int] = []
    atomic_ranges: List[Tuple[int, int]] = []
    text_len = len(raw_text)

    for s in sorted_spans:
        start = int(s.get("start", 0))
        end = int(s.get("end", 0))
        span_type = str(s.get("type", "")).lower()

        if 0 < start < text_len:
            boundaries.append(start)
        if 0 < end < text_len:
            boundaries.append(end)

        # Atomic rule: a detected quotation (ayah, hadith, dhikr) is never cut in the middle
        if span_type in ("quran", "hadith", "adhkar", "other") and end > start:
            atomic_ranges.append((start, end))

    return boundaries, atomic_ranges


class SegmentationConfig(BaseModel):
    """How the transcript is cut into sentences. ASR output (Whisper) often has no punctuation at all, so pauses
    between words and a length cap matter as much as punctuation."""

    use_punctuation: bool = True
    pause_sec: float = 0.7          # a silence at least this long between two words ends a sentence
    min_words: int = 2              # pause cuts leaving fewer words are dropped (2: short headings like «باب الطهارة» survive)
    max_words: int = 40             # longer sentences are cut again at their longest internal pause


def _word_spans(raw_text: str, asr_words: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """ASR words whose char offsets really point into raw_text (anything else is ignored, never trusted)."""
    out: List[Dict[str, Any]] = []
    for w in asr_words or []:
        try:
            cs, ce = int(w.get("char_start", -1)), int(w.get("char_end", -1))
        except (TypeError, ValueError):
            continue
        if 0 <= cs < ce <= len(raw_text) and raw_text[cs:ce].strip() and (not out or cs >= out[-1]["ce"]):
            out.append({"cs": cs, "ce": ce, "start": w.get("start"), "end": w.get("end")})
    return out


def segment_transcript(
    raw_text: str,
    asr_words: Optional[List[Dict[str, Any]]] = None,
    detection_spans: Optional[List[Dict[str, Any]]] = None,
    use_detection_boundaries: bool = True,
    config: Optional[SegmentationConfig] = None,
) -> List[TranscriptSegment]:
    """
    Segments raw_text into TranscriptSegment objects.
    Guarantees "".join(s.original_text for s in segments) == raw_text exactly.
    Each segment records why it ends (cut_reason): punctuation | pause | length | detection | end.
    """
    if not raw_text:
        return []

    cfg = config or SegmentationConfig()
    text_len = len(raw_text)
    reasons: Dict[int, str] = {}

    # 1. Punctuation cuts
    if cfg.use_punctuation:
        for c in find_punctuation_cut_points(raw_text):
            reasons.setdefault(c, "punctuation")

    # 2. Detection boundary cuts (atomic Quran ranges always protected)
    atomic_ranges: List[Tuple[int, int]] = []
    if detection_spans:
        det_cuts, atomic_ranges = resolve_detection_boundaries(raw_text, detection_spans)
        if use_detection_boundaries:
            for c in det_cuts:
                reasons.setdefault(c, "detection")

    # 3. Pause cuts from word timestamps: the cut sits right before the next word
    words = _word_spans(raw_text, asr_words)
    gap_before: Dict[int, float] = {}
    for prev, nxt in zip(words, words[1:]):
        try:
            gap = float(nxt["start"]) - float(prev["end"])
        except (TypeError, ValueError):
            continue
        gap_before[nxt["cs"]] = gap
        if gap >= cfg.pause_sec:
            reasons.setdefault(nxt["cs"], "pause")

    def inside_atomic(cut: int) -> bool:
        return any(a < cut < b for a, b in atomic_ranges)

    cuts = sorted(c for c in reasons if 0 < c < text_len and not inside_atomic(c))

    def n_words(lo: int, hi: int) -> int:
        return len(raw_text[lo:hi].split())

    # 4. Drop pause cuts that would create fragments shorter than min_words (punctuation cuts are kept)
    changed = True
    while changed:
        changed = False
        bounds = [0] + cuts + [text_len]
        for k in range(1, len(bounds) - 1):
            c = bounds[k]
            if reasons.get(c) != "pause":
                continue
            if n_words(bounds[k - 1], c) < cfg.min_words or n_words(c, bounds[k + 1]) < cfg.min_words:
                cuts.remove(c)
                changed = True
                break

    # 5. Cap sentence length: cut long ones at their longest internal pause (or the middle word without timings)
    def split_long(lo: int, hi: int) -> List[int]:
        if cfg.max_words <= 0 or n_words(lo, hi) <= cfg.max_words:
            return []
        starts = [lo + m.start() for m in re.finditer(r"\S+", raw_text[lo:hi])][1:]
        ok = [p for p in starts if n_words(lo, p) >= cfg.min_words and n_words(p, hi) >= cfg.min_words and not inside_atomic(p)]
        if not ok:
            return []
        mid = n_words(lo, hi) / 2

        def after_comma(p: int) -> bool:
            return raw_text[:p].rstrip()[-1:] in ("،", ",", "؛", ";", ":")

        # prefer a clause boundary (comma), then the longest pause, then the middle
        best = max(ok, key=lambda p: (after_comma(p), gap_before.get(p, 0.0), -abs(n_words(lo, p) - mid)))
        reasons[best] = "comma" if after_comma(best) else "length"
        return split_long(lo, best) + [best] + split_long(best, hi)

    bounds = [0] + cuts + [text_len]
    extra: List[int] = []
    for lo, hi in zip(bounds, bounds[1:]):
        extra.extend(split_long(lo, hi))
    filtered_cuts = sorted(set(cuts) | set(extra))

    # Construct boundary slices. Two cuts can sit a space apart (a quote ending right before a punctuation cut):
    # a whitespace-only slice is not a sentence, so it is merged into the next one.
    all_boundaries = [0] + sorted(set(filtered_cuts)) + [text_len]
    all_boundaries = [c for k, c in enumerate(all_boundaries)
                      if k == 0 or k == len(all_boundaries) - 1 or raw_text[all_boundaries[k - 1]:c].strip()]
    segments: List[TranscriptSegment] = []

    words = asr_words or []

    for i in range(len(all_boundaries) - 1):
        c_start = all_boundaries[i]
        c_end = all_boundaries[i + 1]
        seg_text = raw_text[c_start:c_end]

        # Intersect with detection spans
        seg_signals: List[Dict[str, Any]] = []
        if detection_spans:
            for d in detection_spans:
                d_start = int(d.get("start", 0))
                d_end = int(d.get("end", 0))
                # Check overlap
                if max(c_start, d_start) < min(c_end, d_end):
                    seg_signals.append(d)

        # Estimate timestamps from asr_words if available
        seg_start_time: Optional[float] = None
        seg_end_time: Optional[float] = None
        mapping_reliable = True

        if words:
            matching_words = [
                w
                for w in words
                if int(w.get("char_start", -1)) >= c_start and int(w.get("char_end", -1)) <= c_end
            ]
            if matching_words:
                seg_start_time = float(matching_words[0].get("start", 0.0))
                seg_end_time = float(matching_words[-1].get("end", 0.0))
            else:
                mapping_reliable = False

        pos = SourcePosition(
            char_start=c_start,
            char_end=c_end,
            start_time=seg_start_time,
            end_time=seg_end_time,
            mapping_reliable=mapping_reliable,
        )

        seg_id = f"seg_{i+1:04d}"
        segment = TranscriptSegment(
            id=seg_id,
            original_text=seg_text,
            source_pos=pos,
            detection_signals=seg_signals,
            cut_reason=reasons.get(c_end, "end"),
        )
        segments.append(segment)

    # Invariant assertion
    reconstructed = "".join(s.original_text for s in segments)
    assert reconstructed == raw_text, (
        f"Stage 1 segmentation violated exact text reconstruction!\n"
        f"Original len: {len(raw_text)}, Reconstructed len: {len(reconstructed)}"
    )

    return segments
