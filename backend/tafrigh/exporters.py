"""
Model-Specific Exporters for Wahy-Transcriber AI Tafrigh Phase.
Exports canonical training records to:
1. JEV and Laya classification format
2. LLM multi-turn chat/instruction JSONL for fine-tuning.
Enforces strict filtering: only verified records (human_confirmed, human_corrected, gold) are exported.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .training_store import CanonicalTrainingRecord

VERIFIED_PROVENANCES = {"human_confirmed", "human_corrected", "gold"}


def export_for_jev_or_laya(
    canonical_jsonl_path: str,
    output_path: str,
    include_unreviewed: bool = False,
) -> int:
    """
    Exports verified records into JEV/Laya question-classification format.
    Returns count of exported records.
    """
    in_path = Path(canonical_jsonl_path)
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not in_path.exists():
        return 0

    exported_count = 0
    with open(in_path, "r", encoding="utf-8") as fin, open(out_path, "w", encoding="utf-8") as fout:
        for line in fin:
            if not line.strip():
                continue
            rec = CanonicalTrainingRecord.model_validate_json(line)
            prov = rec.review_status.get("provenance")

            if not include_unreviewed and prov not in VERIFIED_PROVENANCES:
                continue

            # State payload
            state = {
                "target_text": rec.original_text,
                "context_before": rec.context_shown.get("context_before", []),
                "context_after": rec.context_shown.get("context_after", []),
                "partial_toc": rec.context_shown.get("partial_toc", []),
            }

            # Questions with dynamic choices presented at inference time
            tag_options = []
            for c in rec.dynamic_choice_list:
                tag = c.get("tag", "paragraph")
                lvl = c.get("level")
                pid = c.get("parent_id")
                if tag == "heading" and lvl:
                    tag_options.append(f"heading_{lvl}_{pid or 'none'}")
                else:
                    tag_options.append(tag)

            final_tag = rec.final_accepted_decision.get("tag", "paragraph")
            final_level = rec.final_accepted_decision.get("level")
            final_parent = rec.final_accepted_decision.get("parent_id")

            if final_tag == "heading" and final_level:
                chosen_tag = f"heading_{final_level}_{final_parent or 'none'}"
            else:
                chosen_tag = str(final_tag)

            has_typo = "true" if bool(rec.final_accepted_decision.get("edits")) else "false"
            needs_splitting = "true" if bool(rec.final_accepted_decision.get("splitPoints")) else "false"

            questions = {
                "tag": tag_options if tag_options else [chosen_tag],
                "hasTypo": ["true", "false"],
                "needsSplitting": ["true", "false"],
            }

            answers = {
                "tag": chosen_tag,
                "hasTypo": has_typo,
                "needsSplitting": needs_splitting,
            }

            laya_record = {
                "id": rec.record_id,
                "state": state,
                "questions": questions,
                "answers": answers,
            }
            fout.write(json.dumps(laya_record, ensure_ascii=False) + "\n")
            exported_count += 1

    return exported_count


def export_for_llm_chat_jsonl(
    canonical_jsonl_path: str,
    output_path: str,
    include_hard_negatives: bool = True,
    include_unreviewed: bool = False,
) -> int:
    """
    Exports verified records into LLM chat fine-tuning JSONL format.
    Includes human-corrected disagreements and rejected proposals as hard negatives.
    """
    in_path = Path(canonical_jsonl_path)
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not in_path.exists():
        return 0

    exported_count = 0
    with open(in_path, "r", encoding="utf-8") as fin, open(out_path, "w", encoding="utf-8") as fout:
        for line in fin:
            if not line.strip():
                continue
            rec = CanonicalTrainingRecord.model_validate_json(line)
            prov = rec.review_status.get("provenance")

            if not include_unreviewed and prov not in VERIFIED_PROVENANCES:
                continue

            system_msg = {
                "role": "system",
                "content": "You are Wahy-Transcriber AI, an expert Islamic transcription and structural analysis system.",
            }

            user_msg = {
                "role": "user",
                "content": json.dumps({
                    "target_text": rec.original_text,
                    "context_before": rec.context_shown.get("context_before", []),
                    "context_after": rec.context_shown.get("context_after", []),
                    "allowed_choices": rec.dynamic_choice_list,
                }, ensure_ascii=False),
            }

            assistant_payload: Dict[str, Any] = {
                "tag": rec.final_accepted_decision.get("tag"),
                "level": rec.final_accepted_decision.get("level"),
                "parent": rec.final_accepted_decision.get("parent_id"),
                "hasTypo": bool(rec.final_accepted_decision.get("edits")),
                "needsSplitting": bool(rec.final_accepted_decision.get("splitPoints")),
                "splitPoints": rec.final_accepted_decision.get("splitPoints", []),
                "edits": rec.final_accepted_decision.get("edits", []),
            }

            assistant_msg = {
                "role": "assistant",
                "content": json.dumps(assistant_payload, ensure_ascii=False),
            }

            chat_item = {"messages": [system_msg, user_msg, assistant_msg]}
            fout.write(json.dumps(chat_item, ensure_ascii=False) + "\n")
            exported_count += 1

    return exported_count
