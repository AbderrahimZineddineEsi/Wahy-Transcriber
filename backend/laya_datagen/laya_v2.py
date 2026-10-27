"""Laya fine-tuning dataset v2: the ablation folder for run 3 (envelope v2, docs/laya-finetune/envelope-v2.md).

Same labels, same lectures and same train / val / test split as laya_v1 (laya_dataset.assign_splits). What changes is
what Laya reads, and every state is built by the app's own code (js/ai-verifier.js buildLayaV2Requests, run through
js/harness.js), so the training rows and the app cannot drift apart:

  base        envelope v2: lecture fields before the corpus text, no duplicate verse text, boundary = two yes/no
              questions (start_missing / end_missing) with the word-overlap evidence in the state
  passages    + consecutive verses found back to back are one row (D)
  neighbours  + the engine's nearest other findings, without verdicts (A)
  both        + both (A + D)
  both_synth  both + counterfactual boundary rows in train: a complete quote with 1-3 of its edge words moved out
              of the span is a "start / end cut off" example whose label is right by construction

Every variant has its own train / val / test (a passage row only exists in the passage variants); the evaluation
scores all of them per verse (eval_laya.per_verse), and the old model on laya_v1/test.jsonl, on the same cards.
"""
from __future__ import annotations

import datetime
import json
import random
import shutil
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import inventory
from .cache import DATA_DIR
from .engine_bridge import EngineBridge
from .export import EPS_BY_SOURCE, VERDICTS
from .laya_dataset import (BASE_MODEL, HARD, LABEL_FILES, SOURCE_KEY, TRAIN_SOURCES, _sha_file, _write_jsonl,
                           assign_splits, lecture_info, shortcut_baselines, teacher_baselines)
from .laya_dataset import OUT as V1_OUT

OUT = DATA_DIR / "datasets" / "laya_v2"
KAGGLE_DIR = Path(__file__).parent / "kaggle"
ENVELOPE = 2
MAX_LEN, HEAD_MAX_LEN = 2048, 256
SEED = 20261027
VARIANTS = {
    "base": {"passages": False, "neighbours": False, "synth": False,
             "about": "envelope v2 alone (field order, no duplicate verse text, yes/no boundary + evidence)"},
    "passages": {"passages": True, "neighbours": False, "synth": False, "about": "+ consecutive verses as one row (D)"},
    "neighbours": {"passages": False, "neighbours": True, "synth": False, "about": "+ nearest other findings, no verdicts (A)"},
    "both": {"passages": True, "neighbours": True, "synth": False, "about": "+ D + A"},
    "both_synth": {"passages": True, "neighbours": True, "synth": True,
                   "about": "D + A + counterfactual 'cut off' boundary rows in train"},
}
SYNTH_MAX = 700             # counterfactual rows in train: ~2x the real "cut off" answers (169 start + 132 end)
SYNTH_K = (1, 2, 3)         # words moved out of the span
DET_DROP = ("unit_words", "unit_len", "envelope")


# ---------------------------------------------------------------------------------------------- inputs

def load_inputs():
    """(recs, where, bundles, usable rows): every finding, which set each lecture is in, the lectures' ASR words and
    every engine's records, and one label per finding (inventory.usable)."""
    recs, where, bundles = inventory.collect(with_bundles=True)
    ans = inventory.answers(recs)
    return recs, where, bundles, ans, inventory.usable(ans, recs, where)


def labels_by_key(recs, where, usable_rows) -> Tuple[Dict[str, Dict[str, Any]], Counter]:
    """finding key -> {verdict, boundary, source, split, ...}: the labels laya_v1 uses, same split, same drops."""
    info = lecture_info(where)
    split = assign_splits(info)
    out, dropped = {}, Counter()
    for x in usable_rows:
        if not x["exportable"]:
            dropped["quoted by meaning (not an option of Laya's question)"] += 1
            continue
        src = SOURCE_KEY[x["source"]]
        s = split[x["doc"]]
        if s != "test" and src not in TRAIN_SOURCES:
            dropped[f"{src} label in {s} (test-only source)"] += 1
            continue
        rec = recs[x["key"]]
        i = info[x["doc"]]
        out[x["key"]] = {"verdict": x["verdict"], "boundary": x["boundary"], "source": src, "split": s,
                         "doc_id": x["doc"], "engine": rec["engine"], "group": i["group"], "batch": i["batch"],
                         "speaker": i["speaker"], "place": x["place"], "flags": rec["label"].get("flags", []),
                         "source_type": rec["det"].get("sourceType")}
    return out, dropped


