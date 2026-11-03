import json
import shutil

import pytest

from backend.laya_datagen import laya_v2 as V
from backend.laya_datagen.engine_bridge import EngineBridge, REPO_ROOT
from backend.laya_datagen.kaggle import eval_laya as E

needs_node = pytest.mark.skipif(
    not shutil.which("node") or not (REPO_ROOT / "data" / "corpus.json").exists(), reason="needs node and data/corpus.json"
)

# الواقعة 86-90 recited back to back, then commentary
TEXT = ("قال الشيخ رحمه الله فلولا إن كنتم غير مدينين ترجعونها إن كنتم صادقين فأما إن كان من المقربين فروح وريحان وجنة نعيم "
        "وأما إن كان من أصحاب اليمين ثم شرح الشيخ معنى الآية في كلام طويل عن الجنة والنار وأهوال يوم القيامة").split()
STATE_ORDER = ["source_type", "candidate_reference", "has_citation_cue", "context_before", "matched_span_in_lecture",
               "context_after", "immediate_transcript_before", "unmatched_corpus_prefix_words", "prefix_words_heard",
               "immediate_transcript_after", "unmatched_corpus_suffix_words", "suffix_words_heard"]


@pytest.fixture(scope="module")
def run():
    with EngineBridge() as b:
        dets = [{k: v for k, v in d.items() if k not in V.DET_DROP} for d in b.detect("v4", TEXT)]
        yield b, dets


@needs_node
def test_passage_is_one_request_with_lecture_fields_first(run):
    b, dets = run
    assert [d["displayRef"] for d in dets] == [f"الواقعة: {a}" for a in range(86, 91)]
    reqs = b.laya_v2("v4", TEXT, dets, {"passages": True, "neighbours": False})
    assert [r["members"] for r in reqs] == [[0, 1, 2, 3, 4]]
    st = reqs[0]["state"]
    assert list(st)[:len(STATE_ORDER)] == STATE_ORDER                 # the span comes before the (long) corpus text
    assert list(st).index("canonical_corpus_text") > list(st).index("matched_span_in_lecture")
    assert st["candidate_reference"] == "الواقعة: 86-90" and st["verses_in_passage"] == 5
    assert st["matched_span_in_lecture"] == " ".join(TEXT[4:28])
    assert "current_ayah_text" not in st["quran_neighboring_context"]
    assert st["quran_neighboring_context"]["ayah"] == "86-90"
    q = reqs[0]["questions"]
    assert q["verdict"]["type"] == "choice" and q["start_missing"]["type"] == "noul" and q["end_missing"]["type"] == "noul"


@needs_node
def test_neighbours_list_the_findings_around_without_verdicts(run):
    b, dets = run
    reqs = b.laya_v2("v4", TEXT, dets, {"passages": False, "neighbours": True}, targets=[2])
    assert [r["members"] for r in reqs] == [[2]]
    nb = reqs[0]["state"]["neighbor_findings"]
    assert nb["previous"]["candidate_reference"] == "الواقعة: 87" and nb["next"]["candidate_reference"] == "الواقعة: 89"
    assert nb["previous"]["same_surah"] and nb["previous"]["ayah_distance"] == 1 and nb["next"]["ayah_distance"] == 1
    assert nb["previous"]["gap_word_count"] == 0
    assert not any("verdict" in json.dumps(n) for n in nb.values())


@needs_node
def test_no_options_is_one_request_per_finding_without_neighbour_field(run):
    b, dets = run
    reqs = b.laya_v2("v4", TEXT, dets, {"passages": False, "neighbours": False})
    assert [r["members"] for r in reqs] == [[0], [1], [2], [3], [4]]
    assert all("neighbor_findings" not in r["state"] and "verses_in_passage" not in r["state"] for r in reqs)


@needs_node
def test_trimmed_start_is_heard_in_the_evidence(run):
    b, dets = run
    d = V.trimmed(dets[2], "start", 2)                       # «فأما إن» moved out of «فأما إن كان من المقربين»
    assert (d["wordStartIdx"], d["qSegments"][0][0]) == (dets[2]["wordStartIdx"] + 2, (dets[2]["qSegments"] or [[0]])[0][0] + 2)
    reqs = b.laya_v2("v4", TEXT, dets[:2] + [d] + dets[3:], {"passages": False, "neighbours": False}, targets=[2])
    st = reqs[0]["state"]
    assert st["matched_span_in_lecture"] == "كان من المقربين"
    assert E._norm_words(st["unmatched_corpus_prefix_words"])[-2:] == ["فاما", "ان"]
    assert st["prefix_words_heard"] == "2 of 2"


