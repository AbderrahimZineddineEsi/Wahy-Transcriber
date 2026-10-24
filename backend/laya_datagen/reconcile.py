"""GT + teacher(s) + human -> final label per record (plan §5).

GT is the label. A teacher confirms GT-silent / weak cases and its disagreement with strong GT is SIGNAL: those go to
the review queue instead of being thrown away (dropping them would keep only what the teacher already gets right).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .cache import DATA_DIR

CONF = 0.8          # teacher probability needed to count as confident


def human_labels(path: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    """Latest human label per record id, appended by the review widget. Keyed engine-independently by span (see key)."""
    p = path or DATA_DIR / "labels" / "human.jsonl"
    out: Dict[str, Dict[str, Any]] = {}
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                out[r["key"]] = r
    return out


def human_key(rec: Dict[str, Any]) -> str:
    d = rec["det"]
    return f"{rec['doc_id']}|{d['wordStartIdx']}-{d['wordEndIdx']}|{d.get('unitId')}"


def save_human(rec: Dict[str, Any], verdict: str, boundary: Optional[str], path: Optional[Path] = None) -> None:
    p = path or DATA_DIR / "labels" / "human.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps({"key": human_key(rec), "verdict": verdict, "boundary": boundary}, ensure_ascii=False) + "\n")


def reconcile(records: List[Dict[str, Any]], teacher_out: Dict[str, List[Dict[str, Any]]],
              humans: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    """`teacher_out[name][i]` is the prediction for records[i] (or missing). Mutates `label` and adds `decision`."""
    humans = humans if humans is not None else human_labels()
    stats = {"accepted": 0, "review": 0, "dropped": 0, "human": 0}
    for i, rec in enumerate(records):
        lab = rec["label"]
        tp = [(n, o[i]) for n, o in teacher_out.items() if i < len(o) and o[i]]
        h = humans.get(human_key(rec))
        if h:
            lab.update(verdict=h["verdict"], boundary=h.get("boundary") or lab.get("boundary"), human=True)
            rec["decision"] = "human"; stats["human"] += 1
            continue
        confident = [(n, p) for n, p in tp if max(p["probs"].values()) >= CONF]
        agree = [n for n, p in confident if p["verdict"] == lab["verdict"]]
        tier, gt_v = lab["tier"], lab["verdict"]
        if tier in ("unalignable", "asr_mismatch"):
            rec["decision"] = "dropped"; stats["dropped"] += 1
        elif tier in ("pos_strong", "wrong_id"):
            if tp and not agree and confident:
                rec["decision"] = "review"; stats["review"] += 1          # strong GT vs confident teacher
            else:
                rec["decision"] = "accepted"; stats["accepted"] += 1
        elif tier == "neg_weak":
            if not tp or agree:
                rec["decision"] = "accepted"; stats["accepted"] += 1
            else:
                rec["decision"] = "review"; stats["review"] += 1
        elif tier == "silent":
            votes = {p["verdict"] for _, p in confident}
            if len(confident) >= 2 and len(votes) == 1:
                v = votes.pop()
                if v != "NOT_SURE":                                         # NOT_SURE only from humans (D5)
                    lab.update(verdict=v, tier="teacher_consensus")
                    rec["decision"] = "accepted"; stats["accepted"] += 1
                    continue
            rec["decision"] = "review" if tp else "dropped"
            stats["review" if tp else "dropped"] += 1
        else:
            rec["decision"] = "dropped"; stats["dropped"] += 1
    return stats