def key_of(doc_id: str, det: Dict[str, Any]) -> str:
    return f"{doc_id}|{det['wordStartIdx']}-{det['wordEndIdx']}|{det.get('unitId')}"


def runs(recs, bundles, labels) -> Dict[Tuple[str, str], Dict[str, Any]]:
    """(doc, engine) -> {words, dets, keys, targets}: every engine run that holds a labelled finding. A label belongs to
    the run of the engine its record came from (inventory keeps the first engine that found the span)."""
    want: Dict[Tuple[str, str], set] = {}
    for k, lab in labels.items():
        want.setdefault((lab["doc_id"], lab["engine"]), set()).add(k)
    out = {}
    for (doc, engine), keys in want.items():
        b = bundles[doc]
        dets = [{k: v for k, v in r["det"].items() if k not in DET_DROP} for r in b["records"] if r["engine"] == engine]
        dkeys = [key_of(doc, d) for d in dets]
        out[(doc, engine)] = {"engine": engine, "words": [w["word"] for w in b["asr_words"]], "dets": dets, "keys": dkeys,
                              "unit_words": {r["det"].get("unitId"): r["det"].get("unit_words") for r in b["records"]
                                             if r["engine"] == engine},
                              "targets": [i for i, k in enumerate(dkeys) if k in keys]}
    return out


# ---------------------------------------------------------------------------------------------- rows

def _noul(p_true: float) -> Dict[str, Any]:
    return {"probabilities": {"false": round(1 - p_true, 4), "true": round(p_true, 4)}}


def _soft(choice: str, eps: float) -> Dict[str, float]:
    rest = eps / (len(VERDICTS) - 1)
    return {o: round(1 - eps if o == choice else rest, 4) for o in VERDICTS}


def position(i: int, n: int) -> str:
    return "only" if n == 1 else "first" if i == 0 else "last" if i == n - 1 else "inner"


def make_row(req, run, labels, labels_kind: str = "soft") -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """One Laya row for one request, or (None, why) when its labelled verses disagree (a passage mixing a real verse
    and a 'not a quote' one: kept in test, where each verse is scored on its own, dropped from train / val)."""
    keys = [run["keys"][i] for i in req["members"]]
    # a label counts in the engine run it was given in: the same span found by another engine is another finding
    labs = [l if l and l["engine"] == run.get("engine", l["engine"]) else None for l in (labels.get(k) for k in keys)]
    known = [l for l in labs if l]
    verdicts = {l["verdict"] for l in known}
    split = known[0]["split"]
    mixed = len(verdicts) > 1
    if mixed and split != "test":
        return None, "passage with mixed labels (train / val)"
    verdict = Counter(l["verdict"] for l in known).most_common(1)[0][0]
    eps_src = [HARD if labels_kind == "hard" else EPS_BY_SOURCE[l["source"]] for l in known]
    gold = {"verdict": {"probabilities": _soft(verdict, max(e["verdict"] for e in eps_src))}}
    if verdict == "CORRECT" and not mixed:
        eb = max(e["boundary_status"] for e in eps_src)
        first, last = labs[0], labs[-1]
        if first and first.get("boundary"):
            gold["start_missing"] = _noul(1 - eb if first["boundary"] in ("MISSING_START", "MISSING_BOTH") else eb)
        if last and last.get("boundary"):
            gold["end_missing"] = _noul(1 - eb if last["boundary"] in ("MISSING_END", "MISSING_BOTH") else eb)
    lead = known[0]
    st = req["state"]
    members = [{"id": k, "position": position(i, len(keys)),
                "meta": {**{f: l[f] for f in ("doc_id", "split", "group", "batch", "speaker", "engine", "source", "verdict",
                                               "boundary", "source_type", "place", "flags")},
                         "span_words": len(" ".join(run["words"][run["dets"][m]["wordStartIdx"]:run["dets"][m]["wordEndIdx"] + 1]).split())}}
               for i, (k, l, m) in enumerate(zip(keys, labs, req["members"])) if l]
    row = {"id": keys[0] if len(keys) == 1 else "passage:" + ";".join(keys), "state": st, "questions": req["questions"],
           "gold": gold,
           "meta": {"doc_id": lead["doc_id"], "split": split, "group": lead["group"], "batch": lead["batch"],
                    "speaker": lead["speaker"], "engine": lead["engine"], "source": lead["source"], "verdict": verdict,
                    "boundary": lead["boundary"] if len(keys) == 1 else None, "source_type": st.get("source_type"),
                    "span_words": len(str(st.get("matched_span_in_lecture", "")).split()), "verses": len(keys),
                    "mixed_labels": mixed, "members": members, "synthetic": None}}
    return row, None


