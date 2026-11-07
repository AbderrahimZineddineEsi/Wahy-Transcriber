"""Corpora: the hadith sources (converted from a small fake release zip, no network), the adhkar list, custom
quotes, and the engine worker reading another hadith file (real worker, small corpus)."""

from __future__ import annotations

import io
import json
import subprocess
import zipfile
from pathlib import Path

import pytest
from fakes import FakeEngine

from wahy.core.engine import EngineClient
from wahy.core.settings import REPO_ROOT
from wahy.features.corpora.service import BUILTIN_ADHKAR, SEEDED_KEY, CorporaService, normalise
from wahy.features.corpora.sources import (
    AlreadyPreparing,
    SourceError,
    SourceStore,
    UnknownSource,
    convert_open_hadith_zip,
)
from wahy.features.settings.store import SettingsStore

SMALL_CORPUS = REPO_ROOT / "engine" / "src" / "fixtures" / "small-corpus.json"
NIYYAT = "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"


def make_zip(path: Path | None = None) -> bytes:
    """A release zip in the Open Hadith Data layout: one JSON file per collection, plus one to skip."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("bukhari.json", json.dumps({"collection_id": "bukhari", "books": [{"hadiths": [
            {"hadith_number": 1, "text_ar": f"حدثنا فلان قال النبي {NIYYAT}", "matn_ar": NIYYAT,
             "grade_ar": "حكم: صحيح"},
            {"hadith_number": 2, "text_ar": "حديث بلا متن منفصل"},
            {"hadith_number": 3, "text_ar": "", "matn_ar": ""},                       # empty: dropped
        ]}]}, ensure_ascii=False))
        z.writestr("hisn.json", json.dumps({"hadiths": [{"text_ar": "دعاء"}]}))        # skipped collection
        z.writestr("readme.txt", "not json")
    if path:
        path.write_bytes(buf.getvalue())
    return buf.getvalue()


class FakeDownload:
    """Replaces the HTTP download: writes the fake zip and counts the calls."""

    def __init__(self):
        self.calls = 0

    def __call__(self, url, dest, progress, check):
        self.calls += 1
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(make_zip())
        progress(50, "downloading")


@pytest.fixture
def download() -> FakeDownload:
    return FakeDownload()


@pytest.fixture
def store(tmp_path, download) -> SourceStore:
    return SourceStore(tmp_path, download=download)


# ---- the conversion and the source store -------------------------------------------------------------------------

def test_the_release_zip_is_converted_to_the_apps_hadith_format():
    out = convert_open_hadith_zip(make_zip(), skip=("hisn",))
    assert out["by_book"] == {"Bukhari": 2}
    first, second = out["hadiths"]
    assert first == {"id": "OHD:Bukhari:1", "book": "Bukhari", "ref": "صحيح البخاري (1)",
                     "t": f"حدثنا فلان قال النبي {NIYYAT}", "matn": NIYYAT, "grade": "صحيح"}
    assert second["t"] == "حديث بلا متن منفصل" and "matn" not in second      # no split in the source: no matn


def test_prepare_downloads_once_converts_and_writes_the_prepared_file(store, download):
    steps = []
    summary = store.prepare("open_hadith_data", "job1", lambda pct, msg: steps.append((pct, msg)))
    assert summary["count"] == 2 and summary["by_book"] == {"Bukhari": 2} and download.calls == 1
    assert steps[0][0] == 50 and steps[-1][0] == 100
    [builtin, ohd] = store.describe()
    assert builtin["status"] == "ready" and builtin["builtin"]
    assert (ohd["status"], ohd["count"], ohd["zip_cached"]) == ("ready", 2, True)
    # the file is {"summary": ..., "hadiths": [...]} and the summary is readable without parsing the hadiths
    data = json.loads(store.output_path("open_hadith_data").read_text(encoding="utf-8"))
    assert data["summary"]["count"] == 2 and len(data["hadiths"]) == 2
    # preparing again reuses the cached zip
    store.prepare("open_hadith_data", "job2", lambda *_: None)
    assert download.calls == 1


def test_an_uploaded_zip_replaces_the_download_and_a_wrong_file_is_refused(store, download):
    with pytest.raises(SourceError, match="not a valid zip"):
        store.save_upload("open_hadith_data", b"this is not a zip")
    store.save_upload("open_hadith_data", make_zip())
    store.prepare("open_hadith_data", "job", lambda *_: None)
    assert download.calls == 0                                            # the upload was used
    with pytest.raises(UnknownSource):
        store.save_upload("wahy_default", make_zip())                      # the built-in source has no zip


def test_an_empty_or_broken_zip_fails_clearly_and_a_cancelled_download_leaves_nothing(store):
    store._download = lambda url, dest, progress, check: (dest.parent.mkdir(parents=True, exist_ok=True),
                                                          dest.write_bytes(b"PK broken"))
    with pytest.raises(SourceError, match="not a valid zip"):
        store.prepare("open_hadith_data", "j", lambda *_: None)
    assert not store.zip_path("open_hadith_data").exists()                # a broken cache would fail forever
    empty = io.BytesIO()
    with zipfile.ZipFile(empty, "w") as z:
        z.writestr("x.json", "{}")
    store.save_upload("open_hadith_data", empty.getvalue())
    with pytest.raises(SourceError, match="no hadiths"):
        store.prepare("open_hadith_data", "j", lambda *_: None)
    assert not store.output_path("open_hadith_data").exists()


def test_two_prepares_of_one_source_are_refused(store):
    def slow(url, dest, progress, check):
        with pytest.raises(AlreadyPreparing):
            store.prepare("open_hadith_data", "second", lambda *_: None)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(make_zip())
    store._download = slow
    store.prepare("open_hadith_data", "first", lambda *_: None)
    assert store.describe()[1]["preparing_job"] is None                    # cleared when it ends


# ---- sources through the API -------------------------------------------------------------------------------------

@pytest.fixture
def api(client, download):
    """The app with a fake download and a fake engine worker."""
    corpora: CorporaService = client.app.state.corpora
    corpora.sources._download = download
    corpora.engine = client.app.state.detection.engine = fake = FakeEngine()
    client.fake_engine = fake
    return client


def run_job(client, started: dict) -> dict:
    return client.app.state.jobs.wait(started["job"]["id"], timeout=30).model_dump()


def test_prepare_source_as_a_job_then_choose_it_then_delete_it(api, download):
    sources = {s["id"]: s for s in api.get("/api/corpora/sources").json()}
    assert sources["wahy_default"]["active"] and sources["open_hadith_data"]["status"] == "missing"

    # choosing a source that is not prepared is refused, with the reason
    r = api.put("/api/corpora/active-hadith-source", json={"source_id": "open_hadith_data"})
    assert r.status_code == 409 and "prepare it first" in r.json()["detail"]

    r = api.post("/api/corpora/sources/open_hadith_data/prepare")
    assert r.status_code == 202
    job = run_job(api, r.json())
    assert job["status"] == "done" and job["result"]["count"] == 2
    assert job["progress"]["percent"] == 100

    r = api.put("/api/corpora/active-hadith-source", json={"source_id": "open_hadith_data"})
    assert r.status_code == 200 and r.json()["active"] and r.json()["count"] == 2
    assert api.fake_engine.hadiths and api.fake_engine.hadiths.name == "hadith_open_hadith_data.json"

    # it is remembered: a service built later (a restart) picks the same source
    again = CorporaService(api.app.state.db, api.app.state.settings, api.app.state.jobs, FakeEngine())
    assert again.active_source() == "open_hadith_data" and again.engine.hadiths is not None

    # deleting the one in use puts the engine back on the built-in hadiths
    assert api.delete("/api/corpora/sources/open_hadith_data").status_code == 204
    assert api.fake_engine.hadiths is None
    assert {s["id"]: s["status"] for s in api.get("/api/corpora/sources").json()}["open_hadith_data"] == "missing"
    assert download.calls == 1


def test_redownload_fetches_the_zip_again(api, download):
    run_job(api, api.post("/api/corpora/sources/open_hadith_data/prepare").json())
    run_job(api, api.post("/api/corpora/sources/open_hadith_data/prepare", json={"redownload": True}).json())
    assert download.calls == 2


def test_upload_a_zip_by_hand_prepares_from_it(api, download):
    r = api.post("/api/corpora/sources/open_hadith_data/upload", files={"file": ("c.zip", b"nope")})
    assert r.status_code == 400
    r = api.post("/api/corpora/sources/open_hadith_data/upload", files={"file": ("c.zip", make_zip())})
    assert r.status_code == 202 and run_job(api, r.json())["status"] == "done"
    assert download.calls == 0


def test_a_failed_download_is_a_failed_job_with_the_reason(api):
    def refuse(url, dest, progress, check):
        raise SourceError("download failed (HTTP 403)")
    api.app.state.corpora.sources._download = refuse
    job = run_job(api, api.post("/api/corpora/sources/open_hadith_data/prepare").json())
    assert job["status"] == "failed" and "HTTP 403" in job["error"]


def test_unknown_and_built_in_sources_cannot_be_prepared(api):
    assert api.post("/api/corpora/sources/nope/prepare").status_code == 404
    assert api.post("/api/corpora/sources/wahy_default/prepare").status_code == 404
    assert api.put("/api/corpora/active-hadith-source", json={"source_id": "nope"}).status_code == 404


def test_info_reports_what_the_engine_loaded(api):
    info = api.get("/api/corpora/info").json()
    assert (info["quran"], info["hadiths"], info["adhkar"], info["hadith_source"]) == (6236, 39737, 18, "wahy_default")


# ---- adhkar ------------------------------------------------------------------------------------------------------

def test_the_initial_seed_equals_the_engines_list():
    """The seed file is a copy of BUILTIN_ADHKAR_DATA in engine/src/shared.js. The two only have to agree at the
    first seed: after that the table is the user's and the engine gets the rows from it on every detect call."""
    js = "import('./engine/src/shared.js').then(m => console.log(JSON.stringify(m.BUILTIN_ADHKAR_DATA)))"
    out = subprocess.run(["node", "-e", js], cwd=REPO_ROOT, capture_output=True, text=True, check=True)
    assert json.loads(out.stdout) == BUILTIN_ADHKAR


