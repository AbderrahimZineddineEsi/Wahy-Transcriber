"""ipywidgets UI: audit auto-labels (gate G1) and label the review queue. Everything is appended to jsonl as you click."""
from __future__ import annotations

import html
import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from .cache import DATA_DIR
from .reconcile import human_key, save_human

AUDIT_PATH = DATA_DIR / "labels" / "audit.jsonl"


def audit_sample(records: List[Dict[str, Any]], n: int = 100, seed: int = 0,
                 tiers=("pos_strong", "wrong_id", "neg_weak")) -> List[Dict[str, Any]]:
    """Stratified by (tier, source) so rare strata are not drowned by the common ones."""
    strata = defaultdict(list)
    for r in records:
        if r["label"]["tier"] in tiers:
            strata[(r["label"]["tier"], r["det"]["sourceType"])].append(r)
    rnd = random.Random(seed)
    for v in strata.values():
        rnd.shuffle(v)
    out, i = [], 0
    while len(out) < n and any(strata.values()):
        for v in list(strata.values()):
            if v and len(out) < n:
                out.append(v.pop())
    return out


def audit_results(path: Path = AUDIT_PATH) -> Dict[str, Any]:
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()] if path.exists() else []
    latest = {r["key"]: r for r in rows}
    by = defaultdict(lambda: [0, 0])
    for r in latest.values():
        by[r["tier"]][1] += 1
        by[r["tier"]][0] += r["ok"]
        if r.get("boundary_ok") is not None:
            by["boundary"][1] += 1
            by["boundary"][0] += r["boundary_ok"]
    return {k: {"correct": a, "n": n, "precision": round(a / n, 3)} for k, (a, n) in by.items()}


def _card(rec: Dict[str, Any]) -> str:
    st, lab = rec["envelope"]["state"], rec["label"]
    e = html.escape
    return (f"<div dir='rtl' style='font-size:17px;line-height:1.9;max-width:900px'>"
            f"<div style='font:12px sans-serif;direction:ltr'>{e(rec['id'])} · {e(st['source_type'])} · {e(st['candidate_reference'])} · "
            f"auto: <b>{e(str(lab['verdict']))}</b> / {e(str(lab.get('boundary')))} ({e(lab['tier'])}) · {e(', '.join(rec['cases']))}</div>"
            f"<p style='color:#888'>{e(st['context_before'])}</p>"
            f"<p style='background:#fff3b0;color:#000;padding:4px'><b>{e(st['matched_span_in_lecture'])}</b></p>"
            f"<p style='color:#888'>{e(st['context_after'])}</p>"
            f"<p style='background:#e8f5e9;color:#000;padding:4px'>{e(st['canonical_corpus_text'][:600])}</p>"
            f"<p style='font:12px sans-serif;direction:ltr'>missing-start: {e(st['unmatched_corpus_prefix_words'])} | "
            f"missing-end: {e(st['unmatched_corpus_suffix_words'])}</p></div>")


def audit_widget(sample: List[Dict[str, Any]], path: Path = AUDIT_PATH):
    import ipywidgets as w
    from IPython.display import display
    path.parent.mkdir(parents=True, exist_ok=True)
    pos = {"i": 0}
    body, status = w.HTML(), w.HTML()
    ok, bad = w.Button(description="✔ label right", button_style="success"), w.Button(description="✘ label wrong", button_style="danger")
    b_ok, b_bad = w.Button(description="boundary ✔"), w.Button(description="boundary ✘")
    skip = w.Button(description="skip")

    def show():
        i = pos["i"]
        status.value = f"<b>{min(i + 1, len(sample))}/{len(sample)}</b> — " + json.dumps(audit_results(path), ensure_ascii=False)
        body.value = _card(sample[i]) if i < len(sample) else "<h3>done</h3>"

    def save(ok_v: Optional[bool], b_v: Optional[bool] = None):
        r = sample[pos["i"]]
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"key": human_key(r), "tier": r["label"]["tier"], "ok": ok_v, "boundary_ok": b_v}) + "\n")
        pos["i"] = min(len(sample), pos["i"] + 1)
        show()

    ok.on_click(lambda _: save(True)); bad.on_click(lambda _: save(False)); skip.on_click(lambda _: (pos.update(i=pos["i"] + 1), show()))
    b_ok.on_click(lambda _: save(True, True)); b_bad.on_click(lambda _: save(True, False))
    show()
    display(w.VBox([status, body, w.HBox([ok, bad, b_ok, b_bad, skip])]))


def review_widget(queue: List[Dict[str, Any]], on_save=None):
    import ipywidgets as w
    from IPython.display import display
    pos = {"i": 0}
    body, status = w.HTML(), w.HTML()
    boundary = w.Dropdown(options=[("(keep)", None), "COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"], description="boundary")
    btns = {v: w.Button(description=v, button_style=s) for v, s in (("CORRECT", "success"), ("FALSE", "danger"), ("NOT_SURE", "warning"))}

    def show():
        i = pos["i"]
        status.value = f"<b>{min(i + 1, len(queue))}/{len(queue)}</b>"
        body.value = _card(queue[i]) if i < len(queue) else "<h3>queue empty</h3>"

    def click(v):
        if pos["i"] >= len(queue):
            return
        r = queue[pos["i"]]
        save_human(r, v, boundary.value if v == "CORRECT" else None)
        boundary.value = None
        pos["i"] += 1
        show()
        if on_save:
            on_save(r, v)

    for v, b in btns.items():
        b.on_click(lambda _, v=v: click(v))
    show()
    display(w.VBox([status, body, boundary, w.HBox(list(btns.values()))]))