# ---------------------------------------------------------------------------------------------- counterfactual boundary

def _aligned(run, det, side: str, k: int) -> bool:
    """The k span words at that edge are the k corpus words there, one to one (so moving them out of the span keeps
    the engine's own alignment exact). Same normalisation and similarity as the app's boundary evidence."""
    from .kaggle.eval_laya import _norm_words, _similar
    unit = run["unit_words"].get(det.get("unitId")) or []
    segs = det.get("qSegments") or [[0, len(unit)]]
    q0, q1 = segs[0][0], segs[-1][1]
    span = run["words"][det["wordStartIdx"]:det["wordEndIdx"] + 1]
    if len(span) < k + 2 or not unit:
        return False
    a = span[:k] if side == "start" else span[-k:]
    b = unit[q0:q0 + k] if side == "start" else unit[q1 - k:q1]
    na, nb = _norm_words(" ".join(a)), _norm_words(" ".join(b))
    return len(na) == len(nb) == k and all(_similar(x, y) for x, y in zip(na, nb))


def trimmed(det, side: str, k: int) -> Dict[str, Any]:
    d = json.loads(json.dumps(det))
    segs = d.get("qSegments") or []
    if side == "start":
        d["wordStartIdx"] += k
        if segs:
            segs[0][0] += k
    else:
        d["wordEndIdx"] -= k
        if segs:
            segs[-1][1] -= k
    d["qSegments"] = segs
    d.pop("charStart", None), d.pop("charEnd", None)
    return d


def synth_candidates(rows, run_of) -> List[Tuple[str, str, int, str]]:
    """(run id, member key, side, k): train verses labelled real + complete whose edge can be moved out exactly."""
    out = []
    for r in rows:
        if r["meta"]["split"] != "train" or r["meta"]["verdict"] != "CORRECT":
            continue
        for m in r["meta"]["members"]:
            if m["meta"]["boundary"] != "COMPLETE_SPAN":
                continue
            run = run_of[(m["meta"]["doc_id"], m["meta"]["engine"])]
            det = run["dets"][run["keys"].index(m["id"])]
            for side in ("start", "end"):
                if m["position"] in ("only", "first" if side == "start" else "last"):
                    for k in SYNTH_K:
                        if _aligned(run, det, side, k):
                            out.append(((m["meta"]["doc_id"], m["meta"]["engine"]), m["id"], side, k))
    return out


def synth_rows(bridge, run_of, labels, cands, options, seed: int = SEED) -> List[Dict[str, Any]]:
    """One counterfactual row per picked candidate (at most SYNTH_MAX, one k per verse and side)."""
    rng = random.Random(seed)
    by_verse: Dict[Tuple[str, str], List] = {}
    for c in cands:
        by_verse.setdefault((c[1], c[2]), []).append(c)
    picks = [rng.choice(v) for v in by_verse.values()]
    rng.shuffle(picks)
    out = []
    for run_id, key, side, k in picks[:SYNTH_MAX]:
        run = run_of[run_id]
        i = run["keys"].index(key)
        dets = list(run["dets"])
        dets[i] = trimmed(dets[i], side, k)
        reqs = bridge.laya_v2(run_id[1], run["words"], dets, options, targets=[i])
        req = next(r for r in reqs if i in r["members"])
        sub = dict(run, dets=dets, keys=[key_of(run_id[0], d) for d in dets])
        row, _ = make_row(req, sub, {**labels, sub["keys"][i]: labels[key]})
        if row is None or row["meta"]["verdict"] != "CORRECT":
            continue
        pos = req["members"].index(i)
        q = "start_missing" if side == "start" else "end_missing"
        if (side == "start" and pos != 0) or (side == "end" and pos != len(req["members"]) - 1):
            continue                    # the trimmed verse is no longer at that edge of its passage
        eb = EPS_BY_SOURCE["user"]["boundary_status"]     # right by construction: the sharpest label we give
        row["gold"][q] = _noul(1 - eb)
        row["id"] = f"synth:{side}{k}:{row['id']}"
        row["meta"]["synthetic"] = {"side": side, "k": k, "from": key}
        for m in row["meta"]["members"]:
            m["id"] = "synth:" + m["id"]
        out.append(row)
    return out


