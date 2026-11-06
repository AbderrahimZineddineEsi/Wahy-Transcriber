"""Getting a lecture's audio ready for speech recognition, with ffmpeg.

    audio = AudioTools().prepare(media_file, work_dir, check=ctx.check)
    audio.duration_s
    audio.array()          # float32 samples, 16 kHz mono: what faster-whisper and the specialized model take
    audio.groq_chunks()    # MP3 pieces under Groq's 25 MB upload limit, each with its time offset

Why an array and not a file path: faster-whisper decodes a path with PyAV and calls
`av.open(metadata_errors=...)`, which PyAV 19 removed, so a path crashes it (the old app hit this on
2026-11-06). The WAV we write is already 16 kHz mono, so we read the samples ourselves with the standard
`wave` module.

ffmpeg runs as a child process that is polled, so a cancelled job kills it instead of waiting for it to end.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import wave
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
GROQ_MAX_CHUNK_S = 2700          # 45 minutes
GROQ_MAX_FILE_MB = 24.0          # Groq's hard limit is 25 MB
GROQ_MIN_PIECE_S = 300           # never cut into pieces shorter than 5 minutes


class AudioError(RuntimeError):
    """ffmpeg or ffprobe is missing or failed (the job fails with this message)."""


@dataclass(frozen=True)
class Chunk:
    path: Path
    offset_s: float
    duration_s: float


def _run(cmd: list[str], check: Callable[[], None]) -> str:
    """Run a command and return its output; stops it if `check` raises (the job was cancelled)."""
    check()
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise AudioError(f"{cmd[0]} is not installed or not on PATH") from None
    try:
        while True:
            try:
                out, err = proc.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                check()
    except BaseException:
        proc.kill()
        proc.communicate()
        raise
    if proc.returncode != 0:
        raise AudioError(f"{cmd[0]} failed: {err.strip()[-600:]}")
    return out


class PreparedAudio:
    def __init__(self, wav_path: Path, duration_s: float, tools: AudioTools, check: Callable[[], None]):
        self.wav_path = wav_path
        self.duration_s = duration_s
        self._tools = tools
        self._check = check
        self._array: np.ndarray | None = None
        self._chunks: list[Chunk] | None = None

    def array(self) -> np.ndarray:
        if self._array is None:
            self._array = load_wav_array(self.wav_path)
        return self._array

    def groq_chunks(self) -> list[Chunk]:
        if self._chunks is None:
            self._chunks = self._tools.mp3_chunks(self.wav_path, self.duration_s, self._check)
        return self._chunks


class AudioTools:
    def probe_duration(self, path: Path) -> float:
        out = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                   lambda: None)
        try:
            return float(json.loads(out)["format"]["duration"])
        except (KeyError, ValueError, TypeError):
            raise AudioError(f"could not read the duration of {path.name}: is it an audio or video file?") \
                from None

    def prepare(self, media: Path, work_dir: Path, check: Callable[[], None] = lambda: None) -> PreparedAudio:
        """Extract the audio of `media` as a 16 kHz mono WAV in `work_dir`."""
        work_dir.mkdir(parents=True, exist_ok=True)
        wav = work_dir / "audio_16k.wav"
        _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(media), "-vn",
              "-acodec", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", str(wav)], check)
        if not wav.exists():
            raise AudioError(f"ffmpeg produced no audio for {media.name}")
        return PreparedAudio(wav, self.probe_duration(wav), self, check)

    def mp3_chunks(self, wav: Path, duration_s: float, check: Callable[[], None]) -> list[Chunk]:
        """The audio as MP3 (16 kHz mono 48 kbps, about 21 MB an hour), cut into pieces when it would not fit
        one Groq upload. Each piece keeps its start time, so its words go back on the lecture's clock."""
        mp3 = wav.with_name("audio_48k.mp3")
        _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
              "-codec:a", "libmp3lame", "-b:a", "48k", "-ar", str(SAMPLE_RATE), "-ac", "1", str(mp3)], check)
        size_mb = mp3.stat().st_size / (1024 * 1024)
        if duration_s <= GROQ_MAX_CHUNK_S and size_mb <= GROQ_MAX_FILE_MB:
            return [Chunk(mp3, 0.0, duration_s)]
        count = max(math.ceil(size_mb / 20.0), math.ceil(max(duration_s, 1.0) / GROQ_MAX_CHUNK_S), 2)
        piece_s = max(GROQ_MIN_PIECE_S, math.ceil(duration_s / count))
        _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp3),
              "-f", "segment", "-segment_time", str(piece_s), "-c", "copy",
              str(wav.with_name("part_%03d.mp3"))], check)
        chunks, offset = [], 0.0
        for path in sorted(wav.parent.glob("part_*.mp3")):
            length = self.probe_duration(path)
            chunks.append(Chunk(path, round(offset, 3), length))
            offset += length
        if not chunks:
            raise AudioError("ffmpeg produced no audio pieces")
        return chunks


def load_wav_array(path: Path) -> np.ndarray:
    """A 16 kHz mono 16-bit WAV as float32 samples in [-1, 1]."""
    with wave.open(str(path), "rb") as wf:
        if (wf.getframerate(), wf.getnchannels(), wf.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise AudioError(f"{path.name} is not 16 kHz mono 16-bit audio")
        pcm = wf.readframes(wf.getnframes())
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def remove_tree(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
