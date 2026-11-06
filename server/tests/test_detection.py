"""Detection through the API. Fast tests use a fake engine to check what is sent to it and what is saved; a test
with the real worker and the small corpus checks the custom-quote and adhkar switches end to end; the golden
test sends each golden input through the API with the real worker and the full corpus (skipped without
data/corpus.json) and requires the old app's findings, exactly."""

from __future__ import annotations

import json

import pytest
from fakes import FakeEngine, make_finding

from wahy.core.settings import REPO_ROOT, Settings
from wahy.features.lectures.parsing import TimedWord
from wahy.main import create_app

SMALL_CORPUS = REPO_ROOT / "engine" / "src" / "fixtures" / "small-corpus.json"
FULL_CORPUS = REPO_ROOT / "data" / "corpus.json"
GOLDEN = REPO_ROOT / "engine" / "golden"
TEXT = "قال الله تعالى قل هو الله أحد الله الصمد ثم قال النبي إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"


def run_job(client, started: dict, timeout: float = 60) -> dict:
    return client.app.state.jobs.wait(started["job"]["id"], timeout=timeout).model_dump()


def make_lecture(client, text: str = TEXT) -> int:
    lectures = client.app.state.lectures
    lecture_id = lectures.create_empty(title="t", source_kind="text")
    lectures.replace_words(lecture_id, [TimedWord(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(text.split())])
    return lecture_id


@pytest.fixture
def api(client):
    """The app with a fake engine. `client.engine.finder` decides what it finds."""
    client.engine = FakeEngine(lambda words, options: [make_finding(3, 6), make_finding(7, 8, unit="112:2")])
    client.app.state.detection.engine = client.app.state.corpora.engine = client.engine
    return client


# ---- the job -----------------------------------------------------------------------------------------------------

def test_detect_runs_as_a_job_and_saves_the_findings_as_the_engine_gave_them(api):
    lecture_id = make_lecture(api)
    r = api.post(f"/api/lectures/{lecture_id}/detect")
    assert r.status_code == 202
    job = run_job(api, r.json())
    assert job["status"] == "done" and job["lecture_id"] == lecture_id
    assert job["result"] == {"engine": "v5", "count": 2, "by_type": {"QURAN": 2}, "word_count": 20,
                             "hadith_source": "wahy_default"}

    saved = api.get(f"/api/lectures/{lecture_id}/findings").json()
    assert saved["count"] == 2
    first = saved["findings"][0]
    assert (first["idx"], first["engine"], first["source_type"], first["unit_id"], first["word_start"],
            first["word_end"]) == (0, "v5", "QURAN", "112:1", 3, 6)
    assert first["data"] == make_finding(3, 6)                    # the whole finding, untouched (evidence...)

    words, options = api.engine.detect_calls[0]
    assert words[3] == {"word": "قل", "start": 1.5, "end": 1.9} and len(words) == 20
    assert (options["engine"], options["profile"], options["qiraat"]) == ("v5", "normal", "AUTO")
    assert len(options["adhkar"]) == 18 and options["customQuotes"] == []


def test_the_engine_choice_qiraah_and_adhkar_switch_reach_the_engine(api):
    lecture_id = make_lecture(api)
    api.app.state.corpora.add_quote(__import__("wahy.features.corpora.schemas", fromlist=["QuoteIn"])
                                    .QuoteIn(t="الدين النصيحة", ref="r"))
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect",
                          json={"engine": "v5:loose", "qiraat": "warsh", "adhkar": False}).json())
    _, options = api.engine.detect_calls[-1]
    assert (options["engine"], options["profile"], options["qiraat"], options["adhkar"]) == \
        ("v5", "loose", "warsh", [])
    assert [q["ref"] for q in options["customQuotes"]] == ["r"]
    assert api.get(f"/api/lectures/{lecture_id}/findings").json()["findings"][0]["engine"] == "v5:loose"


def test_saved_detection_settings_are_the_defaults_and_bad_values_are_refused(api):
    assert api.get("/api/detection/settings").json() == {"engine": "v5", "qiraat": "AUTO", "adhkar": True}
    r = api.patch("/api/detection/settings", json={"engine": "v4", "adhkar": False})
    assert r.json() == {"engine": "v4", "qiraat": "AUTO", "adhkar": False}
    assert api.get("/api/detection/settings").json()["engine"] == "v4"          # remembered

    lecture_id = make_lecture(api)
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect").json())
    _, options = api.engine.detect_calls[-1]
    assert (options["engine"], options["adhkar"]) == ("v4", [])
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect", json={"adhkar": True}).json())
    assert len(api.engine.detect_calls[-1][1]["adhkar"]) == 18                 # a request overrides the setting

    assert api.patch("/api/detection/settings", json={"engine": "v9"}).status_code == 422
    assert api.post(f"/api/lectures/{lecture_id}/detect", json={"engine": "v5:strict"}).status_code == 422
    assert api.post(f"/api/lectures/{lecture_id}/detect", json={"qiraat": "../x"}).status_code == 422


