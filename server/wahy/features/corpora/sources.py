"""Hadith corpus sources (F-079), ported from the old app's backend/corpus_sources.py.

The built-in source is the hadith part of data/corpus.json. Other sources are downloaded once, converted to
the app's hadith format and written to `data/corpora/hadith_<source>.json`; the engine worker reads that file
instead of the built-in hadiths when the source is active:

    {"summary": {...}, "hadiths": [{"id", "book", "ref", "t", "matn"?, "grade"?}, ...]}

`t` is the full text shown to the user (chain of narration + matn); `matn` is the part the engine compares,
when the source gives a real isnad/matn split.

    store = SourceStore(settings.data_dir)
    # download (or reuse the cached zip), convert, write the prepared file
    store.prepare("open_hadith_data", job_id, progress=lambda pct, msg: ..., check=ctx.check)
    store.describe()                                    # status of every source
    store.save_upload("open_hadith_data", zip_bytes)    # when the download is blocked: upload the zip by hand

The zip stays in `downloads/` (the download cache), so preparing again never downloads twice.
"""

from __future__ import annotations

import io
import json
import re
import threading
import time
import zipfile
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

ProgressFn = Callable[[float, str], None]
Downloader = Callable[[str, Path, ProgressFn, Callable[[], None]], None]
BUILTIN = "wahy_default"

# Book keys used across the app (engine ranking, filters) and their Arabic titles
BOOK_KEYS = [
    # (match in collection id/file name, app book key, Arabic title)
    ("bukhari", "Bukhari", "صحيح البخاري"),
    ("muslim", "Muslim", "صحيح مسلم"),
    ("nasai", "Nasai", "سنن النسائي"),
    ("abudawud", "AbiDawud", "سنن أبي داود"),
    ("abidawud", "AbiDawud", "سنن أبي داود"),
    ("dawud", "AbiDawud", "سنن أبي داود"),
    ("tirmidhi", "Tirmidhi", "جامع الترمذي"),
    ("ibnmajah", "IbnMajah", "سنن ابن ماجه"),
    ("majah", "IbnMajah", "سنن ابن ماجه"),
    ("malik", "Muwatta", "موطأ مالك"),
    ("muwatta", "Muwatta", "موطأ مالك"),
    ("ahmad", "Ahmad", "مسند أحمد"),
    ("darimi", "Darimi", "سنن الدارمي"),
    ("adab", "AdabMufrad", "الأدب المفرد"),
    ("riyad", "RiyadSalihin", "رياض الصالحين"),
    ("bulugh", "BulughMaram", "بلوغ المرام"),
    ("shamail", "Shamail", "الشمائل المحمدية"),
    ("mishkat", "Mishkat", "مشكاة المصابيح"),
    ("nawawi", "Nawawi40", "الأربعون النووية"),
    ("qudsi", "Qudsi40", "الأحاديث القدسية"),
    ("shahwaliullah", "ShahWaliullah40", "أربعون شاه ولي الله"),
    ("waliullah", "ShahWaliullah40", "أربعون شاه ولي الله"),
]

SOURCES: dict[str, dict[str, Any]] = {
    BUILTIN: {
        "label": "Wahy corpus (data/corpus.json)",
        "description": "The hadiths inside the project's own corpus file.",
        "builtin": True,
    },
    "open_hadith_data": {
        "label": "Open Hadith Data (sunnah.com)",
        "description": "17 collections from sunnah.com with the chain of narration separated from the text, "
                       "and the hadith grades (about 46,891 hadiths).",
        "version": "v1.1.0",
        "zip_url": "https://github.com/Jaguar16/open-hadith-data/releases/download/v1.1.0/collections-json.zip",
        "page_url": "https://github.com/Jaguar16/open-hadith-data/releases",
        # Hisn al-Muslim is du'as, not hadith (adhkar are managed by the user)
        "skip_collections": ("hisn",),
    },
}


class SourceError(Exception):
    """A source could not be prepared (download failed, wrong file, nothing inside)."""


class UnknownSource(SourceError, KeyError):
    """No such source, or the built-in one where only a prepared source makes sense."""


class AlreadyPreparing(SourceError):
    """This source is being prepared by another job."""


def _book_for(collection: str) -> tuple[str, str]:
    key = re.sub(r"[^a-z]", "", collection.lower())
    for needle, book, title in BOOK_KEYS:
        if needle in key:
            return book, title
    return collection or "Hadith", collection or "حديث"


