"""Lectures through the API: create from text, subtitles and the sample; list, rename, delete; media; versions."""

from __future__ import annotations

import io
import json
from pathlib import Path

from fakes import make_audio

SRT = """1
00:00:01,000 --> 00:00:03,000
بسم الله الرحمن الرحيم

2
00:00:04,000 --> 00:00:06,000
الحمد لله رب العالمين
"""
VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nإن الحمد لله\n"
REPO = Path(__file__).resolve().parents[2]


def words_of(lecture: dict) -> list[tuple]:
    return [(w["text"], w["start"], w["end"]) for w in lecture["words"]]


# ---- creating ----------------------------------------------------------------------------------------------

def test_pasted_srt_becomes_a_lecture_with_timed_words(client):
    r = client.post("/api/lectures", json={"text": SRT, "title": "خطبة"})
    assert r.status_code == 201
    lecture = r.json()
    assert (lecture["title"], lecture["source_kind"], lecture["word_count"]) == ("خطبة", "srt", 8)
    assert words_of(lecture)[0] == ("بسم", 1.0, 1.5)             # 4 words share the cue's 2 seconds
    assert lecture["duration_s"] == lecture["words"][-1]["end"]


def test_plain_text_gets_estimated_times_and_a_title_from_its_first_words(client):
    lecture = client.post("/api/lectures", json={"text": "الحمد لله رب العالمين، الرحمن الرحيم مالك"}).json()
    assert lecture["source_kind"] == "text"
    assert lecture["title"] == "الحمد لله رب العالمين، الرحمن الرحيم"
    assert lecture["words"][0]["idx"] == 0 and lecture["words"][1]["start"] > lecture["words"][0]["end"]


def test_empty_text_is_refused(client):
    assert client.post("/api/lectures", json={"text": "  \n "}).status_code == 422
    assert client.post("/api/lectures", json={"text": ""}).status_code == 422


def test_uploaded_vtt_file_keeps_its_timings_and_names_the_lecture_after_the_file(client):
    files = {"file": ("درس-الفجر.vtt", VTT.encode("utf-8"), "text/vtt")}
    lecture = client.post("/api/lectures/import", files=files).json()
    assert (lecture["title"], lecture["source_kind"]) == ("درس-الفجر", "vtt")
    assert words_of(lecture) == [("إن", 1.0, 1.33), ("الحمد", 1.33, 1.67), ("لله", 1.67, 2.0)]


def test_import_refuses_other_file_types_and_non_utf8(client):
    assert client.post("/api/lectures/import", files={"file": ("a.pdf", b"x")}).status_code == 400
    bad = {"file": ("a.txt", "نص".encode("windows-1256"))}
    assert client.post("/api/lectures/import", files=bad).status_code == 400


def test_the_sample_is_the_golden_input_every_time(client):
    golden = json.loads((REPO / "engine/golden/inputs/sample.json").read_text("utf-8"))
    a = client.post("/api/lectures/sample").json()
    b = client.post("/api/lectures/sample").json()
    assert a["title"] == golden["title"] and a["source_kind"] == "sample"
    assert words_of(a) == words_of(b)
    assert " ".join(w["text"] for w in a["words"]) == " ".join(golden["text"].split())


# ---- the saved lectures list ---------------------------------------------------------------------------------

def test_list_rename_and_delete(client):
    first = client.post("/api/lectures", json={"text": "واحد اثنان", "title": "أول"}).json()
    second = client.post("/api/lectures", json={"text": "ثلاثة", "title": "ثان"}).json()
    listing = client.get("/api/lectures").json()
    assert [row["id"] for row in listing] == [second["id"], first["id"]]          # newest first
    assert listing[1]["word_count"] == 2 and "words" not in listing[1]

    assert client.patch(f"/api/lectures/{first['id']}", json={"title": "جديد"}).json()["title"] == "جديد"
    assert client.delete(f"/api/lectures/{second['id']}").status_code == 204
    assert [(row["id"], row["title"]) for row in client.get("/api/lectures").json()] == [(first["id"], "جديد")]
    assert client.get(f"/api/lectures/{second['id']}").status_code == 404
    assert client.delete(f"/api/lectures/{second['id']}").status_code == 404


def test_delete_all_needs_confirmation(client):
    for i in range(3):
        client.post("/api/lectures", json={"text": f"كلمة {i}"})
    assert client.delete("/api/lectures").status_code == 400
    assert client.get("/api/lectures").json() != []
    assert client.delete("/api/lectures?confirm=true").json() == {"deleted": 3}
    assert client.get("/api/lectures").json() == []


def test_deleting_a_lecture_deletes_its_words(client):
    lecture = client.post("/api/lectures", json={"text": "كلمة أخرى"}).json()
    client.delete(f"/api/lectures/{lecture['id']}")
    db = client.app.state.db
    from sqlalchemy import func, select

    from wahy.features.lectures.models import Word
    with db.session() as s:
        assert s.scalar(select(func.count(Word.id))) == 0


# ---- media -----------------------------------------------------------------------------------------------------

