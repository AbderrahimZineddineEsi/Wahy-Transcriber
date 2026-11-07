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

    def __init__(self, finder=None, enveloper=None):
        # finder(words, options) → findings; the default finds nothing
        self.finder = finder or (lambda words, options: [])
        # enveloper(findings, words, version, options) → envelopes; the default: fake_envelopes
        self.enveloper = enveloper or fake_envelopes
        self.detect_calls: list[tuple[list, dict]] = []
        self.search_calls: list[tuple[str, dict]] = []
        self.envelope_calls: list[tuple[int, dict]] = []
        self.rule_calls: list[list[dict]] = []
        self.hadiths: Path | None = None
        self.closed = 0

    def detect(self, words, options=None):
        self.detect_calls.append((words, options or {}))
        return self.finder(words, options or {})

    def envelopes(self, findings, words, version, options=None):
        self.envelope_calls.append((version, options or {}))
        return self.enveloper(findings, words, version, options or {})

    def rule_boundary(self, states):
        self.rule_calls.append(states)
        return [{"start": int(bool(s.get("prefix_words_heard"))), "end": int(bool(s.get("suffix_words_heard")))}
                for s in states]

    def search(self, text, options=None):
        self.search_calls.append((text, options or {}))
        return [{"unitId": "112:1", "sourceType": "QURAN", "displayRef": "الإخلاص: 1", "fullText": "قل هو الله أحد"}]

    def browse(self, options):
        self.browse_calls = [*getattr(self, "browse_calls", []), options]
        return {"total": 1, "items": [{"id": "18:26", "ref": "الكهف: 26", "text": "قل الله أعلم", "group": "الكهف"}],
                "groups": {"18": ["الكهف", 110]}}

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


def fake_envelopes(findings, words, version, options):
    """Envelopes as the engine shapes them, from the finding's own fields: one per target, or one per run of
    findings that share `data["passage"]` when passages are on. A finding's `prefix` / `suffix` say whether the
    corpus has words before / after the matched part (so a missing start or end can stand)."""
    targets = options.get("targets")
    targets = set(range(len(findings))) if targets is None else set(targets)
    groups: list[list[int]] = []
    for i, f in enumerate(findings):
        if options.get("passages") and groups and f.get("passage") and findings[groups[-1][-1]].get("passage") == \
                f.get("passage"):
            groups[-1].append(i)
        else:
            groups.append([i])
    out = []
    for g in groups:
        if not targets & set(g):
            continue
        first, last = findings[g[0]], findings[g[-1]]
        state = {"source_type": first.get("sourceType"), "candidate_reference": first.get("displayRef"),
                 "matched_span_in_lecture": " ".join(w["word"] for w in words[first["wordStartIdx"]:
                                                                              last["wordEndIdx"] + 1]),
                 "unmatched_corpus_prefix_words": first.get("prefix", ""),
                 "unmatched_corpus_suffix_words": last.get("suffix", ""),
                 "engine_score": 12.0, "engine_confidence_band": "HIGH"}
        if version > 1:
            state["prefix_words_heard"] = first.get("heard_start", "")
            state["suffix_words_heard"] = last.get("heard_end", "")
        questions = {"verdict": {"type": "choice", "instructions": "Is it a quote?",
                                 "criteria": {"CORRECT": "a quote", "FALSE": "speech", "NOT_SURE": "unsure"}}}
        if version == 1:
            questions["boundary_status"] = {"type": "choice", "instructions": "Is it whole?", "criteria": {}}
        else:
            questions["start_missing"] = {"type": "yes_no"}
            questions["end_missing"] = {"type": "yes_no"}
        env = {"members": g, "state": state, "questions": questions}
        if version == 1:
            env["merge"] = first.get("merge")
        if version == 3:
            env["boundaryByRule"] = {"start": int(bool(state["prefix_words_heard"])),
                                     "end": int(bool(state["suffix_words_heard"]))}
        out.append(env)
    return out
