"""
Pilot-Set Tooling for Wahy-Transcriber AI Tafrigh Phase.
Provides:
- Stratified pilot passage selection across rare lecture phenomena.
- Bootstrap pre-labeling with blind splits and Laya held-out splits.
- Cohen's kappa Inter-Annotator Agreement (IAA) calculator.
- Synthetic valid-word substitution generator for Arabic ASR stress-testing.
"""

from __future__ import annotations

import json
import random
import re
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from .models import TextEdit, TranscriptSegment

# Realistic Arabic ASR phonetic/valid-word substitutions
ARABIC_VALID_WORD_PAIRS = [
    ("الحق", "الخلق"),
    ("العلم", "الحلم"),
    ("شرط", "شوط"),
    ("الوصية", "الوضعية"),
    ("الصلاة", "الصلات"),
    ("يثبت", "ينبت"),
    ("النية", "البنية"),
    ("يقبل", "يقتل"),
    ("سنة", "سنة"),
    ("حكم", "حلم"),
    ("واجب", "واهب"),
]


class GoldSubsegment(BaseModel):
    id: str
    text: str
    tag: str
    level: Optional[int] = None
    parent: Optional[str] = None


class GoldSegmentRecord(BaseModel):
    id: str
    text: str
    tag: Optional[str] = None
    level: Optional[int] = None
    parent: Optional[str] = None
    hasTypo: bool = False
    edits: List[Dict[str, Any]] = Field(default_factory=list)
    needsSplitting: bool = False
    splitPoints: List[int] = Field(default_factory=list)
    subsegments: List[GoldSubsegment] = Field(default_factory=list)
    commentKind: Optional[str] = None
    matnMatch: Optional[Dict[str, Any]] = None


def inject_synthetic_valid_word_typos(
    text: str,
    max_typos: int = 1,
    seed: Optional[int] = None,
) -> Tuple[str, List[TextEdit]]:
    """
    Injects realistic Arabic ASR valid-word substitutions into text.
    Returns:
        corrupted_text: text with substitution applied
        edits: ground-truth TextEdit objects to revert the corruption back to original text
    """
    if seed is not None:
        random.seed(seed)

    words = text.split()
    edits: List[TextEdit] = []
    corrupted_words = list(words)

    injected = 0
    for idx, w in enumerate(words):
        if injected >= max_typos:
            break
        for orig, sub in ARABIC_VALID_WORD_PAIRS:
            if orig == w:
                corrupted_words[idx] = sub
                injected += 1
                break

    corrupted_text = " ".join(corrupted_words)
    if corrupted_text == text:
        return text, []

    # Calculate edit spans in corrupted_text to restore original text
    c_words = corrupted_text.split()
    char_offset = 0
    for idx, cw in enumerate(c_words):
        orig_w = words[idx]
        if cw != orig_w:
            w_start = corrupted_text.index(cw, char_offset)
            w_end = w_start + len(cw)
            edits.append(
                TextEdit(
                    start=w_start,
                    end=w_end,
                    replacement=orig_w,
                    is_valid_word_substitution=True,
                    is_synthetic=True,
                    reason=f"Synthetic valid-word substitution: {cw} -> {orig_w}",
                )
            )
            char_offset = w_end

    return corrupted_text, edits


def select_stratified_pilot_passages(
    transcripts: List[Dict[str, Any]],
    target_sentence_count: int = 300,
) -> List[Dict[str, Any]]:
    """
    Selects 3-5 passages stratified across rare phenomena:
    - incidental comments (sneeze, question)
    - matn/sharh transitions
    - long run-on sentences (needs splitting)
    - suspected typos
    """
    selected: List[Dict[str, Any]] = []
    collected_count = 0

    for t in transcripts:
        if collected_count >= target_sentence_count:
            break
        sentences = t.get("segments", [])
        # Check phenomena presence
        has_cue = any("قال المصنف" in s.get("text", "") for s in sentences)
        has_long = any(len(s.get("text", "").split()) > 25 for s in sentences)
        has_comment = any("سؤال" in s.get("text", "") or "تنبيه" in s.get("text", "") for s in sentences)

        if has_cue or has_long or has_comment or len(selected) < 3:
            selected.append(t)
            collected_count += len(sentences)

    return selected


def prepare_annotation_batches(
    segments: List[TranscriptSegment],
    blind_ratio: float = 0.20,
    heldout_ratio: float = 0.15,
    overlap_count: int = 100,
    seed: int = 42,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Prepares annotation batches:
    - Pre-labeled batches for human correction
    - Blind subset (20% blank labels) to prevent anchoring
    - Dual-annotator overlap batch (for Cohen's kappa IAA)
    - Dedicated held-out split reserved strictly for future Laya evaluation.
    """
    random.seed(seed)
    shuffled = list(segments)
    random.shuffle(shuffled)

    n = len(shuffled)
    n_heldout = int(n * heldout_ratio)
    heldout = shuffled[:n_heldout]
    remaining = shuffled[n_heldout:]

    overlap = remaining[: min(len(remaining), overlap_count)]
    annotator_1: List[Dict[str, Any]] = []
    annotator_2: List[Dict[str, Any]] = []

    for seg in remaining:
        is_blind = random.random() < blind_ratio
        item = {
            "id": seg.id,
            "text": seg.original_text,
            "proposed_tag": None if is_blind else (seg.proposed_decision.tag.value if seg.proposed_decision else None),
            "is_blind": is_blind,
        }
        annotator_1.append(item)

    for seg in overlap:
        annotator_2.append({
            "id": seg.id,
            "text": seg.original_text,
            "proposed_tag": None,  # Always blind for second annotator
            "is_blind": True,
        })

    heldout_records = [
        {"id": s.id, "text": s.original_text, "source_pos": s.source_pos.model_dump()}
        for s in heldout
    ]

    return {
        "annotator_1": annotator_1,
        "annotator_2": annotator_2,
        "heldout_laya": heldout_records,
    }


def compute_iaa(
    labels_ann1: List[str],
    labels_ann2: List[str],
) -> float:
    """
    Computes Cohen's kappa coefficient between two annotator label lists.
    """
    if len(labels_ann1) != len(labels_ann2) or not labels_ann1:
        return 0.0

    n = len(labels_ann1)
    categories = sorted(set(labels_ann1).union(set(labels_ann2)))

    # Observed agreement
    agree_count = sum(1 for a, b in zip(labels_ann1, labels_ann2) if a == b)
    p_o = agree_count / n

    # Expected agreement by chance
    p_e = 0.0
    for cat in categories:
        count_1 = sum(1 for a in labels_ann1 if a == cat)
        count_2 = sum(1 for b in labels_ann2 if b == cat)
        p_e += (count_1 / n) * (count_2 / n)

    if math_isclose(p_e, 1.0):
        return 1.0

    kappa = (p_o - p_e) / (1.0 - p_e)
    return round(kappa, 4)


def math_isclose(a: float, b: float, rel_tol: float = 1e-9) -> bool:
    return abs(a - b) <= rel_tol
