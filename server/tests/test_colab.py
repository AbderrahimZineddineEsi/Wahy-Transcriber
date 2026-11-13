"""The Colab runner (F-130), everything that can be checked without a Colab GPU: the notebook's cells, the Drive
copy, the backup zip, the web-build cache and the corpus download with its sha256 check."""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from wahy.core.settings import REPO_ROOT

SCRIPTS = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
import colab_support as cs  # noqa: E402
import make_colab_notebook as gen  # noqa: E402

NOTEBOOK = REPO_ROOT / gen.NOTEBOOK


# ---- the notebook ---------------------------------------------------------------------------------------------

def cells(kind: str = "code") -> list[str]:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    return ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == kind]


def test_the_committed_notebook_is_what_the_generator_writes():
    expected = json.dumps(gen.notebook, indent=2, ensure_ascii=False) + "\n"
    assert NOTEBOOK.read_text(encoding="utf-8") == expected, "run: python scripts/make_colab_notebook.py"


def test_every_code_cell_parses_and_uses_no_notebook_magics():
    code_cells = cells()
    assert len(code_cells) == 3                                   # one Run-all flow: options, install, run
    for src in code_cells:
        ast.parse(src)
        assert not re.search(r"^\s*[!%]", src, re.M), "plain Python only, so the cells can be tested"


def test_no_secret_is_in_the_notebook():
    text = NOTEBOOK.read_text(encoding="utf-8")
    patterns = [r"hf_[A-Za-z0-9]{20,}", r"gsk_[A-Za-z0-9]{20,}", r"AIza[0-9A-Za-z_-]{30,}", r"sk-or-[A-Za-z0-9-]{20,}",
                r"gh[pousr]_[A-Za-z0-9]{30,}", r"github_pat_[A-Za-z0-9_]{30,}", r"sk-ant-[A-Za-z0-9-]{20,}",
                r"Bearer\s+[A-Za-z0-9._-]{20,}"]
    for pattern in patterns:
        assert not re.search(pattern, text), pattern
    nb = json.loads(text)
    for c in nb["cells"]:
        assert not c.get("outputs"), "outputs (links, tokens) must not be committed"
        assert c.get("execution_count") is None


def test_the_notebook_keeps_the_promises_it_makes():
    options, install, run = cells()
    assert re.search(r"^USE_GOOGLE_DRIVE = True\b", options, re.M)         # Drive ON is the default
    assert "restore_from_drive" in options and "mount" in options
    assert "Google Drive is OFF" in options and "LOST" in options           # said plainly
    assert "/content/tadqeeq-backup.zip" in options and "ZipBackupper" in run  # the backup for the no-Drive case
    assert "WAHY_ACCESS_TOKEN=TOKEN" in run and "access_url" in run         # the access guard is switched on
    assert "local-asr laya" in run and "/api/settings/laya/load" in run     # local Whisper and Laya
    assert "fetch_corpus.sh" in install and "snapshot_download" in install
    assert gen.SPECIALIZED_WHISPER in install and gen.LAYA in install
    assert gen.REPO in options                                              # the public repo is cloned, no login
    intro = cells("markdown")[0]
    assert "random access token" in intro and "lost when the session ends" in intro and "Tadqeeq" in intro
    assert "colab.research.google.com/github/" + gen.REPO in intro


def test_the_readme_has_the_open_in_colab_badge():
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert f"colab.research.google.com/github/{gen.REPO}/blob/{gen.BRANCH}/{gen.NOTEBOOK}" in readme


# ---- the access link and the log ------------------------------------------------------------------------------

def test_tokens_are_random_and_the_link_carries_one():
    a, b = cs.new_token(), cs.new_token()
    assert a != b and len(a) >= 30
    assert cs.access_url("https://x.trycloudflare.com/", "a b") == "https://x.trycloudflare.com/?token=a%20b"


