"""
Wahy-Finder v2.0 — Module 3: Multi-Source Input & Media Processing Pipeline
File: backend/media_processor.py

Responsibilities:
1. Download YouTube video/audio via the yt_dlp Python library (up to 720p MP4 for
   local synchronized playback + audio extraction) into backend/temp_media/.
2. Normalize uploaded or downloaded media with FFmpeg into:
   - audio_16k.wav (16kHz, mono, PCM s16le) for local faster-whisper (CUDA int8).
   - audio_compressed.mp3 (16kHz, mono, 48kbps/64kbps) for Groq Cloud API.
3. Automatically slice MP3 files longer than 45 minutes (2700s) or >24MB into
   contiguous chunks so Groq's 25MB free-tier limit is never exceeded.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import yt_dlp  # type: ignore
except ImportError:
    yt_dlp = None


class YtDlpDownloadError(RuntimeError):
    """Raised when yt-dlp fails to fetch or extract a YouTube/media URL."""


class FFmpegProcessingError(RuntimeError):
    """Raised when ffmpeg/ffprobe fails during audio normalization or chunking."""


BASE_DIR = Path(__file__).resolve().parent
TEMP_MEDIA_DIR = BASE_DIR / "temp_media"
TEMP_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
import hashlib

CACHE_MEDIA_DIR = (BASE_DIR.parent / "data" / "media_cache")
CACHE_MEDIA_DIR.mkdir(parents=True, exist_ok=True)



def check_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def probe_media_duration_seconds(media_path: Path) -> float:
    """Return duration of media file in seconds using ffprobe."""
    if not shutil.which("ffprobe"):
        return 0.0
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(media_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        return 0.0
    try:
        data = json.loads(proc.stdout)
        return float(data.get("format", {}).get("duration", 0.0))
    except (ValueError, TypeError, json.JSONDecodeError):
        return 0.0



def get_cached_youtube_media(youtube_url: str) -> Optional[Dict[str, Any]]:
    """Check if YouTube video has already been downloaded and cached locally."""
    url_hash = hashlib.sha256(youtube_url.strip().encode("utf-8")).hexdigest()[:16]
    meta_path = CACHE_MEDIA_DIR / f"yt_{url_hash}_meta.json"
    if meta_path.exists():
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            cached_vid = CACHE_MEDIA_DIR / meta.get("filename", "")
            if cached_vid.exists() and cached_vid.stat().st_size > 1024:
                # Copy/link to temp_media for current serving
                dest_path = TEMP_MEDIA_DIR / cached_vid.name
                if not dest_path.exists():
                    shutil.copy2(cached_vid, dest_path)
                return {
                    "session_id": meta.get("session_id", url_hash),
                    "video_path": dest_path,
                    "media_url": f"/media/{dest_path.name}",
                    "title": meta.get("title", f"YouTube_{url_hash}"),
                    "duration": float(meta.get("duration", 0.0)),
                    "webpage_url": youtube_url,
                    "from_cache": True
                }
        except Exception:
            pass
    return None

def download_youtube_media(youtube_url: str, session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Download best MP4 video up to 720p for local playback in the UI player,
    using the yt_dlp Python library directly for rich exception capture.
    """
    if yt_dlp is None:
        raise YtDlpDownloadError(
            "مكتبة yt-dlp غير مثبتة في بيئة بايثون. يرجى تشغيل: pip install yt-dlp"
        )

    cached = get_cached_youtube_media(youtube_url)
    if cached is not None:
        return cached

    sid = session_id or uuid.uuid4().hex[:10]
    out_tmpl = str(TEMP_MEDIA_DIR / f"yt_{sid}.%(ext)s")

    ydl_opts: Dict[str, Any] = {
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
        "merge_output_format": "mp4",
        "outtmpl": out_tmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=True)
            downloaded_path = Path(ydl.prepare_filename(info))
            # If merged to mp4, check .mp4 extension
            mp4_candidate = downloaded_path.with_suffix(".mp4")
            if mp4_candidate.exists():
                downloaded_path = mp4_candidate
            elif not downloaded_path.exists():
                matches = list(TEMP_MEDIA_DIR.glob(f"yt_{sid}.*"))
                if not matches:
                    raise YtDlpDownloadError(f"لم يتم العثور على الملف المحمّل من الرابط: {youtube_url}")
                downloaded_path = matches[0]

                        # Save to persistent cache
            try:
                url_hash = hashlib.sha256(youtube_url.strip().encode("utf-8")).hexdigest()[:16]
                cached_target = CACHE_MEDIA_DIR / f"yt_{url_hash}{downloaded_path.suffix}"
                shutil.copy2(downloaded_path, cached_target)
                meta_payload = {
                    "session_id": sid,
                    "filename": cached_target.name,
                    "title": info.get("title") or f"YouTube_{sid}",
                    "duration": float(info.get("duration") or probe_media_duration_seconds(downloaded_path)),
                    "webpage_url": youtube_url
                }
                with open(CACHE_MEDIA_DIR / f"yt_{url_hash}_meta.json", "w", encoding="utf-8") as mf:
                    json.dump(meta_payload, mf)
            except Exception:
                pass

            return {
                "session_id": sid,
                "video_path": downloaded_path,
                "media_url": f"/media/{downloaded_path.name}",
                "title": info.get("title") or f"YouTube_{sid}",
                "duration": float(info.get("duration") or probe_media_duration_seconds(downloaded_path)),
                "webpage_url": youtube_url,
            }
    except Exception as exc:
        if isinstance(exc, YtDlpDownloadError):
            raise
        raise YtDlpDownloadError(f"فشل تحميل فيديو يوتيوب عبر yt-dlp: {exc}") from exc


