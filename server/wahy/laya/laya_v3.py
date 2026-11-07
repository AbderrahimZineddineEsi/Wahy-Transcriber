"""Laya fine-tuning dataset v3: the envelope-v3 rows of run 6, stored in their final form (ADR 0003).

Run 6 trained `v3_single` and `v3_mixed` from laya_v2: its notebook rebuilt every row with its own `to_v3_state` and
its own verdict question. The app builds the same envelope with the engine (engine/src/envelopes.ts, version 3), and
the two disagree (rewrite phase 2's skew report: 2,019 of 4,901 single rows, and the question on every row). Here
every row is the engine's own envelope, built by the same call the app makes at verification time, and nothing
reshapes it afterwards: training and evaluation read the rows as they are.

Same labels, lectures, split and gold as laya_v2 (laya_v2.make_row), so a model trained on it can be compared with
run 6 card for card:

  v3_single   every labelled finding alone (envelope 3, passages off)
  v3_mixed    v3_single + every multi-verse passage (envelope 3, passages on), as run 6's v3_mixed

The rows keep the envelope's three questions (verdict, start_missing, end_missing) with the gold laya_v2 gives them;
a verdict-only model is trained with `--questions verdict` (train_ddp.py), which picks items and leaves each item's
input as it is, as the app does for a checkpoint trained on fewer questions.

    cd server && uv run python -m wahy.laya build-v3 --out ../data/laya_datagen/datasets/laya_v3
"""
from __future__ import annotations

import datetime
import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Tuple

from . import laya_v2 as V2
from .cache import DATA_DIR
from .engine_bridge import EngineBridge
from .export import EPS_BY_SOURCE
from .laya_dataset import BASE_MODEL, LABEL_FILES, TRAIN_SOURCES, _sha_file, _write_jsonl
from .laya_dataset import OUT as V1_OUT

NAME = "laya_v3"
OUT = DATA_DIR / "datasets" / NAME
ENVELOPE = 3
MAX_LEN, HEAD_MAX_LEN = V2.MAX_LEN, V2.HEAD_MAX_LEN
SPLITS = ("train", "val", "test")
VARIANTS = {
    "v3_single": {"passages": False, "about": "envelope 3 (corpus text first, no neighbours), every verse alone"},
    "v3_mixed": {"passages": True, "about": "envelope 3, every verse alone + every multi-verse passage (run 6's v3_mixed)"},
}
QUESTIONS_TRAINED_IN_RUN_6 = ["verdict"]


def requests(bridge: EngineBridge, run_of, passages: bool) -> List[Tuple[Tuple[str, str], Dict[str, Any]]]:
    """((doc, engine), request) for every envelope-3 request that holds a labelled finding."""
    out = []
    for run_id, run in sorted(run_of.items()):
        for req in bridge.envelopes(ENVELOPE, run_id[1], run["words"], run["dets"], {"passages": passages},
                                    targets=run["targets"]):
            out.append((run_id, req))
    return out


def variant_rows(bridge, run_of, labels, name: str) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """The variant's rows (every split) and why rows were dropped."""
    from collections import Counter
    dropped: Counter = Counter()
    rows: List[Dict[str, Any]] = []
    shapes = [False] if not VARIANTS[name]["passages"] else [False, True]
    for passages in shapes:
        for run_id, req in requests(bridge, run_of, passages):
            if passages and len(req["members"]) < 2:
                continue                    # the single verses are already in, from the passages-off pass
            row, why = V2.make_row({"members": req["members"], "state": req["state"], "questions": req["questions"]},
                                   run_of[run_id], labels)
            if row is None:
                dropped[why] += 1
            else:
                rows.append(row)
    return rows, dict(dropped)


def build(out_dir: Path = OUT, inputs=None, *, overwrite: bool = False) -> Dict[str, Any]:
    """Writes the Kaggle-ready folder and returns the manifest. Refuses to write over an existing folder unless
    `overwrite` (a dataset is never replaced by accident). `inputs` = laya_v2.load_inputs() output, if loaded."""
    if out_dir.exists() and any(out_dir.iterdir()) and not overwrite:
        raise FileExistsError(f"{out_dir} exists: choose a new folder (or pass overwrite=True / --force)")
    recs, where, bundles, ans, usable_rows = inputs or V2.load_inputs()
    labels, dropped_labels = V2.labels_by_key(recs, where, usable_rows)
    run_of = V2.runs(recs, bundles, labels)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    manifest: Dict[str, Any] = {
        "name": NAME, "created": datetime.date.today().isoformat(), "base_model": BASE_MODEL, "envelope": ENVELOPE,
        "built_by": "wahy/laya/laya_v3.py: engine/src/envelopes.ts version 3, the app's own envelope builder",
        "rows_are_final": True, "max_len": MAX_LEN, "head_max_len": HEAD_MAX_LEN, "eps_by_source": EPS_BY_SOURCE,
        "train_sources": list(TRAIN_SOURCES), "labels": len(labels), "dropped labels": dict(dropped_labels),
        "label_files": {n: _sha_file(DATA_DIR / "labels" / f"{n}.json") for n in LABEL_FILES},
        "variants": {}, "files": {}}
    with EngineBridge() as bridge:
        manifest["harness"] = bridge.fingerprint()
        for name, v in VARIANTS.items():
            rows, dropped = variant_rows(bridge, run_of, labels, name)
            by = {s: [r for r in rows if r["meta"]["split"] == s] for s in SPLITS}
            for s, rs in by.items():
                _write_jsonl(out_dir / name / f"{s}.jsonl", rs)
                manifest["files"][f"{name}/{s}.jsonl"] = len(rs)
            manifest["variants"][name] = {
                **v, "dropped": dropped,
                "cfg_extra": {"wahy_envelope": ENVELOPE, "wahy_envelope_options": {"passages": v["passages"]},
                              "wahy_questions": QUESTIONS_TRAINED_IN_RUN_6},
                **{s: V2.describe(rs) for s, rs in by.items()}}
        # the per-verse context slices eval_laya reports (same definition as laya_v2: from the v2 A + D rows)
        both, _ = V2.variant_rows(bridge, run_of, labels, "both")
        (out_dir / "test_verse_flags.json").write_text(json.dumps(V2.verse_flags(both), ensure_ascii=False),
                                                       encoding="utf-8")
    # the production model before run 6 (soft_asis, envelope 1) on its own test rows, for the "before" line
    shutil.copy(V1_OUT / "test.jsonl", out_dir / "v1_test.jsonl")
    shutil.copy(V1_OUT / "baselines.json", out_dir / "v1_baselines.json")
    manifest["files"]["v1_test.jsonl"] = sum(1 for _ in open(out_dir / "v1_test.jsonl", encoding="utf-8"))
    for f in ("train_ddp.py", "eval_laya.py"):
        shutil.copy(V2.KAGGLE_DIR / f, out_dir / f)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


