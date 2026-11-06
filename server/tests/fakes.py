"""Fakes for the outside world: speech recognition, the YouTube downloader, and small real audio files made with
ffmpeg (so the audio code is tested for real, without any model or network)."""

from __future__ import annotations

import shutil
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

from wahy.features.lectures.media import Downloaded
from wahy.features.transcription.audio import PreparedAudio
from wahy.features.transcription.backends import AsrError, RawWord


def make_audio(path: Path, seconds: float = 3.0, frequency: int = 440) -> Path:
    """A real sine-wave audio file (format from the suffix: .mp3, .wav, .m4a ...)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency={frequency}:duration={seconds}", str(path)], check=True)
    return path


def sample_words(n: int = 6, start: float = 0.0) -> list[RawWord]:
    return [RawWord(f"كلمة{i}", start + i * 0.5, start + i * 0.5 + 0.4) for i in range(n)]


class FakeAsr:
    """Stands in for one recogniser. Records what it was asked, and can fail or wait."""

    def __init__(self, id: str, label: str | None = None, words: list[RawWord] | None = None, *,
                 error: str | None = None, steps: int = 3, step_delay: float = 0.0):
        self.id, self.label = id, label or f"fake:{id}"
        self.words = words if words is not None else sample_words()
        self.error, self.steps, self.step_delay = error, steps, step_delay
        self.calls = 0
        self.audio_seconds: list[float] = []

    def transcribe(self, audio: PreparedAudio, *, on_percent: Callable[[float], None],
                   check: Callable[[], None], call=None) -> list[RawWord]:
        self.calls += 1
        self.audio_seconds.append(audio.duration_s)
        if self.error:
            raise AsrError(self.error)
        for i in range(self.steps):
            check()
            on_percent(100 * (i + 1) / self.steps)
            if self.step_delay:
                time.sleep(self.step_delay)
        return list(self.words)


class FakeYoutube:
    """The downloader: copies a prepared audio file into place instead of calling yt-dlp."""

    def __init__(self, source: Path, title: str = "خطبة الجمعة", duration: float = 3.0):
        self.source, self.title, self.duration = source, title, duration
        self.calls: list[str] = []

    def __call__(self, url: str, dest_stem: Path, on_progress: Callable[[float], None]) -> Downloaded:
        self.calls.append(url)
        on_progress(10.0)
        target = dest_stem.with_suffix(self.source.suffix)
        shutil.copy(self.source, target)
        on_progress(90.0)
        return Downloaded(target, self.title, self.duration)


class FakeEngine:
    """Stands in for the engine worker (core/engine.py): records what it was asked and answers from a function,
    so the services can be tested without Node or the corpus."""

    def __init__(self, finder=None):
        # finder(words, options) → findings; the default finds nothing
        self.finder = finder or (lambda words, options: [])
        self.detect_calls: list[tuple[list, dict]] = []
        self.search_calls: list[tuple[str, dict]] = []
        self.hadiths: Path | None = None
        self.closed = 0

    def detect(self, words, options=None):
        self.detect_calls.append((words, options or {}))
        return self.finder(words, options or {})

    def search(self, text, options=None):
        self.search_calls.append((text, options or {}))
        return [{"unitId": "112:1", "sourceType": "QURAN", "displayRef": "الإخلاص: 1", "fullText": "قل هو الله أحد"}]

    def info(self):
        return {"quran": 6236, "hadiths": 39737, "fingerprint": {"files": {}, "corpus": {}}}

    def use_hadiths(self, path):
        changed = (Path(path) if path else None) != self.hadiths
        self.hadiths = Path(path) if path else None
        return changed

    def close(self):
        self.closed += 1


def make_finding(start: int, end: int, *, unit: str = "112:1", source: str = "QURAN") -> dict:
    """The few fields of an engine finding that the detection feature reads, plus an extra one that must survive."""
    return {"id": f"finding_{start}", "sourceType": source, "unitId": unit, "displayRef": f"ref {unit}",
            "wordStartIdx": start, "wordEndIdx": end, "segments": [[start, end + 1]], "evidence": {"S": 1.5}}