def restart(api) -> CorporaService:
    """What a server restart does to the corpora service (it seeds in its constructor)."""
    return CorporaService(api.app.state.db, api.app.state.settings, api.app.state.jobs, FakeEngine())


def test_a_new_database_has_the_initial_adhkar_and_additions_survive_a_restart(api):
    adhkar = api.get("/api/corpora/adhkar").json()
    assert len(adhkar) == 18 and not any(d["is_custom"] for d in adhkar)
    assert [(d["id"], d["category"], d["ref"], d["t"]) for d in adhkar] == \
        [(i["id"], i["category"], i["ref"], i["t"]) for i in BUILTIN_ADHKAR]

    r = api.post("/api/corpora/adhkar", json={"ref": "دعاء", "t": "اللهم اغفر لي"})
    assert r.status_code == 201 and r.json()["is_custom"] and r.json()["category"] == "أذكار متفرقة"
    mine = r.json()

    corpora = restart(api)
    after = api.get("/api/corpora/adhkar").json()
    assert len(after) == 19 and after[0]["id"] == mine["id"]                # the user's own come first

    engine_list = corpora.engine_adhkar()
    assert engine_list[0] == {"id": mine["id"], "category": "أذكار متفرقة", "ref": "دعاء", "t": "اللهم اغفر لي",
                              "isCustom": True}
    assert engine_list[1:] == BUILTIN_ADHKAR                               # the initial rows, as the engine knows them


