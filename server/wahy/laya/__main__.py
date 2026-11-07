"""The research side's command line. Run from server/ (the server's environment has the engine client, core/ai
and, with `uv sync --extra laya`, the laya package):

    uv run python -m wahy.laya build-v2 --out ../data/laya_datagen/rebuild/laya_v2   # never over an existing folder
    uv run python -m wahy.laya build-v3 --out ../data/laya_datagen/datasets/laya_v3
    uv run python -m wahy.laya hashes ../data/laya_datagen/datasets/laya_v2 ../data/laya_datagen/rebuild/laya_v2
    uv run python -m wahy.laya skew-run6 ../data/laya_datagen/datasets/laya_v3        # how laya_v3 differs from run 6
    uv run python -m wahy.laya label --teacher fake --n 5                            # a teacher labels 5 cards
    uv run python -m wahy.laya teacher-eval report                                   # the teacher table
    uv run python -m wahy.laya validate ../data/laya_datagen/datasets/laya_v3        # Laya's own reader (laya extra)
    uv run python -m wahy.laya zip ../data/laya_datagen/datasets/laya_v3

Nothing here trains a model or starts a Kaggle run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .cache import DATA_DIR

TEACHERS = ("fake", "gemini", "jev", "openrouter", "laya")


# ---------------------------------------------------------------------------------------------- hashes

def file_hashes(folder: Path) -> Dict[str, str]:
    """relative path -> sha256 of every data file in a dataset folder (no caches, no __pycache__)."""
    out = {}
    for p in sorted(folder.rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts:
            out[str(p.relative_to(folder))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def compare_hashes(a: Path, b: Path, ignore=("manifest.json",)) -> Dict[str, List[str]]:
    """Which files are identical, differ, or exist on one side only. The manifest is compared without its date
    (`created`), so a rebuild on another day can still be identical."""
    ha, hb = file_hashes(a), file_hashes(b)
    out: Dict[str, List[str]] = {"identical": [], "differ": [], f"only in {a}": [], f"only in {b}": []}
    for f in sorted(ha.keys() | hb.keys()):
        if f not in hb:
            out[f"only in {a}"].append(f)
        elif f not in ha:
            out[f"only in {b}"].append(f)
        elif ha[f] == hb[f]:
            out["identical"].append(f)
        elif f in ignore and _manifest_equal(a / f, b / f):
            out["identical"].append(f + " (apart from the date)")
        else:
            out["differ"].append(f)
    return out


def _manifest_equal(a: Path, b: Path) -> bool:
    ma, mb = (json.loads(p.read_text(encoding="utf-8")) for p in (a, b))
    ma.pop("created", None), mb.pop("created", None)
    return ma == mb


# ---------------------------------------------------------------------------------------------- label

def make_teacher(name: str, model: Optional[str] = None):
    from .teachers.fake import FakeTeacher
    from .teachers.gemini import GeminiTeacher
    from .teachers.jev import JevTeacher
    from .teachers.laya_local import LayaLocal
    from .teachers.openrouter_chat import OpenRouterChatTeacher
    if name == "fake":
        return FakeTeacher(model or "fake-1")
    if name == "gemini":
        return GeminiTeacher(model or "gemini-3.5-flash-lite")
    if name == "jev":
        return JevTeacher(model or "typesafe/jev-1.14")
    if name == "openrouter":
        if not model:
            raise SystemExit("--model is needed for an OpenRouter chat model")
        return OpenRouterChatTeacher(model)
    return LayaLocal(model or "convaiinnovations/laya-multilingual")


def pick_cards(rows_file: Path, n: int, seed: int, source: Optional[str]) -> List[Dict[str, Any]]:
    """n rows of a dataset file, the same ones for the same seed: the cards a teacher labels. `source` keeps the
    rows labelled by that source only (user = your own labels), so the teacher's answer can be compared."""
    rows = [json.loads(line) for line in open(rows_file, encoding="utf-8")]
    if source:
        rows = [r for r in rows if r["meta"].get("source") == source]
    rows.sort(key=lambda r: r["id"])
    return random.Random(seed).sample(rows, min(n, len(rows)))


def label(teacher_name: str, model: Optional[str], rows_file: Path, n: int, seed: int,
          source: Optional[str]) -> Dict[str, Any]:
    """A teacher labels n cards (cached: a card is never paid for twice). Prints the cards next to their gold
    verdict and writes results/teacher_labels/<teacher>_<time>.json."""
    from .teachers.base import VERDICTS
    teacher = make_teacher(teacher_name, model)
    cards = pick_cards(rows_file, n, seed, source)
    envs = [{"state": r["state"], "questions": r["questions"]} for r in cards]
    new = sum(teacher.cache.get(teacher.key(e)) is None for e in envs)
    t0 = time.time()
    answers = teacher.predict(envs)
    gold = [max(VERDICTS, key=lambda v: r["gold"]["verdict"]["probabilities"].get(v, 0.0)) for r in cards]
    out = {"teacher": teacher.name, "model": teacher.model, "prompt_version": teacher.prompt_version,
           "rows": str(rows_file), "seed": seed, "source": source, "cards": len(cards), "asked": new,
           "cached": len(cards) - new, "seconds": round(time.time() - t0, 1),
           "cost_usd": round(teacher.cost_usd, 6),
           "agree_with_gold": sum(a["verdict"] == g for a, g in zip(answers, gold)),
           "labels": [{"id": r["id"], "ref": r["state"].get("candidate_reference"), "gold": g, "verdict": a["verdict"],
                       "boundary": a.get("boundary"), "p": {k: round(v, 3) for k, v in a["probs"].items()},
                       "reason": a.get("reason", ""), "request_id": a.get("request_id"), "cost_usd": a.get("cost", 0.0)}
                      for r, g, a in zip(cards, gold, answers)]}
    path = DATA_DIR / "results" / "teacher_labels" / f"{teacher.name}_{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    out["saved"] = str(path)
    return out


