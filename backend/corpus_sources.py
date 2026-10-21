"""
Selectable hadith corpora.

The default corpus is the hadith part of data/corpus.json (loaded by the browser as before). Other corpora are
downloaded once, converted to the app's hadith format and written to data/corpora/hadith_<source>.json, which the
browser loads when that corpus is selected:

    {"id", "book", "ref", "t", "matn"?, "grade"?}

`t` is the full text shown to the user (chain of narration + matn); `matn` is the part the engine compares, when
the corpus provides a real isnad/matn split (otherwise the engine guesses it from `t`).
"""

from __future__ import annotations

import io
import json
import re
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

import httpx

ProgressFn = Callable[[float, str], None]

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

SOURCES: Dict[str, Dict[str, Any]] = {
    "wahy_default": {
        "label": "قاعدة واحي الحالية (data/corpus.json)",
        "description": "الأحاديث المضمّنة في ملف القاعدة الحالي للمشروع.",
        "builtin": True,
    },
    "open_hadith_data": {
        "label": "Open Hadith Data (sunnah.com)",
        "description": "17 مصنّفاً من sunnah.com مع فصل الإسناد عن المتن وأحكام الحديث (~46,891 حديثاً).",
        "version": "v1.1.0",
        "zip_url": "https://github.com/Jaguar16/open-hadith-data/releases/download/v1.1.0/collections-json.zip",
        "page_url": "https://github.com/Jaguar16/open-hadith-data/releases",
        "skip_collections": ("hisn",),   # Hisn al-Muslim is du'as, not hadith (adhkar are managed by the user)
    },
}


def _book_for(collection: str) -> tuple:
    key = re.sub(r"[^a-z]", "", collection.lower())
    for needle, book, title in BOOK_KEYS:
        if needle in key:
            return book, title
    return collection or "Hadith", collection or "حديث"


def _hadith_items(payload: Any) -> Iterable[Dict[str, Any]]:
    """Hadith dicts from one collection file, whatever its nesting ({books:[{hadiths}]}, {hadiths}, [..])."""
    if isinstance(payload, list):
        for x in payload:
            if isinstance(x, dict) and ("text_ar" in x or "matn_ar" in x):
                yield x
            elif isinstance(x, (dict, list)):
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


def convert_open_hadith_zip(zip_bytes: bytes, skip: Iterable[str] = ()) -> Dict[str, Any]:
    hadiths: List[Dict[str, Any]] = []
    by_book: Dict[str, int] = {}
    seen = set()
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
            meta_id = payload.get("collection_id") or payload.get("id") or payload.get("slug") if isinstance(payload, dict) else None
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
                item: Dict[str, Any] = {"id": hid, "book": book, "ref": f"{title} ({num})", "t": full or matn}
                if matn and matn != full:
                    item["matn"] = matn
                grade = re.sub(r"^\s*حكم\s*[:：]?\s*", "", _clean(h.get("grade_ar")))   # some rows hold only the label
                if grade:
                    item["grade"] = grade
                hadiths.append(item)
                by_book[book] = by_book.get(book, 0) + 1
    return {"hadiths": hadiths, "by_book": by_book}


