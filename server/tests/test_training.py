"""Training data through the API (ROADMAP phase 20), with the real engine worker and the small corpus.

Done-when test: importing the old app's exported training bank and exporting it again gives the old app's
file byte for byte (engine/golden/expected/laya_export.jsonl). The rest: the user's corrections become gold
labels that say how they were given (verdict buttons, approve all, delete as ordinary speech, a missed quote),
the "reference wrong" flag reaches the export (N-007), verifiers' verdicts are rows until the user labels them,
clearing empties the screen, and a Tafrigh run's sentences can be saved for Laya (F-120).
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from tafrigh.helpers import make_ai, unsure_transport

from wahy.core.ai.fake import FakeVerifier
from wahy.core.settings import REPO_ROOT, Settings
from wahy.features.lectures.parsing import TimedWord
from wahy.main import create_app

SMALL_CORPUS = REPO_ROOT / "engine" / "src" / "fixtures" / "small-corpus.json"
GOLDEN_EXPORT = REPO_ROOT / "engine" / "golden" / "expected" / "laya_export.jsonl"
#       0   1    2     3  4  5    6   7    8     9  10  11    12  13   14   15   16   17      18     19    20  21
TEXT = ("قال الله تعالى قل هو الله أحد الله الصمد ثم قال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ "
        #  22 23  24   25   26   27  28    29
        "ما نوى وهذا كلام عادي في الدرس اليوم")
WORDS = TEXT.split()


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("training") / "data", corpus_path=SMALL_CORPUS,
                        engine_max_heap_mb=1024, engine_timeout_s=120, _env_file=None)
    with TestClient(create_app(settings)) as c:
        c.patch("/api/detection/settings", json={"engine": "v3"})
        yield c


@pytest.fixture
def clean(app):
    """Every test starts with no training data."""
    assert app.delete("/api/training").status_code == 200
    return app


def new_lecture(app, title: str = "درس التجربة") -> int:
    lectures = app.app.state.lectures
    lecture_id = lectures.create_empty(title=title, source_kind="text")
    lectures.replace_words(lecture_id, [TimedWord(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(WORDS)])
    job = app.post(f"/api/lectures/{lecture_id}/detect").json()["job"]
    assert app.app.state.jobs.wait(job["id"], timeout=60).status == "done"
    return lecture_id


def by_unit(app, lecture_id: int, unit: str) -> dict:
    return next(f for f in app.get(f"/api/lectures/{lecture_id}/findings").json()["findings"] if f["unit_id"] == unit)


def page(app, **params) -> dict:
    r = app.get("/api/training", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def export(app, **params) -> list[dict]:
    r = app.get("/api/training/export", params=params)
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"].startswith('attachment; filename="wahy_')
    return [json.loads(line) for line in r.text.splitlines()]


# ---- the old app's bank (F-100, F-101) ------------------------------------------------------------------------------

def test_importing_the_old_bank_and_exporting_it_again_gives_the_old_apps_export(clean):
    """Done-when test. The old app's only export of its bank is the Laya JSONL file (F-101); the golden one holds
    three user verdicts and three AI verdicts."""
    golden = GOLDEN_EXPORT.read_bytes()
    r = clean.post("/api/training/import", files={"file": ("wahy_laya_train.jsonl", golden)})
    assert r.status_code == 200, r.text
    assert r.json() == {"imported": 6, "replaced": 0, "skipped": 0, "files": ["wahy_laya_train.jsonl"]}

    exported = clean.get("/api/training/export")
    assert exported.content == golden

    # the counters equal the old app's (renderLayaDatasetBankStats on the same records)
    c = page(clean)["counts"]
    assert (c["total"], c["correct"], c["false"], c["not_sure"], c["gold"], c["ai"]) == (6, 3, 2, 1, 3, 3)
    assert c["clipped"] == 1                                    # req_golden_1: MISSING_END

    # importing it again saves the same rows again, it does not add them twice
    again = clean.post("/api/training/import", files={"file": ("again.jsonl", golden)}).json()
    assert (again["imported"], again["replaced"]) == (0, 6)
    assert clean.get("/api/training/export").content == golden


def test_the_import_reads_data_legacy_and_skips_lines_that_are_not_rows(clean):
    legacy = clean.app.state.training.legacy_dir
    legacy.mkdir(parents=True, exist_ok=True)
    (legacy / "bank.jsonl").write_bytes(GOLDEN_EXPORT.read_bytes() + b'{"hello": 1}\nnot json\n')
    (legacy / "notes.txt").write_text("ignored", encoding="utf-8")
    try:
        got = clean.post("/api/training/import/legacy").json()
        assert got == {"imported": 6, "replaced": 0, "skipped": 2, "files": ["bank.jsonl"]}
        assert clean.get("/api/training/export").content == GOLDEN_EXPORT.read_bytes()
        rows = page(clean, origin="legacy")["rows"]
        assert len(rows) == 6 and {r["origin"] for r in rows} == {"legacy"}
        human = [r for r in rows if r["gold"]]
        assert sorted(r["verdict"] for r in human) == ["CORRECT", "FALSE", "NOT_SURE"]
        assert all(r["lecture_title"] == "محاضرة تجريبية — آيات وأحاديث وأذكار" for r in rows)
    finally:
        (legacy / "bank.jsonl").unlink()
        (legacy / "notes.txt").unlink()


def test_a_json_array_imports_too_and_a_broken_file_is_refused(clean):
    rows = [json.loads(line) for line in GOLDEN_EXPORT.read_text(encoding="utf-8").splitlines()]
    r = clean.post("/api/training/import", files={"file": ("bank.json", json.dumps(rows[:2]).encode())})
    assert r.json()["imported"] == 2
    assert clean.post("/api/training/import", files={"file": ("x.json", b"[1, 2")}).status_code == 400


# ---- the user's corrections (F-064, F-065, F-091, N-007) ------------------------------------------------------------

def test_the_users_corrections_are_gold_labels_that_say_how_they_were_given(clean):
    app = clean
    lecture_id = new_lecture(app)
    verse = by_unit(app, lecture_id, "112:1")
    hadith = by_unit(app, lecture_id, "Nawawi40:1")
    assert app.put(f"/api/findings/{verse['id']}/verdict", json={"verdict": "FALSE"}).status_code == 200
    assert app.delete(f"/api/findings/{hadith['id']}", params={"intent": "ordinary_speech"}).status_code == 200
    r = app.post(f"/api/lectures/{lecture_id}/edits/quote",
                 json={"start": 24, "end": 29, "source_type": "HADITH", "ref": "قول مأثور"})
    assert r.status_code == 201, r.text

    rows = page(app, origin="user")["rows"]                      # newest first
    assert [(r["action"], r["verdict"], r["boundary"]) for r in rows] == [
        ("MISSED_QUOTE", "CORRECT", "COMPLETE"), ("ORDINARY_SPEECH", "FALSE", None), ("SET", "FALSE", None)]
    assert all(r["gold"] and r["lecture_title"] == "درس التجربة" for r in rows)
    assert page(app)["counts"]["missed"] == 1

    lines = export(app, gold_only=True)
    assert len(lines) == 3
    assert all(x["meta"]["human_verified"] and x["meta"]["lecture_title"] == "درس التجربة" for x in lines)
    assert [x["answers"]["verdict"]["choice"] for x in lines] == ["FALSE", "FALSE", "CORRECT"]
    assert lines[0]["answers"]["verdict"]["probabilities"] == {"CORRECT": 0.01, "FALSE": 0.98, "NOT_SURE": 0.01}
    assert lines[0]["state"]["candidate_reference"] == verse["display_ref"]
    assert lines[2]["answers"]["boundary_status"]["choice"] == "COMPLETE_SPAN"
    assert all(x["id"].startswith("wahy_dec_") for x in lines)

    # undoing the missed quote takes its label away with it
    assert app.post(f"/api/lectures/{lecture_id}/edits/undo").json()["op"]["label"] == "Add a missed quote"
    assert [r["action"] for r in page(app, origin="user")["rows"]] == ["ORDINARY_SPEECH", "SET"]


def test_the_reference_wrong_flag_reaches_the_gold_label(clean):
    app = clean
    lecture_id = new_lecture(app)
    verse = by_unit(app, lecture_id, "112:2")
    app.put(f"/api/findings/{verse['id']}/verdict", json={"verdict": "CORRECT"})
    assert "ref_issue" not in export(app)[0]["meta"]
    r = app.post(f"/api/findings/{verse["id"]}/edit", json={"op": "flag_reference", "wrong": True})
    assert r.status_code == 200, r.text
    assert export(app)[0]["meta"]["ref_issue"] is True
    assert page(app)["rows"][0]["ref_issue"] is True
    app.post(f"/api/lectures/{lecture_id}/edits/undo")
    assert "ref_issue" not in export(app)[0]["meta"]


def test_verifier_verdicts_are_rows_until_approved_and_clearing_hides_them(clean):
    app = clean
    lecture_id = new_lecture(app)
    app.app.state.ai.fake = FakeVerifier(app.app.state.ai.log)
    r = app.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": {"provider": "fake"}})
    assert r.status_code == 202, r.text
    assert app.app.state.jobs.wait(r.json()["job"]["id"], timeout=60).status == "done"

    ai = page(app, origin="ai")["rows"]
    assert len(ai) == 3 and {r["origin"] for r in ai} == {"ai"} and not any(r["gold"] for r in ai)
    lines = export(app)
    assert len(lines) == 3 and not any(x["meta"]["human_verified"] for x in lines)
    assert all(x["id"].startswith("wahy_verdict_") for x in lines)
    assert export(app, gold_only=True) == []

    # approve all: each AI verdict becomes the user's (gold), and the AI row gives way to it
    assert app.post(f"/api/lectures/{lecture_id}/verification/approve").json()["labels"] == 3
    p = page(app)
    assert (p["counts"]["total"], p["counts"]["gold"], p["counts"]["ai"]) == (3, 3, 0)
    assert {r["action"] for r in p["rows"]} == {"VALIDATE_ALL"}
    assert len(page(app, origin="approval")["rows"]) == 3
    assert all(r["ai_verdict"] == "CORRECT" for r in p["rows"])
    approved = export(app)
    assert all(x["human_gold_resolution"]["user_action"] == "VALIDATE_ALL" for x in approved)
    assert all(x["meta"]["source_provider"] == "fake-1" for x in approved)

    # F-103: clear empties the training data; the verdicts stay on the lecture
    assert app.delete("/api/training").json()["deleted"] == 3
    assert page(app)["counts"]["total"] == 0
    found = app.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]
    assert all(f["verdict"] for f in found)


def test_filters_search_and_the_row_inspector(clean):
    app = clean
    app.post("/api/training/import", files={"file": ("b.jsonl", GOLDEN_EXPORT.read_bytes())})
    assert len(page(app, label="FALSE")["rows"]) == 2
    assert len(page(app, label="CLIPPED")["rows"]) == 1
    assert len(page(app, origin="gold")["rows"]) == 3
    assert len(page(app, q="يونس")["rows"]) == 1
    assert page(app, task="tafrigh")["rows"] == []
    assert len(page(app, limit=2)["rows"]) == 2 and page(app, limit=2)["matching"] == 6
    row = page(app, q="يونس")["rows"][0]
    got = app.get(f"/api/training/rows/{row['id']}").json()
    assert got["row"]["id"] == "wahy_dec_1793707200_0"
    assert app.get("/api/training/rows/label:999999").status_code == 404
    assert app.get("/api/training", params={"origin": "nope"}).status_code == 422


# ---- Tafrigh (F-120) ------------------------------------------------------------------------------------------------

def test_saving_a_tafrigh_runs_sentences_for_laya_replaces_the_previous_save(clean, tmp_path):
    app = clean
    service = app.app.state.tafrigh
    old_ai, old_settings = service.ai, service.settings
    service.ai = make_ai(unsure_transport(), db=app.app.state.db)
    service.settings = service.ai.settings
    service.settings.tafrigh_runs_dir = old_settings.tafrigh_runs_dir
    try:
        lecture = app.post("/api/lectures/sample").json()["id"]
        r = app.post(f"/api/lectures/{lecture}/tafrigh/runs", json={"model_candidate": "jev_hybrid", "first_n": 8})
        assert r.status_code == 202, r.text
        job = app.app.state.jobs.wait(r.json()["job"]["id"], timeout=60)
        assert job.status == "done", job
        run_id = job.result["run_id"]
    finally:
        service.ai, service.settings = old_ai, old_settings
    segments = app.get(f"/api/tafrigh/runs/{run_id}").json()["structured_json"]["segments"]
    ids = [s["id"] for s in segments]
    assert app.get(f"/api/training/tafrigh/{run_id}").json() is None

    # review one sentence, then save five
    app.post(f"/api/tafrigh/runs/{run_id}/review", json={"segment_id": ids[0], "action": "confirm"})
    saved = app.post(f"/api/training/tafrigh/{run_id}", json={"segment_ids": ids[:5], "note": "أول حفظ"}).json()
    assert (saved["sentences"], saved["note"]) == (5, "أول حفظ")
    assert saved["by_source"].get("human_confirmed") == 1
    p = page(app, task="tafrigh")
    assert p["counts"]["segmentation"] == 5
    assert {r["origin"] for r in p["rows"]} == {"tafrigh"} and all(r["run_id"] == run_id for r in p["rows"])
    assert len(page(app, origin="gold", task="tafrigh")["rows"]) == 1

    # the Tafrigh file: the old "save run" lines (schema, task, gold answers, the model's own answers)
    lines = export(app, task="tafrigh")
    assert len(lines) == saved["count"]
    assert {x["schema_version"] for x in lines} == {"tafrigh-laya-1"}
    assert lines[0]["meta"]["note"] == "أول حفظ" and lines[0]["saved_at"]
    assert export(app) == []                                     # no verdict rows

    # saving again replaces; the file round-trips through the import
    again = app.post(f"/api/training/tafrigh/{run_id}", json={"segment_ids": ids[:2]}).json()
    assert again["sentences"] == 2 and page(app)["counts"]["segmentation"] == 2
    assert app.get(f"/api/training/tafrigh/{run_id}").json()["segment_ids"] == ids[:2]
    text = app.get("/api/training/export", params={"task": "tafrigh"}).content
    assert app.post("/api/training/import", files={"file": ("t.jsonl", text)}).json()["replaced"] == again["count"]
    assert app.get("/api/training/export", params={"task": "tafrigh"}).content == text

    assert app.post(f"/api/training/tafrigh/{run_id}", json={"segment_ids": ["nope"]}).status_code == 400
    assert app.post("/api/training/tafrigh/run_000000000000", json={"segment_ids": ["x"]}).status_code == 404
