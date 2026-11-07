"""The research side's command line: comparing dataset folders by hash, and a teacher labelling cards."""

import json

import pytest
from sqlalchemy import select

from wahy.core.ai.models import AiRequest
from wahy.laya.__main__ import compare_hashes, main


def write(folder, files):
    for name, text in files.items():
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_text(text, encoding="utf-8")


def test_hashes_finds_identical_and_different_files(tmp_path, capsys):
    a, b = tmp_path / "a", tmp_path / "b"
    write(a, {"base/train.jsonl": "1\n", "base/test.jsonl": "2\n", "manifest.json": '{"created": "2026-10-27", "n": 1}'})
    write(b, {"base/train.jsonl": "1\n", "base/test.jsonl": "3\n", "manifest.json": '{"created": "2026-11-07", "n": 1}',
              "__pycache__/x.pyc": "junk"})
    res = compare_hashes(a, b)
    assert res["identical"] == ["base/train.jsonl", "manifest.json (apart from the date)"]
    assert res["differ"] == ["base/test.jsonl"]
    assert main(["hashes", str(a), str(b)]) == 1
    write(b, {"base/test.jsonl": "2\n"})
    assert main(["hashes", str(a), str(b)]) == 0
    assert "identical: 3" in capsys.readouterr().out


def row(i, verdict):
    return {"id": f"d|{i}-{i}|1:{i}", "state": {"candidate_reference": f"الفاتحة: {i}", "matched_span_in_lecture": "بسم الله",
                                              "unmatched_corpus_prefix_words": "", "unmatched_corpus_suffix_words": ""},
            "questions": {"verdict": {"type": "choice", "criteria": {"CORRECT": "a", "FALSE": "b", "NOT_SURE": "c"}}},
            "gold": {"verdict": {"probabilities": {"CORRECT": 0.9 if verdict == "CORRECT" else 0.05,
                                                   "FALSE": 0.9 if verdict == "FALSE" else 0.05, "NOT_SURE": 0.05}}},
            "meta": {"source": "user" if i % 2 == 0 else "sonnet_high"}}


def test_label_with_the_fake_teacher(tmp_path, laya_core, capsys):
    rows = tmp_path / "test.jsonl"
    rows.write_text("".join(json.dumps(row(i, "CORRECT" if i % 4 else "FALSE"), ensure_ascii=False) + "\n"
                            for i in range(20)), encoding="utf-8")
    assert main(["label", "--teacher", "fake", "--rows", str(rows), "--n", "5"]) == 0
    out = capsys.readouterr().out
    assert "fake (fake-1): 5 cards, 5 asked, 0 from the cache" in out
    saved = json.loads(next((laya_core["laya"] / "results" / "teacher_labels").glob("fake_*.json")).read_text("utf-8"))
    assert saved["cards"] == 5 and all(x["id"].split("|")[1].split("-")[0].isdigit() for x in saved["labels"])
    assert all(int(x["id"].split("|")[1].split("-")[0]) % 2 == 0 for x in saved["labels"])     # your labels only
    assert {x["gold"] for x in saved["labels"]} <= {"CORRECT", "FALSE"} and saved["agree_with_gold"] >= 1
    with laya_core["db"].session() as s:
        assert [r.purpose for r in s.scalars(select(AiRequest))] == ["teacher"] * 5
    # the same cards again: all from the cache
    assert main(["label", "--teacher", "fake", "--rows", str(rows), "--n", "5"]) == 0
    assert "5 cards, 0 asked, 5 from the cache" in capsys.readouterr().out


def test_a_real_teacher_needs_yes(tmp_path):
    with pytest.raises(SystemExit, match="add --yes"):
        main(["label", "--teacher", "gemini", "--rows", str(tmp_path / "x.jsonl")])