def test_redact_hides_the_token_in_server_logs():
    token = cs.new_token()
    line = f'INFO: 127.0.0.1 - "GET /?token={token} HTTP/1.1" 303'
    assert token not in cs.redact(line, token) and "GET /?token=*** HTTP" in cs.redact(line, token)
    assert cs.redact("nothing here", "") == "nothing here"


# ---- where on Drive -------------------------------------------------------------------------------------------

def test_drive_folder_is_inside_my_drive(tmp_path):
    (tmp_path / "MyDrive").mkdir()
    assert cs.drive_dir_for(tmp_path, "Tadqeeq") == tmp_path / "MyDrive" / "Tadqeeq"
    assert (tmp_path / "MyDrive" / "Tadqeeq").is_dir()
    assert cs.drive_dir_for(tmp_path, "/Work/Wahy/") == tmp_path / "MyDrive" / "Work" / "Wahy"
    for bad in ["", "   ", "..", "../x", "a/../../x", "/", "~/x", "."]:
        with pytest.raises(ValueError):
            cs.drive_dir_for(tmp_path, bad)


def test_drive_not_mounted_is_an_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        cs.drive_dir_for(tmp_path, "Tadqeeq")


def test_the_old_wahy_studio_folder_moves_to_the_new_name_with_its_lectures(tmp_path):
    old = tmp_path / "MyDrive" / "Wahy-Studio" / "data"
    old.mkdir(parents=True)
    (old / "wahy.db").write_bytes(b"lectures")
    new = cs.drive_dir_for(tmp_path, "Tadqeeq", legacy=("Wahy-Studio",))
    assert (new / "data" / "wahy.db").read_bytes() == b"lectures" and not (tmp_path / "MyDrive" / "Wahy-Studio").exists()
    # once the new folder exists, an old one is left alone
    (tmp_path / "MyDrive" / "Wahy-Studio").mkdir()
    assert cs.drive_dir_for(tmp_path, "Tadqeeq", legacy=("Wahy-Studio",)) == new
    assert (tmp_path / "MyDrive" / "Wahy-Studio").is_dir()


# ---- Drive <-> the VM -----------------------------------------------------------------------------------------

def make_repo(root: Path) -> Path:
    """A fake clone with a live WAL database, media, a saved run, the corpus and a keys file."""
    data = root / "data"
    (data / "media").mkdir(parents=True)
    (data / "tafrigh_runs" / "r1").mkdir(parents=True)
    (data / "media" / "lecture1.mp3").write_bytes(b"audio-bytes" * 100)
    (data / "tafrigh_runs" / "r1" / "run.json").write_text('{"ok": true}')
    (data / "corpus.json").write_text("x" * 5000)               # must never be copied
    (data / "media" / "half.mp4.part").write_bytes(b"cut")      # a download in progress: skipped
    (root / ".env").write_text("GROQ_API_KEY=fake-test-value\n")
    con = sqlite3.connect(data / "wahy.db")
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE lecture (id INTEGER PRIMARY KEY, title TEXT)")
    con.execute("INSERT INTO lecture (title) VALUES ('Lecture one')")
    con.commit()
    return con and root                  # the connection stays open on purpose: the app is "running"


def titles(db: Path) -> list[str]:
    con = sqlite3.connect(db)
    try:
        return [r[0] for r in con.execute("SELECT title FROM lecture ORDER BY id")]
    finally:
        con.close()


def test_sync_then_restore_brings_a_whole_session_back(tmp_path):
    session1, drive, session2 = tmp_path / "s1", tmp_path / "drive", tmp_path / "s2"
    make_repo(session1)
    result = cs.sync_to_drive(session1, drive)
    assert result.db and not result.errors and result.files >= 3
    assert titles(drive / "data" / "wahy.db") == ["Lecture one"]       # a consistent copy of the live database
    assert (drive / "data" / "media" / "lecture1.mp3").exists()
    assert (drive / ".env").read_text() == "GROQ_API_KEY=fake-test-value\n"
    assert not (drive / "data" / "corpus.json").exists()               # downloaded again, not stored
    assert not list(drive.rglob("*.part")) and not list(drive.rglob("*-wal"))

    session2.mkdir()
    restored = cs.restore_from_drive(session2, drive)
    assert restored.db
    assert titles(session2 / "data" / "wahy.db") == ["Lecture one"]
    assert (session2 / "data" / "tafrigh_runs" / "r1" / "run.json").read_text() == '{"ok": true}'
    assert (session2 / ".env").read_text() == "GROQ_API_KEY=fake-test-value\n"
    assert not (session2 / "data" / "corpus.json").exists()


