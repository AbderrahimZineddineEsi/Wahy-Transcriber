import json
from pathlib import Path

import pytest

from backend.laya_datagen import laya_dataset as L
from backend.laya_datagen.export import EPS_BY_SOURCE

ENV = {"state": {"source_type": "QURAN", "candidate_reference": "x", "canonical_corpus_text": "a b c",
                 "matched_span_in_lecture": "a b", "context_after": "", "engine_score": 30.0,
                 "engine_confidence_band": "VERIFIED", "has_citation_cue": True},
       "questions": {"verdict": {"type": "choice", "instructions": "x", "criteria": {"CORRECT": "a", "FALSE": "b", "NOT_SURE": "c"}},
                     "boundary_status": {"type": "choice", "instructions": "y",
                                         "criteria": {"COMPLETE_SPAN": "a", "MISSING_START": "b", "MISSING_END": "c", "MISSING_BOTH": "d"}}}}

REVIEW = sorted(L.TEST_REVIEW) + ["binbaz_audio_181", "binbaz_audio_820"]
YT = [f"yt_{v}" for vs in list(L.lectures.YOUTUBE.values())[:3] for v in vs]
BB = ["binbaz_audio_183", "binbaz_audio_184", "binbaz_audio_186", "binbaz_audio_1823", "binbaz_audio_1824"]


def fixture():
    where = {d: "review (15 Bin Baz lessons)" for d in REVIEW}
    where.update({d: "lectures batch 1" for d in YT + BB})
    recs, usable = {}, []
    sources = ["You — stages 2 / 4", "Sonnet 5.5 — high", "Automatic (Bin Baz written text)", "Sonnet 5.5 — medium"]
    i = 0
    for doc in where:
        for j in range(8):
            key = f"{doc}|{j}"
            verdict = ["CORRECT", "FALSE", "PARAPHRASE", "CORRECT"][j % 4]
            src = sources[(i + j) % 4]
            recs[key] = {"id": key, "doc_id": doc, "engine": "v4", "det": {}, "envelope": ENV, "cases": [],
                         "label": {"tier": "neg_weak", "verdict": None, "boundary": None, "flags": []}}
            usable.append({"key": key, "doc": doc, "set": where[doc], "source": src, "verdict": verdict,
                           "exportable": verdict != "PARAPHRASE", "boundary": "MISSING_END" if verdict == "CORRECT" else None,
                           "unit": "1:1", "ws": j, "we": j + 1, "place": i * 10 + j})
        i += 1
    return recs, where, usable


def test_split_by_lecture_and_test_review_lessons():
    recs, where, usable = fixture()
    split = L.assign_splits(L.lecture_info(where))
    assert {d for d in REVIEW if split[d] == "test"} == set(L.TEST_REVIEW)
    assert all(split[d] == "train" for d in REVIEW if d not in L.TEST_REVIEW)
    assert sum(split[d] == "test" for d in BB) == L.BINBAZ_LECTURES_TEST
    per_sheikh_test = [sum(split[f"yt_{v}"] == "test" for v in vs) for vs in list(L.lectures.YOUTUBE.values())[:3]]
    assert per_sheikh_test == [1, 1, 1]


def test_rows_schema_sources_and_no_doc_in_two_splits():
    recs, where, usable = fixture()
    rows, dropped = L.build_rows(recs, where, usable, "soft")
    docs = {}
    for r in rows:
        assert set(r) >= {"id", "state", "questions", "gold", "meta"}
        assert "engine_score" not in r["state"] and "engine_confidence_band" not in r["state"]
        assert abs(sum(r["gold"]["verdict"]["probabilities"].values()) - 1) < 1e-6
        assert ("boundary_status" in r["gold"]) == (r["meta"]["verdict"] == "CORRECT")
        docs.setdefault(r["meta"]["doc_id"], set()).add(r["meta"]["split"])
        if r["meta"]["split"] != "test":
            assert r["meta"]["source"] in L.TRAIN_SOURCES           # written text is test-only
        assert r["meta"]["split"] != "train" or r["meta"]["doc_id"] not in L.TEST_REVIEW
    assert all(len(s) == 1 for s in docs.values())
    assert dropped["quoted by meaning (not an option of Laya's question)"] > 0
    assert any(r["meta"]["source"] == "written" and r["meta"]["split"] == "test" for r in rows)


def test_soft_eps_per_source_and_hard_labels():
    recs, where, usable = fixture()
    soft, _ = L.build_rows(recs, where, usable, "soft")
    hard, _ = L.build_rows(recs, where, usable, "hard")
    for r in soft:
        e = EPS_BY_SOURCE[r["meta"]["source"]]
        assert r["gold"]["verdict"]["probabilities"][r["meta"]["verdict"]] == pytest.approx(1 - e["verdict"])
        if "boundary_status" in r["gold"]:
            assert r["gold"]["boundary_status"]["probabilities"]["MISSING_END"] == pytest.approx(1 - e["boundary_status"])
    for r in hard:
        assert r["gold"]["verdict"]["probabilities"][r["meta"]["verdict"]] == 1.0


def test_downsample_keeps_user_rows_and_hits_share():
    rows = [{"meta": {"verdict": "FALSE", "source": "user" if i < 5 else "sonnet_high"}} for i in range(60)] + \
           [{"meta": {"verdict": "CORRECT", "source": "sonnet_high"}} for _ in range(60)]
    out = L.downsample_false(rows, 0.25)
    false = [r for r in out if r["meta"]["verdict"] == "FALSE"]
    assert len(false) == 20 and sum(r["meta"]["source"] == "user" for r in false) == 5
    assert len(out) == 80


def test_variants_share_val():
    recs, where, usable = fixture()
    soft, _ = L.build_rows(recs, where, usable, "soft")
    hard, _ = L.build_rows(recs, where, usable, "hard")
    a, b = L.variant_rows(soft, hard, "soft_asis"), L.variant_rows(soft, hard, "soft_balanced")
    assert a["val"] == b["val"] and len(b["train"]) <= len(a["train"])


BUILT = L.OUT / "manifest.json"


@pytest.mark.skipif(not BUILT.exists(), reason="laya_v1 not built (notebooks/data/laya_dataset.ipynb)")
def test_built_folder_has_no_leak():
    m = json.loads(BUILT.read_text(encoding="utf-8"))
    tr, va, te = (set(m["docs"][s]) for s in ("train", "val", "test"))
    assert not (tr & va) and not (tr & te) and not (va & te)
    assert L.TEST_REVIEW <= te
    test_ids = {json.loads(l)["id"] for l in open(L.OUT / "test.jsonl", encoding="utf-8")}
    for v in L.VARIANTS:
        for s in ("train", "val"):
            for line in open(L.OUT / v / f"{s}.jsonl", encoding="utf-8"):
                r = json.loads(line)
                assert r["id"] not in test_ids and r["meta"]["source"] != "written"
