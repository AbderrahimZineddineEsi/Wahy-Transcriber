"""core/ai shared parts: reading model replies, retries and waits, the free-tier pacer, and the request log."""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
from ai_helpers import Waits, item

from wahy.core.ai.http import HttpSender, RetryPolicy, retry_after
from wahy.core.ai.log import RequestLog
from wahy.core.ai.models import AiRequest
from wahy.core.ai.pacer import Pacer
from wahy.core.ai.types import (
    AiError,
    Call,
    answer_from_decisions,
    answer_from_json,
    normalize_boundary,
    normalize_probabilities,
    normalize_verdict,
    parse_model_json,
    redact,
)
from wahy.core.jobs import JobCancelled

# ---- reading replies -------------------------------------------------------------------------------------------


def test_verdict_words_are_normalised():
    assert [normalize_verdict(v) for v in ("correct", "Yes", "INCORRECT", "unsure", "banana", None)] == [
        "CORRECT", "CORRECT", "FALSE", "NOT_SURE", "NOT_SURE", "NOT_SURE"]


def test_probabilities_sum_to_one_or_come_from_the_confidence():
    p = normalize_probabilities("FALSE", {"CORRECT": 2, "FALSE": 6, "NOT_SURE": 2}, None)
    assert p == {"CORRECT": 0.2, "FALSE": 0.6, "NOT_SURE": 0.2}
    p = normalize_probabilities("CORRECT", None, 0.8)
    assert p["CORRECT"] == 0.8 and p["FALSE"] == pytest.approx(0.1) and sum(p.values()) == pytest.approx(1)


def test_boundary_cleaning_matches_the_old_app():
    full = {"unmatched_corpus_prefix_words": "قال", "unmatched_corpus_suffix_words": "والله"}
    assert normalize_boundary("FALSE", "MISSING_END", full) == "COMPLETE_SPAN"      # no quote, nothing to cut
    assert normalize_boundary("CORRECT", "MISSING_BOTH", full) == "MISSING_BOTH"
    assert normalize_boundary("CORRECT", "MISSING_BOTH", {"unmatched_corpus_suffix_words": "x"}) == "MISSING_END"
    assert normalize_boundary("CORRECT", "MISSING_START", {}) == "COMPLETE_SPAN"     # the corpus has no words before
    assert normalize_boundary("CORRECT", "nonsense", full) == "COMPLETE_SPAN"


def test_json_is_found_in_fences_and_prose():
    assert parse_model_json('```json\n{"verdict": "FALSE"}\n```') == {"verdict": "FALSE"}
    assert parse_model_json('Here you go: {"a": 1} hope it helps') == {"a": 1}
    assert parse_model_json('[{"finding_id": "1"}]') == [{"finding_id": "1"}]
    assert parse_model_json("no json here") is None


def test_flat_and_decision_answers_become_the_same_answer():
    it = item("7")
    flat = answer_from_json(it, {"verdict": "correct", "confidence": 0.9, "boundary_status": "MISSING_END",
                                 "reason": "تلاوة"}, provider="gemini", model="m")
    assert (flat.verdict, flat.boundary, flat.reason, flat.ok) == ("CORRECT", "MISSING_END", "تلاوة", True)
    decided = answer_from_decisions(it, {"verdict": {"choice": "CORRECT", "confidence": 0.9},
                                         "start_missing": {"noul": 0.2}, "end_missing": {"noul": 0.7}},
                                    provider="laya", model="ckpt")
    assert decided.verdict == "CORRECT" and (decided.start_missing, decided.end_missing) == (0.2, 0.7)
    assert decided.boundary is None                    # a verdict-only model gives no boundary


def test_keys_are_redacted():
    text = "GET ?key=AIzaSyA1234567890abcdefghijklmn Bearer sk-or-v1-abcdefabcdef1234567890 gsk_abcdefghijklmnop1234"
    out = redact(text)
    assert "AIza" not in out and "sk-or-v1-abc" not in out and "gsk_abc" not in out


# ---- retries and waits ------------------------------------------------------------------------------------------


