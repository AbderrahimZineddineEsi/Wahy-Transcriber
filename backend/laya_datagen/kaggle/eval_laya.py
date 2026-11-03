"""Score a Laya checkpoint on the Wahy test set, per label source, against the cached baselines.

    python eval_laya.py predict --model MODEL --test test.jsonl --name soft_asis --out results/soft_asis.json
    python eval_laya.py compare results/*.json

laya_v2 rows (one per passage of consecutive verses, yes/no boundary questions) are scored PER VERSE: the passage's
verdict goes to each of its labelled verses, "start cut off" to the first one and "end cut off" to the last, and the
two yes/no answers become the 4 v1 boundary classes. So a v1 model on v1 rows and a v2 model on v2 rows are scored on
the same cards with the same numbers (`per_verse`).

Groups: your labels / Sonnet's (review lessons, other lectures, all) / you + Sonnet / the Bin Baz written text.
Per group: verdict confusion matrix, "not a quote" precision / recall (rejection quality), share of real quotes
wrongly rejected (the costly error), AUC, Brier, ECE + reliability bins, the same after correcting for the app's
class balance, a threshold sweep, results by span length, and boundary accuracy. 95 % Wilson intervals on rates.
Self-contained (numpy + laya) so it runs on Kaggle and locally alike.
"""
import argparse
import json
import math
import re
import sys
import time
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

VERDICTS = ["CORRECT", "FALSE", "NOT_SURE"]
BOUNDARIES = ["COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH"]
SPAN_BINS = (("1-3 words", 1, 3), ("4-8 words", 4, 8), ("9+ words", 9, 10 ** 6))
THRESHOLDS = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95)
# test_verse_flags.json (built from the A+D envelope, so every model is sliced the same way)
CONTEXT_SLICES = (("inside a passage of consecutive verses", lambda c: c.get("in_passage")),
                  ("next to a verse of the same surah (<= 3 ayat away)", lambda c: c.get("neighbour_same_surah")),
                  ("short (1-3 words) and isolated", lambda c: c.get("short") and not c.get("in_passage") and not c.get("neighbour_same_surah")),
                  ("short (1-3 words) with a same-surah verse around", lambda c: c.get("short") and (c.get("in_passage") or c.get("neighbour_same_surah"))),
                  ("has any neighbour finding (<= 40 words)", lambda c: c.get("has_neighbour")),
                  ("no neighbour finding", lambda c: c and not c.get("has_neighbour")))


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def groups(rows):
    """name -> rows. A row's group is set by who labelled it (meta.source) and where it is (meta.group)."""
    sonnet = lambda r: r["meta"]["source"].startswith("sonnet")
    return {
        "you": [r for r in rows if r["meta"]["source"] == "user"],
        "Sonnet · review lessons": [r for r in rows if sonnet(r) and r["meta"]["group"] == "review"],
        "Sonnet · other lectures": [r for r in rows if sonnet(r) and r["meta"]["group"] == "lectures"],
        "Sonnet · all": [r for r in rows if sonnet(r)],
        "you + Sonnet": [r for r in rows if r["meta"]["source"] == "user" or sonnet(r)],
        "written text": [r for r in rows if r["meta"]["source"] == "written"],
    }


# ---------------------------------------------------------------------------------------------- prediction