def test_detecting_again_replaces_the_findings_and_keeps_the_old_ones_as_a_lecture_version(api):
    lecture_id = make_lecture(api)
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect").json())
    assert api.get(f"/api/lectures/{lecture_id}/versions").json() == []        # nothing to keep the first time

    api.engine.finder = lambda words, options: [make_finding(7, 8, unit="112:2")]
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect", json={"engine": "v4"}).json())
    now = api.get(f"/api/lectures/{lecture_id}/findings").json()
    assert [f["unit_id"] for f in now["findings"]] == ["112:2"] and now["findings"][0]["engine"] == "v4"

    [version] = api.get(f"/api/lectures/{lecture_id}/versions").json()
    assert version["name"].startswith("before re-detect (v5)")
    saved = api.get(f"/api/lectures/{lecture_id}/versions/{version['id']}").json()["snapshot"]
    assert saved["engine"] == "v5" and [f["unitId"] for f in saved["findings"]] == ["112:1", "112:2"]


def test_each_finding_carries_its_newest_verdict_or_none(api):
    from wahy.features.verification.models import Verdict

    lecture_id = make_lecture(api)
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect").json())
    first, second = api.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]
    assert first["verdict"] is None and second["verdict"] is None
    with api.app.state.db.session() as s:
        s.add(Verdict(finding_id=first["id"], verifier="laya", model="v3_mixed", verdict="CORRECT",
                      boundary="MISSING_END"))
        s.add(Verdict(finding_id=first["id"], verifier="human", verdict="FALSE", boundary="COMPLETE"))
    first, second = api.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]
    assert first["verdict"] == {"verdict": "FALSE", "boundary": "COMPLETE", "verifier": "human", "model": None}
    assert second["verdict"] is None


def test_a_lecture_without_words_fails_the_job_and_an_unknown_lecture_is_404(api):
    empty = api.app.state.lectures.create_empty(title="empty", source_kind="youtube", source_url="https://x.y/z")
    job = run_job(api, api.post(f"/api/lectures/{empty}/detect").json())
    assert job["status"] == "failed" and "no words" in job["error"]
    assert api.get(f"/api/lectures/{empty}/findings").json()["count"] == 0
    assert api.post("/api/lectures/999/detect").status_code == 404
    assert api.get("/api/lectures/999/findings").status_code == 404


def test_deleting_a_lecture_deletes_its_findings(api):
    lecture_id = make_lecture(api)
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect").json())
    assert api.delete(f"/api/lectures/{lecture_id}").status_code == 204
    from sqlalchemy import func, select

    from wahy.features.detection.models import Finding
    with api.app.state.db.session() as s:
        assert s.scalar(select(func.count(Finding.id))) == 0


# ---- corpus search -----------------------------------------------------------------------------------------------

def test_search_passes_the_query_kind_and_limit_with_the_same_engine_options_as_detection(api):
    hits = api.get("/api/corpus/search", params={"q": "الإخلاص", "kind": "QURAN", "limit": 5}).json()
    assert hits[0]["unitId"] == "112:1" and hits[0]["displayRef"] == "الإخلاص: 1"
    text, options = api.engine.search_calls[0]
    assert text == "الإخلاص" and (options["kind"], options["limit"], options["engine"]) == ("QURAN", 5, "v5")
    # same engine options as a detection, so the worker reuses the matcher it already built
    lecture_id = make_lecture(api)
    run_job(api, api.post(f"/api/lectures/{lecture_id}/detect").json())
    detect_options = api.engine.detect_calls[0][1]
    assert {k: v for k, v in options.items() if k not in ("kind", "limit")} == detect_options
    assert api.get("/api/corpus/search", params={"kind": "NOPE"}).status_code == 422


# ---- the real worker, small corpus -------------------------------------------------------------------------------

@pytest.fixture
def real(tmp_path):
    from fastapi.testclient import TestClient
    settings = Settings(data_dir=tmp_path / "data", corpus_path=SMALL_CORPUS, engine_max_heap_mb=1024,
                        engine_timeout_s=120, _env_file=None)
    with TestClient(create_app(settings)) as c:
        yield c


