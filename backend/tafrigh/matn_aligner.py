"""
Stage 2 Matn Alignment module for Wahy-Transcriber.
Implements sequential pointer fuzzy matn alignment against canonical matn texts.
Distinguishes standalone matn readings from short embedded quotes in sharh.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

from .models import MatnMatchEvidence, TranscriptSegment

try:
    import rapidfuzz
    from rapidfuzz import fuzz
    RAPIDFUZZ_AVAILABLE = True
except ImportError:
    import difflib
    RAPIDFUZZ_AVAILABLE = False


TASHKEEL_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
READING_CUES = [
    "قال المصنف رحمه الله",
    "قال المصنف",
    "قال رحمه الله",
    "قال المؤلف رحمه الله",
    "قال الشيخ",
    "قال الشارح",
]


def normalize_arabic_for_alignment(text: str) -> Tuple[str, List[int]]:
    """
    Strips tashkeel/diacritics and tatweel, normalizes hamza and taa marbuta/alif maqsura.
    Returns:
        norm_text: The normalized string
        orig_indices: List mapping each character index in norm_text back to its index in text
    """
    norm_chars: List[str] = []
    orig_indices: List[int] = []

    for idx, ch in enumerate(text):
        if TASHKEEL_RE.match(ch):
            continue

        n_ch = ch
        if ch in ("أ", "إ", "آ", "ٱ"):
            n_ch = "ا"
        elif ch == "ة":
            n_ch = "ه"
        elif ch == "ى":
            n_ch = "ي"
        elif ch in ("ؤ", "ئ", "ء"):
            n_ch = "ا"

        norm_chars.append(n_ch)
        orig_indices.append(idx)

    return "".join(norm_chars), orig_indices


def compute_fuzzy_similarity(spoken_norm: str, line_norm: str) -> float:
    """Computes similarity score in [0.0, 1.0] between normalized spoken text and matn line."""
    if not spoken_norm or not line_norm:
        return 0.0

    if RAPIDFUZZ_AVAILABLE:
        score = fuzz.token_set_ratio(spoken_norm, line_norm) / 100.0
    else:
        tokens1 = set(spoken_norm.split())
        tokens2 = set(line_norm.split())
        if not tokens1 or not tokens2:
            return 0.0
        intersection = tokens1 & tokens2
        diff1to2 = tokens1 - tokens2
        diff2to1 = tokens2 - tokens1
        sorted_inter = " ".join(sorted(intersection))
        sorted_1to2 = " ".join(sorted(intersection | diff1to2))
        sorted_2to1 = " ".join(sorted(intersection | diff2to1))
        r1 = difflib.SequenceMatcher(None, sorted_inter, sorted_1to2).ratio()
        r2 = difflib.SequenceMatcher(None, sorted_inter, sorted_2to1).ratio()
        r3 = difflib.SequenceMatcher(None, sorted_1to2, sorted_2to1).ratio()
        score = max(r1, r2, r3)

    return round(score, 4)


class MatnConfig(BaseModel):
    mode: Literal["upload", "builtin", "no_matn"] = "no_matn"
    matn_id: Optional[str] = None
    raw_matn_text: Optional[str] = None
    matn_dir: Optional[str] = None
    max_lookahead_lines: int = 15
    similarity_threshold: float = 0.72
    lambda_skip: float = 0.05
    lambda_repeat: float = 0.02


class SequentialMatnAligner:
    """
    Maintains a sequential pointer tracking the speaker's progress through a matn.
    Distinguishes in-order progression, repeated lines, skipped lines, and short quotes.
    """

    def __init__(self, config: MatnConfig) -> None:
        self.config = config
        self.pointer_line_idx: int = 0
        self.raw_lines: List[str] = []
        self.norm_lines: List[str] = []
        self._load_matn()

    def _load_matn(self) -> None:
        if self.config.mode == "no_matn":
            return

        text = ""
        if self.config.mode == "upload" and self.config.raw_matn_text:
            text = self.config.raw_matn_text
        elif self.config.mode == "builtin" and self.config.matn_id:
            search_dirs = [
                Path(self.config.matn_dir) if self.config.matn_dir else None,
                Path("data/matns"),
                Path("../data/matns"),
            ]
            for d in search_dirs:
                if d and d.exists():
                    target_file = d / f"{self.config.matn_id}.txt"
                    if target_file.exists():
                        text = target_file.read_text(encoding="utf-8")
                        break

        if text:
            # Split into non-empty stripped lines
            self.raw_lines = [line.strip() for line in text.splitlines() if line.strip()]
            self.norm_lines = [normalize_arabic_for_alignment(l)[0] for l in self.raw_lines]

    def reset_pointer(self, position: int = 0) -> None:
        self.pointer_line_idx = position

    def align_segment(self, segment: TranscriptSegment) -> MatnMatchEvidence:
        """
        Aligns a single segment against the matn using the sequential pointer.
        Attaches evidence to segment and updates pointer position when appropriate.
        """
        if self.config.mode == "no_matn" or not self.raw_lines:
            evidence = MatnMatchEvidence()
            segment.matn_evidence = evidence
            return evidence

        spoken_text = segment.original_text.strip()
        spoken_norm, _ = normalize_arabic_for_alignment(spoken_text)
        spoken_words = spoken_norm.split()
        word_count = len(spoken_words)

        if word_count == 0:
            evidence = MatnMatchEvidence()
            segment.matn_evidence = evidence
            return evidence

        total_lines = len(self.raw_lines)
        min_line = max(0, self.pointer_line_idx - 3)
        max_line = min(total_lines, self.pointer_line_idx + self.config.max_lookahead_lines + 1)

        best_score = -1.0
        best_sim = 0.0
        best_coverage = 0.0
        best_line_idx = -1

        for line_idx in range(min_line, max_line):
            canonical_line_norm = self.norm_lines[line_idx]
            sim = compute_fuzzy_similarity(spoken_norm, canonical_line_norm)

            line_words = set(canonical_line_norm.split())
            matched_words = set(spoken_words).intersection(line_words)
            coverage = len(matched_words) / max(1, len(line_words))

            # Penalty based on spatial prior
            penalty = 0.0
            if line_idx in (self.pointer_line_idx, self.pointer_line_idx + 1):
                penalty = 0.0
            elif line_idx < self.pointer_line_idx:
                # Repeated lines
                penalty = self.config.lambda_repeat * (self.pointer_line_idx - line_idx)
            else:
                # Skipped lines
                penalty = self.config.lambda_skip * (line_idx - (self.pointer_line_idx + 1))

            score = sim - penalty

            if score > best_score:
                best_score = score
                best_sim = sim
                best_coverage = coverage
                best_line_idx = line_idx

        # Evaluate if match qualifies
        if best_sim >= self.config.similarity_threshold and best_line_idx >= 0:
            canonical_text = self.raw_lines[best_line_idx]
            canonical_norm = self.norm_lines[best_line_idx]

            # Detect wording / edition variants: high similarity, but words differ
            has_variant = (spoken_norm != canonical_norm) and (best_sim >= self.config.similarity_threshold)

            # Check if starts at segment boundary or has reading cue
            starts_at_boundary = True
            for cue in READING_CUES:
                if cue in spoken_text:
                    starts_at_boundary = True
                    break

            # Heuristic for standalone reading vs. embedded quote inside sharh:
            # Standalone if full clause (coverage >= 0.65 or word_count >= 6) and starts at boundary
            # False if short quote (coverage < 0.50 and word_count < 6)
            is_standalone = False
            if (best_coverage >= 0.65 or word_count >= 6) and starts_at_boundary:
                is_standalone = True
            elif best_coverage < 0.50 and word_count < 6:
                is_standalone = False

            pointer_delta = best_line_idx - self.pointer_line_idx

            evidence = MatnMatchEvidence(
                matched_line_indices=[best_line_idx],
                coverage_ratio=round(best_coverage, 3),
                similarity_score=round(best_sim, 3),
                starts_at_segment_boundary=starts_at_boundary,
                word_count=word_count,
                pointer_delta=pointer_delta,
                canonical_text=canonical_text,
                has_variant_wording=has_variant,
                is_candidate_standalone_matn=is_standalone,
            )

            # Advance pointer if standalone or high-confidence sequential progress
            if is_standalone or (best_sim >= 0.85 and best_line_idx >= self.pointer_line_idx):
                self.pointer_line_idx = best_line_idx + 1
        else:
            evidence = MatnMatchEvidence()

        segment.matn_evidence = evidence
        return evidence
