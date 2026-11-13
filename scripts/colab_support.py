"""Helpers for the Colab notebook (F-130): keep the app's data on the user's Google Drive, make a backup zip,
make the access link, and cache the built web app. Plain Python with no Colab imports, so the tests run
anywhere; the notebook (scripts/make_colab_notebook.py) imports this file from the cloned repo.

Why copy instead of pointing the app at Drive: the app runs on the VM's fast disk (data/), and SQLite on the
Drive mount is unreliable (file locking, WAL). So a background thread copies data/ to Drive every minute (the
database through SQLite's backup API, so the copy is always consistent) and the next session copies it back.

What is kept: data/wahy.db, media/, tafrigh_runs/, corpora/ uploads, ... (everything in data/) and the keys file
`.env`. What is not: data/corpus.json (90 MB, downloaded again with a sha256 check) and half-written files.
Nothing is ever deleted on Drive by a sync, only added or updated.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import sqlite3
import subprocess
import tarfile
import threading
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

DB_NAME = "wahy.db"
KEYS_FILE = ".env"
# not copied to Drive / the backup: re-downloadable or temporary
SKIP_NAMES = {"corpus.json", ".gitkeep", ".DS_Store"}
SKIP_SUFFIXES = (".part", ".tmp", "-wal", "-shm", "-journal")
MIN_FREE_BYTES = 200 * 1024 * 1024


# ---- the access link -----------------------------------------------------------------------------------------

def new_token() -> str:
    """A fresh random access token (about 190 bits), URL-safe."""
    return secrets.token_urlsafe(24)


def access_url(base_url: str, token: str) -> str:
    """The link to hand to the user: the public address with the token (core/access.py trades it for a cookie)."""
    return f"{base_url.rstrip('/')}/?token={quote(token, safe='')}"


# ---- where on Drive ------------------------------------------------------------------------------------------

def drive_dir_for(mount_root: str | Path, folder: str, legacy: tuple[str, ...] = ()) -> Path:
    """`<mount_root>/MyDrive/<folder>`, created if needed. `folder` is a name or a short path under My Drive; it
    can never leave My Drive (no `..`, no absolute path), so a typo cannot write somewhere else.

    `legacy`: the folder's old names (the app was called Wahy Studio, its folder Wahy-Studio). When `folder` does not
    exist yet and an old one does, the old one is renamed to `folder`, so the lectures saved there come along."""
    name = (folder or "").strip().strip("/")
    parts = [p for p in name.replace("\\", "/").split("/") if p]
    if not parts or any(p in (".", "..") for p in parts) or name.startswith("~"):
        raise ValueError(f"bad Drive folder name {folder!r}: use a plain name such as Tadqeeq")
    base = Path(mount_root) / "MyDrive"
    if not base.is_dir():
        raise FileNotFoundError(f"{base} not found: is Google Drive mounted?")
    target = base.joinpath(*parts)
    if not target.exists():
        for old in legacy:
            source = base / old
            if old and "/" not in old and old not in (".", "..") and source.is_dir():
                target.parent.mkdir(parents=True, exist_ok=True)
                source.rename(target)
                print(f"Moved My Drive/{old} to My Drive/{name} (the app's new name); your lectures are kept.")
                break
    target.mkdir(parents=True, exist_ok=True)
    if not target.resolve().is_relative_to(base.resolve()):
        raise ValueError(f"bad Drive folder name {folder!r}")
    return target


def _skip(path: Path) -> bool:
    return path.name in SKIP_NAMES or path.name.endswith(SKIP_SUFFIXES) or path.name == DB_NAME


def _walk(root: Path):
    """Every kept file under root (not the database: it has its own copy)."""
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            p = Path(dirpath) / f
            if not _skip(p) and not p.is_symlink():
                yield p


def _needs_copy(src: Path, dst: Path) -> bool:
    if not dst.exists():
        return True
    a, b = src.stat(), dst.stat()
    return a.st_size != b.st_size or a.st_mtime > b.st_mtime + 2     # Drive's clock is coarse


def _copy(src: Path, dst: Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)
    try:
        os.utime(dst, (src.stat().st_atime, src.stat().st_mtime))
    except OSError:
        pass
    return dst.stat().st_size


def _backup_db(src: Path, dst: Path) -> None:
    """A consistent copy of a live SQLite database (SQLite's backup API), replacing dst atomically."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    tmp.unlink(missing_ok=True)
    source = sqlite3.connect(f"file:{src}?mode=ro", uri=True, timeout=30)
    target = sqlite3.connect(tmp)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    os.replace(tmp, dst)


@dataclass
class SyncResult:
    files: int = 0
    bytes: int = 0
    db: bool = False
    errors: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        db = "database + " if self.db else ""
        return f"{db}{self.files} file(s), {self.bytes / 1e6:.1f} MB copied" + (
            f", {len(self.errors)} error(s): {self.errors[0]}" if self.errors else "")


# ---- Drive <-> the VM ----------------------------------------------------------------------------------------

def sync_to_drive(repo: str | Path, drive_dir: str | Path) -> SyncResult:
    """Copy data/ (and the keys file) from the VM to Drive: changed files only, never deleting anything."""
    repo, drive_dir = Path(repo), Path(drive_dir)
    data, out = repo / "data", drive_dir / "data"
    result = SyncResult()
    if data.is_dir():
        db = data / DB_NAME
        if db.is_file():
            try:
                _backup_db(db, out / DB_NAME)
                result.db = True
            except (sqlite3.Error, OSError) as e:
                result.errors.append(f"database: {e}")
        for src in _walk(data):
            dst = out / src.relative_to(data)
            try:
                if _needs_copy(src, dst):
                    result.bytes += _copy(src, dst)
                    result.files += 1
            except OSError as e:
                result.errors.append(f"{src.name}: {e}")
    keys = repo / KEYS_FILE
    if keys.is_file():
        try:
            if not (drive_dir / KEYS_FILE).exists() or keys.read_bytes() != (drive_dir / KEYS_FILE).read_bytes():
                _copy(keys, drive_dir / KEYS_FILE)
                result.files += 1
        except OSError as e:
            result.errors.append(f"{KEYS_FILE}: {e}")
    return result


def restore_from_drive(repo: str | Path, drive_dir: str | Path) -> SyncResult:
    """Copy what a previous session saved on Drive back to the VM. Only fills what is missing locally: it never
    overwrites a file the VM already has."""
    repo, drive_dir = Path(repo), Path(drive_dir)
    src_data, data = drive_dir / "data", repo / "data"
    result = SyncResult()
    data.mkdir(parents=True, exist_ok=True)
    if (src_data / DB_NAME).is_file() and not (data / DB_NAME).exists():
        shutil.copyfile(src_data / DB_NAME, data / DB_NAME)
        result.db = True
    if src_data.is_dir():
        for src in _walk(src_data):
            dst = data / src.relative_to(src_data)
            if not dst.exists():
                result.bytes += _copy(src, dst)
                result.files += 1
    if (drive_dir / KEYS_FILE).is_file() and not (repo / KEYS_FILE).exists():
        _copy(drive_dir / KEYS_FILE, repo / KEYS_FILE)
        (repo / KEYS_FILE).chmod(0o600)
        result.files += 1
    return result


class _Periodic:
    """Runs `tick()` every `interval_s` seconds in a background thread; `stop()` does one last tick."""

    what = "job"

    def __init__(self, interval_s: float, log=print):
        self.interval_s, self.log = interval_s, log
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name=self.what)
        self.last_at: float | None = None

    def tick(self):
        raise NotImplementedError

    def start(self):
        self._thread.start()
        return self

    def tick_now(self):
        result = self.tick()
        self.last_at = time.time()
        return result

    def _run(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self.tick_now()
            except Exception as e:      # never let the thread die silently: say so and keep going
                self.log(f"[{self.what}] failed: {e}")

    def stop(self):
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=5)
        return self.tick_now()


