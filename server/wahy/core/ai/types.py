"""The words every provider shares: what a caller passes in (`Call`, `Item`), what comes back (`Answer`), and
the one error type (`AiError`). Also the small parsers that turn a model's reply into an `Answer`, the same
for every provider, so a verdict means the same thing whoever gave it.

    call = Call(purpose="verify", job_id=ctx.job_id, lecture_id=7, check=ctx.check)
    items = [Item(id="12", state=env["state"], questions=env["questions"]) for env in envelopes]
    answers = ai.verify("gemini", items, call=call)          # [Answer(item_id="12", verdict="CORRECT", ...)]
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

VERDICTS = ("CORRECT", "FALSE", "NOT_SURE")
BOUNDARIES = ("COMPLETE_SPAN", "MISSING_START", "MISSING_END", "MISSING_BOTH")
PURPOSES = ("verify", "teacher", "tafrigh", "transcribe", "chat", "test")


def _never_stop() -> None:
    return None


@dataclass
class Call:
    """Who is asking and why. Saved with every request (the telemetry screens group by it).

    `check()` is called before each request and during every wait: a job passes `ctx.check`, so pausing blocks
    there and cancelling raises there. `on_wait(seconds, reason)` is told about each wait (free-tier pacing, a
    429), so the web app can show a countdown."""

    purpose: str = "verify"
    job_id: str | None = None
    lecture_id: int | None = None
    check: Callable[[], None] = _never_stop
    on_wait: Callable[[float, str], None] | None = None


@dataclass(frozen=True)
class Item:
    """One thing to judge: an envelope (`state` + `questions`, built by the engine, ADR 0003) and the id the
    answer comes back under (a finding id, or a passage's first finding)."""

    id: str
    state: dict[str, Any]
    questions: dict[str, Any]


@dataclass
class Answer:
    """A verifier's structured answer for one item. `error` is set (and the rest empty) when the reply had no
    usable answer for this item; the other items of the same request can still be fine."""

    item_id: str
    verdict: str | None = None  # CORRECT | FALSE | NOT_SURE
    confidence: float | None = None
    probabilities: dict[str, float] | None = None  # the three verdicts, summing to 1
    boundary: str | None = None  # COMPLETE_SPAN | MISSING_START | MISSING_END | MISSING_BOTH
    boundary_confidence: float | None = None
    boundary_probabilities: dict[str, float] | None = None
    start_missing: float | None = None  # Laya envelope v2: P(the start is cut off)
    end_missing: float | None = None  # Laya envelope v2: P(the end is cut off)
    merge_suggestion: str | None = None
    merge_confidence: float | None = None
    merge_gap_type: str | None = None
    reason: str = ""
    provider: str = ""
    model: str = ""
    request_id: int | None = None  # the saved AI request that produced it
    error: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.error is None and self.verdict is not None


class AiError(RuntimeError):
    """A provider call failed. `fatal` means every other request would fail the same way (no key, a wrong key,
    an unknown model, no credit), so a verification pass should stop instead of trying the next finding.
    `status` is the HTTP status when there was one. Messages never contain a key."""

    def __init__(
        self, message: str, *, status: int | None = None, fatal: bool = False, request_id: int | None = None
    ):
        super().__init__(redact(message))
        self.status, self.fatal, self.request_id = status, fatal, request_id


# ---- secrets -----------------------------------------------------------------------------------------------

_SECRET = re.compile(
    r"(key=|x-goog-api-key[\"':\s=]+|bearer\s+)[A-Za-z0-9_\-.]{12,}|sk-or-v1-[A-Za-z0-9]{16,}"
    r"|gsk_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_\-]{20,}",
    re.I,
)


def redact(text: Any) -> str:
    """Remove anything that looks like an API key from a message or a saved payload."""
    return _SECRET.sub(lambda m: (m.group(1) + "***") if m.group(1) else "***", str(text))


# ---- reading model replies ---------------------------------------------------------------------------------

_ALIASES = {
    "TRUE": "CORRECT",
    "YES": "CORRECT",
    "QUOTE": "CORRECT",
    "NO": "FALSE",
    "INCORRECT": "FALSE",
    "UNSURE": "NOT_SURE",
    "UNCERTAIN": "NOT_SURE",
    "NOT SURE": "NOT_SURE",
    "NOT-SURE": "NOT_SURE",
}


def normalize_verdict(value: Any) -> str:
    """A model's verdict word → CORRECT | FALSE | NOT_SURE (anything unknown is NOT_SURE)."""
    word = str(value or "").strip().upper()
    return word if word in VERDICTS else _ALIASES.get(word, "NOT_SURE")


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def normalize_probabilities(verdict: str, probabilities: Any, confidence: float | None) -> dict[str, float]:
    """The three verdict probabilities, summing to 1. When the model gave none, the chosen verdict gets
    `confidence` (0.85 if missing) and the other two share the rest."""
    if isinstance(probabilities, dict):
        values = {k: _number(probabilities.get(k)) for k in VERDICTS}
        if all(v is not None and v >= 0 for v in values.values()):
            total = sum(v for v in values.values() if v is not None)
            if total > 0:
                return {k: float(values[k] or 0.0) / total for k in VERDICTS}
    c = min(1.0, max(0.0, confidence if confidence is not None else 0.85))
    return {k: (c if k == verdict else (1 - c) / 2) for k in VERDICTS}


def normalize_boundary(verdict: str, boundary: Any, state: dict[str, Any] | None) -> str:
    """The boundary a model reported, cleaned the way the old app did for every provider: a FALSE finding is
    complete (there is no quote to cut), and a missing start or end is dropped when the corpus has no words
    before or after the matched part (`unmatched_corpus_prefix_words` / `..._suffix_words` empty)."""
    if verdict == "FALSE":
        return "COMPLETE_SPAN"
    b = str(boundary or "COMPLETE_SPAN").strip().upper()
    if b not in BOUNDARIES:
        b = "COMPLETE_SPAN"
    state = state or {}
    has_prefix = bool(str(state.get("unmatched_corpus_prefix_words") or "").strip())
    has_suffix = bool(str(state.get("unmatched_corpus_suffix_words") or "").strip())
    if not has_prefix and b in ("MISSING_START", "MISSING_BOTH"):
        b = "MISSING_END" if b == "MISSING_BOTH" else "COMPLETE_SPAN"
    if not has_suffix and b in ("MISSING_END", "MISSING_BOTH"):
        b = "MISSING_START" if b == "MISSING_BOTH" else "COMPLETE_SPAN"
    return b


def answer_from_json(
    item: Item, data: dict[str, Any], *, provider: str, model: str, default_reason: str = ""
) -> Answer:
    """A flat JSON answer (Gemini, OpenRouter chat: {"verdict", "confidence", "probabilities",
    "boundary_status", ...}) → Answer."""
    verdict = normalize_verdict(data.get("verdict"))
    confidence = _number(data.get("confidence"))
    probabilities = normalize_probabilities(verdict, data.get("probabilities"), confidence)
    return Answer(
        item_id=item.id,
        verdict=verdict,
        confidence=confidence if confidence is not None else probabilities[verdict],
        probabilities=probabilities,
        boundary=normalize_boundary(verdict, data.get("boundary_status"), item.state),
        boundary_confidence=_number(data.get("boundary_confidence")),
        merge_suggestion=_text_or_none(data.get("merge_suggestion")),
        merge_confidence=_number(data.get("merge_confidence")),
        merge_gap_type=_text_or_none(data.get("merge_gap_type")),
        reason=str(data.get("reason") or default_reason),
        provider=provider,
        model=model,
    )


def answer_from_decisions(
    item: Item, answers: dict[str, Any], *, provider: str, model: str, reason: str = ""
) -> Answer:
    """A decisions-style answer (JEV, Laya: {"verdict": {"choice", "confidence", "probabilities"},
    "boundary_status": {...}, "start_missing": {"noul": p}, ...}) → Answer."""
    v = answers.get("verdict") if isinstance(answers.get("verdict"), dict) else {}
    verdict = normalize_verdict(v.get("choice"))
    confidence = _number(v.get("confidence"))
    probabilities = normalize_probabilities(verdict, v.get("probabilities"), confidence)
    b = answers.get("boundary_status") if isinstance(answers.get("boundary_status"), dict) else {}

    def yes(question: str) -> float | None:
        a = answers.get(question)
        return _number(a.get("noul")) if isinstance(a, dict) else None

    def choice(question: str) -> str | None:
        a = answers.get(question)
        return _text_or_none(a.get("choice")) if isinstance(a, dict) else None

    merge = answers.get("merge_suggestion") if isinstance(answers.get("merge_suggestion"), dict) else {}
    return Answer(
        item_id=item.id,
        verdict=verdict,
        confidence=confidence if confidence is not None else probabilities[verdict],
        probabilities=probabilities,
        boundary=normalize_boundary(verdict, b.get("choice"), item.state) if b else None,
        boundary_confidence=_number(b.get("confidence")),
        boundary_probabilities=b.get("probabilities") if isinstance(b.get("probabilities"), dict) else None,
        start_missing=yes("start_missing"),
        end_missing=yes("end_missing"),
        merge_suggestion=choice("merge_suggestion"),
        merge_confidence=_number(merge.get("confidence")),
        merge_gap_type=choice("merge_gap_type"),
        reason=reason,
        provider=provider,
        model=model,
    )


def _text_or_none(value: Any) -> str | None:
    return str(value) if isinstance(value, str) and value.strip() else None


def parse_model_json(text: str) -> Any:
    """The JSON in a model reply: plain, inside ```json fences, or surrounded by prose. None when there is
    none."""
    t = str(text or "").strip()
    attempts = [t]
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", t, re.I)
    if fenced:
        attempts.append(fenced.group(1))
    for open_, close in (("{", "}"), ("[", "]")):
        a, b = t.find(open_), t.rfind(close)
        if a >= 0 and b > a:
            attempts.append(t[a : b + 1])
    for candidate in attempts:
        try:
            value = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(value, dict | list):
            return value
    return None
