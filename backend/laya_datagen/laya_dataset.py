"""Laya fine-tuning dataset v1: the Kaggle-ready folder (3 training variants, one shared val / test).

Split by whole lecture (near-duplicate spans of one quote and the context of one lecture never cross splits):
  test  = 6 of the 15 review lessons (your labels ~ 200 / 200 with the other 9, same share of "not a quote")
          + 1 lecture per YouTube sheikh + 2 Bin Baz lectures from the batches (Sonnet's labels on varied speakers)
  val   = 1 lecture of every other sheikh + 2 Bin Baz lectures (calibration temperature + overfitting check)
  train = everything else, including the 9 other review lessons (your labels there are trained on)
The Bin Baz written-text labels are test-only (your choice, 2026-10-25): in train / val those findings are dropped.

Variants (same val / test): soft_asis (soft labels, data as is), soft_balanced (soft labels, train "not a quote"
downsampled to FALSE_SHARE), hard_asis (one-hot labels). Walkthrough: notebooks/data/laya_dataset.ipynb, docs/laya-finetune/.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import random
import shutil
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np

from . import inventory, lectures
from .cache import DATA_DIR
from .export import BOUNDARIES, EPS_BY_SOURCE, VERDICTS, to_laya_row

OUT = DATA_DIR / "datasets" / "laya_v1"
KAGGLE_DIR = Path(__file__).parent / "kaggle"   # train_ddp.py + eval_laya.py, copied into the folder
BASE_MODEL = "convaiinnovations/laya-multilingual"

SOURCE_KEY = {"You — stages 2 / 4": "user", "You — negatives sprint": "user",
              "Automatic (Bin Baz written text)": "written",
              "Sonnet 5.5 — high": "sonnet_high", "Sonnet 5.5 — medium": "sonnet_medium"}
TRAIN_SOURCES = ("user", "sonnet_high", "sonnet_medium")
# 6 review lessons: 198 of your labels (27 "not a quote"); the other 9 hold 197 (28)
TEST_REVIEW = frozenset({"binbaz_audio_180", "binbaz_audio_561", "binbaz_audio_565", "binbaz_audio_821",
                         "binbaz_audio_1937", "binbaz_audio_2950"})
BINBAZ_LECTURES_TEST = 2
BINBAZ_LECTURES_VAL = 2
FALSE_SHARE = 0.25          # soft_balanced: share of "not a quote" in train after downsampling
SEED = 20261025
VARIANTS = {
    "soft_asis": {"labels": "soft", "false_share": None,
                  "about": "soft labels (eps per source and question), training data as is"},
    "soft_balanced": {"labels": "soft", "false_share": FALSE_SHARE,
                      "about": "soft labels, 'not a quote' in train downsampled to %d %%" % (FALSE_SHARE * 100)},
    "hard_asis": {"labels": "hard", "false_share": None, "about": "one-hot labels (eps = 0), training data as is"},
}
HARD = {"verdict": 0.0, "boundary_status": 0.0}
LABEL_FILES = ("findings", "sprint", "sonnet", "sonnet_engine_eval", "sonnet_cmp_medium", "sonnet_cmp_high")


# ---------------------------------------------------------------------------------------------- the split

def lecture_info(where: Dict[str, str]) -> Dict[str, Dict[str, Any]]:
    """doc -> {group: review | lectures, batch, speaker} (speaker = YouTube sheikh, or "binbaz")."""
    yt = {}
    for batch, table in ((1, lectures.YOUTUBE), (2, lectures.YOUTUBE_2)):
        for sheikh, vids in table.items():
            for v in vids:
                yt[f"yt_{v}"] = (sheikh, batch)
    out = {}
    for doc, s in where.items():
        if s.startswith("review"):
            out[doc] = {"group": "review", "batch": 0, "speaker": "binbaz"}
        else:
            sheikh, batch = yt.get(doc, ("binbaz", 1 if s.endswith("1") else 2))
            out[doc] = {"group": "lectures", "batch": batch, "speaker": sheikh}
    return out


def _h(doc: str) -> str:
    return hashlib.sha256(doc.encode()).hexdigest()


def assign_splits(info: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
    """doc -> train | val | test. Deterministic: depends only on the lecture lists, never on the labels."""
    split = {}
    by_speaker: Dict[str, List[str]] = {}
    for doc, i in info.items():
        if i["group"] == "review":
            split[doc] = "test" if doc in TEST_REVIEW else "train"
        else:
            by_speaker.setdefault(i["speaker"], []).append(doc)
    for n, (speaker, docs) in enumerate(sorted(by_speaker.items())):
        docs = sorted(docs, key=_h)
        if speaker == "binbaz":
            n_test, n_val = BINBAZ_LECTURES_TEST, BINBAZ_LECTURES_VAL
        else:
            n_test, n_val = 1, (1 if n % 2 == 0 else 0)     # val: every other sheikh
        for k, doc in enumerate(docs):
            split[doc] = "test" if k < n_test else "val" if k < n_test + n_val else "train"
    return split


# ---------------------------------------------------------------------------------------------- rows

def load_inventory():
    """(recs, where, answers, usable rows): every finding, which set it is in, every reviewer's labels, one label each."""
    recs, where = inventory.collect()
    ans = inventory.answers(recs)
    return recs, where, ans, inventory.usable(ans, recs, where)