def normalize_audio_streams(input_media_path: Path, session_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Convert input video/audio into two standardized audio files:
    1. audio_16k.wav (16kHz, mono, PCM s16le) for local faster-whisper.
    2. audio_compressed.mp3 (16kHz, mono, 48kbps) for Groq Cloud API upload.
    """
    if not shutil.which("ffmpeg"):
        raise FFmpegProcessingError(
            "أداة FFmpeg غير مثبتة أو غير موجودة في PATH. يرجى تثبيت ffmpeg لاستخراج الصوت."
        )

    sid = session_id or uuid.uuid4().hex[:10]
    wav_path = TEMP_MEDIA_DIR / f"{sid}_audio_16k.wav"
    mp3_path = TEMP_MEDIA_DIR / f"{sid}_audio_compressed.mp3"

    # 1. Generate 16kHz mono PCM WAV for local faster-whisper
    wav_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_media_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(wav_path),
    ]
    wav_proc = subprocess.run(wav_cmd, capture_output=True, text=True, check=False)
    if wav_proc.returncode != 0 or not wav_path.exists():
        raise FFmpegProcessingError(
            f"فشل تحويل الصوت إلى WAV (16kHz mono): {wav_proc.stderr[-600:]}"
        )

    # 2. Generate 16kHz mono 48kbps MP3 for Groq Cloud API (keeps 1-hour lecture ~21MB < 25MB limit)
    mp3_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(wav_path),
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "48k",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(mp3_path),
    ]
    mp3_proc = subprocess.run(mp3_cmd, capture_output=True, text=True, check=False)
    if mp3_proc.returncode != 0 or not mp3_path.exists():
        raise FFmpegProcessingError(
            f"فشل ضغط الصوت إلى MP3 لواجهة Groq: {mp3_proc.stderr[-600:]}"
        )

    duration_sec = probe_media_duration_seconds(wav_path)
    mp3_size_mb = mp3_path.stat().st_size / (1024 * 1024)

    return {
        "session_id": sid,
        "wav_path": wav_path,
        "mp3_path": mp3_path,
        "duration_sec": duration_sec,
        "mp3_size_mb": round(mp3_size_mb, 2),
    }


def slice_audio_for_groq(
    mp3_path: Path,
    duration_sec: float,
    max_chunk_duration_sec: int = 2700,  # 45 minutes
    max_file_size_mb: float = 24.0,      # Safe margin under Groq's 25MB hard limit
) -> List[Dict[str, Any]]:
    """
    Slice long lectures (>45 minutes or >24MB) into sequential MP3 chunks
    so Groq's 25MB per-request limit is never exceeded, preserving exact time offsets.
    """
    file_size_mb = mp3_path.stat().st_size / (1024 * 1024)
    if duration_sec <= max_chunk_duration_sec and file_size_mb <= max_file_size_mb:
        return [
            {
                "chunk_index": 0,
                "path": mp3_path,
                "offset_sec": 0.0,
                "duration_sec": duration_sec,
            }
        ]

    # Determine safe segment time in seconds
    num_chunks_by_size = math.ceil(file_size_mb / 20.0)
    num_chunks_by_time = math.ceil(max(duration_sec, 1.0) / max_chunk_duration_sec)
    total_chunks = max(num_chunks_by_size, num_chunks_by_time, 2)
    chunk_len_sec = max(300, int(math.ceil(duration_sec / total_chunks)))

    chunk_prefix = mp3_path.stem
    chunk_pattern = TEMP_MEDIA_DIR / f"{chunk_prefix}_part_%03d.mp3"

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(mp3_path),
        "-f",
        "segment",
        "-segment_time",
        str(chunk_len_sec),
        "-c",
        "copy",
        str(chunk_pattern),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise FFmpegProcessingError(
            f"فشل تقسيم الملف الصوتي الطويل لواجهة Groq: {proc.stderr[-600:]}"
        )

    chunk_files = sorted(TEMP_MEDIA_DIR.glob(f"{chunk_prefix}_part_*.mp3"))
    if not chunk_files:
        raise FFmpegProcessingError("لم يتم إنتاج مقاطع الصوت المقسمة بواسطة FFmpeg.")

    chunks: List[Dict[str, Any]] = []
    running_offset = 0.0
    for idx, cpath in enumerate(chunk_files):
        cdur = probe_media_duration_seconds(cpath)
        chunks.append(
            {
                "chunk_index": idx,
                "path": cpath,
                "offset_sec": round(running_offset, 3),
                "duration_sec": round(cdur, 3),
            }
        )
        running_offset += cdur

    return chunks