# ---------------------------------------------------------------------------------------------- the folder

def variant_rows(bridge, run_of, labels, name: str) -> Tuple[List[Dict[str, Any]], Counter]:
    v = VARIANTS[name]
    options = {"passages": v["passages"], "neighbours": v["neighbours"]}
    rows, dropped = [], Counter()
    for (doc, engine), run in sorted(run_of.items()):
        for req in bridge.laya_v2(engine, run["words"], run["dets"], options, targets=run["targets"]):
            row, why = make_row(req, run, labels)
            if row is None:
                dropped[why] += 1
            else:
                rows.append(row)
    return rows, dropped


def verse_flags(rows) -> Dict[str, Dict[str, bool]]:
    """verse id -> context flags, from the A + D rows: the same slices for every model in eval_laya."""
    out = {}
    for r in rows:
        nb = r["state"].get("neighbor_findings") or {}
        near = [n for n in (nb.get("previous"), nb.get("next")) if n]
        same = any(n.get("same_surah") and n.get("ayah_distance") is not None and abs(n["ayah_distance"]) <= 3 for n in near)
        for m in r["meta"]["members"]:
            out[m["id"]] = {"in_passage": r["meta"]["verses"] > 1, "neighbour_same_surah": same, "has_neighbour": bool(near),
                            "short": m["meta"]["span_words"] <= 3}
    return out


def to_v1_envelope(row: Dict[str, Any]) -> Dict[str, Any]:
    """Converts a row to the exact canonical v1 envelope format (corpus text at top, verdict only)."""
    st = row["state"]
    v1_state = {
        "source_type": st.get("source_type"),
        "candidate_reference": st.get("candidate_reference"),
        "canonical_corpus_text": st.get("canonical_corpus_text"),
        "context_before": st.get("context_before"),
        "matched_span_in_lecture": st.get("matched_span_in_lecture"),
        "context_after": st.get("context_after"),
        "unmatched_corpus_prefix_words": st.get("unmatched_corpus_prefix_words", ""),
        "immediate_transcript_before": st.get("immediate_transcript_before", ""),
        "unmatched_corpus_suffix_words": st.get("unmatched_corpus_suffix_words", ""),
        "immediate_transcript_after": st.get("immediate_transcript_after", ""),
        "quran_neighboring_context": st.get("quran_neighboring_context"),
        "has_citation_cue": bool(st.get("has_citation_cue", False))
    }
    v1_instructions = (
        "In this Arabic Islamic lecture transcript, determine whether `matched_span_in_lecture` "
        "(surrounded by `context_before` and `context_after`) is an actual quotation/citation of "
        "`canonical_corpus_text` (`source_type`), or if it is merely ordinary speaker prose/explanation "
        "that happens to share words with the corpus text."
    )
    v1_criteria = {
        "CORRECT": "The speaker is genuinely quoting, reciting, or invoking this Quranic Ayah, Prophetic Hadith, or Dhikr (verbatim or as a direct religious citation in context).",
        "FALSE": "False positive: the words are ordinary conversational speech, fiqh explanation, or narrator/person names that coincidentally overlap with corpus vocabulary without quoting the text.",
        "NOT_SURE": "Ambiguous or partial paraphrase/meaning-only allusion where it is borderline whether the speaker intended a direct quotation."
    }
    return {
        "id": row["id"],
        "state": v1_state,
        "questions": {
            "verdict": {
                "type": "choice",
                "instructions": v1_instructions,
                "criteria": v1_criteria
            }
        },
        "gold": {"verdict": row["gold"]["verdict"]},
        "meta": row["meta"]
    }