def _meta(x: Dict[str, Any], rec: Dict[str, Any], src: str, split: str, info: Dict[str, Any]) -> Dict[str, Any]:
    st = rec["envelope"]["state"]
    return {"doc_id": x["doc"], "split": split, "group": info["group"], "batch": info["batch"],
            "speaker": info["speaker"], "engine": rec["engine"], "source": src, "verdict": x["verdict"],
            "boundary": x["boundary"], "source_type": st.get("source_type"),
            "span_words": len(str(st.get("matched_span_in_lecture", "")).split()), "place": x["place"],
            "flags": rec["label"].get("flags", [])}


def build_rows(recs, where, usable_rows, labels: str = "soft") -> Tuple[List[Dict[str, Any]], Counter]:
    """One Laya row per usable finding, tagged with its split in meta. Returns (rows, dropped counts)."""
    info = lecture_info(where)
    split = assign_splits(info)
    rows, dropped = [], Counter()
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
        eps = EPS_BY_SOURCE[src] if labels == "soft" else HARD
        row = to_laya_row(rec, label={"verdict": x["verdict"], "boundary": x["boundary"]}, eps=eps)
        row["id"] = x["key"]
        row["meta"] = _meta(x, rec, src, s, info[x["doc"]])
        rows.append(row)
    return rows, dropped


def downsample_false(train: List[Dict[str, Any]], false_share: float, seed: int = SEED) -> List[Dict[str, Any]]:
    """Drop random non-user "not a quote" rows until they are `false_share` of train (your labels always stay)."""
    false = [r for r in train if r["meta"]["verdict"] == "FALSE"]
    rest = len(train) - len(false)
    keep_n = round(false_share / (1 - false_share) * rest)
    mine = [r for r in false if r["meta"]["source"] == "user"]
    others = [r for r in false if r["meta"]["source"] != "user"]
    random.Random(seed).shuffle(others)
    keep = {id(r) for r in mine + others[:max(0, keep_n - len(mine))]}
    return [r for r in train if r["meta"]["verdict"] != "FALSE" or id(r) in keep]


def variant_rows(rows_soft, rows_hard, variant: str) -> Dict[str, List[Dict[str, Any]]]:
    """{train, val} for one variant. Test is shared (soft gold; the evaluation scores the hard label in meta)."""
    v = VARIANTS[variant]
    rows = rows_soft if v["labels"] == "soft" else rows_hard
    train = [r for r in rows if r["meta"]["split"] == "train"]
    if v["false_share"]:
        train = downsample_false(train, v["false_share"])
    return {"train": train, "val": [r for r in rows if r["meta"]["split"] == "val"]}


# ---------------------------------------------------------------------------------------------- baselines

SHALLOW = ("span_words", "canon_words", "coverage", "is_quran", "cue", "has_prefix", "has_suffix")


def shallow_features(row: Dict[str, Any]) -> Dict[str, float]:
    s = row["state"]
    span = len(str(s.get("matched_span_in_lecture", "")).split())
    canon = len(str(s.get("canonical_corpus_text", "")).split())
    return {"span_words": span, "canon_words": canon, "coverage": span / max(1, canon),
            "is_quran": float(s.get("source_type") == "QURAN"), "cue": float(bool(s.get("has_citation_cue"))),
            "has_prefix": float(bool(s.get("unmatched_corpus_prefix_words"))),
            "has_suffix": float(bool(s.get("unmatched_corpus_suffix_words")))}


class LogReg:
    """Plain logistic regression (gradient descent, standardised log1p features): the 'shortcut' baseline."""

    def __init__(self, iters: int = 3000, lr: float = 0.5, l2: float = 1e-3):
        self.iters, self.lr, self.l2 = iters, lr, l2

    def _z(self, X):
        return np.c_[(np.log1p(X) - self.mu) / self.sd, np.ones(len(X))]

    def fit(self, X, y):
        L = np.log1p(X)
        self.mu, self.sd = L.mean(0), L.std(0) + 1e-9
        Z, w = self._z(X), np.zeros(X.shape[1] + 1)
        for _ in range(self.iters):
            p = 1 / (1 + np.exp(-Z @ w))
            w -= self.lr * (Z.T @ (p - y) / len(y) + self.l2 * w)
        self.w = w
        return self

    def predict_proba(self, X):
        return 1 / (1 + np.exp(-self._z(X) @ self.w))