def test_any_dhikr_can_be_edited_or_deleted(api):
    body = {"category": "التهليل", "ref": "مختصر", "t": "لا إله إلا الله وحده"}
    r = api.put("/api/corpora/adhkar/Adhkar:tahlil", json=body)           # an initial row
    assert r.status_code == 200 and (r.json()["ref"], r.json()["t"]) == ("مختصر", "لا إله إلا الله وحده")
    assert api.delete("/api/corpora/adhkar/Adhkar:tahlil_full").status_code == 204
    assert api.delete("/api/corpora/adhkar/Adhkar:tahlil_full").status_code == 404
    assert api.put("/api/corpora/adhkar/Adhkar:tahlil_full", json=body).status_code == 404
    ids = [d["id"] for d in api.get("/api/corpora/adhkar").json()]
    assert len(ids) == 17 and "Adhkar:tahlil_full" not in ids

    mine = api.post("/api/corpora/adhkar", json={"ref": "دعاء", "t": "اللهم اغفر لي"}).json()
    r = api.put(f"/api/corpora/adhkar/{mine['id']}", json={"category": "أدعية", "ref": "دعاء 2", "t": "اللهم ارحمني"})
    assert r.status_code == 200 and (r.json()["category"], r.json()["t"]) == ("أدعية", "اللهم ارحمني")
    assert api.delete(f"/api/corpora/adhkar/{mine['id']}").status_code == 204
    assert api.post("/api/corpora/adhkar", json={"ref": " ", "t": "x"}).status_code == 422