# ---------------------------------------------------------------------------------------------- rows (no node)

def lab(verdict="CORRECT", boundary="COMPLETE_SPAN", split="train", source="sonnet_high"):
    return {"verdict": verdict, "boundary": boundary, "source": source, "split": split, "doc_id": "d", "engine": "v4",
            "group": "lectures", "batch": 1, "speaker": "s", "place": 1, "flags": [], "source_type": "QURAN"}


def fake_run(n=3):
    words = [f"w{i}" for i in range(20)]
    dets = [{"wordStartIdx": 2 + 3 * i, "wordEndIdx": 4 + 3 * i, "unitId": f"1:{i + 1}"} for i in range(n)]
    return {"words": words, "dets": dets, "keys": [V.key_of("d", x) for x in dets], "unit_words": {}}


REQ = {"members": [0, 1, 2], "state": {"source_type": "QURAN", "matched_span_in_lecture": "a b c d e f g h i"},
       "questions": {"verdict": {}, "start_missing": {}, "end_missing": {}}}


def test_passage_row_takes_start_from_first_and_end_from_last():
    run = fake_run()
    labels = {run["keys"][0]: lab(boundary="MISSING_START"), run["keys"][1]: lab(), run["keys"][2]: lab(boundary="COMPLETE_SPAN")}
    row, why = V.make_row(REQ, run, labels)
    assert why is None and row["meta"]["verses"] == 3 and row["id"].startswith("passage:")
    eb = V.EPS_BY_SOURCE["sonnet_high"]["boundary_status"]
    assert row["gold"]["start_missing"]["probabilities"]["true"] == pytest.approx(1 - eb)
    assert row["gold"]["end_missing"]["probabilities"]["true"] == pytest.approx(eb)
    assert [m["position"] for m in row["meta"]["members"]] == ["first", "inner", "last"]


def test_mixed_passage_is_dropped_from_train_and_kept_in_test():
    run = fake_run()
    for split, kept in (("train", False), ("test", True)):
        labels = {run["keys"][0]: lab(split=split), run["keys"][1]: lab(split=split), run["keys"][2]: lab("FALSE", None, split)}
        row, why = V.make_row(REQ, run, labels)
        assert (row is not None) == kept
        if kept:
            assert row["meta"]["mixed_labels"] and "start_missing" not in row["gold"]
            assert [m["meta"]["verdict"] for m in row["meta"]["members"]] == ["CORRECT", "CORRECT", "FALSE"]


def test_unlabelled_member_has_no_member_entry_and_no_edge_label():
    run = fake_run()
    labels = {run["keys"][1]: lab()}                          # only the middle verse is labelled
    row, _ = V.make_row(REQ, run, labels)
    assert [m["position"] for m in row["meta"]["members"]] == ["inner"]
    assert "start_missing" not in row["gold"] and "end_missing" not in row["gold"]


def test_false_row_has_no_boundary_questions():
    run = fake_run(1)
    row, _ = V.make_row({**REQ, "members": [0]}, run, {run["keys"][0]: lab("FALSE", None)})
    assert set(row["gold"]) == {"verdict"} and row["id"] == run["keys"][0]


# ---------------------------------------------------------------------------------------------- per-verse scoring