def test_attach_media_then_serve_it_with_range_support(client, tmp_path):
    lecture = client.post("/api/lectures", json={"text": "نص بلا صوت"}).json()
    assert not lecture["has_media"]
    assert client.get(f"/api/lectures/{lecture['id']}/media").status_code == 404

    audio = make_audio(tmp_path / "a.mp3", seconds=1)
    r = client.put(f"/api/lectures/{lecture['id']}/media", files={"file": ("a.mp3", audio.read_bytes())})
    assert r.status_code == 200 and r.json()["has_media"]

    full = client.get(f"/api/lectures/{lecture['id']}/media")
    assert full.status_code == 200 and full.content == audio.read_bytes()
    part = client.get(f"/api/lectures/{lecture['id']}/media", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and part.content == audio.read_bytes()[:100]      # the player can seek


def test_attach_refuses_a_non_media_file(client):
    lecture = client.post("/api/lectures", json={"text": "نص"}).json()
    r = client.put(f"/api/lectures/{lecture['id']}/media", files={"file": ("virus.exe", b"MZ")})
    assert r.status_code == 400


def test_deleting_a_lecture_removes_its_uploaded_media_but_not_a_shared_one(client, tmp_path):
    media_dir = client.app.state.settings.media_dir
    audio = make_audio(tmp_path / "a.mp3", seconds=1).read_bytes()
    a = client.post("/api/lectures", json={"text": "أ"}).json()
    client.put(f"/api/lectures/{a['id']}/media", files={"file": ("a.mp3", audio)})
    stored = [p.name for p in media_dir.glob("upload_*")]
    assert len(stored) == 1

    # a second lecture pointing at the same file (what two lectures from one link look like)
    b = client.post("/api/lectures", json={"text": "ب"}).json()
    client.app.state.lectures.set_media(b["id"], stored[0])
    client.delete(f"/api/lectures/{a['id']}")
    assert (media_dir / stored[0]).exists()            # b still uses it
    client.delete(f"/api/lectures/{b['id']}")
    assert not (media_dir / stored[0]).exists()


def test_media_paths_cannot_leave_the_media_folder(client):
    from wahy.features.lectures.media import MediaError
    store = client.app.state.lectures.media
    for evil in ("../wahy.db", "/etc/passwd", "a/../../x"):
        try:
            store.path(evil)
        except MediaError:
            continue
        raise AssertionError(f"{evil} was allowed")


# ---- versions --------------------------------------------------------------------------------------------------

def test_versions_save_rename_open_and_delete_but_never_the_last(client):
    lecture = client.post("/api/lectures", json={"text": "نص"}).json()
    base = f"/api/lectures/{lecture['id']}/versions"
    v1 = client.post(base, json={"name": "المحرك v3", "snapshot": {"findings": [1, 2]}}).json()
    v2 = client.post(base, json={"name": "المحرك v4", "snapshot": {"findings": [1]}}).json()
    assert [v["name"] for v in client.get(base).json()] == ["المحرك v3", "المحرك v4"]
    assert client.get("/api/lectures").json()[0]["version_count"] == 2

    assert client.get(f"{base}/{v1['id']}").json()["snapshot"] == {"findings": [1, 2]}
    assert client.patch(f"{base}/{v2['id']}", json={"name": "بعد التدقيق"}).json()["name"] == "بعد التدقيق"
    assert client.delete(f"{base}/{v1['id']}").status_code == 204
    assert client.delete(f"{base}/{v2['id']}").status_code == 409          # the last one stays
    assert client.get(f"{base}/{v1['id']}").status_code == 404


def test_a_version_of_another_lecture_is_not_found(client):
    a = client.post("/api/lectures", json={"text": "أ"}).json()
    b = client.post("/api/lectures", json={"text": "ب"}).json()
    v = client.post(f"/api/lectures/{a['id']}/versions", json={"name": "x"}).json()
    assert client.get(f"/api/lectures/{b['id']}/versions/{v['id']}").status_code == 404


def test_io_bytes_upload_roundtrip_of_a_text_file(client):
    r = client.post("/api/lectures/import", files={"file": ("n.txt", io.BytesIO("سلام عليكم".encode()))})
    assert r.status_code == 201 and r.json()["title"] == "n"


# ---- editing one word (F-041) --------------------------------------------------------------------------------

def test_editing_a_word_changes_its_text_and_keeps_its_timing(client):
    lecture = client.post("/api/lectures", json={"text": SRT}).json()
    before = lecture["words"][1]
    r = client.patch(f"/api/lectures/{lecture['id']}/words/1", json={"text": " اللّه "})
    assert r.status_code == 200
    assert r.json() == {**before, "text": "اللّه"}
    after = client.get(f"/api/lectures/{lecture['id']}").json()["words"]
    assert after[1] == {**before, "text": "اللّه"}
    assert [w for i, w in enumerate(after) if i != 1] == [w for i, w in enumerate(lecture["words"]) if i != 1]


def test_editing_a_word_refuses_two_words_and_unknown_places(client):
    lecture = client.post("/api/lectures", json={"text": SRT}).json()
    assert client.patch(f"/api/lectures/{lecture['id']}/words/0", json={"text": "بسم الله"}).status_code == 422
    assert client.patch(f"/api/lectures/{lecture['id']}/words/0", json={"text": "  "}).status_code == 422
    assert client.patch(f"/api/lectures/{lecture['id']}/words/99", json={"text": "x"}).status_code == 404
    assert client.patch("/api/lectures/999/words/0", json={"text": "x"}).status_code == 404
