import json

from backend.laya_datagen.export import assign_splits, export_dataset, to_laya_row

ENV = {"state": {"source_type": "QURAN", "engine_score": 30.0, "engine_confidence_band": "VERIFIED", "has_citation_cue": True},
       "questions": {"verdict": {"type": "choice", "instructions": "x", "criteria": {"CORRECT": "a", "FALSE": "b", "NOT_SURE": "c"}}}}


def rec(i, doc="d1", unit="1:1", tier="pos_strong", verdict="CORRECT", boundary="MISSING_END"):
    return {"id": f"r{i}", "doc_id": doc, "engine": "v4", "det": {"wordStartIdx": i, "wordEndIdx": i + 3, "unitId": unit},
            "envelope": ENV, "label": {"tier": tier, "verdict": verdict, "boundary": boundary, "flags": []}, "cases": []}


def test_row_hides_engine_fields_and_uses_gold_probabilities():
    row = to_laya_row(rec(0))
    assert "engine_score" not in row["state"] and "engine_confidence_band" not in row["state"]
    assert row["state"]["has_citation_cue"] is True
    p = row["gold"]["verdict"]["probabilities"]
    assert p == {"CORRECT": 0.95, "FALSE": 0.025, "NOT_SURE": 0.025}
    assert row["gold"]["boundary_status"]["probabilities"]["MISSING_END"] == 0.95
    assert "answers" not in row


def test_false_has_no_boundary_and_silent_is_dropped():
    assert "boundary_status" not in to_laya_row(rec(0, verdict="FALSE", tier="wrong_id", boundary=None))["gold"]
    assert to_laya_row(rec(0, tier="silent", verdict=None)) is None


def test_export_splits_by_doc_dedups_and_caps(tmp_path):
    recs = [rec(i, doc=f"d{i % 5}", unit=f"1:{i}") for i in range(40)] + [rec(0, doc="d0", unit="1:0")]  # last = duplicate
    m = export_dataset(recs, tmp_path, max_per_unit_per_doc=3)
    docs_by_split = {}
    for s in ("train", "val", "test"):
        for line in (tmp_path / f"{s}.jsonl").read_text().splitlines():
            docs_by_split.setdefault(json.loads(line)["meta"]["doc_id"], set()).add(s)
    assert all(len(v) == 1 for v in docs_by_split.values())
    assert sum(c.get("_rows", 0) for c in m["counts"].values()) == 40
    assert set(assign_splits(["a", "b", "c", "d", "e"]).values()) == {"train", "val", "test"}
