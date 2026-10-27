"""Every label you have for engine findings, by reviewer, and how much of it can train Laya.

Reviewers: you (stages 2 / 4, negatives sprint), the automatic label from Bin Baz's written text, JEV, Gemini, base Laya,
DeepSeek, Sonnet (per effort). Model answers (JEV / Gemini / Laya / DeepSeek) are cached under a hash of the envelope they
were asked about, so they are mapped back to findings by recomputing that hash for every finding we have.

Usable for training = a finding with an envelope (Laya's input) and a verdict Laya's question can express (real / not a
quote / unsure; "ayah inside a hadith" counts as real, "quoted by meaning" is not an option yet), labelled by you, the
written text or Sonnet (never by JEV / Gemini / base Laya), one label per finding.
"""
from __future__ import annotations

import json
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from . import engine_eval as ev
from . import lectures, stages
from .cache import DATA_DIR, sha
from .teachers.base import Teacher

LABELS = DATA_DIR / "labels"
CACHE = DATA_DIR / "cache"
EXPORTABLE = {"CORRECT": "CORRECT", "IN_HADITH": "CORRECT", "FALSE": "FALSE", "NOT_SURE": "NOT_SURE"}
# (cache folder, teacher name, model) as run in laya_review.ipynb (stage 5, negatives sprint)
TEACHERS = [("JEV", "jev", "typesafe/jev-1.14"), ("Gemini", "gemini", "gemini-3.5-flash-lite"),
            ("Laya (base)", "laya", "convaiinnovations/laya-multilingual"),
            ("Laya (base)", "laya", "convaiinnovations/laya-multilingual|agnostic"),
            ("DeepSeek", "orchat", "deepseek/deepseek-chat")]


def _load(name: str) -> Dict[str, Any]:
    p = LABELS / f"{name}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def collect(engines_review=("v3", "v4", "v5", "v5:loose"), engines_lectures=("v4", "v5", "v5:loose"), with_bundles=False):
    """All finding records we have (review lessons + lecture batches 1 and 2), and which set each document is in.
    Engines other than v3 / v4 come from engine_eval's cache (run them once in notebooks/data/laya_engine_v5.ipynb).
    `with_bundles`: also return doc -> bundle (its ASR words and every engine's records), for laya_v2."""
    review, ls = ev.load()
    for e in engines_review:
        if e not in ("v3", "v4"):
            ev.add_engine(review, ls, e)
    yt = {**lectures.YOUTUBE, **{f"{k} (2)": v for k, v in lectures.YOUTUBE_2.items()}}
    lec, lls = ev.load_lectures(yt, lectures.BINBAZ + lectures.BINBAZ_2)
    for e in engines_lectures:
        if e != "v4":
            ev.add_engine(lec, lls, e)
    b1 = {f"yt_{v}" for vs in lectures.YOUTUBE.values() for v in vs} | \
         {"binbaz_audio_" + u.split("/audios/")[1].split("/")[0] for u in lectures.BINBAZ}
    where = {d: "review (15 Bin Baz lessons)" for d in review}
    where.update({d: "lectures batch 1" if d in b1 else "lectures batch 2" for d in lec})
    recs: Dict[str, Dict[str, Any]] = {}
    for b in list(review.values()) + list(lec.values()):
        for r in b["records"]:
            recs.setdefault(stages.finding_key(r), r)
    if with_bundles:
        return recs, where, {**review, **lec}
    return recs, where