def print_labels(out: Dict[str, Any]) -> None:
    print(f"{out['teacher']} ({out['model']}): {out['cards']} cards, {out['asked']} asked, {out['cached']} from the "
          f"cache, {out['seconds']} s, ${out['cost_usd']}; agrees with gold on {out['agree_with_gold']}/{out['cards']}")
    for x in out["labels"]:
        print(f"  {x['ref'] or '?':<24} gold {x['gold']:<9} teacher {x['verdict']:<9} {x['boundary'] or '':<14} "
              f"{x['reason'][:70]}")
    print("saved:", out["saved"])


# ---------------------------------------------------------------------------------------------- main

def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m wahy.laya", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, about in (("build-v2", "build laya_v2 (runs 3 to 6) into a new folder"),
                        ("build-v3", "build laya_v3 (final envelope-v3 rows) into a new folder")):
        p = sub.add_parser(name, help=about)
        p.add_argument("--out", type=Path, required=True)
        p.add_argument("--force", action="store_true", help="write over an existing folder")
    p = sub.add_parser("hashes", help="compare two dataset folders file by file")
    p.add_argument("a", type=Path)
    p.add_argument("b", type=Path)
    p = sub.add_parser("skew-run6", help="how a laya_v3 folder differs from the rows run 6 trained on")
    p.add_argument("v3", type=Path)
    p.add_argument("--laya-v2", type=Path, default=DATA_DIR / "datasets" / "laya_v2")
    p.add_argument("--notebook", type=Path,
                   default=Path(__file__).resolve().parents[3] / "notebooks" / "kaggle" / "laya_run6_kaggle.ipynb")
    p = sub.add_parser("label", help="a teacher labels n cards of a dataset file")
    p.add_argument("--teacher", choices=TEACHERS, default="fake")
    p.add_argument("--model")
    p.add_argument("--rows", type=Path, default=DATA_DIR / "datasets" / "laya_v3" / "v3_mixed" / "test.jsonl")
    p.add_argument("--n", type=int, default=5)
    p.add_argument("--seed", type=int, default=22)
    p.add_argument("--source", default="user", help="only rows labelled by this source ('' for all)")
    p.add_argument("--yes", action="store_true", help="needed for a teacher that is not the fake one (it may cost)")
    p = sub.add_parser("teacher-eval", help="teacher_eval: jev | laya | chat | report", add_help=False)
    p.add_argument("rest", nargs=argparse.REMAINDER)
    p = sub.add_parser("validate", help="every file through Laya's own reader (needs the laya extra)")
    p.add_argument("folder", type=Path)
    p = sub.add_parser("zip", help="zip a dataset folder for Kaggle (next to the datasets folder)")
    p.add_argument("folder", type=Path)
    a = ap.parse_args(argv)

    if a.cmd in ("build-v2", "build-v3"):
        from . import laya_v2, laya_v3
        mod = laya_v2 if a.cmd == "build-v2" else laya_v3
        t0 = time.time()
        m = mod.build(a.out.resolve(), overwrite=a.force)
        print(json.dumps(m["files"], indent=1))
        print(f"built {a.out} in {time.time() - t0:.0f} s")
    elif a.cmd == "hashes":
        res = compare_hashes(a.a.resolve(), a.b.resolve())
        for k, files in res.items():
            print(f"{k}: {len(files)}")
            if k != "identical":
                for f in files:
                    print("   ", f)
        return 0 if not res["differ"] and not any(v for k, v in res.items() if k.startswith("only")) else 1
    elif a.cmd == "skew-run6":
        from . import laya_v3
        nb = laya_v3.notebook_code(a.notebook)
        question = {"type": "choice", "instructions": nb["v1_instructions"], "criteria": nb["v1_criteria"]}
        print(json.dumps(laya_v3.skew(a.v3.resolve(), laya_v3.run6_rows(a.laya_v2.resolve(), nb["to_v3_state"],
                                                                          question)), ensure_ascii=False, indent=1))
    elif a.cmd == "label":
        if a.teacher != "fake" and not a.yes:
            raise SystemExit(f"{a.teacher} may cost money or quota: add --yes to ask it")
        print_labels(label(a.teacher, a.model, a.rows, a.n, a.seed, a.source or None))
    elif a.cmd == "teacher-eval":
        from . import teacher_eval
        return teacher_eval.main(a.rest) or 0
    elif a.cmd == "validate":
        from . import laya_v2
        rows = laya_v2.validate(a.folder.resolve())
        for r in rows:
            print(r)
        return 0 if all(r["ok"] for r in rows) else 1
    elif a.cmd == "zip":
        from . import laya_v2
        print(laya_v2.zip_dataset(a.folder.resolve()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
