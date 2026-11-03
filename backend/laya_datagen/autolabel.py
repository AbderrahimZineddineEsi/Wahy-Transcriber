"""Stage 8 · automatic labelling: Sonnet labels engine findings through Claude Code's headless mode (`claude -p`).

Same guide and same card text as the blind test (agent_eval), 10 cards per call, run from a folder outside the repo with
every tool turned off: the model sees only the prompt. Each answer is saved to labels/sonnet.json with its reason, each
call to labels/sonnet_runs.jsonl with its usage. A usage limit or an error stops the run cleanly; re-running resumes.
"""
from __future__ import annotations

import json
import subprocess
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

from .agent_eval import BOUNDARIES, REAL, VERDICTS5, card_text, guide
from .cache import sha, write_atomic
from .stages import BOUNDARY, VERDICT, finding_key, is_gt_finding, pct

STORE = "sonnet"
CHECK_STORE = "sonnet_check"
RUN_DIR = Path.home() / "laya_labeller"
MODEL, EFFORT, BATCH = "sonnet", "high", 10       # the first 100 cards ran at "medium" (saved with each answer)

SCHEMA = {"type": "object", "required": ["answers"], "properties": {"answers": {"type": "array", "items": {
    "type": "object", "required": ["card", "verdict", "boundary", "reason"], "properties": {
        "card": {"type": "string"}, "verdict": {"type": "string", "enum": VERDICTS5},
        "boundary": {"type": "string", "enum": BOUNDARIES + ["NONE"]}, "reason": {"type": "string"}}}}}}


class Stop(Exception):
    """The run cannot go on now (usage limit, error): everything answered so far is saved."""


# ---------------------------------------------------------------------------------------------- the pool
def pool(bundles: Dict[str, Dict[str, Any]], engine: str, seed: int = 3) -> List[Dict[str, Any]]:
    """Every finding of `engine` except the ones on a quote marked in Bin Baz's written text (their automatic label is
    already right 99% of the time). Stable pseudo-random order, so lectures and sheikhs are mixed in every batch."""
    out = []
    for doc_id, b in bundles.items():
        for r in b["records"]:
            if r["engine"] == engine and not is_gt_finding(r):
                r["_bundle"] = doc_id
                out.append(r)
    return sorted(out, key=lambda r: sha(seed, finding_key(r)))


# ---------------------------------------------------------------------------------------------- one call
def _prompt(batch: List[Dict[str, Any]], bundles: Dict[str, Dict[str, Any]]) -> str:
    cards_ = "\n---\n\n".join(card_text(f"c{i + 1}", r, bundles[r["_bundle"]]) for i, r in enumerate(batch))
    return (guide() + "\n\n# The cards\n\n" + cards_ +
            f"\n\nLabel all {len(batch)} cards above, one answer per card (`card` = its id, e.g. c1). Give `boundary` only "
            "for CORRECT / IN_HADITH (otherwise NONE), and a short `reason` in English.")


def label_batch(batch: List[Dict[str, Any]], bundles: Dict[str, Dict[str, Any]], model: str = MODEL,
                effort: str = EFFORT) -> Dict[str, Any]:
    RUN_DIR.mkdir(exist_ok=True)
    t0 = time.time()
    try:
        p = subprocess.run(["claude", "-p", "--model", model, "--effort", effort, "--output-format", "json",
                            "--no-session-persistence", "--tools", "", "--json-schema", json.dumps(SCHEMA)],
                           input=_prompt(batch, bundles), capture_output=True, text=True, cwd=RUN_DIR, timeout=900)
    except subprocess.TimeoutExpired:
        raise Stop("claude -p timed out after 15 min")
    try:
        out = json.loads(p.stdout)
    except json.JSONDecodeError:
        raise Stop(f"claude -p failed: {(p.stderr or p.stdout)[:400]}")
    if out.get("is_error") or not out.get("structured_output"):
        raise Stop(f"claude -p stopped: {str(out.get('result') or out.get('api_error_status') or out)[:400]}")
    got = {a["card"]: a for a in out["structured_output"]["answers"]}
    answers = {}
    for i, r in enumerate(batch):
        a = got.get(f"c{i + 1}")
        if a:
            answers[finding_key(r)] = {"verdict": a["verdict"], "reason": a["reason"],
                                       "boundary": a["boundary"] if a["verdict"] in REAL and a["boundary"] != "NONE" else None}
    u = out.get("usage", {})
    return {"answers": answers, "seconds": round(time.time() - t0, 1), "cost_usd": out.get("total_cost_usd", 0),
            "tokens": {k: u.get(k, 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")}}


# ---------------------------------------------------------------------------------------------- the run
def run(pool_: List[Dict[str, Any]], bundles: Dict[str, Dict[str, Any]], n: int, allow_calls: bool,
        store: str = STORE, model: str = MODEL, effort: str = EFFORT) -> None:
    """Label the next `n` unlabelled findings of the pool, BATCH per call. `store` = the labels file
    (labels/<store>.json): another one keeps e.g. an engine evaluation apart from the Laya training labels.
    `model` / `effort` = what `claude -p` runs (saved with every answer)."""
    from . import cards
    ans = cards.store(store)
    todo = [r for r in pool_ if finding_key(r) not in ans][:n]
    if not todo:
        print("nothing to label: every finding of the pool has an answer")
        return
    if not allow_calls:
        print(f"{len(todo)} findings to label — skipped (set RUN_MODELS = True to call Sonnet)")
        return
    log = cards.LABELS_DIR / "sonnet_runs.jsonl"
    done = 0
    for s in range(0, len(todo), BATCH):
        batch = todo[s:s + BATCH]
        try:
            res = label_batch(batch, bundles, model, effort)
        except Stop as e:
            print(f"⏸ stopped after {done} cards: {e}\n   re-run this cell later to continue")
            break
        now = time.time()
        for k, a in res["answers"].items():
            ans[k] = {"answer": a, "t": now, "model": f"{model}/{effort}"}
        cards.save_store(store)
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": now, "cards": len(batch), "answered": len(res["answers"]), "seconds": res["seconds"],
                                "cost_usd": res["cost_usd"], "tokens": res["tokens"], "model": f"{model}/{effort}",
                                "store": store}) + "\n")
        done += len(res["answers"])
        print(f"batch {s // BATCH + 1}/{-(-len(todo) // BATCH)} · {len(res['answers'])}/{len(batch)} answered · "
              f"{res['seconds']:.0f} s · {res['tokens']['output_tokens']:,} tokens out · ≈${res['cost_usd']:.3f}", flush=True)


