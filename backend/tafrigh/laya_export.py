"""
Saved Tafrigh runs → Laya fine-tuning examples.

Each example is the exact choice-question envelope the structural classifier answers
({state, questions} → answers, same shape JEV/Laya receive at inference) with the
human-approved labels as gold answers. The model's own answers are kept alongside so
training can weight or filter by agreement.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .adapters.jev_adapter import QUESTION_INSTRUCTIONS, describe_option
from .models import TranscriptSegment

SCHEMA_VERSION = "tafrigh-laya-1"
BOOL_OPTIONS = ["true", "false"]


def tag_label(tag: str, level: Optional[int] = None, parent_id: Optional[str] = None) -> str:
    """Choice label in the classifier's format (heading_<level>_<parent|none>)."""
    if tag == "heading" and level:
        return f"heading_{level}_{parent_id or 'none'}"
    return tag


def label_source(seg: TranscriptSegment) -> str:
    review = seg.trace.get("review") or {}
    return {"correct": "human_corrected", "confirm": "human_confirmed", "revert_edits": "human_corrected"}.get(
        review.get("action"), "model"
    )


def _choice_question(key: str, options: List[str]) -> Dict[str, Any]:
    return {
        "type": "choice",
        "instructions": QUESTION_INSTRUCTIONS.get(key, key),
        "criteria": {opt: describe_option(opt) for opt in options},
    }


def _model_answers(trace: Dict[str, Any]) -> Dict[str, Any]:
    dec = trace.get("decision") or (trace.get("split_from") or {}).get("decision") or {}
    return {k: v.get("choice") for k, v in (dec.get("answers") or {}).items() if isinstance(v, dict)}


def _reconstructed_input(seg: TranscriptSegment, segments: List[TranscriptSegment], context: int = 3) -> Dict[str, Any]:
    """Runs from before the input was recorded: rebuild what we can (no partial TOC, default choices)."""
    ids = [s.id for s in segments]
    i = ids.index(seg.id) if seg.id in ids else 0
    return {
        "state": {
            "target_text": seg.original_text,
            "context_before": [s.original_text for s in segments[max(0, i - context):i]],
            "context_after": [s.original_text for s in segments[i + 1:i + 1 + context]],
            "partial_toc": [],
        },
        "allowed_choices": [],
        "reconstructed": True,
    }


def build_examples(run_id: str, segments: List[TranscriptSegment], selected_ids: List[str]) -> List[Dict[str, Any]]:
    wanted = set(selected_ids)
    examples: List[Dict[str, Any]] = []
    split_parents_done = set()

    for seg in segments:
        if seg.id not in wanted:
            continue
        inp = seg.trace.get("input") or _reconstructed_input(seg, segments)
        dec = seg.final_decision
        gold_tag = tag_label(dec.tag.value if dec else "paragraph", dec.level if dec else None, dec.parent_id if dec else None)

        tag_options = [tag_label(c.get("tag", "paragraph"), c.get("level"), c.get("parent_id")) for c in inp.get("allowed_choices") or []]
        tag_options = list(dict.fromkeys(tag_options)) or ["paragraph", "continuation", "heading_1_none", "list_intro", "list_item", "comment"]
        if gold_tag not in tag_options:  # a reviewer may pick a label the model was not offered at that point
            tag_options.append(gold_tag)

        examples.append({
            "schema_version": SCHEMA_VERSION,
            "task": "tafrigh_structure",
            "run_id": run_id,
            "segment_id": seg.id,
            "label_source": label_source(seg),
            "input_reconstructed": bool(inp.get("reconstructed")),
            "state": inp.get("state") or {},
            "questions": {
                "tag": _choice_question("tag", tag_options),
                "hasTypo": _choice_question("hasTypo", BOOL_OPTIONS),
                "needsSplitting": _choice_question("needsSplitting", BOOL_OPTIONS),
            },
            "answers": {
                "tag": gold_tag,
                "hasTypo": "true" if seg.active_version_id else "false",
                "needsSplitting": "false",
            },
            "model_answers": _model_answers(seg.trace),
            "corrected_text": seg.active_text if seg.active_version_id else None,
        })

        # The sentence this one was split from is a positive needsSplitting example
        parent = seg.trace.get("split_from") or {}
        if parent.get("input") and parent.get("id") not in split_parents_done:
            split_parents_done.add(parent["id"])
            examples.append({
                "schema_version": SCHEMA_VERSION,
                "task": "tafrigh_split",
                "run_id": run_id,
                "segment_id": parent["id"],
                "label_source": "model",
                "input_reconstructed": False,
                "state": parent["input"].get("state") or {},
                "questions": {"needsSplitting": _choice_question("needsSplitting", BOOL_OPTIONS)},
                "answers": {"needsSplitting": "true"},
                "model_answers": _model_answers({"decision": parent.get("decision")}),
                "corrected_text": None,
            })
    return examples


def save_run(store_dir: Path, run_id: str, examples: List[Dict[str, Any]], meta: Dict[str, Any]) -> Path:
    """One file per run, rewritten on every save: saving the same run again never duplicates examples."""
    store_dir.mkdir(parents=True, exist_ok=True)
    path = store_dir / f"{run_id}.jsonl"
    saved_at = datetime.now(timezone.utc).isoformat()
    with open(path, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(dict(ex, saved_at=saved_at, meta=meta), ensure_ascii=False) + "\n")
    return path