def build(out_dir: Path = OUT, inputs=None, variants=tuple(VARIANTS)) -> Dict[str, Any]:
    """Writes the Kaggle-ready folder and returns the manifest. `inputs` = load_inputs() output (reused if given)."""
    recs, where, bundles, ans, usable_rows = inputs or load_inputs()
    labels, dropped_labels = labels_by_key(recs, where, usable_rows)
    run_of = runs(recs, bundles, labels)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    manifest: Dict[str, Any] = {
        "name": "laya_v2", "created": datetime.date.today().isoformat(), "base_model": BASE_MODEL, "envelope": ENVELOPE,
        "max_len": MAX_LEN, "head_max_len": HEAD_MAX_LEN, "eps_by_source": EPS_BY_SOURCE,
        "train_sources": list(TRAIN_SOURCES), "labels": len(labels), "dropped labels": dict(dropped_labels),
        "label_files": {n: _sha_file(DATA_DIR / "labels" / f"{n}.json") for n in LABEL_FILES},
        "variants": {}, "files": {}}
    with EngineBridge(extra_engine_files=["js/engine_v5.js"]) as bridge:
        manifest["harness"] = bridge.fingerprint()
        for name in variants:
            v = VARIANTS[name]
            options = {"passages": v["passages"], "neighbours": v["neighbours"]}
            rows, dropped = variant_rows(bridge, run_of, labels, name)
            synth = []
            if v["synth"]:
                synth = synth_rows(bridge, run_of, labels, synth_candidates(rows, run_of), options)
            by = {s: [r for r in rows if r["meta"]["split"] == s] for s in ("train", "val", "test")}
            by["train"] += synth
            for s, rs in by.items():
                _write_jsonl(out_dir / name / f"{s}.jsonl", rs)
                manifest["files"][f"{name}/{s}.jsonl"] = len(rs)
            manifest["variants"][name] = {
                **v, "options": options, "dropped": dict(dropped), "synthetic_rows": len(synth),
                "cfg_extra": {"wahy_envelope": ENVELOPE, "wahy_envelope_options": options},
                **{s: describe(rs) for s, rs in by.items()}}
            if name == "both":
                (out_dir / "test_verse_flags.json").write_text(json.dumps(verse_flags(rows), ensure_ascii=False), encoding="utf-8")
    # the old model's test set (v1 envelope, one row per verse) and its baselines, for the "before" line; and laya_v1's
    # soft_asis train / val as the `v1` variant: an old-envelope control trained in the same run (run 4)
    v1_test = [json.loads(l) for l in open(V1_OUT / "test.jsonl", encoding="utf-8")]
    _write_jsonl(out_dir / "v1_test.jsonl", v1_test)
    shutil.copy(V1_OUT / "baselines.json", out_dir / "v1_baselines.json")
    manifest["files"]["v1_test.jsonl"] = len(v1_test)
    v1 = {"test": v1_test, **{s: [json.loads(l) for l in open(V1_OUT / "soft_asis" / f"{s}.jsonl", encoding="utf-8")]
                              for s in ("train", "val")}}
    for s, rs in v1.items():
        _write_jsonl(out_dir / "v1" / f"{s}.jsonl", rs)
        manifest["files"][f"v1/{s}.jsonl"] = len(rs)
    manifest["variants"]["v1"] = {
        "passages": False, "neighbours": False, "synth": False, "options": {}, "dropped": {}, "synthetic_rows": 0,
        "about": "laya_v1 soft_asis as is (old envelope, 4-class boundary): the control",
        "cfg_extra": {"wahy_envelope": 1},
        **{s: {"rows": len(rs), "verses (labelled)": len(rs), **{f"verdict {v}": sum(r["meta"]["verdict"] == v for r in rs)
                                                                 for v in VERDICTS}} for s, rs in v1.items()}}

    # v1_passages (run 5): passages on the exact canonical v1 envelope (canonical corpus text at the top), verdict only
    v1_pass = {s: [to_v1_envelope(json.loads(l)) for l in open(out_dir / "passages" / f"{s}.jsonl", encoding="utf-8")]
               for s in ("train", "val", "test")}
    for s, rs in v1_pass.items():
        _write_jsonl(out_dir / "v1_passages" / f"{s}.jsonl", rs)
        manifest["files"][f"v1_passages/{s}.jsonl"] = len(rs)
    manifest["variants"]["v1_passages"] = {
        "passages": True, "neighbours": False, "synth": False, "options": {"passages": True}, "dropped": {}, "synthetic_rows": 0,
        "about": "passages merged on the exact v1 envelope (canonical corpus text at top), verdict only",
        "cfg_extra": {"wahy_envelope": 1, "wahy_envelope_options": {"passages": True}, "wahy_questions": ["verdict"]},
        **{s: {"rows": len(rs), "verses (labelled)": sum(r["meta"]["verses"] for r in rs),
               **{f"verdict {v}": sum(r["meta"]["verdict"] == v for r in rs) for v in VERDICTS}}
           for s, rs in v1_pass.items()}}

    for f in ("train_ddp.py", "eval_laya.py"):
        shutil.copy(KAGGLE_DIR / f, out_dir / f)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