# ---------------------------------------------------------------------------------------------- results
def summary(pool_: List[Dict[str, Any]], bundles: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    from . import cards
    ans = cards.store(STORE)
    by = {"YouTube": Counter(), "Bin Baz": Counter()}
    for r in pool_:
        a = ans.get(finding_key(r))
        if a:
            v = a["answer"]
            by["YouTube" if r["doc_id"].startswith("yt_") else "Bin Baz"][
                VERDICT[v["verdict"]] + (f" · {BOUNDARY[v['boundary']]}" if v.get("boundary") else "")] += 1
    log = cards.LABELS_DIR / "sonnet_runs.jsonl"
    runs = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []
    n = sum(x["answered"] for x in runs)
    usage = {"calls": len(runs), "cards answered": n,
             "time": f"{sum(x['seconds'] for x in runs) / 60:.1f} min ({sum(x['seconds'] for x in runs) / max(1, n):.1f} s per card)",
             "tokens out": f"{sum(x['tokens']['output_tokens'] for x in runs):,}",
             "tokens in (cache write / read)": f"{sum(x['tokens']['cache_creation_input_tokens'] for x in runs):,} / "
                                               f"{sum(x['tokens']['cache_read_input_tokens'] for x in runs):,}",
             "API-equivalent cost": f"${sum(x['cost_usd'] for x in runs):.2f} (${sum(x['cost_usd'] for x in runs) / max(1, n) * 1000:.0f} per 1,000 cards)"}
    return {"pool": len(pool_), "labelled": sum(sum(c.values()) for c in by.values()), "by source": {k: dict(v) for k, v in by.items()},
            "usage": usage}


CHECK = {"right": "✔ Sonnet is right", "wrong": "✘ Sonnet is wrong", "unsure": "? Not sure"}


def spot_check(pool_: List[Dict[str, Any]], bundles: Dict[str, Dict[str, Any]], every: int = 7):
    """Every `every`-th labelled finding, with Sonnet's answer and reason: one click = your judgement + next card."""
    from . import cards
    ans = cards.store(STORE)
    items = [r for r in pool_ if finding_key(r) in ans][::every]

    def extra(r):
        a = ans[finding_key(r)]["answer"]
        lab = VERDICT[a["verdict"]] + (f" · {BOUNDARY[a['boundary']]}" if a.get("boundary") else "")
        return f"<div class='sec'><div class='lbl'>Sonnet's answer</div><b>{cards.esc(lab)}</b> — {cards.esc(a['reason'])}</div>"

    def summ(its, got):
        c = Counter(got[finding_key(r)]["answer"] for r in its if finding_key(r) in got)
        n = c["right"] + c["wrong"]
        return {"checked": sum(c.values()), "of": len(its), "Sonnet right": pct(c["right"], n), "wrong": c["wrong"]}

    return cards.Reviewer(items, CHECK_STORE, key=finding_key, mode="choice", choices=CHECK,
                          render=lambda r: cards.render_finding(r, bundles[r["_bundle"]], extra=extra(r), ctx=16), summary=summ)
