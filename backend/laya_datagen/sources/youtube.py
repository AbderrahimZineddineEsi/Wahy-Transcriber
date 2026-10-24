"""YouTube lectures (no written transcript): audio + metadata, downloaded once with yt-dlp and kept on disk."""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Optional

from ..cache import DATA_DIR, write_atomic

AUDIO_DIR = DATA_DIR / "cache" / "audio"
LECTURES_DIR = DATA_DIR / "lectures"


@dataclass
class Video:
    id: str               # doc id: yt_<video id>
    video_id: str
    url: str
    title: str
    channel: str
    duration: int
    sheikh: str

    def to_json(self) -> Dict[str, Any]:
        return asdict(self)


def download(video_id: str, sheikh: str) -> Video:
    """Audio as mono mp3 (cache/audio/yt_<id>.mp3) + lectures/yt_<id>/meta.json. Cached: a second call downloads nothing."""
    doc_id = f"yt_{video_id}"
    meta_p = LECTURES_DIR / doc_id / "meta.json"
    audio = AUDIO_DIR / f"{doc_id}.mp3"
    if meta_p.exists() and audio.exists():
        return Video(**json.loads(meta_p.read_text(encoding="utf-8")))
    import yt_dlp
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    opts = {"format": "bestaudio/best", "outtmpl": str(AUDIO_DIR / f"{doc_id}.%(ext)s"), "quiet": True, "noprogress": True,
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "64"}],
            "postprocessor_args": ["-ac", "1"]}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    v = Video(id=doc_id, video_id=video_id, url=info.get("webpage_url", ""), title=info.get("title", ""),
              channel=info.get("channel") or info.get("uploader") or "", duration=int(info.get("duration") or 0), sheikh=sheikh)
    write_atomic(meta_p, json.dumps(v.to_json(), ensure_ascii=False, indent=1).encode("utf-8"))
    return v


def save_transcript(doc_id: str, asr: Dict[str, Any], meta: Optional[Dict[str, Any]] = None) -> Path:
    """Readable copies next to the metadata: transcript.txt (one line per ~minute) and words.json (with timestamps)."""
    d = LECTURES_DIR / doc_id
    lines, cur, t0 = [], [], 0.0
    for w in asr["words"]:
        if not cur:
            t0 = w["start"]
        cur.append(w["word"])
        if w["end"] - t0 >= 60:
            lines.append(f"[{int(t0 // 60):02d}:{int(t0 % 60):02d}] " + " ".join(cur))
            cur = []
    if cur:
        lines.append(f"[{int(t0 // 60):02d}:{int(t0 % 60):02d}] " + " ".join(cur))
    write_atomic(d / "transcript.txt", "\n".join(lines).encode("utf-8"))
    write_atomic(d / "words.json", json.dumps(asr["words"], ensure_ascii=False).encode("utf-8"))
    if meta is not None and not (d / "meta.json").exists():
        write_atomic(d / "meta.json", json.dumps(meta, ensure_ascii=False, indent=1).encode("utf-8"))
    return d