def describe(rows) -> Dict[str, Any]:
    """Counts for the manifest: rows, verses, verdicts, yes/no boundary answers, passages."""
    g = Counter()
    for r in rows:
        g["rows"] += 1
        g["verses (labelled)"] += len(r["meta"]["members"])
        g["verdict " + r["meta"]["verdict"]] += 1
        g["passages"] += r["meta"]["verses"] > 1
        g["synthetic"] += bool(r["meta"]["synthetic"])
        for q in ("start_missing", "end_missing"):
            if q in r["gold"]:
                g[f"{q} items"] += 1
                g[f"{q} true"] += r["gold"][q]["probabilities"]["true"] > 0.5
    return dict(g)


def zip_dataset(out_dir: Path = OUT) -> Path:
    """data/laya_datagen/laya_v2.zip with the folder inside (upload it to Kaggle as the `laya_v2` dataset)."""
    z = out_dir.parent.parent / f"{out_dir.name}.zip"
    shutil.rmtree(out_dir / "__pycache__", ignore_errors=True)       # left by running eval_laya.py from the folder
    shutil.make_archive(str(z.with_suffix("")), "zip", root_dir=out_dir.parent, base_dir=out_dir.name)
    return z


# ---------------------------------------------------------------------------------------------- validation

def validate(out_dir: Path = OUT, tok=None) -> List[Dict[str, Any]]:
    """Every file through Laya's own reader at 2048 / 256: every labelled question must give an item, nothing skipped."""
    from laya.train import items_from_rows, read_jsonl
    from .laya_dataset import tokenizer
    if tok is None:
        tok, _, _ = tokenizer()
    out = []
    for p in sorted(out_dir.rglob("*.jsonl")):
        rows = read_jsonl(str(p))
        items, skipped = items_from_rows(tok, rows, MAX_LEN, HEAD_MAX_LEN)
        expected = sum(len(r["gold"]) for r in rows)
        out.append({"file": str(p.relative_to(out_dir)), "rows": len(rows), "items": len(items),
                    "expected items": expected, "skipped": dict(skipped), "ok": len(items) == expected and not skipped})
    return out


def token_lengths(out_dir: Path = OUT, tok=None) -> List[Dict[str, Any]]:
    """State tokens per file and how many states do not fit next to the longest question (they lose their end)."""
    import numpy as np
    from laya.common import build_head, encode_text, serialize_state
    from laya.train import read_jsonl, to_internal
    from .laya_dataset import tokenizer
    if tok is None:
        tok, _, _ = tokenizer()
    out = []
    for p in sorted(out_dir.rglob("*.jsonl")):
        rows = read_jsonl(str(p))
        if not rows:
            continue
        head = max(len(build_head(tok, to_internal(q, d), HEAD_MAX_LEN)[0]) for q, d in rows[0]["questions"].items())
        n = np.array([len(encode_text(tok, serialize_state(r["state"]), add_special_tokens=False)["input_ids"]) for r in rows])
        room = MAX_LEN - head - 1
        out.append({"file": str(p.relative_to(out_dir)), "rows": len(rows), "median": int(np.median(n)),
                    "p99": int(np.percentile(n, 99)), "max": int(n.max()), "room": room, "cut": int((n > room).sum())})
    return out
