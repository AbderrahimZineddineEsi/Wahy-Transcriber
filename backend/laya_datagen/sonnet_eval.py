"""Sonnet (the labeller) on ALL your labelled cards, not only the 60 of the blind test.

Same guide, card text, model and effort as autolabel.py, two conditions:
  written   the card as autolabel showed it on the review lessons: with Bin Baz's written text (quotes marked ⟪ ⟫)
  nowritten the same card without that section: what Sonnet had on the YouTube lectures (most of the training labels),
            and closer to what Laya / JEV see
Answers go to labels/sonnet_user_<condition>.json, which no exporter reads, so they never become training labels.

    python -m backend.laya_datagen.sonnet_eval run [nowritten] [written]   # both by default; resumable after a usage limit
    python -m backend.laya_datagen.sonnet_eval report
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from . import autolabel, cards
from . import engine_eval as ev
from .cache import DATA_DIR
from .stages import finding_key

LABELS = DATA_DIR / "labels"
CONDITIONS = ("nowritten", "written")


def your_labels():
    """finding key -> {"verdict", "boundary"} from stages 2 / 4 and the negatives sprint."""
    f = json.loads((LABELS / "findings.json").read_text(encoding="utf-8"))
    s = json.loads((LABELS / "sprint.json").read_text(encoding="utf-8"))
    out = {k: {"verdict": v["answer"]["verdict"], "boundary": v["answer"].get("boundary")} for k, v in f.items()}
    out.update({k: {"verdict": v["answer"] if isinstance(v["answer"], str) else v["answer"]["verdict"], "boundary": None}
                for k, v in s.items()})
    return out


def pool_and_bundles():
    """Your cards as autolabel records, and the bundles card_text needs per condition (`nowritten` drops the written text)."""
    bundles, ls = ev.load()
    for e in ("v5", "v5:loose"):
        ev.add_engine(bundles, ls, e)
    mine = your_labels()
    pool, seen = [], set()
    for doc_id, b in bundles.items():
        for r in b["records"]:
            k = finding_key(r)
            if k in mine and k not in seen:
                seen.add(k)
                r["_bundle"] = doc_id
                pool.append(r)
    by_condition = {"written": bundles,
                    "nowritten": {d: {**b, "doc": {k: v for k, v in b["doc"].items() if k != "gt"}} for d, b in bundles.items()}}
    missing = sorted(set(mine) - seen)
    if missing:
        print(f"{len(missing)} of your cards have no record (skipped): {missing[:5]}")
    return sorted(pool, key=lambda r: finding_key(r)), by_condition


def run(conditions=CONDITIONS):
    pool, by_condition = pool_and_bundles()      # the slow part (engines on 15 lessons), once for every condition
    for c in conditions:
        print(f"\n### {c}: {len(pool)} cards", flush=True)
        autolabel.run(pool, by_condition[c], len(pool), True, store=f"sonnet_user_{c}")


def report():
    mine = your_labels()
    real = lambda v: "CORRECT" if v in ("CORRECT", "IN_HADITH") else v
    for c in CONDITIONS:
        ans = cards.store(f"sonnet_user_{c}")
        ks = [k for k in mine if k in ans]
        if not ks:
            continue
        pairs = [(real(mine[k]["verdict"]), real(ans[k]["answer"]["verdict"])) for k in ks]
        conf = Counter(pairs)
        print(f"\n## {c}: {len(ks)} of your {len(mine)} cards")
        print(f"verdict agreement {sum(a == b for a, b in pairs) / len(pairs):.1%}")
        print("you \\ Sonnet:", {g: {q: n for (a, q), n in conf.items() if a == g} for g in sorted({a for a, _ in pairs})})
        b = [(mine[k]["boundary"], ans[k]["answer"].get("boundary")) for k in ks
             if real(mine[k]["verdict"]) == "CORRECT" and mine[k]["boundary"] and real(ans[k]["answer"]["verdict"]) == "CORRECT"]
        if b:
            print(f"boundary agreement {sum(x == y for x, y in b) / len(b):.1%} on {len(b)} cards both call real;",
                  "you \\ Sonnet:", dict(Counter(b)))


def main(argv=None):
    a = (argv or sys.argv[1:]) or ["report"]
    if a[0] == "run":
        run(a[1:] or CONDITIONS)
    else:
        report()


if __name__ == "__main__":
    sys.exit(main())