def test_a_custom_quote_and_the_adhkar_switch_change_what_the_real_engine_finds(real):
    text = "سبحان الله وبحمده ثم قال الدين النصيحة لله ولرسوله"
    lecture_id = make_lecture(real, text)
    real.patch("/api/detection/settings", json={"engine": "v3"})

    def refs() -> set[str]:
        run_job(real, real.post(f"/api/lectures/{lecture_id}/detect").json())
        return {f["data"]["unitId"] for f in real.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]}

    with_adhkar = refs()
    assert "Adhkar:tasbih_hamd" in with_adhkar

    real.patch("/api/detection/settings", json={"adhkar": False})
    assert not any(r.startswith("Adhkar:") for r in refs())              # F-046: off → no dhikr findings

    quote = real.post("/api/corpora/custom-quotes", json={"t": "الدين النصيحة لله ولرسوله", "ref": "حديث النصيحة"})
    found = refs()                                                       # F-075: the next detection finds it
    assert quote.json()["id"] in found
    hit = real.get("/api/corpus/search", params={"q": "حديث النصيحة"}).json()
    assert [h["unitId"] for h in hit] == [quote.json()["id"]]            # and corpus search sees it too
    real.delete(f"/api/corpora/custom-quotes/{quote.json()['id']}")
    assert quote.json()["id"] not in refs()


def test_search_finds_ayat_by_reference_and_by_words_with_the_real_engine(real):
    by_words = real.get("/api/corpus/search", params={"q": "الصمد", "kind": "QURAN"}).json()
    assert any(h["unitId"] == "112:2" for h in by_words)
    assert real.get("/api/corpus/search", params={"q": "112:1"}).json()[0]["unitId"] == "112:1"
    assert real.get("/api/corpus/search", params={"q": "", "limit": 3}).json().__len__() == 3


# ---- golden: the old app's findings, through the API -------------------------------------------------------------

manifest = json.loads((GOLDEN / "expected" / "manifest.json").read_text(encoding="utf-8")) \
    if (GOLDEN / "expected" / "manifest.json").exists() else {"inputs": {}, "engines": []}


@pytest.fixture(scope="module")
def golden_client(tmp_path_factory):
    """One app and one engine worker for the whole module: building the four matchers takes minutes."""
    from fastapi.testclient import TestClient
    settings = Settings(data_dir=tmp_path_factory.mktemp("golden") / "data", corpus_path=FULL_CORPUS,
                        engine_max_heap_mb=3584, engine_timeout_s=900, _env_file=None)
    with TestClient(create_app(settings)) as c:
        c.lecture_ids = {}
        yield c


def golden_lecture(client, name: str) -> int:
    if name not in client.lecture_ids:
        source = json.loads((GOLDEN / "inputs" / f"{name}.json").read_text(encoding="utf-8"))
        if "text" in source:                       # the sample: pasted text, timed by the server
            lecture_id = client.post("/api/lectures", json={"text": source["text"].strip(), "title": name}).json()["id"]
        else:
            lectures = client.app.state.lectures
            lecture_id = lectures.create_empty(title=name, source_kind="text")
            lectures.replace_words(lecture_id, [TimedWord(w["word"], w["start"], w["end"]) for w in source["words"]])
        client.lecture_ids[name] = lecture_id
    return client.lecture_ids[name]


@pytest.mark.skipif(not FULL_CORPUS.exists(), reason="data/corpus.json is missing (./run.sh downloads it)")
@pytest.mark.parametrize("choice", manifest["engines"])
@pytest.mark.parametrize("name", list(manifest["inputs"]))
def test_golden_findings_through_the_api(golden_client, name, choice):
    lecture_id = golden_lecture(golden_client, name)
    started = golden_client.post(f"/api/lectures/{lecture_id}/detect", json={"engine": choice})
    assert started.status_code == 202
    job = run_job(golden_client, started.json(), timeout=900)
    assert job["status"] == "done", job["error"]

    got = [f["data"] for f in golden_client.get(f"/api/lectures/{lecture_id}/findings").json()["findings"]]
    expected = json.loads((GOLDEN / "expected" / name / choice.replace(":", "-") / "findings.json")
                          .read_text(encoding="utf-8"))
    assert len(got) == len(expected)
    for i, (g, e) in enumerate(zip(got, expected, strict=True)):
        assert g == e, f"finding {i} differs"