class CorpusSourceManager:
    def __init__(self, data_dir: Path) -> None:
        self.dir = data_dir / "corpora"
        self.downloads = self.dir / "downloads"
        self._lock = threading.Lock()
        self._running: Dict[str, str] = {}   # source id -> job id while preparing

    def output_path(self, source_id: str) -> Path:
        return self.dir / f"hadith_{source_id}.json"

    def zip_path(self, source_id: str) -> Path:
        version = SOURCES[source_id].get("version", "latest")
        return self.downloads / f"{source_id}_{version}.zip"

    def describe(self, default_hadith_count: Optional[int] = None) -> List[Dict[str, Any]]:
        out = []
        for sid, meta in SOURCES.items():
            row = {"id": sid, "label": meta["label"], "description": meta["description"],
                   "builtin": bool(meta.get("builtin")), "page_url": meta.get("page_url")}
            if meta.get("builtin"):
                row.update(status="ready", count=default_hadith_count)
            else:
                path = self.output_path(sid)
                row["preparing_job"] = self._running.get(sid)
                if path.exists():
                    info = self._read_header(path)
                    row.update(status="ready", count=info.get("count"), by_book=info.get("by_book"),
                               built_at=info.get("built_at"), version=info.get("version"),
                               size_mb=round(path.stat().st_size / 1e6, 1),
                               url=f"/data/corpora/{path.name}", stamp=int(path.stat().st_mtime))
                else:
                    row.update(status="preparing" if row["preparing_job"] else "missing",
                               zip_cached=self.zip_path(sid).exists())
            out.append(row)
        return out

    @staticmethod
    def _read_header(path: Path) -> Dict[str, Any]:
        """The summary is written first in the file, so it can be read without parsing all hadiths."""
        with open(path, "r", encoding="utf-8") as f:
            head = f.read(4096)
        m = re.search(r'"summary"\s*:\s*(\{.*?\})\s*,\s*"hadiths"', head, re.S)
        try:
            return json.loads(m.group(1)) if m else {}
        except ValueError:
            return {}

    def save_upload(self, source_id: str, data: bytes) -> None:
        self.downloads.mkdir(parents=True, exist_ok=True)
        zipfile.ZipFile(io.BytesIO(data)).testzip()  # raises BadZipFile on a wrong file
        self.zip_path(source_id).write_bytes(data)

    def prepare(self, source_id: str, job_id: str, progress: ProgressFn) -> Dict[str, Any]:
        meta = SOURCES[source_id]
        with self._lock:
            if source_id in self._running:
                raise RuntimeError("هذه القاعدة قيد التحضير بالفعل.")
            self._running[source_id] = job_id
        try:
            zpath = self.zip_path(source_id)
            if not zpath.exists():
                self._download(meta["zip_url"], zpath, progress)
            progress(80, "جاري تحويل الأحاديث إلى صيغة التطبيق...")
            conv = convert_open_hadith_zip(zpath.read_bytes(), meta.get("skip_collections", ()))
            if not conv["hadiths"]:
                raise RuntimeError("لم يُعثر على أحاديث في الملف (صيغة غير متوقعة).")
            summary = {
                "source": source_id, "version": meta.get("version"), "count": len(conv["hadiths"]),
                "by_book": conv["by_book"], "built_at": datetime.now(timezone.utc).isoformat(),
            }
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.output_path(source_id).with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                f.write('{"summary": ' + json.dumps(summary, ensure_ascii=False) + ', "hadiths": ')
                json.dump(conv["hadiths"], f, ensure_ascii=False, separators=(",", ":"))
                f.write("}")
            tmp.replace(self.output_path(source_id))
            progress(100, f"جاهزة: {summary['count']} حديث")
            return summary
        finally:
            with self._lock:
                self._running.pop(source_id, None)

    @staticmethod
    def _download(url: str, dest: Path, progress: ProgressFn) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_suffix(".part")
        progress(1, "جاري الاتصال بخادم التحميل...")
        try:
            with httpx.Client(timeout=httpx.Timeout(30.0, read=120.0), follow_redirects=True) as client:
                with client.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        raise RuntimeError(f"فشل التحميل (HTTP {resp.status_code}).")
                    total = int(resp.headers.get("content-length") or 0)
                    got, last = 0, 0.0
                    with open(part, "wb") as f:
                        for chunk in resp.iter_bytes(1 << 16):
                            f.write(chunk)
                            got += len(chunk)
                            if time.time() - last > 0.5:
                                last = time.time()
                                pct = 2 + 76 * got / total if total else 40
                                progress(pct, f"جاري التحميل: {got / 1e6:.1f} / {total / 1e6:.1f} MB" if total else f"جاري التحميل: {got / 1e6:.1f} MB")
        except httpx.HTTPError as exc:
            part.unlink(missing_ok=True)
            raise RuntimeError(f"تعذر تحميل الملف ({exc.__class__.__name__}). يمكنك تحميله يدوياً ورفعه من الإعدادات.") from exc
        part.replace(dest)