def _hadith_items(payload: Any) -> Iterable[dict[str, Any]]:
    """Hadith dicts from one collection file, whatever its nesting ({books:[{hadiths}]}, {hadiths}, [..])."""
    if isinstance(payload, list):
        for x in payload:
            if isinstance(x, dict) and ("text_ar" in x or "matn_ar" in x):
                yield x
            elif isinstance(x, dict | list):
                yield from _hadith_items(x)
        return
    if not isinstance(payload, dict):
        return
    if "text_ar" in payload or "matn_ar" in payload:
        yield payload
        return
    for k in ("books", "chapters", "hadiths", "data", "items"):
        if k in payload:
            yield from _hadith_items(payload[k])


def _clean(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def convert_open_hadith_zip(zip_bytes: bytes, skip: Iterable[str] = ()) -> dict[str, Any]:
    """The Open Hadith Data release zip → {"hadiths": [...], "by_book": {book: count}}."""
    hadiths: list[dict[str, Any]] = []
    by_book: dict[str, int] = {}
    seen: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for info in sorted(z.infolist(), key=lambda i: i.filename):
            name = info.filename
            if info.is_dir() or not name.lower().endswith(".json"):
                continue
            stem = Path(name).stem
            if any(s in stem.lower() for s in skip):
                continue
            try:
                payload = json.loads(z.read(info).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            meta_id = (payload.get("collection_id") or payload.get("id") or payload.get("slug")
                       if isinstance(payload, dict) else None)
            collection = str(meta_id or stem)
            if any(s in collection.lower() for s in skip):
                continue
            book, title = _book_for(collection)
            for n, h in enumerate(_hadith_items(payload), start=1):
                full = _clean(h.get("text_ar"))
                matn = _clean(h.get("matn_ar"))
                if not full and not matn:
                    continue
                num = h.get("hadith_number") or h.get("number") or n
                hid = f"OHD:{book}:{num}"
                if hid in seen:
                    hid = f"{hid}:{n}"
                seen.add(hid)
                item: dict[str, Any] = {"id": hid, "book": book, "ref": f"{title} ({num})", "t": full or matn}
                if matn and matn != full:
                    item["matn"] = matn
                # some rows hold only the label
                grade = re.sub(r"^\s*حكم\s*[:：]?\s*", "", _clean(h.get("grade_ar")))
                if grade:
                    item["grade"] = grade
                hadiths.append(item)
                by_book[book] = by_book.get(book, 0) + 1
    return {"hadiths": hadiths, "by_book": by_book}


def http_download(url: str, dest: Path, progress: ProgressFn, check: Callable[[], None]) -> None:
    """Stream `url` to `dest` (through a .part file, so a stopped download leaves nothing half-written)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(".part")
    progress(1, "connecting to the download server")
    try:
        with httpx.Client(timeout=httpx.Timeout(30.0, read=120.0), follow_redirects=True) as client:
            with client.stream("GET", url) as resp:
                if resp.status_code != 200:
                    raise SourceError(f"download failed (HTTP {resp.status_code})")
                total = int(resp.headers.get("content-length") or 0)
                got, last = 0, 0.0
                with open(part, "wb") as f:
                    for chunk in resp.iter_bytes(1 << 16):
                        check()
                        f.write(chunk)
                        got += len(chunk)
                        if time.time() - last > 0.5:
                            last = time.time()
                            pct = 2 + 76 * got / total if total else 40
                            of = f" / {total / 1e6:.1f} MB" if total else ""
                            progress(pct, f"downloading: {got / 1e6:.1f}{of}")
    except httpx.HTTPError as exc:
        part.unlink(missing_ok=True)
        raise SourceError(f"could not download the file ({exc.__class__.__name__}); download it by hand and "
                          "upload it") from exc
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    part.replace(dest)


class SourceStore:
    def __init__(self, data_dir: Path, *, download: Downloader = http_download):
        self.dir = data_dir / "corpora"
        self.downloads = self.dir / "downloads"
        self._download = download
        self._lock = threading.Lock()
        self._running: dict[str, str] = {}   # source id -> job id while preparing

    def require_prepared_kind(self, source_id: str) -> dict[str, Any]:
        """The source's definition; raises UnknownSource for an id that is unknown or built in."""
        meta = SOURCES.get(source_id)
        if meta is None or meta.get("builtin"):
            raise UnknownSource(source_id)
        return meta

    def output_path(self, source_id: str) -> Path:
        return self.dir / f"hadith_{source_id}.json"

    def zip_path(self, source_id: str) -> Path:
        version = SOURCES[source_id].get("version", "latest")
        return self.downloads / f"{source_id}_{version}.zip"

    def is_ready(self, source_id: str) -> bool:
        meta = SOURCES.get(source_id)
        return bool(meta) and (bool(meta.get("builtin")) or self.output_path(source_id).exists())

    def hadiths_path(self, source_id: str) -> Path | None:
        """The file the engine reads for this source; None for the built-in hadiths."""
        if source_id == BUILTIN:
            return None
        if not self.is_ready(source_id):
            raise UnknownSource(source_id)
        return self.output_path(source_id)

    def describe(self, builtin_count: int | None = None) -> list[dict[str, Any]]:
        out = []
        for sid, meta in SOURCES.items():
            row: dict[str, Any] = {"id": sid, "label": meta["label"], "description": meta["description"],
                                   "builtin": bool(meta.get("builtin")), "page_url": meta.get("page_url"),
                                   "version": meta.get("version"), "preparing_job": None, "count": None,
                                   "by_book": None, "built_at": None, "size_mb": None, "zip_cached": False}
            if meta.get("builtin"):
                row.update(status="ready", count=builtin_count)
            else:
                row["preparing_job"] = self._running.get(sid)
                path = self.output_path(sid)
                if path.exists():
                    info = self._read_header(path)
                    row.update(status="ready", count=info.get("count"), by_book=info.get("by_book"),
                               built_at=info.get("built_at"), size_mb=round(path.stat().st_size / 1e6, 1))
                else:
                    row["status"] = "preparing" if row["preparing_job"] else "missing"
                row["zip_cached"] = self.zip_path(sid).exists()
            out.append(row)
        return out

    @staticmethod
    def _read_header(path: Path) -> dict[str, Any]:
        """The summary is written first in the file, so it can be read without parsing all hadiths."""
        with open(path, encoding="utf-8") as f:
            head = f.read(4096)
        m = re.search(r'"summary"\s*:\s*(\{.*?\})\s*,\s*"hadiths"', head, re.S)
        try:
            return json.loads(m.group(1)) if m else {}
        except ValueError:
            return {}

    def save_upload(self, source_id: str, data: bytes) -> None:
        """Keep a zip the user downloaded by hand as the source's download. Raises SourceError for a file that
        is not a zip."""
        self.require_prepared_kind(source_id)
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                bad = z.testzip()
        except zipfile.BadZipFile as e:
            raise SourceError(f"the file is not a valid zip: {e}") from None
        if bad:
            raise SourceError(f"the zip is damaged (first bad file: {bad})")
        self.downloads.mkdir(parents=True, exist_ok=True)
        self.zip_path(source_id).write_bytes(data)

    def delete(self, source_id: str, *, keep_download: bool = False) -> None:
        """Forget a prepared source (and its cached zip, unless `keep_download`)."""
        self.require_prepared_kind(source_id)
        with self._lock:
            if source_id in self._running:
                raise AlreadyPreparing(source_id)
        self.output_path(source_id).unlink(missing_ok=True)
        if not keep_download:
            self.zip_path(source_id).unlink(missing_ok=True)

    def prepare(self, source_id: str, job_id: str, progress: ProgressFn,
                check: Callable[[], None] = lambda: None) -> dict[str, Any]:
        """Download the source's zip (unless cached), convert it and write the prepared file. Returns the
        summary {source, version, count, by_book, built_at}."""
        meta = self.require_prepared_kind(source_id)
        with self._lock:
            if source_id in self._running:
                raise AlreadyPreparing(f"{source_id} is already being prepared")
            self._running[source_id] = job_id
        try:
            zpath = self.zip_path(source_id)
            if not zpath.exists():
                self._download(meta["zip_url"], zpath, progress, check)
            check()
            progress(80, "converting the hadiths to the app's format")
            try:
                conv = convert_open_hadith_zip(zpath.read_bytes(), meta.get("skip_collections", ()))
            except zipfile.BadZipFile:
                zpath.unlink(missing_ok=True)       # a broken cached file would fail every time
                raise SourceError("the downloaded file is not a valid zip; prepare again") from None
            if not conv["hadiths"]:
                raise SourceError("no hadiths were found in the file (unexpected format)")
            check()
            summary = {"source": source_id, "version": meta.get("version"), "count": len(conv["hadiths"]),
                       "by_book": conv["by_book"], "built_at": datetime.now(UTC).isoformat()}
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.output_path(source_id).with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write('{"summary": ' + json.dumps(summary, ensure_ascii=False) + ', "hadiths": ')
                json.dump(conv["hadiths"], f, ensure_ascii=False, separators=(",", ":"))
                f.write("}")
            tmp.replace(self.output_path(source_id))
            progress(100, f"ready: {summary['count']} hadiths")
            return summary
        finally:
            with self._lock:
                self._running.pop(source_id, None)