def test_an_edited_or_deleted_dhikr_is_never_restored_at_start_up(api):
    api.put("/api/corpora/adhkar/Adhkar:tahlil", json={"category": "c", "ref": "r", "t": "نص معدل"})
    api.delete("/api/corpora/adhkar/Adhkar:tasbih_hamd")
    corpora = restart(api)
    after = {d["id"]: d for d in api.get("/api/corpora/adhkar").json()}
    assert len(after) == 17 and "Adhkar:tasbih_hamd" not in after
    assert after["Adhkar:tahlil"]["t"] == "نص معدل"

    for d in list(after):                                                  # delete everything...
        assert api.delete(f"/api/corpora/adhkar/{d}").status_code == 204
    restart(api)                                                           # ...and a restart does not bring them back
    assert api.get("/api/corpora/adhkar").json() == []
    assert corpora.engine_adhkar() == []


def test_a_database_made_before_the_seed_flag_is_not_seeded_again(api):
    """Rows exist but the flag is missing (an older database): only the flag is set, nothing is added back."""
    api.delete("/api/corpora/adhkar/Adhkar:tahlil")
    SettingsStore(api.app.state.db).set(SEEDED_KEY, False)
    restart(api)
    ids = [d["id"] for d in api.get("/api/corpora/adhkar").json()]
    assert len(ids) == 17 and "Adhkar:tahlil" not in ids


# ---- custom quotes -----------------------------------------------------------------------------------------------

def test_custom_quotes_are_added_deduplicated_and_given_to_the_engine_newest_first(api):
    a = api.post("/api/corpora/custom-quotes", json={"t": NIYYAT, "ref": "حديث النية"})
    assert a.status_code == 201 and a.json()["id"].startswith("Outside:")
    # the same words with other marks and alef forms: not a second quote, only the label is updated
    again = api.post("/api/corpora/custom-quotes", json={"t": "إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ وإنما لكل امرئ ما نوى", "ref": "الأربعون"})
    assert again.json()["id"] == a.json()["id"] and again.json()["ref"] == "الأربعون"
    b = api.post("/api/corpora/custom-quotes", json={"t": "الدين النصيحة"}).json()
    assert b["ref"] == "حديث خارج القاعدة"
    assert [q["id"] for q in api.get("/api/corpora/custom-quotes").json()] == [b["id"], a.json()["id"]]
    engine_list = api.app.state.corpora.engine_custom_quotes()
    assert engine_list[0] == {"id": b["id"], "book": "OutsideCorpus", "ref": "حديث خارج القاعدة", "t": "الدين النصيحة"}

    assert api.post("/api/corpora/custom-quotes", json={"t": "اب"}).status_code == 422       # too short
    assert api.put(f"/api/corpora/custom-quotes/{b['id']}", json={"t": "الدين النصيحة لله", "ref": "r"}).json()["t"] \
        == "الدين النصيحة لله"
    assert api.delete(f"/api/corpora/custom-quotes/{b['id']}").status_code == 204
    assert api.delete(f"/api/corpora/custom-quotes/{b['id']}").status_code == 404


def test_normalise_ignores_marks_and_letter_forms():
    assert normalise("أَعُوذُ بِاللَّهِ") == normalise("اعوذ بالله")
    assert normalise("رَحْمَةٌ  مُهْدَاةٌ") == "رحمه مهداه"


# ---- the real engine worker reads another hadith file ------------------------------------------------------------

