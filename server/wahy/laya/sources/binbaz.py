"""binbaz.org.sa audio lessons: MP3 + verbatim transcript (book text blocks + the sheikh's commentary).

robots.txt only disallows /index.php. Requests are spaced and HTML is cached, so each page is fetched once.
"""
from __future__ import annotations

import html as html_lib
import re
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional
from urllib.parse import unquote

import httpx
from bs4 import BeautifulSoup

from ..cache import DATA_DIR, write_atomic

BASE = "https://binbaz.org.sa"
UA = "Mozilla/5.0 (research; laya-datagen; contact: local)"
MIN_INTERVAL = 2.5

_last = 0.0


def fetch_html(url: str, cache_dir: Optional[Path] = None) -> str:
    """GET with a polite delay and an on-disk cache keyed by URL."""
    global _last
    cache_dir = cache_dir or DATA_DIR / "cache" / "html"
    p = cache_dir / (re.sub(r"[^0-9A-Za-z]+", "_", unquote(url))[-150:] + ".html")
    if p.exists():
        return p.read_text(encoding="utf-8")
    wait = MIN_INTERVAL - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    r = httpx.get(url, headers={"User-Agent": UA}, timeout=60, follow_redirects=True)
    _last = time.time()
    r.raise_for_status()
    write_atomic(p, r.text.encode("utf-8"))
    return r.text


@dataclass
class Block:
    kind: str          # "book" (div.original-text paragraphs) | "sheikh" (commentary paragraphs)
    text: str


@dataclass
class Lesson:
    id: str
    url: str
    title: str
    mp3: Optional[str]
    blocks: List[Block] = field(default_factory=list)

    def to_json(self) -> Dict[str, Any]:
        return asdict(self)


_PUA = re.compile(r"[-]")        # glyph-font honorifics (e.g.  = رضي الله عنه)
_WS = re.compile(r"[ \t ‏‎]+")


def clean(text: str) -> str:
    return _WS.sub(" ", _PUA.sub(" ", text)).strip()


def parse_lesson(html: str, url: str) -> Lesson:
    s = BeautifulSoup(html, "html.parser")
    h1 = s.find("h1")
    m = re.search(r"/audios/(\d+)", unquote(url))
    mp3 = re.search(r"https?://[^\"'\s]+\.mp3", html)
    art = s.select_one("div.article-content")
    blocks: List[Block] = []
    if art is not None:
        for child in art.children:
            name = getattr(child, "name", None)
            if name == "div" and "original-text" in (child.get("class") or []):
                for p in child.find_all("p"):
                    t = clean(p.get_text(" ", strip=True))
                    if t:
                        blocks.append(Block("book", t))
            elif name == "p":
                t = clean(child.get_text(" ", strip=True))
                t = re.sub(r"^الشيخ\s*:\s*", "", t)
                if t:
                    blocks.append(Block("sheikh", t))
    return Lesson(id=f"binbaz_audio_{m.group(1) if m else 'x'}", url=url, title=h1.get_text(strip=True) if h1 else "",
                  mp3=html_lib.unescape(mp3.group(0)) if mp3 else None, blocks=blocks)   # raw HTML: "&amp;" in some links


def get_lesson(url: str) -> Lesson:
    return parse_lesson(fetch_html(url), url)


def iter_series_items(series_url: str, max_pages: int = 50, _depth: int = 0) -> Iterator[str]:
    """Item URLs of a series, lazily, following ?page=N until a page adds nothing new.

    Some series (e.g. تفسير ابن كثير) list sub-series (one per surah) instead of lessons: those are walked in order."""
    seen: List[str] = []
    sub: List[str] = []
    own_id = re.search(r"/series/(\d+)", series_url)
    for page in range(1, max_pages + 1):
        u = series_url if page == 1 else f"{series_url}{'&' if '?' in series_url else '?'}page={page}"
        try:
            html = fetch_html(u)
        except httpx.HTTPStatusError:
            break
        hrefs = re.findall(r'href="((?:https://binbaz\.org\.sa)?/audios/\d+/[^"#]+)"', html)
        new = [(BASE + h if h.startswith("/") else h) for h in hrefs]
        new = [h for h in dict.fromkeys(new) if h not in seen]
        if page == 1 and not new:
            sub = [s for s in dict.fromkeys(re.findall(r'href="(https://binbaz\.org\.sa/audios/series/(\d+)/[^"#]+)"', html))
                   if not own_id or s[1] != own_id.group(1)]
        if not new:
            break
        seen += new
        yield from new
    if _depth == 0:
        for s, _ in sub:
            yield from iter_series_items(s, max_pages, _depth + 1)


def series_items(series_url: str, max_pages: int = 50) -> List[str]:
    return list(iter_series_items(series_url, max_pages))


def usable_lessons(series_url: str, n: int, max_tried: int = 60) -> Iterator["Lesson"]:
    """The first `n` lessons that have both an MP3 and a transcript (many Bin Baz lessons are audio-only)."""
    got = 0
    for i, url in enumerate(iter_series_items(series_url)):
        if got >= n or i >= max_tried:
            return
        lesson = get_lesson(url)
        if lesson.mp3 and sum(len(b.text.split()) for b in lesson.blocks) >= 300:
            got += 1
            yield lesson


def download_mp3(lesson: Lesson, out_dir: Optional[Path] = None) -> Path:
    out_dir = out_dir or DATA_DIR / "cache" / "audio"
    p = out_dir / f"{lesson.id}.mp3"
    if p.exists():
        return p
    if not lesson.mp3:
        raise ValueError(f"{lesson.id} has no mp3")
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".part")
    with httpx.stream("GET", lesson.mp3, headers={"User-Agent": UA}, timeout=120, follow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    if tmp.read_bytes()[:200].lstrip().lower().startswith((b"<?xml", b"<!doctype", b"<html")):
        tmp.unlink()            # the file server sometimes answers 200 with an HTML error page instead of the mp3
        raise ValueError(f"{lesson.id}: the server sent an HTML page, not audio ({lesson.mp3})")
    tmp.replace(p)
    return p
