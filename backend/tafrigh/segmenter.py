"""
Stage 1 Segmentation module for Wahy-Transcriber.
Segments raw ASR transcripts using punctuation and Qur'an/Hadith/Matn detection boundaries.
Enforces 100% exact text reconstruction and non-splitting of atomic Qur'an ayat.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

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

        # Atomic rule: Quran ayat should not be split internally
        if span_type == "quran" and end > start:
            atomic_ranges.append((start, end))

    return boundaries, atomic_ranges


def segment_transcript(
    raw_text: str,
    asr_words: Optional[List[Dict[str, Any]]] = None,
    detection_spans: Optional[List[Dict[str, Any]]] = None,
    use_detection_boundaries: bool = True,
) -> List[TranscriptSegment]:
    """
    Segments raw_text into TranscriptSegment objects.
    Guarantees "".join(s.original_text for s in segments) == raw_text exactly.
    """
    if not raw_text:
        return []

    text_len = len(raw_text)
    candidate_cuts: Set[int] = set()

    # 1. Punctuation cuts
    candidate_cuts.update(find_punctuation_cut_points(raw_text))

    # 2. Detection boundary cuts
    atomic_ranges: List[Tuple[int, int]] = []
    if use_detection_boundaries and detection_spans:
        det_cuts, atomic_ranges = resolve_detection_boundaries(raw_text, detection_spans)
        candidate_cuts.update(det_cuts)

    # Filter out candidate cuts that fall strictly inside any atomic range
    filtered_cuts: List[int] = []
    for cut in sorted(candidate_cuts):
        if not (0 < cut < text_len):
            continue
        inside_atomic = False
        for a_start, a_end in atomic_ranges:
            if a_start < cut < a_end:
                inside_atomic = True
                break
        if not inside_atomic:
            filtered_cuts.append(cut)

    # Construct boundary slices
    all_boundaries = [0] + sorted(set(filtered_cuts)) + [text_len]
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
        )
        segments.append(segment)

    # Invariant assertion
    reconstructed = "".join(s.original_text for s in segments)
    assert reconstructed == raw_text, (
        f"Stage 1 segmentation violated exact text reconstruction!\n"
        f"Original len: {len(raw_text)}, Reconstructed len: {len(reconstructed)}"
    )

    return segments
