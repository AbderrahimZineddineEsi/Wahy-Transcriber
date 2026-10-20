"""
Evaluation Harness for Wahy-Transcriber AI Tafrigh Phase.
Evaluates model pipeline results against gold annotations (.jsonl).
Computes per-class P/R/F1, heading tree metrics, split accuracy, exact text preservation,
and separated real vs. synthetic valid-word typo recall.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, Field

ALL_STRUCTURAL_TAGS = [
    "paragraph",
    "list_intro",
    "list_item",
    "heading",
    "matn_section",
    "continuation",
    "comment",
]


class ClassMetrics(BaseModel):
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0
    support: int = 0


class EvaluationReport(BaseModel):
    num_gold_segments: int = 0
    num_pred_segments: int = 0
    per_class_metrics: Dict[str, ClassMetrics] = Field(default_factory=dict)
    macro_f1_non_paragraph: float = 0.0
    accuracy_warning: str = (
        "WARNING: Overall accuracy is skewed because 'paragraph' dominates (>70%). "
        "Use macro_f1_non_paragraph and per-class F1 for ranking models."
    )
    heading_level_accuracy: float = 0.0
    heading_parent_accuracy: float = 0.0
    split_precision: float = 0.0
    split_recall: float = 0.0
    split_exact_match: float = 0.0
    split_tolerance_1_match: float = 0.0
    exact_text_preservation_rate: float = 1.0
    real_typo_recall: float = 0.0
    real_typo_precision: float = 0.0
    synthetic_valid_word_typo_recall: float = 0.0
    non_typo_wording_preservation_rate: float = 1.0


def compute_prf1(tp: int, fp: int, fn: int) -> Tuple[float, float, float]:
    prec = tp / max(1, tp + fp) if (tp + fp) > 0 else 0.0
    rec = tp / max(1, tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * (prec * rec) / max(1e-9, prec + rec) if (prec + rec) > 0 else 0.0
    return round(prec, 4), round(rec, 4), round(f1, 4)


def evaluate_run_against_gold(
    results_jsonl_path: str,
    gold_jsonl_path: str,
    manifest_path: Optional[str] = None,
) -> EvaluationReport:
    """Computes comprehensive evaluation metrics comparing predictions against gold."""
    gold_records: Dict[str, Dict[str, Any]] = {}
    with open(gold_jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                item = json.loads(line)
                gold_records[item["id"]] = item

    pred_records: Dict[str, Dict[str, Any]] = {}
    with open(results_jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                item = json.loads(line)
                pred_records[item["segment_id"]] = item

    report = EvaluationReport(
        num_gold_segments=len(gold_records),
        num_pred_segments=len(pred_records),
    )

    # 1. Structural Tag Metrics
    tag_counts = {tag: {"tp": 0, "fp": 0, "fn": 0, "support": 0} for tag in ALL_STRUCTURAL_TAGS}

    heading_level_correct = 0
    heading_level_total = 0
    heading_parent_correct = 0
    heading_parent_total = 0

    # Split metrics
    split_tp = 0
    split_fp = 0
    split_fn = 0
    split_exact = 0
    split_tol1 = 0
    split_gold_total = 0

    # Typo metrics
    real_typo_tp = 0
    real_typo_fp = 0
    real_typo_fn = 0

    synth_typo_tp = 0
    synth_typo_fn = 0

    text_preserved_count = 0

    for sid, gold in gold_records.items():
        pred = pred_records.get(sid)
        gold_tag = gold.get("tag")
        gold_splits = gold.get("splitPoints", [])
        gold_needs_split = gold.get("needsSplitting", False)
        gold_edits = gold.get("edits", [])
        gold_has_typo = gold.get("hasTypo", False) or bool(gold_edits)

        # Check subsegments if parent was split
        pred_tag = None
        pred_splits = []
        pred_needs_split = False
        pred_has_typo = False
        pred_level = None
        pred_parent = None

        if pred:
            f_dec = pred.get("final_decision") or {}
            pred_tag = f_dec.get("tag")
            pred_level = f_dec.get("level")
            pred_parent = f_dec.get("parent_id")
            pred_has_typo = pred.get("hasTypo", False)

            # Check text preservation
            if pred.get("original_text") == gold.get("text"):
                text_preserved_count += 1
        else:
            # Check if represented by subsegments in pred
            sub_preds = [p for p in pred_records.values() if p.get("parent_segment_id") == sid]
            if sub_preds:
                pred_needs_split = True
                pred_has_typo = any(sp.get("hasTypo") for sp in sub_preds)
                # Text preservation across subsegments
                recon = "".join(sp.get("original_text", "") for sp in sub_preds)
                if recon == gold.get("text"):
                    text_preserved_count += 1

        # Class counts
        if gold_tag in tag_counts:
            tag_counts[gold_tag]["support"] += 1
            if pred_tag == gold_tag:
                tag_counts[gold_tag]["tp"] += 1
            else:
                tag_counts[gold_tag]["fn"] += 1

        if pred_tag and pred_tag in tag_counts and pred_tag != gold_tag:
            tag_counts[pred_tag]["fp"] += 1

        # Heading hierarchy
        if gold_tag == "heading":
            heading_level_total += 1
            if pred_level == gold.get("level"):
                heading_level_correct += 1
            if gold.get("parent") is not None:
                heading_parent_total += 1
                if pred_parent == gold.get("parent"):
                    heading_parent_correct += 1

        # Split metrics
        if gold_needs_split:
            split_gold_total += 1
            if pred_needs_split:
                split_tp += 1
                if pred_splits == gold_splits:
                    split_exact += 1
                    split_tol1 += 1
                else:
                    # Check tolerance +- 1 word
                    if len(pred_splits) == len(gold_splits) and all(abs(p - g) <= 1 for p, g in zip(pred_splits, gold_splits)):
                        split_tol1 += 1
            else:
                split_fn += 1
        elif pred_needs_split:
            split_fp += 1

        # Typo recall separated (real vs. synthetic)
        is_synthetic = any(ed.get("is_synthetic") or ed.get("is_valid_word_sub") for ed in gold_edits)
        if gold_has_typo:
            if is_synthetic:
                if pred_has_typo:
                    synth_typo_tp += 1
                else:
                    synth_typo_fn += 1
            else:
                if pred_has_typo:
                    real_typo_tp += 1
                else:
                    real_typo_fn += 1
        elif pred_has_typo:
            real_typo_fp += 1

    # Populate report metrics
    class_f1_non_para: List[float] = []
    for tag, counts in tag_counts.items():
        p, r, f1 = compute_prf1(counts["tp"], counts["fp"], counts["fn"])
        report.per_class_metrics[tag] = ClassMetrics(
            precision=p,
            recall=r,
            f1=f1,
            support=counts["support"],
        )
        if tag != "paragraph" and counts["support"] > 0:
            class_f1_non_para.append(f1)

    if class_f1_non_para:
        report.macro_f1_non_paragraph = round(sum(class_f1_non_para) / len(class_f1_non_para), 4)

    if heading_level_total > 0:
        report.heading_level_accuracy = round(heading_level_correct / heading_level_total, 4)
    if heading_parent_total > 0:
        report.heading_parent_accuracy = round(heading_parent_correct / heading_parent_total, 4)

    s_p, s_r, _ = compute_prf1(split_tp, split_fp, split_fn)
    report.split_precision = s_p
    report.split_recall = s_r
    if split_gold_total > 0:
        report.split_exact_match = round(split_exact / split_gold_total, 4)
        report.split_tolerance_1_match = round(split_tol1 / split_gold_total, 4)

    if len(gold_records) > 0:
        report.exact_text_preservation_rate = round(text_preserved_count / len(gold_records), 4)

    r_p, r_r, _ = compute_prf1(real_typo_tp, real_typo_fp, real_typo_fn)
    report.real_typo_precision = r_p
    report.real_typo_recall = r_r

    if (synth_typo_tp + synth_typo_fn) > 0:
        report.synthetic_valid_word_typo_recall = round(synth_typo_tp / (synth_typo_tp + synth_typo_fn), 4)

    return report