def test_the_real_worker_switches_to_a_prepared_hadith_source(tmp_path):
    """Activating a source restarts the worker on `--hadiths <file>`; a search then finds that file's hadith."""
    data = tmp_path / "data"
    engine = EngineClient(SMALL_CORPUS, max_heap_mb=1024, timeout_s=60)
    try:
        engine.use_hadiths(None)
        assert not any(h["unitId"] == "OHD:Bukhari:1" for h in engine.search("حدثنا فلان", {"engine": "v3"}))
        first_pid = engine.status().pid

        store = SourceStore(data, download=FakeDownload())
        store.prepare("open_hadith_data", "j", lambda *_: None)
        assert engine.use_hadiths(store.hadiths_path("open_hadith_data")) is True
        assert engine.use_hadiths(store.hadiths_path("open_hadith_data")) is False         # no change, no restart
        hits = engine.search("حدثنا فلان", {"engine": "v3"})
        assert [h["unitId"] for h in hits] == ["OHD:Bukhari:1"]
        assert engine.status().pid != first_pid

        assert engine.use_hadiths(None) is True                                            # back to the corpus's own
        assert engine.info()["hadiths"] == 2
    finally:
        engine.close()


# ---- adhkar import, export, reset and browsing ------------------------------------------------------------------

def test_a_dhikr_needs_two_words(api):
    assert api.post("/api/corpora/adhkar", json={"ref": "دعاء", "t": "اللهم"}).status_code == 422
    assert api.post("/api/corpora/adhkar", json={"ref": "دعاء", "t": "اللهم اغفر"}).status_code == 201


def test_export_reset_import_brings_the_list_back(api):
    mine = api.post("/api/corpora/adhkar", json={"ref": "دعاء", "t": "اللهم اغفر لي"}).json()
    api.put("/api/corpora/adhkar/Adhkar:tahlil", json={"category": "التهليل", "ref": "مختصر", "t": "لا إله إلا الله وحده"})
    api.delete("/api/corpora/adhkar/Adhkar:tahlil_full")
    exported = api.get("/api/corpora/adhkar").json()
    assert len(exported) == 18

    reset = api.post("/api/corpora/adhkar/reset").json()
    assert [d["id"] for d in reset] == [i["id"] for i in BUILTIN_ADHKAR]          # exactly the 18 initial rows
    assert reset[0]["t"] == BUILTIN_ADHKAR[0]["t"] and not any(d["is_custom"] for d in reset)

    # importing the export: the user's own row comes back, the edited text is added (the original is "known")
    r = api.post("/api/corpora/adhkar/import", json={"items": exported + [{"t": "كلمة"}, {"t": "  "}, {}]}).json()
    assert r["added"] == 2 and r["skipped"] == 16 + 3                 # 16 initial rows already there, 3 unusable items
    texts = [d["t"] for d in r["adhkar"]]
    assert "اللهم اغفر لي" in texts and "لا إله إلا الله وحده" in texts
    assert api.post("/api/corpora/adhkar/import", json={"items": exported}).json()["added"] == 0   # twice adds nothing
    assert mine["id"] not in [d["id"] for d in r["adhkar"]]                       # imported rows get fresh ids


def test_browse_reads_the_corpus_without_a_matcher(api):
    page = api.get("/api/corpora/browse", params={"kind": "QURAN", "surah": 18, "offset": 25, "limit": 25}).json()
    assert page["total"] == 1 and page["items"][0]["ref"] == "الكهف: 26" and page["groups"]["18"] == ["الكهف", 110]
    assert api.app.state.corpora.engine.browse_calls[-1] == {"kind": "QURAN", "q": "", "offset": 25, "limit": 25, "surah": 18}
    assert api.get("/api/corpora/browse", params={"kind": "ADHKAR"}).status_code == 422
    assert api.get("/api/corpora/browse", params={"kind": "QURAN", "limit": 500}).status_code == 422


def test_the_real_worker_browses_the_small_corpus(tmp_path):
    engine = EngineClient(SMALL_CORPUS, max_heap_mb=1024, timeout_s=60)
    try:
        page = engine.browse({"kind": "QURAN", "surah": 112, "limit": 2})
        assert page["total"] == 4 and [i["id"] for i in page["items"]] == ["112:1", "112:2"]
        assert engine.browse({"kind": "HADITH", "q": "بالنيات"})["total"] == 1
    finally:
        engine.close()
