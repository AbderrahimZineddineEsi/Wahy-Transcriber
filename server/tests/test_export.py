"""Exports through the API (ROADMAP phase 16; F-069 to F-071). Fast tests use the real worker and the small corpus;
the golden test detects golden inputs with the full corpus and requires the old app's caption and text files,
exactly (skipped without data/corpus.json)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from wahy.core.settings import REPO_ROOT, Settings
from wahy.features.lectures.parsing import TimedWord
from wahy.main import create_app

SMALL_CORPUS = REPO_ROOT / "engine" / "src" / "fixtures" / "small-corpus.json"
FULL_CORPUS = REPO_ROOT / "data" / "corpus.json"
GOLDEN = REPO_ROOT / "engine" / "golden"
TEXT = "قال الله تعالى قل هو الله أحد الله الصمد ثم قال النبي صلى الله عليه وسلم إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"
FILES = {"srt": "wahy-captions.srt", "vtt": "wahy-captions.vtt", "ass": "wahy-captions.ass", "md": "wahy-lecture.md",
         "txt": "wahy-lecture.txt"}


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("export") / "data", corpus_path=SMALL_CORPUS,
                        engine_max_heap_mb=1024, engine_timeout_s=120, _env_file=None)
    with TestClient(create_app(settings)) as c:
        c.patch("/api/detection/settings", json={"engine": "v3"})
        lectures = c.app.state.lectures
        c.lecture_id = lectures.create_empty(title="درس", source_kind="text")
        lectures.replace_words(c.lecture_id, [TimedWord(w, i * 0.5, i * 0.5 + 0.4) for i, w in enumerate(TEXT.split())])
        job = c.post(f"/api/lectures/{c.lecture_id}/detect").json()["job"]
        assert c.app.state.jobs.wait(job["id"], timeout=60).status == "done"
        yield c


def get(app, fmt: str, **params) -> str:
    r = app.get(f"/api/lectures/{app.lecture_id}/export/{fmt}", params=params)
    assert r.status_code == 200, r.text
    return r.text


def test_every_format_downloads_with_its_name(app):
    names = {"srt": "wahy-captions.srt", "vtt": "wahy-captions.vtt", "ass": "wahy-captions.ass",
             "md": "wahy-lecture.md", "txt": "wahy-lecture.txt", "json": "wahy-lecture-data.json",
             "html": "wahy-lecture-formatted.html"}
    for fmt, name in names.items():
        r = app.get(f"/api/lectures/{app.lecture_id}/export/{fmt}")
        assert r.status_code == 200
        assert r.headers["content-disposition"] == f'attachment; filename="{name}"'
        assert "charset=utf-8" in r.headers["content-type"]
    assert get(app, "md").startswith("# درس\n\n")
    assert get(app, "txt").startswith("قال الله تعالى ﴿قل هو الله أحد﴾")
    assert "Title: درس" in get(app, "ass")
    data = json.loads(get(app, "json"))
    assert data["title"] == "درس" and len(data["words"]) == len(TEXT.split()) and len(data["findings"]) == 3
    assert app.get(f"/api/lectures/{app.lecture_id}/export/pdf").status_code == 422
    assert app.get("/api/lectures/99999/export/srt").status_code == 404


def test_the_style_is_saved_and_reaches_the_exports(app):
    assert app.get("/api/export/style").json()["quranBracketOpen"] == "﴿"
    r = app.patch("/api/export/style", json={"quranBracketOpen": "«", "quranBracketClose": "»"})
    assert r.json()["quranBracketOpen"] == "«" and r.json()["hadithBracketOpen"] == "«"
    assert app.get("/api/export/style").json()["quranBracketClose"] == "»"          # saved
    assert "«قل هو الله أحد»" in get(app, "srt")
    assert "«قل هو الله أحد»" in get(app, "txt")
    app.patch("/api/export/style", json={"quranBracketOpen": "﴿", "quranBracketClose": "﴾"})


def test_the_verdict_filter_hides_quotes_but_keeps_their_words(app):
    hadith = next(f for f in app.get(f"/api/lectures/{app.lecture_id}/findings").json()["findings"]
                  if f["source_type"] == "HADITH")
    app.put(f"/api/findings/{hadith['id']}/verdict", json={"verdict": "FALSE"})
    shown = get(app, "txt", show=["CORRECT", "NOT_SURE", "NONE"])
    assert "«" not in shown and "إنما الأعمال بالنيات" in shown                  # "ordinary speech" hidden
    assert "«إنما الأعمال" in get(app, "txt")                                       # no filter: all shown
    caps = app.get(f"/api/lectures/{app.lecture_id}/captions", params={"show": ["CORRECT", "NONE"]}).json()
    assert all(c["type"] != "hadith" for c in caps)
    assert " ".join(c["text"] for c in caps).split() == TEXT.split()
    only_quran = get(app, "txt", kind="quran")
    assert "﴿" in only_quran and "«" not in only_quran


def test_standard_script_shows_the_source_text(app):
    assert "قُلْ" in get(app, "srt", script="standard")
    assert "قُلْ" not in get(app, "srt")


def test_the_commentary_split_can_be_turned_off(app):
    app.patch("/api/export/style", json={"splitCommentary": False})
    assert app.get("/api/export/style").json()["splitCommentary"] is False
    app.patch("/api/export/style", json={"splitCommentary": True})


# ---- golden: the old app's files, through the API -----------------------------------------------------------------

manifest = json.loads((GOLDEN / "expected" / "manifest.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def golden(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("golden-export") / "data", corpus_path=FULL_CORPUS,
                        engine_max_heap_mb=3584, engine_timeout_s=900, _env_file=None)
    with TestClient(create_app(settings)) as c:
        yield c


def golden_lecture(client, name: str) -> int:
    source = json.loads((GOLDEN / "inputs" / f"{name}.json").read_text(encoding="utf-8"))
    if "text" in source:
        lecture_id = client.post("/api/lectures", json={"text": source["text"].strip(), "title": source["title"]}).json()["id"]
    else:
        lectures = client.app.state.lectures
        lecture_id = lectures.create_empty(title=source["title"], source_kind="text")
        lectures.replace_words(lecture_id, [TimedWord(w["word"], w["start"], w["end"]) for w in source["words"]])
    job = client.post(f"/api/lectures/{lecture_id}/detect", json={"engine": "v5"}).json()["job"]
    assert client.app.state.jobs.wait(job["id"], timeout=900).status == "done"
    return lecture_id


@pytest.mark.skipif(not FULL_CORPUS.exists(), reason="data/corpus.json is missing (./run.sh downloads it)")
@pytest.mark.parametrize("name", ["sample", "yt_iG2F8nymm1A"])
def test_golden_exports_through_the_api(golden, name):
    """The sample lecture has no commentary gaps: its exports equal the old app's with the default style. The
    other lecture has findings with gaps: with the split turned off, its exports equal the old app's too."""
    lecture_id = golden_lecture(golden, name)
    golden.patch("/api/export/style", json={"splitCommentary": name == "sample"})
    for style in ("default", "alt-style"):
        if style == "alt-style":
            golden.patch("/api/export/style", json=manifest["alt_style"])
        sub = "" if style == "default" else "alt-style/"
        for fmt, file in FILES.items():
            got = golden.get(f"/api/lectures/{lecture_id}/export/{fmt}").text
            assert got == (GOLDEN / "expected" / name / "v5" / f"{sub}{file}").read_text(encoding="utf-8"), \
                f"{name} {sub}{file} differs"
    golden.patch("/api/export/style", json={
        "quranBracketOpen": "﴿", "quranBracketClose": "﴾", "hadithBracketOpen": "«", "hadithBracketClose": "»",
        "adhkarBracketOpen": "〖", "adhkarBracketClose": "〗", "showQuranSource": True, "showHadithSource": True,
        "showAdhkarTag": True, "groupContiguousAyat": True, "splitCommentary": True})