class DriveSyncer(_Periodic):
    """sync_to_drive every `interval_s` seconds; `stop()` does a last sync."""

    what = "drive-sync"

    def __init__(self, repo: str | Path, drive_dir: str | Path, interval_s: float = 60.0, log=print):
        super().__init__(interval_s, log)
        self.repo, self.drive_dir = Path(repo), Path(drive_dir)
        self.last: SyncResult | None = None

    def tick(self) -> SyncResult:
        self.last = sync_to_drive(self.repo, self.drive_dir)
        if self.last.errors:
            self.log(f"[drive] sync problem: {self.last}")
        return self.last


class ZipBackupper(_Periodic):
    """make_backup_zip every `interval_s` seconds (Drive off): the zip sits in the Colab Files panel, ready to
    download at any moment."""

    what = "backup-zip"

    def __init__(self, repo: str | Path, out_zip: str | Path, interval_s: float = 120.0, log=print):
        super().__init__(interval_s, log)
        self.repo, self.out_zip = Path(repo), Path(out_zip)

    def tick(self) -> Path:
        return make_backup_zip(self.repo, self.out_zip)


def redact(line: str, token: str) -> str:
    """A server log line with the access token hidden (the access log shows the first visit's `?token=...`), so
    the notebook's output never carries it except in the one link we print on purpose."""
    if token:
        line = line.replace(token, "***")
        line = line.replace(quote(token, safe=""), "***")
    return line


