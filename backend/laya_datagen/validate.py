"""Gate: the exported file must be fully consumable by laya.train (0 skipped) at the app's max_len."""
from __future__ import annotations

from typing import Any, Dict

BASE = "convaiinnovations/laya-multilingual"


def dry_run(path: str, base: str = BASE, max_len: int = 1024, head_max_len: int = 256) -> Dict[str, Any]:
    from laya.train import TrainConfig, dry_run as laya_dry_run
    return laya_dry_run(path, base, TrainConfig(max_len=max_len, head_max_len=head_max_len))


def truncation_report(path: str, base: str = BASE, max_len: int = 1024) -> Dict[str, Any]:
    """Share of rows whose serialized state exceeds max_len tokens. Laya cuts the state at the END, so the first thing
    lost is the tail (suffix words, immediate_transcript_after, flags) -- exactly what boundary_status needs."""
    import json
    import os

    from laya.common import serialize_state
    from laya.train import resolve_checkpoint_dir
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(os.path.join(resolve_checkpoint_dir(base), "tokenizer"))
    lens, by_src = [], {}
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        n = len(tok(serialize_state(r["state"]), add_special_tokens=False)["input_ids"])
        lens.append(n)
        by_src.setdefault(r["state"].get("source_type"), []).append(n)
    lens.sort()
    over = sum(1 for n in lens if n > max_len)
    return {"rows": len(lens), "over_max_len": over, "share_over": round(over / max(1, len(lens)), 3),
            "p50": lens[len(lens) // 2] if lens else 0, "p95": lens[int(len(lens) * 0.95)] if lens else 0,
            "max": lens[-1] if lens else 0, "by_source_max": {k: max(v) for k, v in by_src.items()}}
