"""Gemini through core/ai, against recorded replies: batches, the key in a header, answers matched by id, cost,
the free-tier pacer, 429 with RetryInfo (F-094), and the model list (F-081)."""

from __future__ import annotations

import json

import httpx
import pytest
from ai_helpers import Replay, Waits, item, ok, recorded

from wahy.core.ai.gemini import GeminiOptions, GeminiProvider, pick_model, price
from wahy.core.ai.log import RequestLog
from wahy.core.ai.models import AiRequest
from wahy.core.ai.pacer import Pacer
from wahy.core.ai.types import AiError, Call

KEY = "AIzaSyA1234567890abcdefghijklmn"


def gemini(replay, db=None, waits=None, key=KEY):
    return GeminiProvider(RequestLog(db), lambda: key, transport=replay.transport,
                          sleep=(waits or Waits()).sleep, pacer=Pacer())


def answer_for(ids):
    """A recorded reply re-labelled for the batch it answers (the first ids get the recorded answers)."""
    def handler(request):
        data = recorded("gemini_generate_ok")
        rows = json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
        sent = json.loads(json.loads(request.content)["contents"][0]["parts"][0]["text"].split("\n\n", 1)[1])
        out = [dict(rows[i % 2], finding_id=s["finding_id"]) for i, s in enumerate(sent) if s["finding_id"] in ids]
        data["candidates"][0]["content"]["parts"][0]["text"] = json.dumps(out, ensure_ascii=False)
        return httpx.Response(200, json=data)
    return handler


def test_a_batch_is_one_request_with_the_key_in_a_header_and_answers_by_id(db):
    replay = Replay(ok("gemini_generate_ok"))
    answers = gemini(replay, db).verify([item("f1"), item("f2")], call=Call(lecture_id=None),
                                        options=GeminiOptions(free_tier=False))
    req = replay.requests[0]
    assert req.headers["x-goog-api-key"] == KEY and "key=" not in str(req.url)
    assert str(req.url).endswith("/models/gemini-3.5-flash-lite:generateContent")
    body = replay.body()
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["responseSchema"]["type"] == "ARRAY"
    assert "Write the `reason` field in Arabic, one short sentence." in body["systemInstruction"]["parts"][0]["text"]

    a, b = answers
    assert (a.item_id, a.verdict, a.boundary, a.probabilities["CORRECT"]) == ("f1", "CORRECT", "MISSING_END", 0.93)
    assert (b.item_id, b.verdict, b.boundary) == ("f2", "FALSE", "COMPLETE_SPAN")   # FALSE: nothing is cut
    assert a.request_id == b.request_id is not None
    with db.session() as s:
        row = s.get(AiRequest, a.request_id)
        assert (row.ok, row.input_tokens, row.output_tokens) == (True, 1834, 212)
        assert row.cost_usd == pytest.approx(price("gemini-3.5-flash-lite", 1834, 212))
        assert KEY not in json.dumps(row.request) and row.request["model"] == "gemini-3.5-flash-lite"


def test_items_go_in_batches_of_5_to_10():
    ids = [f"f{i}" for i in range(12)]
    replay = Replay(*[answer_for(ids)] * 3)
    answers = gemini(replay).verify([item(i) for i in ids], call=Call(), options=GeminiOptions(batch_size=3))
    sizes = [len(json.loads(json.loads(r.content)["contents"][0]["parts"][0]["text"].split("\n\n", 1)[1]))
             for r in replay.requests]
    assert sizes == [5, 5, 2]                          # 3 is raised to the minimum of 5
    assert [a.item_id for a in answers] == ids and all(a.ok for a in answers)

    replay = Replay(*[answer_for(ids)] * 2)
    gemini(replay).verify([item(i) for i in ids], call=Call(), options=GeminiOptions(batch_size=50))
    assert len(replay.requests) == 2                   # 50 is lowered to the maximum of 10


def test_an_item_missing_from_the_reply_gets_an_error_answer():
    replay = Replay(answer_for({"f1"}))
    a, b = gemini(replay).verify([item("f1"), item("f9")], call=Call())
    assert a.ok and not b.ok and "no answer" in b.error


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def test_the_free_tier_costs_nothing_and_is_paced(db):
    ids = [f"f{i}" for i in range(6)]
    replay = Replay(answer_for(ids), answer_for(ids))
    clock, announced = Clock(), []
    provider = GeminiProvider(RequestLog(db), lambda: KEY, transport=replay.transport, sleep=clock.sleep,
                              pacer=Pacer(clock=clock))
    call = Call(on_wait=lambda s, why: announced.append((round(s, 1), why)))
    provider.verify([item(i) for i in ids], call=call, options=GeminiOptions(free_tier=True, rpm=1))
    assert len(replay.requests) == 2
    assert announced == [(60.5, "free tier: at most 1 requests a minute")]   # the 2nd batch waited a minute
    with db.session() as s:
        assert [r.cost_usd for r in s.query(AiRequest)] == [0.0, 0.0]


def test_a_recorded_429_waits_for_retry_info_and_then_succeeds(db):
    """F-094: with a recorded 429 the pass waits (RetryInfo 7 s + 1.5 s) and then succeeds."""
    replay = Replay(ok("gemini_429", 429), ok("gemini_generate_ok"))
    waits = Waits()
    answers = gemini(replay, db, waits).verify([item("f1"), item("f2")], call=waits.call(),
                                               options=GeminiOptions(free_tier=False))
    assert [a.verdict for a in answers] == ["CORRECT", "FALSE"]
    assert waits.total == 8.5 and "429" in waits.announced[0][1]
    with db.session() as s:
        assert [r.ok for r in s.query(AiRequest).order_by(AiRequest.id)] == [False, True]


def test_too_many_429s_stop_with_a_clear_message():
    replay = Replay(*[ok("gemini_429", 429)] * 5)
    waits = Waits()
    with pytest.raises(AiError, match="still hit after 5 attempts"):
        gemini(replay, waits=waits).verify([item("f1")], call=waits.call(), options=GeminiOptions(free_tier=False))
    assert len(replay.requests) == 5 and waits.total == 4 * 8.5


def test_a_bad_key_or_no_key_is_fatal():
    with pytest.raises(AiError, match="refused the key") as e:
        gemini(Replay(ok("gemini_400_bad_key", 400))).verify([item("f1")], call=Call())
    assert e.value.fatal and e.value.request_id is None
    replay = Replay()
    with pytest.raises(AiError, match="no Gemini API key") as e:
        gemini(replay, key=None).verify([item("f1")], call=Call())
    assert e.value.fatal and not replay.requests


def test_a_reply_that_is_not_json_is_an_error_and_is_logged(db):
    data = recorded("gemini_generate_ok")
    data["candidates"][0]["content"]["parts"][0]["text"] = "I cannot help with that"
    with pytest.raises(AiError, match="not JSON") as e:
        gemini(Replay(httpx.Response(200, json=data)), db).verify([item("f1")], call=Call())
    with db.session() as s:
        row = s.get(AiRequest, e.value.request_id)
        assert row.ok is False and row.input_tokens == 1834


def test_the_models_a_key_can_call_and_the_recommended_one():
    replay = Replay(ok("gemini_models"))
    names = gemini(replay).list_models()
    assert names == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-preview-tts"]
    assert replay.requests[0].headers["x-goog-api-key"] == KEY
    assert pick_model(names) == "gemini-3.5-flash-lite"
    assert pick_model(names, "gemini-3.1-flash-lite") == "gemini-3.1-flash-lite"
    assert pick_model(["gemini-3.5-flash-preview-tts"]) is None
