"""A lecture's media file (video or audio): where it is kept, downloading it from YouTube, and the cache.

Everything lives in `settings.media_dir` (data/media/). A lecture stores only the path relative to that folder
(`Lecture.media_path`), so the data folder can be moved.

    store = MediaStore(settings.media_dir)
    rel = store.save_upload(file.file, "khutba.mp4")             # "upload_1a2b….mp4"
    store.path(rel)                                              # absolute, and always inside media_dir
    got = store.fetch_youtube(url, on_progress=..., check=...)   # downloads once, then answers from the cache

The cache is by link: `yt_<hash of the link>.mp4` plus a small `.json` next to it (title, duration), written
only after a complete download. Asking again for the same link skips the download (F-025). yt-dlp does the
download; tests give `MediaStore` a fake fetcher instead.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol

# what a person may upload or attach
MEDIA_SUFFIXES = {".mp4", ".mp3", ".wav", ".m4a", ".webm", ".ogg", ".opus", ".mkv", ".mov", ".flac", ".aac"}
CACHE_PREFIX = "yt_"


class MediaError(Exception):
    """The media could not be stored or downloaded (the API answers 400 or 502 with the message)."""


@dataclass(frozen=True)
class FetchedMedia:
    media_path: str                  # relative to media_dir
    title: str
    duration_s: float | None
    from_cache: bool


@dataclass(frozen=True)
class Downloaded:
    path: Path
    title: str
    duration_s: float | None


class Fetcher(Protocol):
    def __call__(self, url: str, dest_stem: Path, on_progress: Callable[[float], None]) -> Downloaded:
        """Download `url` to a file named `dest_stem` + an extension; call `on_progress(percent)`."""


def youtube_fetcher(url: str, dest_stem: Path, on_progress: Callable[[float], None]) -> Downloaded:
    """The real downloader: yt-dlp, best MP4 up to 720p (video for the player, audio for the ASR)."""
    import yt_dlp

    seen = {"files": 0, "last": None}

    def hook(d: dict) -> None:
        # yt-dlp fetches the video and the audio as two files: map them onto one 0-100 bar
        if d.get("filename") != seen["last"]:
            seen["last"] = d.get("filename")
            seen["files"] += 1
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            fraction = (d.get("downloaded_bytes") or 0) / total if total else 0.0
            on_progress(fraction * 80 if seen["files"] <= 1 else 80 + fraction * 20)

    options = {
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
        "merge_output_format": "mp4",
        "outtmpl": f"{dest_stem}.%(ext)s",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as e:
        raise MediaError(f"could not download {url}: {e}") from e
    files = sorted(dest_stem.parent.glob(f"{dest_stem.name}.*"))
    files = [f for f in files if f.suffix not in (".part", ".ytdl", ".json")]
    if not files:
        raise MediaError(f"yt-dlp finished but left no file for {url}")
    duration = info.get("duration")
    return Downloaded(files[0], info.get("title") or "", float(duration) if duration else None)


class MediaStore:
    def __init__(self, media_dir: Path, fetcher: Fetcher = youtube_fetcher):
        self.dir = media_dir
        self.fetcher = fetcher

    def path(self, relative: str) -> Path:
        """The absolute path of a stored file. Refuses anything that would leave the media folder."""
        root = self.dir.resolve()
        full = (root / relative).resolve()
        if root not in full.parents:
            raise MediaError(f"{relative!r} is outside the media folder")
        return full

    def save_upload(self, stream: BinaryIO, filename: str) -> str:
        """Copy an uploaded file in under a fresh name, and return its relative path. A half-written file is
        removed."""
        suffix = Path(filename).suffix.lower()
        if suffix not in MEDIA_SUFFIXES:
            raise MediaError(f"unsupported file type {suffix or '(none)'}; use one of "
                             f"{', '.join(sorted(MEDIA_SUFFIXES))}")
        self.dir.mkdir(parents=True, exist_ok=True)
        name = f"upload_{uuid.uuid4().hex[:12]}{suffix}"
        target = self.dir / name
        try:
            with open(target, "wb") as out:
                shutil.copyfileobj(stream, out, length=1 << 20)
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return name

    def remove(self, relative: str) -> None:
        """Delete a stored file. Cached YouTube downloads are kept: the next lecture from the same link reuses
        them."""
        if relative.startswith(CACHE_PREFIX):
            return
        try:
            self.path(relative).unlink(missing_ok=True)
        except MediaError:
            pass

    def fetch_youtube(self, url: str, *, on_progress: Callable[[float], None] = lambda _p: None,
                      check: Callable[[], None] = lambda: None) -> FetchedMedia:
        """Download `url` (or find it in the cache). `check` is called with each progress report, so a job can
        be paused or cancelled while downloading."""
        self.dir.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(url.strip().encode("utf-8")).hexdigest()[:16]
        stem = self.dir / f"{CACHE_PREFIX}{key}"
        cached = self._cached(stem)
        if cached is not None:
            on_progress(100.0)
            return cached

        def progress(percent: float) -> None:
            check()
            on_progress(percent)

        got = self.fetcher(url.strip(), stem, progress)
        if not got.path.exists() or got.path.stat().st_size == 0:
            raise MediaError(f"the download of {url} produced no file")
        meta = {"filename": got.path.name, "title": got.title, "duration_s": got.duration_s, "url": url}
        stem.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False), "utf-8")
        on_progress(100.0)
        return FetchedMedia(got.path.name, got.title, got.duration_s, from_cache=False)

    def _cached(self, stem: Path) -> FetchedMedia | None:
        meta_path = stem.with_suffix(".json")
        if not meta_path.exists():
            return None
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
            file = self.dir / meta["filename"]
            if file.exists() and file.stat().st_size > 0:
                return FetchedMedia(file.name, meta.get("title") or "", meta.get("duration_s"),
                                    from_cache=True)
        except (ValueError, KeyError, OSError):
            pass
        return None