# ---------------------------------------------------------------------------------------------- run 6's rows

def run6_rows(laya_v2_dir: Path, to_v3_state, question: Dict[str, Any]) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """The rows run 6's notebook trained on, rebuilt from laya_v2 with its own `to_v3_state` and question (exactly
    its convert_file / v3_mixed cells): variant -> split -> rows."""
    def conv(r):
        return {"id": r["id"], "state": to_v3_state(r["state"]), "questions": {"verdict": question},
                "gold": {"verdict": r["gold"]["verdict"]}, "meta": r["meta"]}

    def read(variant, split):
        return [json.loads(line) for line in open(laya_v2_dir / variant / f"{split}.jsonl", encoding="utf-8")]

    out: Dict[str, Dict[str, List[Dict[str, Any]]]] = {"v3_single": {}, "v3_mixed": {}}
    for s in SPLITS:
        single = [conv(r) for r in read("base", s)]
        seen = {r["id"] for r in single}
        multi = [conv(r) for r in read("passages", s) if r["meta"].get("verses", 1) > 1 and r["id"] not in seen]
        out["v3_single"][s], out["v3_mixed"][s] = single, single + multi
    return out


def skew(v3_dir: Path, run6: Dict[str, Dict[str, List[Dict[str, Any]]]]) -> Dict[str, Any]:
    """How the stored laya_v3 rows differ from what run 6 trained on: per variant and split, how many rows are the
    same, differ (and in what), or exist on one side only. Compares the verdict item (state + verdict question),
    the one item run 6 trained."""
    from collections import Counter
    report: Dict[str, Any] = {}
    for variant, by_split in run6.items():
        for s, old_rows in by_split.items():
            new = {r["id"]: r for r in (json.loads(line) for line in open(v3_dir / variant / f"{s}.jsonl",
                                                                          encoding="utf-8"))}
            old = {r["id"]: r for r in old_rows}
            c: Counter = Counter()
            for rid in old.keys() | new.keys():
                if rid not in new:
                    c["only in run 6"] += 1
                    continue
                if rid not in old:
                    c["only in laya_v3"] += 1
                    continue
                a, b = old[rid], new[rid]
                same_state = json.dumps(a["state"], ensure_ascii=False) == json.dumps(b["state"], ensure_ascii=False)
                same_q = a["questions"]["verdict"] == b["questions"]["verdict"]
                if same_state and same_q:
                    c["same"] += 1
                else:
                    c["differ"] += 1
                    if not same_q:
                        c["differ: verdict question"] += 1
                    if not same_state:
                        c["differ: state"] += 1
                        for k in a["state"].keys() - b["state"].keys():
                            c[f"differ: only run 6 has {k}"] += 1
                        for k in b["state"].keys() - a["state"].keys():
                            c[f"differ: only laya_v3 has {k}"] += 1
                        for k in a["state"].keys() & b["state"].keys():
                            if a["state"][k] != b["state"][k]:
                                c[f"differ: value of {k}"] += 1
                        if a["state"].keys() == b["state"].keys() and list(a["state"]) != list(b["state"]):
                            c["differ: key order"] += 1
                if a["gold"]["verdict"] != b["gold"]["verdict"]:
                    c["differ: gold verdict"] += 1
            report[f"{variant}/{s}"] = dict(sorted(c.items()))
    return report


def notebook_code(notebook: Path) -> Dict[str, Any]:
    """run 6's `to_v3_state`, `v1_instructions` and `v1_criteria`, executed from the notebook's own source."""
    nb = json.loads(notebook.read_text(encoding="utf-8"))
    src = next("".join(c["source"]) for c in nb["cells"] if "def to_v3_state" in "".join(c["source"]))
    ns: Dict[str, Any] = {}
    exec(src[src.index("def to_v3_state"):src.index("def convert_file")], ns)
    return ns