def predict(model, rows, device="auto", batch_size=16):
    """id -> {question: {label: p}} with the checkpoint's own temperatures and max_len (1024 for v1, 2048 for v2).
    A yes/no question comes back as {"false": 1 - p, "true": p}."""
    import laya
    import torch
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    agent = laya.load(model, device=device)
    max_len, head = agent.cfg.get("max_len", 1024), agent.cfg.get("head_max_len", 256)
    trained = agent.cfg.get("wahy_questions")        # run 4: a model trained on some questions is asked only those
    by_q = {}
    for r in rows:                                  # predict_batch takes one question set: group rows by theirs
        by_q.setdefault(json.dumps(r["questions"], sort_keys=True), []).append(r)
    out, t0, done = {}, time.time(), 0
    for group in by_q.values():
        questions = {q: d for q, d in group[0]["questions"].items() if not trained or q in trained}
        for i in range(0, len(group), batch_size):
            chunk = group[i:i + batch_size]
            res = agent.predict_batch([r["state"] for r in chunk], questions, batch_size=batch_size, max_len=max_len, head_max_len=head)
            for r, x in zip(chunk, res):
                a = x["answers"]
                out[r["id"]] = {q: ({"false": 1 - float(a[q]["noul"]), "true": float(a[q]["noul"])} if "noul" in a[q] else
                                    {k: float(v) for k, v in a[q]["probabilities"].items()}) for q in questions if q in a}
            done += len(chunk)
            if (done // batch_size) % 20 == 0:
                print(f"  {done}/{len(rows)} rows, {time.time() - t0:.0f}s", flush=True)
    return out


# ---------------------------------------------------------------------------------------------- per verse

def per_verse(rows, P, flags=None):
    """(verse rows, verse P): v2 passage rows expanded to their labelled verses; v1 rows kept. Every verse P gets
    `boundary_status` (4 classes) and the yes/no `start_missing` / `end_missing` P(true). `flags` (id -> context
    flags, test_verse_flags.json) is copied into meta["context"] so slices are the same for every model."""
    vrows, vP, seen = [], {}, set()
    for r in rows:
        p = P.get(r["id"])
        members = r["meta"].get("members")
        if not members:                                    # v1 row (or a v2 single finding stored the v1 way)
            members = [{"id": r["id"], "position": "only", "meta": r["meta"]}]
        for m in members:
            if m["id"] in seen:                            # a verse is scored once
                continue
            seen.add(m["id"])
            vr = {"id": m["id"], "meta": dict(m["meta"])}
            if flags is not None:
                vr["meta"]["context"] = flags.get(m["id"], {})
            vrows.append(vr)
            if p is None:
                continue
            d = {}
            if "verdict" in p:
                d["verdict"] = p["verdict"]
            if "start_missing" in p or "end_missing" in p:
                first, last = m["position"] in ("only", "first"), m["position"] in ("only", "last")
                ps = p.get("start_missing", {}).get("true", 0.0) if first else 0.0
                pe = p.get("end_missing", {}).get("true", 0.0) if last else 0.0
                d["boundary_status"] = {"COMPLETE_SPAN": (1 - ps) * (1 - pe), "MISSING_START": ps * (1 - pe),
                                        "MISSING_END": (1 - ps) * pe, "MISSING_BOTH": ps * pe}
            elif "boundary_status" in p:
                d["boundary_status"] = p["boundary_status"]
            if "boundary_status" in d:
                b = d["boundary_status"]
                d["start_missing"] = b.get("MISSING_START", 0.0) + b.get("MISSING_BOTH", 0.0)
                d["end_missing"] = b.get("MISSING_END", 0.0) + b.get("MISSING_BOTH", 0.0)
            vP[m["id"]] = d
    return vrows, vP


# ---------------------------------------------------------------------------------------------- metrics

def wilson(k, n, z=1.96):
    """(rate, low, high): the 95 % interval of a proportion; on 27 cards one mistake is ~4 points."""
    if not n:
        return [None, None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(p, 4), round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def auc(y, s):
    y, s = np.asarray(y, bool), np.asarray(s, float)
    n1, n0 = int(y.sum()), int((~y).sum())
    if not n1 or not n0:
        return None
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(len(s))
    ranks[order] = np.arange(1, len(s) + 1)
    for v in np.unique(s):                      # average ranks for ties (hard predictions tie a lot)
        m = s == v
        ranks[m] = ranks[m].mean()
    return round(float((ranks[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)), 4)


def ece(conf, correct, bins=15):
    conf, correct = np.asarray(conf, float), np.asarray(correct, float)
    if not len(conf):
        return None
    edges = np.linspace(0, 1, bins + 1)
    e = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi) if lo > 0 else (conf >= lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return round(float(e), 4)


def reliability(p_false, is_false, bins=5):
    """Bins of predicted P(not a quote) vs how often the card really is not a quote: calibrated = the two match."""
    p, y = np.asarray(p_false, float), np.asarray(is_false, float)
    out = []
    for lo, hi in zip(np.linspace(0, 1, bins + 1)[:-1], np.linspace(0, 1, bins + 1)[1:]):
        m = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        if m.any():
            out.append({"bin": f"{lo:.1f}-{hi:.1f}", "cards": int(m.sum()), "mean predicted": round(float(p[m].mean()), 3),
                        "observed": round(float(y[m].mean()), 3)})
    return out


def decide(p, w=None):
    """argmax of the verdict probabilities, optionally re-weighted per class (prior correction)."""
    if w:
        p = {k: v * w.get(k, 1.0) for k, v in p.items()}
    return max(VERDICTS, key=lambda k: p.get(k, 0.0))


def rejection(gold, pred):
    """Rejection quality for one set of decisions: "not a quote" precision / recall, real quotes wrongly rejected."""
    tp = sum(g == "FALSE" and q == "FALSE" for g, q in zip(gold, pred))
    pred_f = sum(q == "FALSE" for q in pred)
    n_f = sum(g == "FALSE" for g in gold)
    n_c = sum(g == "CORRECT" for g in gold)
    rej = sum(g == "CORRECT" and q == "FALSE" for g, q in zip(gold, pred))
    return {"not-a-quote precision": wilson(tp, pred_f), "not-a-quote recall": wilson(tp, n_f),
            "real quotes wrongly rejected": wilson(rej, n_c), "wrongly rejected (count)": f"{rej}/{n_c}"}


def verdict_metrics(rows, P, train_false_share=None, app_false_share=0.10):
    rows = [r for r in rows if r["id"] in P and "verdict" in P[r["id"]]]
    if not rows:
        return None
    gold = [r["meta"]["verdict"] for r in rows]
    probs = [P[r["id"]]["verdict"] for r in rows]
    pred = [decide(p) for p in probs]
    conf = Counter(zip(gold, pred))
    binary = [i for i, g in enumerate(gold) if g in ("CORRECT", "FALSE")]
    y = [gold[i] == "FALSE" for i in binary]
    pf = [probs[i].get("FALSE", 0.0) for i in binary]
    m = {"cards": len(rows), "real": gold.count("CORRECT"), "not a quote": gold.count("FALSE"), "unsure": gold.count("NOT_SURE"),
         "accuracy": wilson(sum(g == q for g, q in zip(gold, pred)), len(rows)),
         "confusion (gold -> predicted)": {g: {q: conf[(g, q)] for q in VERDICTS} for g in VERDICTS if gold.count(g)},
         **rejection(gold, pred),
         "predicted unsure": sum(q == "NOT_SURE" for q in pred),
         "AUC P(not a quote)": auc(y, pf),
         "Brier P(not a quote)": round(float(np.mean([(p - t) ** 2 for p, t in zip(pf, y)])), 4) if y else None,
         "ECE (top-1)": ece([max(p.values()) for p in probs], [g == q for g, q in zip(gold, pred)]),
         "reliability": reliability(pf, y)}
    if train_false_share:
        # Bayes prior shift: p_app(c|x) ∝ p_train(c|x) · π_app(c) / π_train(c). Training saw ~46 % "not a quote",
        # the app's stream ~10 %, so without this the model rejects more often than the real stream warrants.
        w = {"FALSE": app_false_share / train_false_share, "CORRECT": (1 - app_false_share) / (1 - train_false_share)}
        m["prior-corrected to %d %% not a quote" % round(app_false_share * 100)] = rejection(gold, [decide(p, w) for p in probs])
    m["threshold sweep (reject if P(not a quote) >= t)"] = [
        {"t": t, **rejection(gold, ["FALSE" if p.get("FALSE", 0) >= t else "CORRECT" for p in probs])} for t in THRESHOLDS]
    m["by context"] = []
    for name, sel in CONTEXT_SLICES:
        idx = [i for i, r in enumerate(rows) if sel(r["meta"].get("context") or {})]
        if idx:
            g, q = [gold[i] for i in idx], [pred[i] for i in idx]
            m["by context"].append({"slice": name, "cards": len(idx), "real": g.count("CORRECT"), "not a quote": g.count("FALSE"),
                                    "accuracy": wilson(sum(a == b for a, b in zip(g, q)), len(idx)), **rejection(g, q)})
    m["by span length"] = []
    for name, lo, hi in SPAN_BINS:
        idx = [i for i, r in enumerate(rows) if lo <= r["meta"]["span_words"] <= hi]
        if idx:
            g, q = [gold[i] for i in idx], [pred[i] for i in idx]
            m["by span length"].append({"span": name, "cards": len(idx), "real": g.count("CORRECT"), "not a quote": g.count("FALSE"),
                                        "accuracy": wilson(sum(a == b for a, b in zip(g, q)), len(idx)), **rejection(g, q)})
    return m


def boundary_metrics(rows, P, thresholds=None):
    """`thresholds` = {"start": t, "end": t} (tune_thresholds): the yes/no answers are cut there instead of at 0.5
    and the 4 classes are built from the two decisions."""
    rows = [r for r in rows if r["meta"]["verdict"] == "CORRECT" and r["meta"]["boundary"] and "boundary_status" in P.get(r["id"], {})]
    if not rows:
        return None
    gold = [r["meta"]["boundary"] for r in rows]
    if thresholds:
        cls = {(False, False): "COMPLETE_SPAN", (True, False): "MISSING_START", (False, True): "MISSING_END", (True, True): "MISSING_BOTH"}
        pred = [cls[(P[r["id"]]["start_missing"] >= thresholds["start"], P[r["id"]]["end_missing"] >= thresholds["end"])] for r in rows]
    else:
        pred = [max(BOUNDARIES, key=lambda k: P[r["id"]]["boundary_status"].get(k, 0.0)) for r in rows]
    conf = Counter(zip(gold, pred))
    # per-class recall: "always COMPLETE_SPAN" gets accuracy = the class share but balanced accuracy = 1 / classes
    recall = {b: wilson(conf[(b, b)], gold.count(b)) for b in BOUNDARIES if gold.count(b)}
    incomplete = [i for i, g in enumerate(gold) if g != "COMPLETE_SPAN"]
    sides = {}
    for side, cut in (("start", ("MISSING_START", "MISSING_BOTH")), ("end", ("MISSING_END", "MISSING_BOTH"))):
        if not all(f"{side}_missing" in P[r["id"]] for r in rows):
            continue
        y = [g in cut for g in gold]
        p = [P[r["id"]][f"{side}_missing"] for r in rows]
        yhat = [x >= (thresholds or {}).get(side, 0.5) for x in p]
        tp = sum(a and b for a, b in zip(y, yhat))
        rec_t, rec_f = wilson(tp, sum(y)), wilson(sum((not a) and (not b) for a, b in zip(y, yhat)), len(y) - sum(y))
        sides[f"{side} cut off"] = {"cut off": sum(y), "recall (caught)": rec_t, "precision": wilson(tp, sum(yhat)),
                                    "balanced accuracy": round((rec_t[0] + rec_f[0]) / 2, 4) if rec_t[0] is not None and rec_f[0] is not None else None,
                                    "AUC": auc(y, p)}
    return {"cards": len(rows), "accuracy": wilson(sum(g == q for g, q in zip(gold, pred)), len(rows)),
            **sides,
            "balanced accuracy": round(sum(v[0] for v in recall.values()) / len(recall), 4),
            "recall per class": recall,
            "cut-off quotes caught (gold not complete, predicted not complete)":
                wilson(sum(pred[i] != "COMPLETE_SPAN" for i in incomplete), len(incomplete)),
            "complete vs not complete accuracy": wilson(sum((g == "COMPLETE_SPAN") == (q == "COMPLETE_SPAN") for g, q in zip(gold, pred)), len(rows)),
            "confusion (gold -> predicted)": {g: {q: conf[(g, q)] for q in BOUNDARIES} for g in BOUNDARIES if gold.count(g)},
            "ECE (top-1)": ece([max(P[r["id"]]["boundary_status"].values()) for r in rows], [g == q for g, q in zip(gold, pred)])}


def evaluate(rows, P, name, train_false_share=None, app_false_share=0.10, thresholds=None):
    return {"name": name, "groups": {g: {"verdict": verdict_metrics(rs, P, train_false_share, app_false_share),
                                         "boundary": boundary_metrics(rs, P, thresholds)} for g, rs in groups(rows).items() if rs}}


def tune_thresholds(rows, P):
    """{"start": t, "end": t}: per side, the cut on P(cut off) with the best balanced accuracy on these verses (val).
    A model that ranks cut-off quotes higher but never says yes at 0.5 is then judged at the cut it would use."""
    rows = [r for r in rows if r["meta"]["verdict"] == "CORRECT" and r["meta"]["boundary"] and r["id"] in P
            and "start_missing" in P[r["id"]]]
    out = {}
    for side, cut in (("start", ("MISSING_START", "MISSING_BOTH")), ("end", ("MISSING_END", "MISSING_BOTH"))):
        y = np.array([r["meta"]["boundary"] in cut for r in rows])
        p = np.array([P[r["id"]][f"{side}_missing"] for r in rows])
        best = (0.5, -1.0)
        if y.any() and (~y).any():
            for t in np.unique(np.r_[p, 0.5]):
                bal = ((p[y] >= t).mean() + (p[~y] < t).mean()) / 2
                if bal > best[1] + 1e-9:
                    best = (float(t), float(bal))
        out[side] = round(best[0], 6)
    return out


def baseline_predictions(baselines):
    """name -> P-like dict from baselines.json: teachers give a hard choice (probability 1), shortcuts P(not a quote)."""
    out = {}
    for name, ans in baselines.get("teachers", {}).items():
        out[name] = {}
        for k, a in ans.items():
            if a["verdict"] not in VERDICTS:
                continue
            d = {"verdict": {v: float(v == a["verdict"]) for v in VERDICTS}}
            if a.get("boundary") in BOUNDARIES:
                d["boundary_status"] = {b: float(b == a["boundary"]) for b in BOUNDARIES}
            out[name][k] = d
    for name, pf in baselines.get("shortcut", {}).items():
        out[name] = {k: {"verdict": {"CORRECT": 1 - p, "FALSE": p, "NOT_SURE": 0.0}} for k, p in pf.items()}
    return out


# ---------------------------------------------------------------------------------------------- boundary rule

_DIACRITICS = re.compile(r"[ً-ْٰـ]")


def _norm_words(s):
    out = []
    for w in (s or "").split():
        w = re.sub(r"[إأآٱ]", "ا", _DIACRITICS.sub("", w)).replace("ة", "ه").replace("ى", "ي")
        w = re.sub(r"[^ء-ي]", "", w)
        if w:
            out.append(w)
    return out


def _similar(a, b):
    return a == b or (len(a) > 2 and len(b) > 2 and SequenceMatcher(None, a, b).ratio() >= 0.75)


def rule_boundary(state, k=2):
    """The boundary from the envelope fields alone, as the question's instructions describe it: a quote is cut at the start
    if one of the k corpus words just before the matched part is (ASR-spelled) among the last k + 2 ASR words before the
    span; at the end, the same with the words after. No model: the yardstick a fine-tuned Laya has to beat."""
    pre, before = _norm_words(state.get("unmatched_corpus_prefix_words"))[-k:], _norm_words(state.get("immediate_transcript_before"))[-(k + 2):]
    suf, after = _norm_words(state.get("unmatched_corpus_suffix_words"))[:k], _norm_words(state.get("immediate_transcript_after"))[:k + 2]
    start = any(_similar(w, x) for w in pre for x in before)
    end = any(_similar(w, x) for w in suf for x in after)
    return BOUNDARIES[0] if not (start or end) else "MISSING_BOTH" if start and end else "MISSING_START" if start else "MISSING_END"


def rule_predictions(rows):
    """P-like dict of the rule, boundary question only (one-hot). v1 rows (one per verse)."""
    return {r["id"]: {"boundary_status": {b: float(b == rule_boundary(r["state"])) for b in BOUNDARIES}} for r in rows}


# ---------------------------------------------------------------------------------------------- report

KEYS = (("accuracy", "verdict accuracy"), ("not-a-quote recall", "not-a-quote recall"),
        ("not-a-quote precision", "not-a-quote precision"), ("real quotes wrongly rejected", "real wrongly rejected"),
        ("AUC P(not a quote)", "AUC"), ("ECE (top-1)", "ECE"))


def _fmt(v):
    if isinstance(v, list):
        return "—" if v[0] is None else f"{100 * v[0]:.1f} % [{100 * v[1]:.0f}–{100 * v[2]:.0f}]"
    return "—" if v is None else f"{v:.3f}" if isinstance(v, float) else str(v)


def compare(results, group="you"):
    """Markdown table: one line per model on one group (cards in brackets = how many it was scored on)."""
    head = "| model | cards | " + " | ".join(h for _, h in KEYS) + " | boundary accuracy |"
    lines = [head, "|" + "---|" * (len(KEYS) + 3)]
    for res in results:
        g = res["groups"].get(group) or {}
        v, b = g.get("verdict"), g.get("boundary")
        if not v:
            continue
        lines.append(f"| {res['name']} | {v['cards']} | " + " | ".join(_fmt(v.get(k)) for k, _ in KEYS) +
                     f" | {_fmt(b['accuracy']) if b else '—'} |")
    return "\n".join(lines)


def compare_boundary(results, group="you"):
    """Markdown table of the boundary question only: balanced accuracy and recall of every class, per model."""
    lines = ["| model | cards | accuracy | **balanced accuracy** | cut-off quotes caught | " + " | ".join(BOUNDARIES) +
             " | start: balanced / AUC | end: balanced / AUC |",
             "|" + "---|" * (7 + len(BOUNDARIES))]
    for res in results:
        b = (res["groups"].get(group) or {}).get("boundary")
        if not b or "balanced accuracy" not in b:
            continue
        lines.append(f"| {res['name']} | {b['cards']} | {_fmt(b['accuracy'])} | **{_fmt(b['balanced accuracy'])}** | "
                     f"{_fmt(b['cut-off quotes caught (gold not complete, predicted not complete)'])} | " +
                     " | ".join(_fmt(b['recall per class'].get(c, [None])) for c in BOUNDARIES) + " | " +
                     " | ".join(f"{_fmt((b.get(k) or {}).get('balanced accuracy'))} / {_fmt((b.get(k) or {}).get('AUC'))}"
                                for k in ("start cut off", "end cut off")) + " |")
    return "\n".join(lines)


def compare_slices(results, group="you", part="by context"):
    """Markdown: one line per model, one column per slice (`by context` or `by span length`): accuracy and the share of
    real quotes wrongly rejected, the error the context fields are meant to fix."""
    names = []
    for res in results:
        for sl in (((res["groups"].get(group) or {}).get("verdict") or {}).get(part) or []):
            n = sl.get("slice") or sl.get("span")
            if n not in names:
                names.append(n)
    lines = ["| model | " + " | ".join(f"{n} (acc · real rejected)" for n in names) + " |", "|" + "---|" * (len(names) + 1)]
    for res in results:
        v = (res["groups"].get(group) or {}).get("verdict") or {}
        by = {(sl.get("slice") or sl.get("span")): sl for sl in v.get(part) or []}
        cells = [f"{_fmt(by[n]['accuracy'])} · {by[n]['wrongly rejected (count)']}" if n in by else "—" for n in names]
        lines.append(f"| {res['name']} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("predict")
    p.add_argument("--model", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--test", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--baselines", help="baselines.json: also score the cached JEV / Gemini / base-Laya / shortcut answers")
    p.add_argument("--train-false-share", type=float, help="share of 'not a quote' the model was trained on (manifest)")
    p.add_argument("--app-false-share", type=float, default=0.10)
    p.add_argument("--device", default="auto")
    p.add_argument("--batch-size", type=int, default=16)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--verse-flags", help="test_verse_flags.json: context of every verse, for the 'by context' slices")
    p.add_argument("--tune-val", help="val.jsonl: tune the yes/no boundary thresholds there, add res['tuned'] on test")
    c = sub.add_parser("compare")
    c.add_argument("files", nargs="+")
    c.add_argument("--group", action="append")
    a = ap.parse_args(argv)
    if a.cmd == "predict":
        rows = read_jsonl(a.test)[: a.limit or None]
        flags = json.loads(Path(a.verse_flags).read_text(encoding="utf-8")) if a.verse_flags else None
        P = predict(a.model, rows, a.device, a.batch_size)
        vrows, vP = per_verse(rows, P, flags)
        res = evaluate(vrows, vP, a.name, a.train_false_share, a.app_false_share)
        res["predictions"] = P
        res["verse_predictions"] = vP
        if a.tune_val:
            vr, vp = per_verse(read_jsonl(a.tune_val), predict(a.model, read_jsonl(a.tune_val), a.device, a.batch_size))
            th = tune_thresholds(vr, vp)
            res["thresholds"] = th
            res["tuned"] = evaluate(vrows, vP, a.name + f" (tuned {th['start']:.2f}/{th['end']:.2f})", thresholds=th)
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        if a.baselines:
            for name, BP in baseline_predictions(json.loads(Path(a.baselines).read_text(encoding="utf-8"))).items():
                br = evaluate(*per_verse(rows, BP, flags), name)
                Path(a.out).with_name("baseline_" + name.split(" (")[0].replace(" ", "_").lower() + ".json").write_text(
                    json.dumps(br, ensure_ascii=False, indent=1), encoding="utf-8")
        print(compare([res], "you"))
    else:
        results = [json.loads(Path(f).read_text(encoding="utf-8")) for f in a.files]
        for g in a.group or ["you", "you + Sonnet", "Sonnet · other lectures", "written text"]:
            print(f"\n### {g}\n" + compare(results, g))


if __name__ == "__main__":
    sys.exit(main())
