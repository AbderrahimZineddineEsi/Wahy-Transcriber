"""
Universal Laya Dataset Converter
Module: backend/laya_converter.py

Converts raw AI verification logs and human-corrected findings from:
- Google Gemini 3.5 Flash-Lite
- OpenRouter Chat LLMs (DeepSeek, Qwen, etc.)
- OpenRouter JEV Decisions API
- Local Laya Decisions
- Human Gold Verifications
into canonical .jsonl datasets compatible with `laya` fine-tuning (RLCD and Cross-Entropy).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

CANONICAL_CHOICES = ["CORRECT", "FALSE", "NOT_SURE"]

DEFAULT_INSTRUCTIONS = (
    "In this Arabic Islamic lecture transcript, determine whether `matched_span_in_lecture` "
    "(surrounded by `context_before` and `context_after`) is an actual quotation/citation "
    "of `canonical_corpus_text` (`source_type`), or if it is merely ordinary speaker "
    "prose/explanation that happens to share words with the corpus text."
)

DEFAULT_CRITERIA = {
    "CORRECT": (
        "The speaker is genuinely quoting, reciting, or invoking this Quranic Ayah, "
        "Prophetic Hadith, or Dhikr (verbatim or as a direct religious citation in context)."
    ),
    "FALSE": (
        "False positive: the words are ordinary conversational speech, fiqh explanation, "
        "or narrator/person names that coincidentally overlap with corpus vocabulary without quoting the text."
    ),
    "NOT_SURE": (
        "Ambiguous or partial paraphrase/meaning-only allusion where it is borderline "
        "whether the speaker intended a direct quotation."
    )
}


def sanitize_probabilities(probs: Optional[Dict[str, float]], fallback_choice: str = "CORRECT", confidence: float = 0.90) -> Dict[str, float]:
    """Ensure probabilities exist, sum to 1.0, and cover all 3 canonical choices."""
    if probs and all(k in probs for k in CANONICAL_CHOICES):
        total = sum(float(probs.get(k, 0.0)) for k in CANONICAL_CHOICES)
        if total > 0.0001:
            return {k: round(float(probs[k]) / total, 4) for k in CANONICAL_CHOICES}

    c = max(0.34, min(0.99, float(confidence or 0.85)))
    rem = round((1.0 - c) / 2.0, 4)
    choice = fallback_choice if fallback_choice in CANONICAL_CHOICES else "CORRECT"

    out = {}
    for k in CANONICAL_CHOICES:
        out[k] = round(c, 4) if k == choice else rem
    total = sum(out.values())
    if total > 0:
        out = {k: round(v / total, 4) for k, v in out.items()}
    return out


def convert_single_record_to_laya_format(
    record: Dict[str, Any],
    index: int = 0,
    timestamp: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """
    Transforms one raw verification log / finding into a single Laya training line.
    """
    if not isinstance(record, dict):
        return None

    now_ts = timestamp or int(time.time())
    rec_id = str(record.get("id") or record.get("requestId") or f"wahy_dec_{now_ts}_{index:04d}")

    # Extract state (or build from detection fields)
    state = record.get("state")
    if not isinstance(state, dict):
        state = {
            "source_type": record.get("sourceType") or record.get("source_type") or "HADITH",
            "candidate_reference": record.get("displayRef") or record.get("candidate_reference") or record.get("reference") or "",
            "canonical_corpus_text": record.get("canonicalText") or record.get("canonical_corpus_text") or record.get("matched_span_in_lecture") or "",
            "context_before": record.get("context_before") or record.get("contextBefore") or "",
            "matched_span_in_lecture": record.get("matched_span_in_lecture") or record.get("matchedSpan") or "",
            "context_after": record.get("context_after") or record.get("contextAfter") or "",
            "engine_confidence_band": record.get("confidenceBand") or record.get("engine_confidence_band") or "CANDIDATE",
            "engine_score": float(record.get("engine_score") or record.get("totalScore") or 0.0),
            "has_citation_cue": bool(record.get("has_citation_cue") or record.get("hasCitationCue") or False)
        }

    # Extract questions (or fallback to canonical standard)
    questions = record.get("questions")
    if not isinstance(questions, dict) or "verdict" not in questions:
        questions = {
            "verdict": {
                "type": "choice",
                "instructions": DEFAULT_INSTRUCTIONS,
                "criteria": DEFAULT_CRITERIA
            }
        }

    # Determine verdict and probabilities
    is_human = bool(record.get("humanOverride") or record.get("human_verified") or record.get("provider") == "human_override")
    raw_verdict = str(
        record.get("humanVerdict") or
        record.get("verdict") or
        record.get("choice") or
        "CORRECT"
    ).upper().strip()

    if raw_verdict not in CANONICAL_CHOICES:
        # map Arabic verdicts if needed
        if "صحيح" in raw_verdict or "مقبول" in raw_verdict:
            raw_verdict = "CORRECT"
        elif "خطأ" in raw_verdict or "خاطئ" in raw_verdict or "كلام عادي" in raw_verdict:
            raw_verdict = "FALSE"
        else:
            raw_verdict = "NOT_SURE"

    confidence = float(record.get("confidence") or 0.88)
    probabilities = record.get("probabilities")

    if is_human:
        # Teacher target: 0.98 on gold verdict
        probabilities = {
            "CORRECT": 0.01,
            "FALSE": 0.01,
            "NOT_SURE": 0.01
        }
        probabilities[raw_verdict] = 0.98
        confidence = 0.98
    else:
        probabilities = sanitize_probabilities(probabilities, fallback_choice=raw_verdict, confidence=confidence)

    answers = {
        "verdict": {
            "type": "choice",
            "choice": raw_verdict,
            "probabilities": probabilities
        }
    }

    meta = {
        "source_provider": str(record.get("provider") or record.get("modelUsed") or record.get("source_provider") or "gemini-3.5-flash-lite"),
        "human_verified": is_human,
        "lecture_title": str(record.get("lectureTitle") or record.get("lecture_title") or "Wahy Transcript"),
        "converted_at": now_ts
    }

    return {
        "id": rec_id,
        "state": state,
        "questions": questions,
        "answers": answers,
        "meta": meta
    }


def convert_verification_records_to_laya_jsonl(
    records: List[Dict[str, Any]],
    options: Optional[Dict[str, Any]] = None
) -> Tuple[str, Dict[str, Any]]:
    """
    Converts an array of records into a valid JSON Lines string and returns statistics.
    """
    opts = options or {}
    now_ts = int(time.time())
    lines = []
    stats = {
        "total_input": len(records),
        "total_converted": 0,
        "by_verdict": {"CORRECT": 0, "FALSE": 0, "NOT_SURE": 0},
        "human_verified_count": 0,
        "ai_count": 0,
    }

    for idx, rec in enumerate(records):
        converted = convert_single_record_to_laya_format(rec, index=idx, timestamp=now_ts)
        if not converted:
            continue
        v = converted["answers"]["verdict"]["choice"]
        if v in stats["by_verdict"]:
            stats["by_verdict"][v] += 1
        if converted["meta"]["human_verified"]:
            stats["human_verified_count"] += 1
        else:
            stats["ai_count"] += 1
        
        stats["total_converted"] += 1
        lines.append(json.dumps(converted, ensure_ascii=False))

    jsonl_output = "\n".join(lines) + ("\n" if lines else "")
    return jsonl_output, stats


def main():
    parser = argparse.ArgumentParser(description="Universal Laya Dataset Converter (Wahy-Transcriber)")
    parser.add_argument("input_file", help="Path to JSON file containing array of verification records")
    parser.add_argument("-o", "--output", default="wahy_laya_train.jsonl", help="Output .jsonl file path")
    args = parser.parse_args()

    in_path = Path(args.input_file)
    if not in_path.exists():
        print(f"Error: input file '{in_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    try:
        raw_data = json.loads(in_path.read_text(encoding="utf-8"))
        records = raw_data if isinstance(raw_data, list) else raw_data.get("records", [])
    except Exception as e:
        print(f"Error reading input JSON: {e}", file=sys.stderr)
        sys.exit(1)

    jsonl_str, stats = convert_verification_records_to_laya_jsonl(records)
    out_path = Path(args.output)
    out_path.write_text(jsonl_str, encoding="utf-8")
    print(f"Successfully converted {stats['total_converted']} records to {out_path}.")
    print(f"Stats: {stats}")


if __name__ == "__main__":
    main()