def test_per_verse_spreads_a_passage_answer_over_its_verses():
    row = {"id": "passage:a;b;c", "meta": {"members": [
        {"id": "a", "position": "first", "meta": {"verdict": "CORRECT"}},
        {"id": "b", "position": "inner", "meta": {"verdict": "CORRECT"}},
        {"id": "c", "position": "last", "meta": {"verdict": "CORRECT"}}]}}
    P = {"passage:a;b;c": {"verdict": {"CORRECT": .9, "FALSE": .05, "NOT_SURE": .05},
                           "start_missing": {"false": .2, "true": .8}, "end_missing": {"false": .9, "true": .1}}}
    vrows, vP = E.per_verse([row], P, {"a": {"in_passage": True}})
    assert [r["id"] for r in vrows] == ["a", "b", "c"] and vrows[0]["meta"]["context"] == {"in_passage": True}
    assert all(vP[i]["verdict"]["CORRECT"] == .9 for i in "abc")
    assert vP["a"]["start_missing"] == pytest.approx(.8) and vP["a"]["end_missing"] == pytest.approx(0)
    assert vP["b"]["boundary_status"]["COMPLETE_SPAN"] == pytest.approx(1)
    assert vP["c"]["end_missing"] == pytest.approx(.1) and vP["c"]["start_missing"] == pytest.approx(0)
    assert sum(vP["a"]["boundary_status"].values()) == pytest.approx(1)


def test_per_verse_keeps_v1_rows_and_derives_yes_no_from_4_classes():
    row = {"id": "x", "meta": {"verdict": "CORRECT"}}
    P = {"x": {"verdict": {"CORRECT": 1.0}, "boundary_status": {"COMPLETE_SPAN": .1, "MISSING_START": .2, "MISSING_END": .3, "MISSING_BOTH": .4}}}
    vrows, vP = E.per_verse([row], P)
    assert vrows[0]["id"] == "x"
    assert vP["x"]["start_missing"] == pytest.approx(.6) and vP["x"]["end_missing"] == pytest.approx(.7)


def test_label_counts_only_in_its_own_engine_run():
    run = dict(fake_run(), engine="v5")
    labels = {run["keys"][0]: lab(), run["keys"][1]: lab(), run["keys"][2]: lab()}     # labelled on v4 findings
    labels[run["keys"][1]] = dict(lab(), engine="v5")
    row, _ = V.make_row(REQ, run, labels)
    assert [m["position"] for m in row["meta"]["members"]] == ["inner"]


@needs_node
def test_long_run_is_split_into_equal_passages_not_6_plus_1(run):
    b, _ = run
    text = ("قال الشيخ رحمه الله وأنتم حينئذ تنظرون ونحن أقرب إليه منكم ولكن لا تبصرون " + " ".join(TEXT[4:28]) +
            " ثم شرح الشيخ معنى الآية في كلام طويل").split()
    dets = [{k: v for k, v in d.items() if k not in V.DET_DROP} for d in b.detect("v4", text)]
    assert [d["displayRef"] for d in dets] == [f"الواقعة: {a}" for a in range(84, 91)]
    reqs = b.laya_v2("v4", text, dets, {"passages": True, "neighbours": True})
    assert [r["members"] for r in reqs] == [[0, 1, 2, 3], [4, 5, 6]]                  # 7 verses -> 4 + 3, not 6 + 1
    assert [r["state"]["candidate_reference"] for r in reqs] == ["الواقعة: 84-87", "الواقعة: 88-90"]
    assert reqs[1]["state"]["neighbor_findings"]["previous"]["ayah_distance"] == 1   # the halves still see each other


def test_thresholds_tuned_on_val_rescue_a_model_that_never_says_yes():
    # P(cut off) ranks the cut-off quotes higher but never reaches 0.5: at 0.5 balanced = 0.5, at the tuned cut = 1.0
    gold = ["MISSING_START"] * 3 + ["COMPLETE_SPAN"] * 7
    rows = [{"id": str(i), "meta": {"verdict": "CORRECT", "boundary": b, "source": "user", "group": "review"}} for i, b in enumerate(gold)]
    ps = [0.30, 0.35, 0.40] + [0.05, 0.1, 0.1, 0.15, 0.2, 0.2, 0.25]
    P = {str(i): {"start_missing": p, "end_missing": 0.0,
                  "boundary_status": {"COMPLETE_SPAN": 1 - p, "MISSING_START": p, "MISSING_END": 0, "MISSING_BOTH": 0}}
         for i, p in enumerate(ps)}
    th = E.tune_thresholds(rows, P)
    assert 0.25 < th["start"] <= 0.30
    at_half = E.boundary_metrics(rows, P)["start cut off"]["balanced accuracy"]
    tuned = E.boundary_metrics(rows, P, th)
    assert at_half == 0.5 and tuned["start cut off"]["balanced accuracy"] == 1.0
    assert tuned["recall per class"]["MISSING_START"][0] == 1.0
