"""laya_v3 stores the final envelopes (ADR 0003): each row's state and questions are exactly what the engine builds
for the app, and the run-6 comparison says how they differ from the rows run 6 trained on."""

import json
import shutil

import pytest

from wahy.laya import laya_v2 as V2
from wahy.laya import laya_v3 as V3
from wahy.laya.engine_bridge import REPO_ROOT, EngineBridge

needs_node = pytest.mark.skipif(
    not shutil.which("node") or not (REPO_ROOT / "data" / "corpus.json").exists(), reason="needs node and data/corpus.json"
)
RUN6 = REPO_ROOT / "notebooks" / "kaggle" / "laya_run6_kaggle.ipynb"

# الواقعة 86-90 recited back to back, a hadith, then commentary
TEXT = ("قال الشيخ رحمه الله فلولا إن كنتم غير مدينين ترجعونها إن كنتم صادقين فأما إن كان من المقربين فروح وريحان وجنة نعيم "
        "وأما إن كان من أصحاب اليمين ثم قال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى "
        "ثم شرح الشيخ معنى الآية في كلام طويل عن الجنة والنار").split()


def lab(i, verdict="CORRECT", split="train"):
    return {"verdict": verdict, "boundary": "COMPLETE_SPAN" if verdict == "CORRECT" else None, "source": "user",
            "split": split, "doc_id": "d", "engine": "v4", "group": "lectures", "batch": 1, "speaker": "s", "place": i,
            "flags": [], "source_type": "QURAN"}


@pytest.fixture(scope="module")
def bridge():
    with EngineBridge() as b:
        yield b


@pytest.fixture(scope="module")
def run_of(bridge):
    dets = [{k: v for k, v in d.items() if k not in V2.DET_DROP} for d in bridge.detect("v4", TEXT)]
    keys = [V2.key_of("d", d) for d in dets]
    run = {"engine": "v4", "words": TEXT, "dets": dets, "keys": keys, "unit_words": {}, "targets": list(range(len(dets)))}
    labels = {k: lab(i, "FALSE" if d["sourceType"] == "HADITH" else "CORRECT") for i, (k, d) in enumerate(zip(keys, dets, strict=True))}
    return {("d", "v4"): run}, labels


@needs_node
def test_rows_are_the_engines_envelopes_unchanged(bridge, run_of):
    runs, labels = run_of
    run = runs[("d", "v4")]
    assert [d["sourceType"] for d in run["dets"]] == ["QURAN"] * 5 + ["HADITH"]
    rows, dropped = V3.variant_rows(bridge, runs, labels, "v3_single")
    app = bridge.envelopes(3, "v4", TEXT, run["dets"], {"passages": False}, targets=run["targets"])
    assert dropped == {} and len(rows) == len(app) == 6
    for row, req in zip(rows, app, strict=True):
        # byte for byte what the app sends: the same state (keys, order, values) and the same questions
        assert json.dumps(row["state"], ensure_ascii=False) == json.dumps(req["state"], ensure_ascii=False)
        assert row["questions"] == req["questions"]
    assert list(rows[0]["state"])[:3] == ["source_type", "candidate_reference", "canonical_corpus_text"]
    assert set(rows[0]["questions"]) == {"verdict", "start_missing", "end_missing"}
    hadith = rows[-1]
    assert hadith["gold"].keys() == {"verdict"} and hadith["meta"]["verdict"] == "FALSE"
    assert "quran_neighboring_context" not in hadith["state"]                 # the app leaves it out (run 6 had null)


@needs_node
def test_mixed_adds_the_passage_and_keeps_every_verse_alone(bridge, run_of):
    runs, labels = run_of
    single, _ = V3.variant_rows(bridge, runs, labels, "v3_single")
    mixed, _ = V3.variant_rows(bridge, runs, labels, "v3_mixed")
    assert mixed[:len(single)] == single
    [passage] = mixed[len(single):]
    assert passage["id"].startswith("passage:") and passage["meta"]["verses"] == 5
    assert passage["state"]["candidate_reference"] == "الواقعة: 86-90"
    app = bridge.envelopes(3, "v4", TEXT, runs[("d", "v4")]["dets"], {"passages": True},
                           targets=runs[("d", "v4")]["targets"])
    assert passage["state"] == app[0]["state"] and passage["questions"] == app[0]["questions"]


def test_build_refuses_to_write_over_a_dataset(tmp_path):
    (tmp_path / "laya_v3").mkdir()
    (tmp_path / "laya_v3" / "manifest.json").write_text("{}")
    with pytest.raises(FileExistsError, match="choose a new folder"):
        V3.build(tmp_path / "laya_v3", inputs=("never", "read", "", "", ""))
    with pytest.raises(FileExistsError, match="choose a new folder"):
        V2.build(tmp_path / "laya_v3", inputs=("never", "read", "", "", ""))
    assert (tmp_path / "laya_v3" / "manifest.json").read_text() == "{}"


@pytest.mark.skipif(not RUN6.exists(), reason="the run-6 notebook is not here")
def test_skew_compares_run_6_conversion_with_stored_rows(tmp_path):
    nb = V3.notebook_code(RUN6)
    question = {"type": "choice", "instructions": nb["v1_instructions"], "criteria": nb["v1_criteria"]}
    v2 = tmp_path / "laya_v2"
    state = {"source_type": "HADITH", "candidate_reference": "x", "canonical_corpus_text": "t", "matched_span_in_lecture": "m"}
    gold = {"verdict": {"probabilities": {"CORRECT": 1.0}}}
    base = [{"id": "a", "state": state, "gold": gold, "meta": {"verses": 1}}]
    for variant, rows in (("base", base), ("passages", base)):
        for s in V3.SPLITS:
            (v2 / variant).mkdir(parents=True, exist_ok=True)
            (v2 / variant / f"{s}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in (rows if s == "train" else [])))
    run6 = V3.run6_rows(v2, nb["to_v3_state"], question)
    assert run6["v3_single"]["train"][0]["state"]["quran_neighboring_context"] is None     # what run 6 trained on
    app_state = {k: v for k, v in nb["to_v3_state"](state).items() if k != "quran_neighboring_context"}
    v3 = tmp_path / "laya_v3"
    for variant in V3.VARIANTS:
        for s in V3.SPLITS:
            (v3 / variant).mkdir(parents=True, exist_ok=True)
            row = {"id": "a", "state": app_state, "questions": {"verdict": question}, "gold": gold}
            (v3 / variant / f"{s}.jsonl").write_text(json.dumps(row) + "\n" if s == "train" else "")
    report = V3.skew(v3, run6)
    assert report["v3_single/train"] == {"differ": 1, "differ: only run 6 has quran_neighboring_context": 1,
                                         "differ: state": 1}
    assert report["v3_single/test"] == {}
