"""Stage 5: models (JEV, Gemini, chat models, base Laya) against YOUR labels from stages 2 and 4."""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List

import pandas as pd

VERDICTS = ["CORRECT", "FALSE", "NOT_SURE"]


def ece(gold: List[str], preds: List[Dict[str, Any]], bins: int = 10) -> float:
    """Calibration error: does '90% sure' really mean right 90% of the time? (0 = perfect)"""
    b = defaultdict(list)
    for g, p in zip(gold, preds):
        conf = max(p["probs"].values())
        b[min(bins - 1, int(conf * bins))].append((conf, p["verdict"] == g))
    n = len(gold)
    return sum(len(v) / n * abs(sum(c for c, _ in v) / len(v) - sum(ok for _, ok in v) / len(v)) for v in b.values()) if n else float("nan")


def score(gold_v: List[str], gold_b: List[Any], preds: List[Dict[str, Any]]) -> Dict[str, Any]:
    """gold_v without NOT_SURE (those are excluded before scoring)."""
    n = len(gold_v)
    acc = sum(p["verdict"] == g for g, p in zip(gold_v, preds)) / max(1, n)
    real = [(g, p) for g, p in zip(gold_v, preds) if g == "CORRECT"]
    fake = [(g, p) for g, p in zip(gold_v, preds) if g == "FALSE"]
    bd = [(gb, p.get("boundary")) for g, gb, p in zip(gold_v, gold_b, preds) if g == "CORRECT" and gb]
    return {
        "n": n,
        "verdict accuracy": round(acc, 3),
        "keeps real quotes": round(sum(p["verdict"] == "CORRECT" for _, p in real) / max(1, len(real)), 3),
        "rejects false findings": round(sum(p["verdict"] == "FALSE" for _, p in fake) / max(1, len(fake)), 3),
        "says unsure": round(sum(p["verdict"] == "NOT_SURE" for p in preds) / max(1, n), 3),
        "boundary accuracy": round(sum(a == b for a, b in bd) / len(bd), 3) if bd else None,
        "calibration error": round(ece(gold_v, preds), 3),
        "avg latency ms": round(sum(p.get("latency_ms", 0) for p in preds) / max(1, n)),
    }


def confusion(gold_v: List[str], preds: List[Dict[str, Any]]) -> pd.DataFrame:
    c = Counter((g, p["verdict"]) for g, p in zip(gold_v, preds))
    df = pd.DataFrame([[c[(g, p)] for p in VERDICTS] for g in ("CORRECT", "FALSE")],
                      index=["you: real quote", "you: not a quote"], columns=[f"model: {v}" for v in VERDICTS])
    return df
