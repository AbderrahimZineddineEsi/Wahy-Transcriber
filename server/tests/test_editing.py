"""Editing through the API, with the real engine worker and the small corpus (ROADMAP phase 16): every edit goes
into the lecture's log, undo restores exactly what was there, and word timings survive a text edit."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wahy.core.settings import REPO_ROOT, Settings
from wahy.features.editing.align import Shift, replace_span, retime, token_count
from wahy.features.lectures.parsing import TimedWord
from wahy.main import create_app

SMALL_CORPUS = REPO_ROOT / "engine" / "src" / "fixtures" / "small-corpus.json"
#       0   1    2     3  4  5    6   7    8     9  10  11    12  13   14   15   16   17      18     19    20  21
TEXT = ("قال الله تعالى قل هو الله أحد الله الصمد ثم قال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ "
        #  22 23  24   25   26   27  28    29
        "ما نوى وهذا كلام عادي في الدرس اليوم")
WORDS = TEXT.split()


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("editing") / "data", corpus_path=SMALL_CORPUS,
                        engine_max_heap_mb=1024, engine_timeout_s=120, _env_file=None)
    with TestClient(create_app(settings)) as c:
        c.patch("/api/detection/settings", json={"engine": "v3"})
        yield c


def new_lecture(app) -> int:
    """A lecture of TEXT with distinct times (word i at i·0.5 s), detected with v3."""
    lectures = app.app.state.lectures
    lecture_id = lectures.create_empty(title="t", source_kind="text")
    lectures.replace_words(lecture_id, [TimedWord(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(WORDS)])
    job = app.post(f"/api/lectures/{lecture_id}/detect").json()["job"]
    assert app.app.state.jobs.wait(job["id"], timeout=60).status == "done"
    return lecture_id


def words(app, lecture_id) -> list[dict]:
    return app.get(f"/api/lectures/{lecture_id}").json()["words"]


def findings(app, lecture_id) -> list[dict]:
    return app.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]


def by_unit(app, lecture_id, unit) -> dict:
    return next(f for f in findings(app, lecture_id) if f["unit_id"] == unit)


def undo(app, lecture_id) -> dict:
    r = app.post(f"/api/lectures/{lecture_id}/edits/undo")
    assert r.status_code == 200, r.text
    return r.json()["op"]


def snapshot(app, lecture_id) -> tuple:
    return words(app, lecture_id), findings(app, lecture_id), app.get(f"/api/lectures/{lecture_id}/captions").json()


def test_the_lecture_has_the_three_quotes(app):
    lecture_id = new_lecture(app)
    got = [(f["unit_id"], f["word_start"], f["word_end"]) for f in findings(app, lecture_id)]
    assert got == [("112:1", 3, 6), ("112:2", 7, 8), ("Nawawi40:1", 16, 23)]


# ---- words and text (F-041, F-056, F-067) -------------------------------------------------------------------------

def test_word_timings_survive_a_text_edit_and_undo_restores_the_words(app):
    """Done-when test: fix three words in the full text; every other word keeps its start and end."""
    lecture_id = new_lecture(app)
    before = snapshot(app, lecture_id)
    old = words(app, lecture_id)
    new_text = WORDS.copy()
    new_text[1], new_text[25], new_text[26] = "اللهُ", "حديث", "نافع"      # three words fixed
    r = app.put(f"/api/lectures/{lecture_id}/edits/text", json={"text": " ".join(new_text)})
    assert r.status_code == 200, r.text
    assert r.json()["op"]["kind"] == "replace_text"
    after = words(app, lecture_id)
    assert [w["text"] for w in after] == new_text
    for o, a in zip(old, after, strict=True):          # same number of words: every word keeps its own time
        assert (a["start"], a["end"]) == (o["start"], o["end"])
    # the quotes outside the edit are untouched
    assert [(f["unit_id"], f["word_start"], f["word_end"]) for f in findings(app, lecture_id)] == \
        [("112:1", 3, 6), ("112:2", 7, 8), ("Nawawi40:1", 16, 23)]
    assert undo(app, lecture_id)["label"] == "Edit the lecture text"
    assert snapshot(app, lecture_id) == before


def test_inserting_words_keeps_every_other_time_and_moves_the_later_quotes(app):
    lecture_id = new_lecture(app)
    before = snapshot(app, lecture_id)
    old = words(app, lecture_id)
    hadith = by_unit(app, lecture_id, "Nawawi40:1")
    new_text = WORDS[:10] + ["يا", "إخوة"] + WORDS[10:]                   # two words inserted before word 10
    app.put(f"/api/lectures/{lecture_id}/edits/text", json={"text": " ".join(new_text)})
    after = words(app, lecture_id)
    assert [w["text"] for w in after] == new_text
    assert [(w["start"], w["end"]) for w in after[:10]] == [(w["start"], w["end"]) for w in old[:10]]
    assert [(w["start"], w["end"]) for w in after[12:]] == [(w["start"], w["end"]) for w in old[10:]]
    # the new words sit in the silence between their neighbours
    assert old[9]["end"] <= after[10]["start"] < after[11]["end"] <= old[10]["start"] + 0.04
    moved = by_unit(app, lecture_id, "Nawawi40:1")
    assert (moved["id"], moved["word_start"], moved["word_end"]) == (hadith["id"], 18, 25)
    d, o = moved["data"], hadith["data"]
    assert (d["tStart"], d["tEnd"], d["segments"]) == (o["tStart"] + 2, o["tEnd"] + 2, [[18, 26]])
    assert d["charStart"] == o["charStart"] + len("يا إخوة ")
    assert (d["startTime"], d["endTime"]) == (o["startTime"], o["endTime"])
    undo(app, lecture_id)
    assert snapshot(app, lecture_id) == before


def test_rewriting_words_inside_a_quote_with_another_count_drops_it_and_scans_the_span_again(app):
    lecture_id = new_lecture(app)
    hadith = by_unit(app, lecture_id, "Nawawi40:1")
    # words 16..17 «إنما الأعمال» → «إنما الأعمال كلها»: the hadith overlapped the span, so it is dropped...
    r = app.post(f"/api/lectures/{lecture_id}/edits/words", json={"start": 16, "end": 17, "text": "إنما الأعمال كلها"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert hadith["id"] in body["removed"]
    # ...and the re-scan of the span finds it again, over the new words
    again = by_unit(app, lecture_id, "Nawawi40:1")
    assert again["id"] in body["added"] and again["word_start"] == 16
    undo(app, lecture_id)
    assert by_unit(app, lecture_id, "Nawawi40:1")["id"] == hadith["id"]


def test_one_word_fixed_in_place_keeps_its_time_and_can_be_undone(app):
    lecture_id = new_lecture(app)
    before = words(app, lecture_id)[5]
    r = app.patch(f"/api/lectures/{lecture_id}/words/5", json={"text": "اللّه"})
    assert r.status_code == 200
    assert r.json() == {**before, "text": "اللّه"}
    assert app.get(f"/api/lectures/{lecture_id}/edits").json()[0]["kind"] == "edit_word"
    assert app.patch(f"/api/lectures/{lecture_id}/words/5", json={"text": "two words"}).status_code == 422
    assert app.patch(f"/api/lectures/{lecture_id}/words/99", json={"text": "x"}).status_code == 404
    undo(app, lecture_id)
    assert words(app, lecture_id)[5] == before


def test_the_lcs_alignment():
    old = [TimedWord(w, i * 1.0, i * 1.0 + 0.5) for i, w in enumerate("a b c d e".split())]
    same_count = retime(old, "a B c D e".split())                # one for one: each takes the old word's time
    assert [(w.text, w.start, w.end) for w in same_count] == [(w.text.upper() if w.text in "bd" else w.text, w.start,
                                                                w.end) for w in old]
    grown = retime(old, "a b x y z e".split())                    # c d → x y z, spread over c's start .. e's start
    assert [w.text for w in grown] == ["a", "b", "x", "y", "z", "e"]
    assert (grown[0].start, grown[1].end, grown[5].start) == (0.0, 1.5, 4.0)
    assert grown[2].start == 1.5 and grown[4].end == 4.0
    assert replace_span(old, 2, 1, ["new"])[0].start == 1.5        # insertion before c: between b and c
    assert replace_span(old, 1, 3, []) == []
    assert token_count("قال") == 1 and token_count("،") == 0 and token_count("ابن-عمر") == 2
    shift = Shift.of([w.text for w in old], 1, 2, ["x", "y", "z"])
    assert (shift.delta, shift.word(0), shift.word(4), shift.word_after(2)) == (1, 0, 5, -1)


# ---- findings (F-053, F-058 to F-064) -----------------------------------------------------------------------------

def test_a_missed_quote_shows_in_the_findings_and_the_captions_and_undo_removes_it(app):
    lecture_id = new_lecture(app)
    before = snapshot(app, lecture_id)
    r = app.post(f"/api/lectures/{lecture_id}/edits/quote", json={"start": 24, "end": 29, "source_type": "HADITH",
                                                                   "ref": "أثر"})
    assert r.status_code == 201, r.text
    added = r.json()["finding_id"]
    f = next(x for x in findings(app, lecture_id) if x["id"] == added)
    assert (f["unit_id"], f["display_ref"], f["word_start"], f["word_end"]) == ("OUTSIDE_CORPUS", "أثر", 24, 29)
    caps = app.get(f"/api/lectures/{lecture_id}/captions").json()
    assert caps[-1]["displayText"] == "«وهذا كلام عادي في الدرس اليوم» [أثر]"
    srt = app.get(f"/api/lectures/{lecture_id}/export/srt").text
    assert "«وهذا كلام عادي في الدرس اليوم» [أثر]" in srt
    assert undo(app, lecture_id)["label"] == "Add a missed quote"
    assert snapshot(app, lecture_id) == before


def test_a_missed_quote_with_a_corpus_unit_replaces_the_findings_it_overlaps(app):
    lecture_id = new_lecture(app)
    old = by_unit(app, lecture_id, "112:2")
    r = app.post(f"/api/lectures/{lecture_id}/edits/quote", json={"start": 7, "end": 8, "unit_id": "112:2"})
    assert r.status_code == 201
    assert r.json()["removed"] == [old["id"]]
    new = by_unit(app, lecture_id, "112:2")
    assert new["data"]["confidenceBand"] == "VERIFIED" and new["data"]["addedByHand"] is True
    bad = app.post(f"/api/lectures/{lecture_id}/edits/quote", json={"start": 7, "end": 8, "unit_id": "999:1"})
    assert bad.status_code == 409 and "no corpus unit" in bad.json()["detail"]


def test_moving_an_edge_changes_the_captions_and_undo_moves_it_back(app):
    lecture_id = new_lecture(app)
    before = snapshot(app, lecture_id)
    verse = by_unit(app, lecture_id, "112:1")
    r = app.post(f"/api/findings/{verse['id']}/edit", json={"op": "move_edge", "edge": "start", "delta": -1})
    assert r.status_code == 200, r.text
    assert by_unit(app, lecture_id, "112:1")["word_start"] == 2
    caps = app.get(f"/api/lectures/{lecture_id}/captions").json()
    assert any(c["displayText"].startswith("﴿تعالى قل هو الله أحد﴾") for c in caps)
    assert undo(app, lecture_id)["kind"] == "move_edge"
    assert snapshot(app, lecture_id) == before


@pytest.mark.parametrize("edit, check", [
    ({"op": "set_kind", "kind": "dhikr"}, lambda d: d["sourceType"] == "ADHKAR" and d["type"] == "dhikr"),
    ({"op": "snap", "on": True}, lambda d: d["snappedToCanonical"] is True),
    ({"op": "canonical_words", "indices": [0, 1]}, lambda d: d["refSelection"]["indices"] == [0, 1]),
    ({"op": "link_reference", "unit_id": "112:2"}, lambda d: d["unitId"] == "112:2"),
    ({"op": "add_candidate", "unit_id": "112:3"}, lambda d: [c["unitId"] for c in d["candidates"]] == ["112:1", "112:3"]),
    ({"op": "add_candidate", "ref": "مرجع يدوي"}, lambda d: d["candidates"][-1]["unitId"] == "MANUAL:مرجع يدوي"),
])
def test_each_finding_edit_is_saved_and_undone(app, edit, check):
    lecture_id = new_lecture(app)
    before = snapshot(app, lecture_id)
    verse = by_unit(app, lecture_id, "112:1")
    r = app.post(f"/api/findings/{verse['id']}/edit", json=edit)
    assert r.status_code == 200, r.text
    changed = next(f for f in findings(app, lecture_id) if f["id"] == verse["id"])
    assert check(changed["data"])
    undo(app, lecture_id)
    assert snapshot(app, lecture_id) == before


def test_finding_edits_that_cant_be_made_are_refused(app):
    lecture_id = new_lecture(app)
    verse = by_unit(app, lecture_id, "112:1")
    own = app.post(f"/api/findings/{verse['id']}/edit", json={"op": "remove_candidate", "unit_id": "112:1"})
    assert own.status_code == 409 and "own reference" in own.json()["detail"]
    assert app.post(f"/api/findings/{verse['id']}/edit", json={"op": "set_kind", "kind": "ayah"}).status_code == 409
    assert app.post(f"/api/findings/{verse['id']}/edit", json={"op": "nope"}).status_code == 422
    assert app.post("/api/findings/99999/edit", json={"op": "snap", "on": True}).status_code == 404
    first = by_unit(app, lecture_id, "112:1")
    assert app.post(f"/api/findings/{first['id']}/edit", json={"op": "merge", "direction": "previous"}).status_code == 409
    assert app.get(f"/api/lectures/{lecture_id}/edits").json() == []          # nothing refused was logged


def test_merging_two_neighbours_gives_one_finding_and_undo_gives_both_back(app):
    lecture_id = new_lecture(app)
    before = snapshot(app, lecture_id)
    first, second = by_unit(app, lecture_id, "112:1"), by_unit(app, lecture_id, "112:2")
    r = app.post(f"/api/findings/{first['id']}/edit", json={"op": "merge", "direction": "next"})
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == [second["id"]]
    merged = next(f for f in findings(app, lecture_id) if f["id"] == first["id"])
    assert (merged["word_start"], merged["word_end"]) == (3, 8)
    assert second["id"] not in [f["id"] for f in findings(app, lecture_id)]
    undo(app, lecture_id)
    assert snapshot(app, lecture_id) == before


def test_dismissing_a_merge_suggestion_is_remembered_on_the_finding(app):
    lecture_id = new_lecture(app)
    verse = by_unit(app, lecture_id, "112:1")
    app.post(f"/api/findings/{verse['id']}/edit", json={"op": "dismiss_merge", "direction": "next"})
    assert by_unit(app, lecture_id, "112:1")["data"]["mergeDismissed"] == ["next"]


def test_deleting_as_ordinary_speech_saves_a_gold_false_label_and_undo_removes_both(app):
    lecture_id = new_lecture(app)
    before = snapshot(app, lecture_id)
    hadith = by_unit(app, lecture_id, "Nawawi40:1")
    r = app.delete(f"/api/findings/{hadith['id']}", params={"intent": "ordinary_speech"})
    assert r.status_code == 200, r.text
    assert hadith["id"] not in [f["id"] for f in findings(app, lecture_id)]
    from sqlalchemy import select

    from wahy.features.training.models import Label
    with app.app.state.db.session() as s:
        labels = list(s.scalars(select(Label).where(Label.finding_id == hadith["id"])))
        assert [(lab.source, lab.verdict) for lab in labels] == [("user", "FALSE")]
    undo(app, lecture_id)
    assert snapshot(app, lecture_id) == before
    with app.app.state.db.session() as s:
        assert list(s.scalars(select(Label).where(Label.finding_id == hadith["id"]))) == []


def test_deleting_as_a_highlighting_mistake_saves_no_label(app):
    lecture_id = new_lecture(app)
    verse = by_unit(app, lecture_id, "112:1")
    assert app.delete(f"/api/findings/{verse['id']}", params={"intent": "highlight_mistake"}).status_code == 200
    from sqlalchemy import func, select

    from wahy.features.training.models import Label
    with app.app.state.db.session() as s:
        assert s.scalar(select(func.count(Label.id)).where(Label.finding_id == verse["id"])) == 0
    assert app.delete(f"/api/findings/{verse['id']}", params={"intent": "highlight_mistake"}).status_code == 404
    assert app.delete(f"/api/findings/{verse['id']}", params={"intent": "why"}).status_code == 422


def test_expanding_a_clipped_finding_is_an_edit_that_undo_shrinks_back(app):
    lecture_id = new_lecture(app)
    hadith = by_unit(app, lecture_id, "Nawawi40:1")
    # cut the hadith's last two words off, as an engine that missed them would
    app.post(f"/api/findings/{hadith['id']}/edit", json={"op": "move_edge", "edge": "end", "delta": -2})
    app.put(f"/api/findings/{hadith['id']}/verdict", json={"verdict": "CORRECT", "boundary": "MISSING_END"})
    before = snapshot(app, lecture_id)
    r = app.post(f"/api/findings/{hadith['id']}/expand", json={})
    assert r.status_code == 200, r.text
    assert r.json()["changed"] is True and r.json()["word_end"] == 23
    grown = by_unit(app, lecture_id, "Nawawi40:1")
    assert grown["word_end"] == 23 and grown["verdict"]["boundary"] == "COMPLETE"
    assert undo(app, lecture_id)["kind"] == "expand"
    assert snapshot(app, lecture_id) == before


# ---- captions (F-068) ---------------------------------------------------------------------------------------------

def test_caption_edits_split_merge_and_time_and_quotes_are_locked(app):
    lecture_id = new_lecture(app)
    caps = app.get(f"/api/lectures/{lecture_id}/captions").json()
    speech = next(c for c in caps if c["type"] == "normal" and c["wordEndIdx"] > c["wordStartIdx"])
    at = speech["wordStartIdx"] + 1
    r = app.post(f"/api/lectures/{lecture_id}/edits/captions", json={"op": "split", "word": at})
    assert r.status_code == 200, r.text
    split = app.get(f"/api/lectures/{lecture_id}/captions").json()
    assert len(split) == len(caps) + 1
    second = next(c for c in split if c["wordStartIdx"] == at)
    assert second["start"] == words(app, lecture_id)[at]["start"]
    quote = next(c for c in caps if c["type"] != "normal")
    locked = app.post(f"/api/lectures/{lecture_id}/edits/captions", json={"op": "split", "word": quote["wordStartIdx"] + 1})
    assert locked.status_code == 409 and "locked" in locked.json()["detail"]
    app.post(f"/api/lectures/{lecture_id}/edits/captions", json={"op": "time", "word": at, "start": second["start"] + 0.1})
    assert next(c for c in app.get(f"/api/lectures/{lecture_id}/captions").json()
                if c["wordStartIdx"] == at)["start"] == round(second["start"] + 0.1, 2)
    assert "\n" in app.get(f"/api/lectures/{lecture_id}/export/srt").text
    undo(app, lecture_id)
    undo(app, lecture_id)
    assert app.get(f"/api/lectures/{lecture_id}/captions").json() == caps


def test_a_text_edit_moves_the_caption_edits_after_it(app):
    lecture_id = new_lecture(app)
    app.post(f"/api/lectures/{lecture_id}/edits/captions", json={"op": "split", "word": 26})
    app.post(f"/api/lectures/{lecture_id}/edits/words", json={"start": 0, "end": -1, "text": "بسم الله"})
    assert app.app.state.editing.caption_edits(lecture_id) == [{"op": "split", "word": 28}]


# ---- the log ------------------------------------------------------------------------------------------------------

def test_the_log_lists_edits_newest_first_and_a_new_detection_starts_it_again(app):
    lecture_id = new_lecture(app)
    assert app.post(f"/api/lectures/{lecture_id}/edits/undo").status_code == 409     # nothing to undo
    verse = by_unit(app, lecture_id, "112:1")
    app.post(f"/api/findings/{verse['id']}/edit", json={"op": "snap", "on": True})
    app.patch(f"/api/lectures/{lecture_id}/words/0", json={"text": "وقال"})
    undo(app, lecture_id)
    log = app.get(f"/api/lectures/{lecture_id}/edits").json()
    assert [(op["kind"], op["undone"]) for op in log] == [("edit_word", True), ("snap", False)]
    assert undo(app, lecture_id)["kind"] == "snap"
    job = app.post(f"/api/lectures/{lecture_id}/detect").json()["job"]
    app.app.state.jobs.wait(job["id"], timeout=60)
    assert app.get(f"/api/lectures/{lecture_id}/edits").json() == []
    assert app.get("/api/lectures/99999/edits").status_code == 404