def auc(y, p) -> float:
    """ROC AUC by ranks (ties broken by order; fine for continuous scores)."""
    y = np.asarray(y, bool)
    r = np.argsort(np.argsort(p)) + 1
    n1, n0 = y.sum(), len(y) - y.sum()
    return float((r[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")


def shortcut_baselines(train, test, features_sets=None) -> Dict[str, Dict[str, float]]:
    """name -> {row id: P(not a quote)} for logistic regressions on cheap state fields, fit on train (real vs not)."""
    features_sets = features_sets or {"span length only (LR)": ("span_words",), "7 shallow fields (LR)": SHALLOW}
    tr = [r for r in train if r["meta"]["verdict"] in ("CORRECT", "FALSE")]
    y = np.array([r["meta"]["verdict"] == "FALSE" for r in tr], float)
    out = {}
    for name, cols in features_sets.items():
        X = lambda rs: np.array([[shallow_features(r)[c] for c in cols] for r in rs], float)
        m = LogReg().fit(X(tr), y)
        out[name] = {r["id"]: round(float(p), 4) for r, p in zip(test, m.predict_proba(X(test)))}
    return out


def teacher_baselines(ans, test) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Cached JEV / Gemini / base-Laya answers on the test rows they cover (they are never training labels)."""
    ids = {r["id"] for r in test}
    out = {}
    for who in ("JEV", "Gemini", "Laya (base)"):
        got = {k: {"verdict": inventory.EXPORTABLE.get(a["verdict"], a["verdict"]), "boundary": a.get("boundary")}
               for k, a in ans.get(who, {}).items() if k in ids and a.get("verdict")}
        out[who + " (cached)"] = got
    return out


# ---------------------------------------------------------------------------------------------- tables

def counts(rows: Iterable[Dict[str, Any]], *keys: str) -> Counter:
    return Counter(tuple(r["meta"][k] if k != "label" else r["meta"]["verdict"] for k in keys) for r in rows)


def table(rows, by: str = "source") -> List[Dict[str, Any]]:
    """One line per value of meta[by]: rows, real, not a quote, unsure, with a boundary, each boundary class."""
    out = []
    for val in sorted({r["meta"][by] for r in rows}, key=str):
        rs = [r for r in rows if r["meta"][by] == val]
        v = Counter(r["meta"]["verdict"] for r in rs)
        b = Counter(r["meta"]["boundary"] for r in rs if r["meta"]["boundary"])
        out.append({by: val, "rows": len(rs), "real": v["CORRECT"], "not a quote": v["FALSE"], "unsure": v["NOT_SURE"],
                    "% not a quote": round(100 * v["FALSE"] / max(1, len(rs)), 1),
                    "with boundary": sum(b.values()), **{k.lower(): b[k] for k in BOUNDARIES}})
    return out


def _sha_file(p: Path) -> Optional[str]:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.exists() else None


# ---------------------------------------------------------------------------------------------- the folder

def _write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def build(out_dir: Path = OUT, inv=None) -> Dict[str, Any]:
    """Writes the Kaggle-ready folder and returns the manifest. `inv` = load_inventory() output (reused if given)."""
    recs, where, ans, usable_rows = inv or load_inventory()
    rows_soft, dropped = build_rows(recs, where, usable_rows, "soft")
    rows_hard, _ = build_rows(recs, where, usable_rows, "hard")
    test = [r for r in rows_soft if r["meta"]["split"] == "test"]
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    manifest: Dict[str, Any] = {
        "name": "laya_v1", "created": datetime.date.today().isoformat(), "base_model": BASE_MODEL,
        "profile": "engine_agnostic (engine_score / engine_confidence_band removed from the state)",
        "questions": list(test[0]["questions"]), "verdicts": VERDICTS, "boundaries": BOUNDARIES,
        "eps_by_source": EPS_BY_SOURCE, "train_sources": list(TRAIN_SOURCES), "test_sources": sorted({r["meta"]["source"] for r in test}),
        "split_rule": "by lecture; test = review lessons %s + 1 lecture per YouTube sheikh + %d Bin Baz lectures; val = 1 "
                      "lecture of every other sheikh + %d Bin Baz lectures" % (sorted(TEST_REVIEW), BINBAZ_LECTURES_TEST, BINBAZ_LECTURES_VAL),
        "docs": {s: sorted({r["meta"]["doc_id"] for r in rows_soft if r["meta"]["split"] == s}) for s in ("train", "val", "test")},
        "dropped": dict(dropped), "label_files": {n: _sha_file(DATA_DIR / "labels" / f"{n}.json") for n in LABEL_FILES},
        "engines": dict(Counter(r["meta"]["engine"] for r in rows_soft)), "variants": {}, "files": {},
    }
    for name in VARIANTS:
        vr = variant_rows(rows_soft, rows_hard, name)
        for s, rs in vr.items():
            _write_jsonl(out_dir / name / f"{s}.jsonl", rs)
            manifest["files"][f"{name}/{s}.jsonl"] = len(rs)
        tr = vr["train"]
        manifest["variants"][name] = {**VARIANTS[name], "train_rows": len(tr),
                                      "train_false_share": round(sum(r["meta"]["verdict"] == "FALSE" for r in tr) / len(tr), 4),
                                      "train": table(tr), "val": table(vr["val"])}
    test_user = [r for r in test if r["meta"]["source"] == "user"]
    _write_jsonl(out_dir / "test.jsonl", test)
    _write_jsonl(out_dir / "test_user.jsonl", test_user)
    manifest["files"].update({"test.jsonl": len(test), "test_user.jsonl": len(test_user)})
    manifest["test"] = {"by source": table(test), "by group": table(test, "group"), "by speaker": table(test, "speaker")}
    train_asis = [r for r in rows_soft if r["meta"]["split"] == "train"]
    baselines = {"shortcut": shortcut_baselines(train_asis, test), "teachers": teacher_baselines(ans, test)}
    (out_dir / "baselines.json").write_text(json.dumps(baselines, ensure_ascii=False), encoding="utf-8")
    for f in ("train_ddp.py", "eval_laya.py"):
        shutil.copy(KAGGLE_DIR / f, out_dir / f)
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


# ---------------------------------------------------------------------------------------------- validation

def tokenizer(model: str = BASE_MODEL):
    """The checkpoint's tokenizer and config, as laya.train loads them (downloads ~1 GB once if not cached)."""
    import os
    from transformers import AutoTokenizer
    from laya.agent import _fix_tokenizer_config
    from laya.train import resolve_checkpoint_dir
    d = resolve_checkpoint_dir(model)
    _fix_tokenizer_config(d)
    cfg = json.loads(Path(d, "rl_agent_config.json").read_text())
    return AutoTokenizer.from_pretrained(os.path.join(d, "tokenizer")), cfg, d


def validate(out_dir: Path = OUT, tok=None, cfg=None) -> List[Dict[str, Any]]:
    """Load every file with Laya's own reader (read_jsonl + items_from_rows) at the training budgets, on CPU.
    Every row must give a verdict item, every real quote with a boundary a boundary item, nothing skipped."""
    from laya.train import items_from_rows, read_jsonl
    if tok is None:
        tok, cfg, _ = tokenizer()
    max_len, head = cfg.get("max_len", 1024), cfg.get("head_max_len", 256)
    out = []
    for p in sorted(out_dir.rglob("*.jsonl")):
        rows = read_jsonl(str(p))
        items, skipped = items_from_rows(tok, rows, max_len, head)
        expected = sum(len(r["gold"]) for r in rows)
        out.append({"file": str(p.relative_to(out_dir)), "rows": len(rows), "items": len(items),
                    "expected items": expected, "skipped": dict(skipped), "ok": len(items) == expected and not skipped})
    return out


def truncation(rows, tok, max_len: int = 1024, head_max_len: int = 256) -> List[Dict[str, Any]]:
    """Per row: state tokens, the room each question leaves, and whether the span or later fields are cut off
    (build_sequence keeps the START of the serialized state and drops the rest)."""
    from laya.common import build_head, encode_text, serialize_state
    from laya.train import to_internal
    heads = {qid: len(build_head(tok, to_internal(qid, q), head_max_len)[0]) for qid, q in rows[0]["questions"].items()}
    out = []
    for r in rows:
        txt = serialize_state(r["state"])
        n = lambda s: len(encode_text(tok, s, add_special_tokens=False)["input_ids"])
        total = n(txt)
        cut = txt.find('"context_after"')       # the span value ends right before this key
        span_end = n(txt[:cut]) if cut > 0 else total
        out.append({"id": r["id"], "state_tokens": total,
                    **{f"room {q}": max_len - h - 1 for q, h in heads.items()},
                    "span cut (verdict)": span_end > max_len - heads["verdict"] - 1,
                    "state cut (verdict)": total > max_len - heads["verdict"] - 1,
                    "state cut (boundary)": total > max_len - heads.get("boundary_status", 0) - 1})
    return out
