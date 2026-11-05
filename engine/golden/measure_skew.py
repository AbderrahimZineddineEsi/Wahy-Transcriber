"""Training/serving skew of run 6 (ROADMAP phase 2): what Laya was trained on vs what the old app sends it.

Training side: the run-6 notebook (notebooks/kaggle/laya_run6_kaggle.ipynb) reshapes every laya_v2 row with its own
`to_v3_state` and verdict question. Serving side: the app builds the envelope with `buildLayaEnvelopeV3`
(js/ai-verifier.js) from the same findings and words. Laya reads `json.dumps(state)` and the question text, so any
difference in keys, key order, values or instructions is a different input.

Run from the repo root (about 5 minutes):  .venv/bin/python engine/golden/measure_skew.py
Prints the report; nothing is written to the repo.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.laya_datagen import laya_v2 as L  # noqa: E402
from backend.laya_datagen.engine_bridge import EngineBridge  # noqa: E402

NOTEBOOK = ROOT / "notebooks/kaggle/laya_run6_kaggle.ipynb"
DATA = L.OUT


def notebook_code():
    """The notebook's own to_v3_state, v1_instructions and v1_criteria, executed from its source."""
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    src = next("".join(c["source"]) for c in nb["cells"] if "def to_v3_state" in "".join(c["source"]))
    code = src[src.index("def to_v3_state"):src.index("def convert_file")]
    ns: dict = {}
    exec(code, ns)
    return ns


def rows(variant):
    for split in ("train", "val", "test"):
        for line in open(DATA / variant / f"{split}.jsonl", encoding="utf-8"):
            yield json.loads(line)


def row_keys(row):
    rid = row["id"]
    return tuple(rid[len("passage:"):].split(";")) if rid.startswith("passage:") else (rid,)


def diff(a: dict, b: dict) -> list:
    """What differs between two states, in words: missing / extra keys, values, then key order."""
    out = [f"only in training: {k}" for k in a if k not in b] + [f"only in app: {k}" for k in b if k not in a]
    out += [f"value of {k}" for k in a if k in b and a[k] != b[k]]
    if not out and list(a) != list(b):
        out.append("key order")
    return out


def main():
    nb = notebook_code()
    recs, where, bundles, ans, usable = L.load_inputs()
    labels, _ = L.labels_by_key(recs, where, usable)
    run_of = L.runs(recs, bundles, labels)
    with EngineBridge(extra_engine_files=["js/engine_v5.js"]) as bridge:
        fingerprint_now = bridge.fingerprint()
    built_with = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))["harness"]

    with tempfile.TemporaryDirectory() as tmp:
        runs_path, out_path = Path(tmp) / "runs.json", Path(tmp) / "out.json"
        runs = [{"id": f"{doc}|{engine}", "engine": engine, "words": r["words"], "dets": r["dets"],
                 "targets": r["targets"]} for (doc, engine), r in sorted(run_of.items())]
        runs_path.write_text(json.dumps(runs, ensure_ascii=False), encoding="utf-8")
        subprocess.run(["node", "--max-old-space-size=4096", str(ROOT / "engine/golden/laya_requests.mjs"),
                        str(runs_path), str(out_path)], check=True)
        app = json.loads(out_path.read_text(encoding="utf-8"))

    # requests by their members' finding keys
    by_keys = {}
    for (doc, engine), r in run_of.items():
        for tag, reqs in app[f"{doc}|{engine}"].items():
            for q in reqs:
                by_keys[(tag, tuple(r["keys"][i] for i in q["members"]))] = q

    report = {"harness fingerprint": {"dataset built with": built_with, "today": fingerprint_now}}

    # 1. code drift: today's v2 builder against the stored v2 rows
    drift, unmatched = Counter(), []
    for variant, tag in (("base", "v2.p0"), ("passages", "v2.p1")):
        for row in rows(variant):
            if row["id"].startswith("synth:"):
                continue
            q = by_keys.get((tag, row_keys(row)))
            if q is None:
                # the groups today's builder makes from this row's first finding
                first = row_keys(row)[0]
                unmatched.append({"row": row["id"], "split": row["meta"]["split"], "mixed": row["meta"]["mixed_labels"],
                                  "today": [list(k) for (t, k) in by_keys if t == tag and first in k]})
            drift[(variant, "no request" if q is None else "same" if json.dumps(q["state"], ensure_ascii=False) ==
                   json.dumps(row["state"], ensure_ascii=False) else "differs")] += 1
    report["v2 rows rebuilt today"] = {f"{v}: {k}": n for (v, k), n in sorted(drift.items())}
    report["rows with no request today"] = unmatched

    # 2. training (to_v3_state of the row) vs serving (buildLayaEnvelopeV3 on the same group)
    states, fields, examples = Counter(), Counter(), {}
    for variant, tag, keep in (("base", "v3.p0", lambda r: True), ("passages", "v3.p1", lambda r: r["meta"].get("verses", 1) > 1)):
        name = "v3_single" if variant == "base" else "v3_mixed passages"
        for row in rows(variant):
            if not keep(row):
                continue
            q = by_keys.get((tag, row_keys(row)))
            if q is None:
                states[(name, "no request")] += 1
                continue
            train = nb["to_v3_state"](row["state"])
            same = json.dumps(train, ensure_ascii=False) == json.dumps(q["state"], ensure_ascii=False)
            states[(name, "identical" if same else "differs")] += 1
            for d in diff(train, q["state"]):
                fields[(name, d)] += 1
                examples.setdefault(d, {"row": row["id"], "training": train.get(d.split()[-1]), "app": q["state"].get(d.split()[-1])})
    report["states"] = {f"{n}: {k}": c for (n, k), c in sorted(states.items())}
    report["what differs"] = {f"{n}: {k}": c for (n, k), c in sorted(fields.items())}
    report["examples"] = examples

    # 3. the verdict question: the notebook's vs the app's (filtered to the trained question, as the app does)
    app_q = next(iter(by_keys.values()))["questions"]["verdict"]
    report["verdict question"] = {
        "same instructions": app_q["instructions"] == nb["v1_instructions"],
        "same criteria": app_q["criteria"] == nb["v1_criteria"],
        "app adds": app_q["instructions"][len(nb["v1_instructions"]):] if app_q["instructions"].startswith(nb["v1_instructions"]) else app_q["instructions"],
    }

    # 4. grouping: a v3_mixed checkpoint is served with passages on, so a verse inside a passage is never sent alone
    in_passage = Counter()
    passage_members = {k for (tag, keys) in by_keys if tag == "v3.p1" and len(keys) > 1 for k in keys}
    for row in rows("base"):
        in_passage["single-verse rows whose verse is served inside a passage" if row["id"] in passage_members
                   else "single-verse rows served alone"] += 1
    report["grouping at serving (passages on)"] = dict(in_passage)

    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