def test_a_second_sync_copies_only_what_changed_and_never_deletes(tmp_path):
    repo, drive = tmp_path / "repo", tmp_path / "drive"
    make_repo(repo)
    cs.sync_to_drive(repo, drive)
    again = cs.sync_to_drive(repo, drive)
    assert again.files == 0
    (repo / "data" / "media" / "lecture2.mp3").write_bytes(b"new")
    (repo / "data" / "media" / "lecture1.mp3").unlink()
    third = cs.sync_to_drive(repo, drive)
    assert third.files == 1
    assert (drive / "data" / "media" / "lecture1.mp3").exists()        # Drive keeps it: a sync never deletes


def test_restore_never_overwrites_what_the_vm_already_has(tmp_path):
    drive, repo = tmp_path / "drive", tmp_path / "repo"
    (drive / "data").mkdir(parents=True)
    (drive / "data" / "note.txt").write_text("from drive")
    (repo / "data").mkdir(parents=True)
    (repo / "data" / "note.txt").write_text("newer on the VM")
    (repo / ".env").write_text("A=1\n")
    (drive / ".env").write_text("A=2\n")
    cs.restore_from_drive(repo, drive)
    assert (repo / "data" / "note.txt").read_text() == "newer on the VM"
    assert (repo / ".env").read_text() == "A=1\n"


def test_the_background_syncer_saves_and_stops_with_a_last_sync(tmp_path):
    repo, drive = tmp_path / "repo", tmp_path / "drive"
    make_repo(repo)
    syncer = cs.DriveSyncer(repo, drive, interval_s=3600, log=lambda *_: None).start()
    (repo / "data" / "media" / "late.mp3").write_bytes(b"added just before stopping")
    final = syncer.stop()
    assert (drive / "data" / "media" / "late.mp3").exists() and final.db


# ---- the backup zip -------------------------------------------------------------------------------------------

def test_backup_zip_round_trip_without_keys_by_default(tmp_path):
    repo = tmp_path / "repo"
    make_repo(repo)
    out = cs.make_backup_zip(repo, tmp_path / "out" / "tadqeeq-backup.zip")
    names = set(zipfile.ZipFile(out).namelist())
    assert {"data/wahy.db", "data/media/lecture1.mp3", "data/tafrigh_runs/r1/run.json"} <= names
    assert ".env" not in names and "data/corpus.json" not in names     # keys stay out of a downloadable file
    assert ".env" in zipfile.ZipFile(cs.make_backup_zip(repo, tmp_path / "k.zip", include_keys=True)).namelist()

    fresh = tmp_path / "fresh"
    fresh.mkdir()
    assert cs.restore_backup_zip(out, fresh) == 3
    assert titles(fresh / "data" / "wahy.db") == ["Lecture one"]


def test_restoring_a_zip_cannot_write_outside_the_repo(tmp_path):
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("../escaped.txt", "x")
        z.writestr("data/../../escaped2.txt", "x")
        z.writestr("/abs.txt", "x")
        z.writestr("other/file.txt", "x")
        z.writestr("data/ok.txt", "fine")
    repo = tmp_path / "repo"
    repo.mkdir()
    assert cs.restore_backup_zip(evil, repo) == 1
    assert (repo / "data" / "ok.txt").read_text() == "fine"
    assert not (tmp_path / "escaped.txt").exists() and not (tmp_path / "escaped2.txt").exists()
    assert not (repo / "other").exists()


# ---- the cached web build -------------------------------------------------------------------------------------

def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=repo, check=True,
                   capture_output=True)