def test_retry_after_reads_seconds_dates_and_google_retry_info():
    assert retry_after(httpx.Response(429, headers={"retry-after": "12"})) == 12.0
    now = datetime(2026, 11, 6, 12, 0, 0, tzinfo=UTC)
    dated = httpx.Response(503, headers={"retry-after": "Fri, 06 Nov 2026 12:00:30 GMT"})
    assert retry_after(dated, now=lambda: now) == 30.0
    body = {"error": {"details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "7s"}]}}
    assert retry_after(httpx.Response(429, json=body)) == 7.0
    assert retry_after(httpx.Response(500, text="oops")) is None


def sender(handler, db=None, waits=None):
    return HttpSender(RequestLog(db), provider="test", transport=httpx.MockTransport(handler),
                      sleep=(waits or Waits()).sleep)


def test_busy_answers_and_dropped_connections_are_retried_with_backoff(db):
    answers = [httpx.ConnectError("reset"), httpx.Response(503, text="busy"), httpx.Response(200, json={"x": 1})]

    def handler(_r):
        a = answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a

    waits = Waits()
    reply = sender(handler, db, waits).post("https://x", json={"q": 1}, call=waits.call(), model="m",
                                            policy=RetryPolicy(attempts=3, delays=(2.0, 4.0)))
    assert reply.response.json() == {"x": 1} and reply.attempts == 3
    assert waits.total == 6.0 and [round(s) for s, _ in waits.announced] == [2, 4]
    with db.session() as s:
        failed = s.query(AiRequest).all()
    assert [r.ok for r in failed] == [False, False]                  # both failed attempts are in the log
    assert "connection failed" in failed[0].error and failed[1].response == {"text": "busy"}


def test_a_wrong_key_is_not_retried_and_giving_up_is_clear():
    calls = []
    reply = sender(lambda r: calls.append(r) or httpx.Response(401, text="bad key")).post(
        "https://x", json={}, call=Call(), model="m", policy=RetryPolicy(attempts=4))
    assert reply.response.status_code == 401 and len(calls) == 1      # the provider decides what 401 means

    with pytest.raises(AiError, match=r"rate limit \(HTTP 429\) was still hit after 3 attempts") as e:
        sender(lambda r: httpx.Response(429, text="slow")).post("https://x", json={}, call=Call(), model="m",
                                                               policy=RetryPolicy(attempts=3))
    assert e.value.status == 429


def test_a_cancel_during_a_wait_stops_at_once():
    checks = []

    def check():
        checks.append(1)
        if len(checks) > 3:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        sender(lambda r: httpx.Response(429, headers={"retry-after": "60"})).post(
            "https://x", json={}, call=Call(check=check), model="m", policy=RetryPolicy(attempts=5))
    assert len(checks) == 4                       # stopped a few seconds into the 60 s wait


# ---- the free-tier pacer ----------------------------------------------------------------------------------------


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def test_pacer_never_lets_more_than_the_limit_through_in_any_minute():
    """F-081: at 5 requests a minute, 20 requests never put more than 5 in any 60-second window."""
    clock = FakeClock()
    pacer = Pacer(clock=clock)
    starts, waits = [], []
    for _ in range(20):
        pacer.take(limit=5, call=Call(on_wait=lambda s, why: waits.append(why)), sleep=clock.sleep)
        starts.append(clock.t)
    for t in starts:
        assert sum(1 for u in starts if t <= u < t + 60) <= 5
    assert starts[-1] - starts[0] >= 3 * 60                  # 20 requests at 5 a minute take at least 3 minutes
    assert waits and "at most 5 requests a minute" in waits[0]


# ---- the request log --------------------------------------------------------------------------------------------


def test_the_log_saves_payloads_without_keys_and_drops_unknown_links(db):
    log = RequestLog(db)
    rid = log.save(provider="gemini", model="m", call=Call(purpose="verify", job_id="nope", lecture_id=99), ok=True,
                   request={"headers": {"x-goog-api-key": "AIzaSyA1234567890abcdefghijklmn"}, "n": 1},
                   response={"ok": 1}, input_tokens=10, output_tokens=2, cost_usd=0.001, latency_ms=50)
    with db.session() as s:
        row = s.get(AiRequest, rid)
        assert (row.job_id, row.lecture_id, row.purpose, row.cost_usd) == (None, None, "verify", 0.001)
        assert "AIza" not in str(row.request) and row.request["n"] == 1
    assert RequestLog(None).save(provider="x", model="m", call=Call(), ok=True, request={}) is None


def test_the_log_links_a_real_job(db, runner):
    runner.register("noop", lambda ctx: None)
    job = runner.submit("noop", {})
    rid = RequestLog(db).save(provider="fake", model="m", call=Call(job_id=job.id), ok=True, request={})
    with db.session() as s:
        assert s.get(AiRequest, rid).job_id == job.id
