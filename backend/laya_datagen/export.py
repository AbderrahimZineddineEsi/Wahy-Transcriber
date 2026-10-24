"""Candidate records -> Laya fine-tuning JSONL (`{state, questions, gold}`), split by lecture."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

VERDICTS = ["CORRECT", "FALSE", "NOT_SURE"]
BOUNDARIES = ["COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"]
# target sharpness encodes trust (Laya has no per-sample weights)
EPS = {"pos_strong": 0.05, "wrong_id": 0.05, "neg_weak": 0.10, "asr_mismatch": 0.15, "teacher_consensus": 0.15, "human": 0.02}
# Fields that describe the engine, not the lecture: Laya must not learn "score high => CORRECT" (plan D2).
ENGINE_STATE_KEYS = ("engine_score", "engine_confidence_band")


def soft(options: List[str], choice: str, eps: float) -> Dict[str, float]:
    rest = eps / (len(options) - 1)
    return {o: round(1 - eps if o == choice else rest, 4) for o in options}


def to_laya_row(rec: Dict[str, Any], profile: str = "engine_agnostic") -> Optional[Dict[str, Any]]:
    lab = dict(rec["label"])
    if lab["verdict"] == "IN_HADITH":      # a verbatim ayah inside a hadith IS a quote of the ayah (tagged `in_hadith`)
        lab["verdict"] = "CORRECT"
    if lab["verdict"] not in VERDICTS:     # None (no label) or PARAPHRASE (not an option of Laya's question yet)
        return None
    state = dict(rec["envelope"]["state"])
    if profile == "engine_agnostic":
        for k in ENGINE_STATE_KEYS:
            state.pop(k, None)
    eps = EPS["human" if lab.get("human") else lab["tier"]]
    gold = {"verdict": {"probabilities": soft(VERDICTS, lab["verdict"], eps)}}
    if lab["verdict"] == "CORRECT" and lab.get("boundary"):
        gold["boundary_status"] = {"probabilities": soft(BOUNDARIES, lab["boundary"], eps)}
    return {
        "id": rec["id"], "state": state, "questions": rec["envelope"]["questions"], "gold": gold,
        "meta": {"doc_id": rec["doc_id"], "engine": rec["engine"], "tier": lab["tier"], "cases": rec["cases"],
                 "label_source": "human" if lab.get("human") else "gt", "state_profile": profile,
                 "flags": lab.get("flags", [])},
    }


def assign_splits(doc_ids: Iterable[str], val: float = 0.1, test: float = 0.1) -> Dict[str, str]:
    """Deterministic split by lecture (never by detection: neighbours share context)."""
    docs = sorted(set(doc_ids), key=lambda d: hashlib.sha256(d.encode()).hexdigest())
    n = len(docs)
    n_test = max(1, round(n * test)) if n >= 3 else 0
    n_val = max(1, round(n * val)) if n >= 3 else 0
    out = {}
    for i, d in enumerate(docs):
        out[d] = "test" if i < n_test else "val" if i < n_test + n_val else "train"
    return out


def export_dataset(records: List[Dict[str, Any]], out_dir: Path, *, profile: str = "engine_agnostic",
                   include_tiers: Iterable[str] = ("pos_strong", "wrong_id", "neg_weak", "teacher_consensus"),
                   engine: Optional[str] = None, max_per_unit_per_doc: int = 3, max_per_unit: int = 8,
                   meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Writes train/val/test.jsonl + manifest.json. Dedup key = (doc, span, unit); caps stop frequent verses flooding."""
    include = set(include_tiers)
    rows, seen = [], set()
    per_doc_unit: Counter = Counter()
    per_unit: Counter = Counter()
    for rec in records:
        if engine and rec["engine"] != engine:
            continue
        if rec["label"]["tier"] not in include and not rec["label"].get("human"):
            continue
        if rec.get("decision") in ("review", "dropped"):
            continue
        d = rec["det"]
        key = (rec["doc_id"], d["wordStartIdx"], d["wordEndIdx"], d.get("unitId"))
        if key in seen:
            continue
        unit = d.get("unitId")
        if per_doc_unit[(rec["doc_id"], unit)] >= max_per_unit_per_doc or per_unit[unit] >= max_per_unit:
            continue
        row = to_laya_row(rec, profile)
        if row is None:
            continue
        seen.add(key)
        per_doc_unit[(rec["doc_id"], unit)] += 1
        per_unit[unit] += 1
        rows.append(row)
    splits = assign_splits(r["meta"]["doc_id"] for r in rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    counts: Dict[str, Counter] = {s: Counter() for s in ("train", "val", "test")}
    files = {s: open(out_dir / f"{s}.jsonl", "w", encoding="utf-8") for s in counts}
    try:
        for r in rows:
            s = splits[r["meta"]["doc_id"]]
            files[s].write(json.dumps(r, ensure_ascii=False) + "\n")
            top = max(r["gold"]["verdict"]["probabilities"].items(), key=lambda kv: kv[1])[0]
            counts[s][top] += 1
            counts[s]["_rows"] += 1
            if "boundary_status" in r["gold"]:
                counts[s]["boundary:" + max(r["gold"]["boundary_status"]["probabilities"].items(), key=lambda kv: kv[1])[0]] += 1
    finally:
        for f in files.values():
            f.close()
    manifest = {"profile": profile, "tiers": sorted(include), "engine": engine, "splits": splits,
                "counts": {s: dict(c) for s, c in counts.items()}, **(meta or {})}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest
