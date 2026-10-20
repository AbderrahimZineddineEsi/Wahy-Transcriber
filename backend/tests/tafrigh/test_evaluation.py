"""
Unit tests for Deliverable 8: Pilot-Set Tooling and Evaluation Harness.
"""

import json
from pathlib import Path
import pytest

from backend.tafrigh.evaluation import evaluate_run_against_gold
from backend.tafrigh.pilot_tools import (
    compute_iaa,
    inject_synthetic_valid_word_typos,
)


def test_compute_iaa_cohens_kappa():
    # Perfect agreement
    labels_a = ["paragraph", "heading", "list_intro", "comment"]
    labels_b = ["paragraph", "heading", "list_intro", "comment"]
    kappa_perfect = compute_iaa(labels_a, labels_b)
    assert kappa_perfect == 1.0

    # Disagreement
    labels_c = ["paragraph", "heading", "list_intro", "paragraph"]
    labels_d = ["paragraph", "paragraph", "list_intro", "comment"]
    kappa_partial = compute_iaa(labels_c, labels_d)
    assert 0.0 < kappa_partial < 1.0


def test_synthetic_valid_word_injection():
    text = "هذا هو الحق المبين وعليه واجب البيان"
    corrupted, edits = inject_synthetic_valid_word_typos(text, max_typos=2, seed=42)

    # "الحق" was substituted with "الخلق" or "واجب" with "واهب"
    assert len(edits) > 0
    assert edits[0].is_synthetic is True
    assert edits[0].is_valid_word_substitution is True

    # Applying replacement should recover original word
    e0 = edits[0]
    recovered = corrupted[:e0.start] + e0.replacement + corrupted[e0.end:]
    assert e0.replacement in recovered


def test_evaluate_run_against_gold_metrics(tmp_path: Path):
    gold_file = tmp_path / "gold.jsonl"
    pred_file = tmp_path / "results.jsonl"

    gold_data = [
        {
            "id": "s1",
            "text": "كتاب الصلاة",
            "tag": "heading",
            "level": 1,
            "parent": None,
            "hasTypo": False,
            "edits": [],
            "needsSplitting": False,
        },
        {
            "id": "s2",
            "text": "هذا شرح بسيط للمسألة",
            "tag": "paragraph",
            "level": None,
            "parent": None,
            "hasTypo": True,
            "edits": [{"start": 0, "end": 3, "replacement": "هذا", "is_synthetic": False}],
            "needsSplitting": False,
        },
        {
            "id": "s3",
            "text": "هذا هو الخلق المبين",
            "tag": "paragraph",
            "level": None,
            "parent": None,
            "hasTypo": True,
            "edits": [{"start": 7, "end": 12, "replacement": "الحق", "is_synthetic": True, "is_valid_word_sub": True}],
            "needsSplitting": False,
        },
    ]

    pred_data = [
        {
            "segment_id": "s1",
            "original_text": "كتاب الصلاة",
            "final_decision": {"tag": "heading", "level": 1, "parent_id": None},
            "hasTypo": False,
        },
        {
            "segment_id": "s2",
            "original_text": "هذا شرح بسيط للمسألة",
            "final_decision": {"tag": "paragraph"},
            "hasTypo": True,
        },
        {
            "segment_id": "s3",
            "original_text": "هذا هو الخلق المبين",
            "final_decision": {"tag": "paragraph"},
            "hasTypo": False,  # Model missed synthetic typo
        },
    ]

    with open(gold_file, "w", encoding="utf-8") as f:
        for item in gold_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    with open(pred_file, "w", encoding="utf-8") as f:
        for item in pred_data:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    report = evaluate_run_against_gold(str(pred_file), str(gold_file))

    assert report.num_gold_segments == 3
    assert report.num_pred_segments == 3
    assert report.exact_text_preservation_rate == 1.0

    # Heading metrics
    assert report.per_class_metrics["heading"].f1 == 1.0
    assert report.heading_level_accuracy == 1.0

    # Real typo recall: detected s2 -> 1.0
    assert report.real_typo_recall == 1.0

    # Synthetic valid-word typo recall: missed s3 -> 0.0
    assert report.synthetic_valid_word_typo_recall == 0.0