def test_web_build_cache_is_keyed_by_the_sources(tmp_path):
    repo, cache = tmp_path / "repo", tmp_path / "cache"
    (repo / "web" / "src").mkdir(parents=True)
    (repo / "engine" / "src").mkdir(parents=True)
    (repo / "web" / "src" / "app.tsx").write_text("v1")
    (repo / "engine" / "src" / "a.ts").write_text("e")
    (repo / "package-lock.json").write_text("{}")
    git(repo, "init", "-q")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "one")

    assert cs.restore_web_dist(repo, cache) is False                   # nothing cached yet
    dist = repo / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>v1</html>")
    (dist / "assets" / "app.js").write_text("js")
    assert cs.save_web_dist(repo, cache).name.startswith("web-dist-")

    import shutil
    shutil.rmtree(dist)
    assert cs.restore_web_dist(repo, cache) is True                    # same sources: reuse the build
    assert (dist / "index.html").read_text() == "<html>v1</html>"
    newest_source = max(p.stat().st_mtime for p in (repo / "web" / "src").rglob("*") if p.is_file())
    assert (dist / "index.html").stat().st_mtime >= newest_source      # run.sh will not think it is stale

    (repo / "web" / "src" / "app.tsx").write_text("v2")
    git(repo, "commit", "-qam", "two")
    assert cs.restore_web_dist(repo, cache) is False                   # sources changed: build again


# ---- the corpus download with its sha256 check ----------------------------------------------------------------

CORPUS_BYTES = b'{"quran": [], "note": "tiny test corpus"}\n'
CORPUS_SHA = hashlib.sha256(CORPUS_BYTES).hexdigest()


@pytest.fixture
def corpus_env(tmp_path):
    """fetch_corpus.sh pointed at a local file, with a `gh` that always fails and no token (no network use)."""
    src = tmp_path / "served" / "corpus.json"
    src.parent.mkdir()
    src.write_bytes(CORPUS_BYTES)
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    (fake_bin / "gh").write_text("#!/bin/sh\nexit 1\n")
    (fake_bin / "gh").chmod(0o755)
    env = {k: v for k, v in os.environ.items() if k != "GITHUB_TOKEN"}
    env.update(PATH=f"{fake_bin}:{os.environ['PATH']}", WAHY_CORPUS_URL=src.as_uri(), WAHY_CORPUS_SHA256=CORPUS_SHA)
    return src, env, tmp_path / "data" / "corpus.json"


def fetch(env: dict, target: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(SCRIPTS / "fetch_corpus.sh"), str(target)], env=env, capture_output=True,
                          text=True, timeout=120)


def test_corpus_is_downloaded_and_checked(corpus_env):
    _src, env, target = corpus_env
    out = fetch(env, target)
    assert out.returncode == 0 and target.read_bytes() == CORPUS_BYTES
    assert "sha256 checked" in out.stdout and not Path(str(target) + ".part").exists()


def test_a_corrupt_download_is_discarded_not_installed(corpus_env):
    src, env, target = corpus_env
    src.write_bytes(CORPUS_BYTES[:-5])                                  # cut short
    out = fetch(env, target)
    assert out.returncode == 0                                          # the app still starts, but warns
    assert not target.exists() and not Path(str(target) + ".part").exists()
    assert "wrong sha256" in out.stdout and "WARNING" in out.stdout


def test_an_existing_corpus_is_left_alone(corpus_env):
    _src, env, target = corpus_env
    target.parent.mkdir(parents=True)
    target.write_text("mine")
    fetch(env, target)
    assert target.read_text() == "mine"


def test_the_default_source_is_the_public_release_asset():
    script = (SCRIPTS / "fetch_corpus.sh").read_text()
    assert "releases/download/corpus-v1/corpus.json" in script
    assert "ffe22b8035e0285bb2f44e1824f909ce485ba25fdbcdc07bbf844f7dfdb69f67" in script
    run_sh = (REPO_ROOT / "run.sh").read_text()
    assert "scripts/fetch_corpus.sh" in run_sh and "private" not in run_sh.lower()