# ---- a backup zip (when Drive is off) ------------------------------------------------------------------------

def make_backup_zip(repo: str | Path, out_zip: str | Path, include_keys: bool = False) -> Path:
    """data/ (the database as a consistent copy, media, saved lectures) in one zip. The keys file is only added
    with include_keys=True, because the zip is meant to be downloaded and kept."""
    repo, out_zip = Path(repo), Path(out_zip)
    data = repo / "data"
    tmp = out_zip.with_name(out_zip.name + ".part")
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    scratch = out_zip.parent / f".{out_zip.stem}-db"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        if (data / DB_NAME).is_file():
            scratch.mkdir(exist_ok=True)
            _backup_db(data / DB_NAME, scratch / DB_NAME)
            z.write(scratch / DB_NAME, f"data/{DB_NAME}")
            shutil.rmtree(scratch, ignore_errors=True)
        if data.is_dir():
            for src in _walk(data):
                z.write(src, f"data/{src.relative_to(data).as_posix()}")
        if include_keys and (repo / KEYS_FILE).is_file():
            z.write(repo / KEYS_FILE, KEYS_FILE)
    os.replace(tmp, out_zip)
    return out_zip


def restore_backup_zip(zip_path: str | Path, repo: str | Path) -> int:
    """Unpack a backup zip made by make_backup_zip into the repo, refusing any path that would leave it.
    Returns the number of files written; files that already exist are replaced."""
    repo = Path(repo).resolve()
    count = 0
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            name = info.filename
            allowed = name == KEYS_FILE or name.startswith("data/")
            target = (repo / name).resolve()
            if info.is_dir() or not allowed or not target.is_relative_to(repo):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            count += 1
    return count


def free_bytes(path: str | Path) -> int:
    return shutil.disk_usage(path).free


# ---- the built web app, cached on Drive ----------------------------------------------------------------------

def web_cache_key(repo: str | Path) -> str:
    """A short key that changes whenever anything the web build reads changes (git's hashes of web/, engine/ and
    the lock files). Empty when git cannot tell (no cache is used then)."""
    try:
        out = subprocess.run(["git", "ls-files", "-s", "web", "engine", "package.json", "package-lock.json"],
                             cwd=repo, capture_output=True, text=True, check=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return ""
    return hashlib.sha1(out.encode()).hexdigest()[:16] if out.strip() else ""


def save_web_dist(repo: str | Path, cache_dir: str | Path) -> Path | None:
    """Pack web/dist into <cache_dir>/web-dist-<key>.tgz (a few MB). Returns None if there is nothing to save."""
    repo, cache_dir = Path(repo), Path(cache_dir)
    key, dist = web_cache_key(repo), repo / "web" / "dist"
    if not key or not (dist / "index.html").is_file():
        return None
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / f"web-dist-{key}.tgz"
    tmp = out.with_name(out.name + ".part")
    with tarfile.open(tmp, "w:gz") as t:
        t.add(dist, arcname="dist")
    os.replace(tmp, out)
    for old in cache_dir.glob("web-dist-*.tgz"):     # keep only the newest build
        if old != out:
            old.unlink(missing_ok=True)
    return out


def restore_web_dist(repo: str | Path, cache_dir: str | Path) -> bool:
    """Unpack a cached build into web/dist if one matches the current sources. run.sh then skips `npm ci` and the
    build. Returns whether a cached build was used."""
    repo, cache_dir = Path(repo), Path(cache_dir)
    key = web_cache_key(repo)
    archive = cache_dir / f"web-dist-{key}.tgz"
    if not key or not archive.is_file():
        return False
    dist = repo / "web" / "dist"
    shutil.rmtree(dist, ignore_errors=True)
    with tarfile.open(archive) as t:
        for m in t.getmembers():                     # only plain files and folders under dist/
            if not (m.isfile() or m.isdir()) or m.name.startswith(("/", "..")) or ".." in Path(m.name).parts:
                return False
        t.extractall(repo / "web", filter="data")
    now = time.time()
    for p in dist.rglob("*"):                        # run.sh rebuilds when sources are newer than dist/index.html
        os.utime(p, (now, now))
    os.utime(dist, (now, now))
    return (dist / "index.html").is_file()


def describe_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"