def answers(recs: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """reviewer -> {finding key: {"verdict", "boundary"}} for every reviewer."""
    out: Dict[str, Dict[str, Dict[str, Any]]] = {}
    out["You — stages 2 / 4"] = {k: {"verdict": v["answer"]["verdict"], "boundary": v["answer"].get("boundary")}
                                 for k, v in _load("findings").items()}
    out["You — negatives sprint"] = {k: {"verdict": v["answer"] if isinstance(v["answer"], str) else v["answer"]["verdict"],
                                         "boundary": None} for k, v in _load("sprint").items()}
    out["Automatic (Bin Baz written text)"] = {
        k: {"verdict": r["label"]["verdict"], "boundary": r["label"].get("boundary")}
        for k, r in recs.items() if r["label"]["tier"] in stages.GT_TIERS and r["label"]["verdict"]}
    # model answers: hash of the envelope, as Teacher.key() computes it
    for who, name, model in TEACHERS:
        folder = CACHE / f"teacher_{name}"
        if not folder.exists():
            continue
        have = {p.stem for p in folder.glob("*.json")}
        got = out.setdefault(who, {})
        for k, r in recs.items():
            h = sha(name, model, Teacher.prompt_version, r["envelope"]["state"], r["envelope"]["questions"])
            if h in have:
                a = json.loads((folder / f"{h}.json").read_text(encoding="utf-8"))
                got[k] = {"verdict": a.get("verdict"), "boundary": a.get("boundary")}
    for store in ("sonnet", "sonnet_engine_eval", "sonnet_cmp_medium", "sonnet_cmp_high"):
        for k, v in _load(store).items():
            effort = (v.get("model") or "sonnet/high").split("/")[-1]
            out.setdefault(f"Sonnet 5.5 — {effort}", {}).setdefault(k, {"verdict": v["answer"]["verdict"],
                                                                         "boundary": v["answer"].get("boundary")})
    return out


def teacher_cache_sizes() -> Dict[str, int]:
    return {n: len(list((CACHE / f"teacher_{n}").glob("*.json"))) for n in ("jev", "gemini", "laya", "orchat")
            if (CACHE / f"teacher_{n}").exists()}


def by_reviewer(ans, recs, where) -> List[Dict[str, Any]]:
    rows = []
    for who, a in ans.items():
        c = Counter(x["verdict"] for x in a.values())
        sets = Counter(where.get(recs[k]["doc_id"], "?") if k in recs else "finding not found" for k in a)
        rows.append({"reviewer": who, "answers": len(a), **{f"verdict {v}": n for v, n in c.items()},
                     **{f"in {s}": n for s, n in sets.items()}})
    return rows


PRIORITY = ["You — stages 2 / 4", "You — negatives sprint", "Automatic (Bin Baz written text)",
            "Sonnet 5.5 — high", "Sonnet 5.5 — medium"]


def usable(ans, recs, where) -> List[Dict[str, Any]]:
    """One row per finding: the best label among you > written text > Sonnet high > Sonnet medium (JEV / Gemini /
    base Laya never used). Rows whose verdict Laya cannot express yet (quoted by meaning) are kept with exportable=False."""
    rows = []
    for k, r in recs.items():
        for who in PRIORITY:
            a = ans.get(who, {}).get(k)
            if a and a["verdict"]:
                v = a["verdict"]
                rows.append({"key": k, "doc": r["doc_id"], "set": where.get(r["doc_id"], "?"), "source": who,
                             "verdict": EXPORTABLE.get(v, v), "exportable": v in EXPORTABLE,
                             "boundary": a.get("boundary") if EXPORTABLE.get(v) == "CORRECT" else None,
                             "unit": r["det"].get("unitId"), "ws": r["det"]["wordStartIdx"], "we": r["det"]["wordEndIdx"]})
                break
    # "places": findings of the same text overlapping in the same lecture are one place (near-duplicate spans)
    rows.sort(key=lambda x: (x["doc"], x["unit"] or "", x["ws"]))
    place, last = 0, None
    for x in rows:
        if not (last and last["doc"] == x["doc"] and last["unit"] == x["unit"] and x["ws"] <= last["we"]):
            place += 1
            last = dict(x)
        else:
            last["we"] = max(last["we"], x["we"])
        x["place"] = place
    return rows


def summary(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    ex = [x for x in rows if x["exportable"]]
    c = Counter(x["verdict"] for x in ex)
    return {"findings": len(ex), "places": len({x["place"] for x in ex}), "real": c["CORRECT"], "not a quote": c["FALSE"],
            "unsure": c["NOT_SURE"], "with a boundary": sum(1 for x in ex if x["boundary"])}


def splits(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """A: your labels are the test set, train = everything else minus findings at a place you labelled.
    B: the 15 reviewed Bin Baz lessons are the test set (whatever labelled them), train = the lecture batches."""
    mine = {"You — stages 2 / 4", "You — negatives sprint"}
    test_a = [x for x in rows if x["source"] in mine]
    test_places = {x["place"] for x in test_a}
    train_a = [x for x in rows if x["source"] not in mine and x["place"] not in test_places]
    test_b = [x for x in rows if x["set"].startswith("review")]
    train_b = [x for x in rows if not x["set"].startswith("review")]
    return {"A · test = your labels": summary(test_a), "A · train = the rest": summary(train_a),
            "B · test = 15 review lessons": summary(test_b), "B · train = lecture batches": summary(train_b),
            "all usable": summary(rows), "quoted by meaning (not exportable yet)": {"findings": sum(1 for x in rows if x["verdict"] == "PARAPHRASE")}}
