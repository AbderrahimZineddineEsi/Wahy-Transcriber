"""Teachers are verifiers of the app's provider layer (ADR 0004): their requests go through core/ai, are saved in the
request log as purpose "teacher", and their answers are cached so a card is never paid for twice."""

from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import select

from wahy.core.ai.models import AiRequest
from wahy.core.ai.types import AiError
from wahy.laya.teachers.base import OLD_PROMPT_VERSION, PROMPT_VERSION
from wahy.laya.teachers.fake import FakeTeacher
from wahy.laya.teachers.gemini import SYSTEM as GEMINI_SYSTEM
from wahy.laya.teachers.gemini import GeminiTeacher
from wahy.laya.teachers.jev import JevTeacher


def env(i: int) -> dict:
    return {"state": {"source_type": "QURAN", "candidate_reference": f"البقرة: {i}",
                      "matched_span_in_lecture": "بسم الله", "unmatched_corpus_prefix_words": "",
                      "unmatched_corpus_suffix_words": "الرحمن"},
            "questions": {"verdict": {"type": "choice", "criteria": {"CORRECT": "a", "FALSE": "b", "NOT_SURE": "c"}}}}


def requests_logged(db) -> list[AiRequest]:
    with db.session() as s:
        return list(s.scalars(select(AiRequest).order_by(AiRequest.id)))


def test_fake_teacher_labels_cards_through_core_ai_and_caches_them(laya_core):
    t = FakeTeacher()
    envs = [env(i) for i in range(5)]
    first = t.predict(envs)
    assert [a["verdict"] for a in first] == ["CORRECT"] * 5
    assert all(set(a) >= {"verdict", "probs", "boundary", "reason", "cost", "latency_ms", "model"} for a in first)
    assert abs(sum(first[0]["probs"].values()) - 1) < 1e-9
    logged = requests_logged(laya_core["db"])
    assert [(r.provider, r.purpose) for r in logged] == [("fake", "teacher")] * 5
    # asked again: every answer from the cache, nothing sent
    assert t.predict(envs) == first
    assert len(requests_logged(laya_core["db"])) == 5


def test_cache_keys_keep_old_answers_apart_from_new_ones(laya_core):
    t = FakeTeacher()
    assert t.prompt_version == PROMPT_VERSION != OLD_PROMPT_VERSION
    old_key = __import__("wahy.laya.cache", fromlist=["sha"]).sha(t.name, t.model, OLD_PROMPT_VERSION,
                                                                     env(1)["state"], env(1)["questions"])
    assert t.key(env(1)) != old_key


def gemini_reply(request: httpx.Request) -> httpx.Response:
    """Gemini's generateContent answer for every item of the batch: the first is not a quote."""
    body = json.loads(request.content)
    items = json.loads(body["contents"][0]["parts"][0]["text"].split("\n\n", 1)[1])
    rows = [{"finding_id": it["finding_id"], "verdict": "FALSE" if i == 0 else "CORRECT", "confidence": 0.8,
             "probabilities": {"CORRECT": 0.1, "FALSE": 0.8, "NOT_SURE": 0.1} if i == 0 else
             {"CORRECT": 0.8, "FALSE": 0.1, "NOT_SURE": 0.1},
             "boundary_status": "MISSING_START", "reason": "سبب"} for i, it in enumerate(items)]
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(rows)}]}}],
                                     "usageMetadata": {"promptTokenCount": 900, "candidatesTokenCount": 120}})


def test_gemini_teacher_sends_one_batch_with_its_own_prompt(laya_core):
    sent: list[httpx.Request] = []

    def handler(request):
        sent.append(request)
        return gemini_reply(request)

    laya_core["make"](httpx.MockTransport(handler))
    answers = GeminiTeacher().predict([env(i) for i in range(5)])
    assert len(sent) == 1                                          # 5 cards = one free-tier request
    body = json.loads(sent[0].content)
    assert body["systemInstruction"]["parts"][0]["text"].startswith(GEMINI_SYSTEM)
    assert "key=" not in str(sent[0].url)                          # the key is a header (core/ai), never in the URL
    assert [a["verdict"] for a in answers] == ["FALSE"] + ["CORRECT"] * 4
    # core/ai's boundary clean-up: no corpus words before the span, so the start cannot be missing
    assert {a["boundary"] for a in answers} == {"COMPLETE_SPAN"}
    assert all(a["cost"] == 0.0 for a in answers)                  # free tier
    [logged] = requests_logged(laya_core["db"])
    assert (logged.provider, logged.purpose, logged.ok, logged.input_tokens) == ("gemini", "teacher", True, 900)


def test_jev_teacher_keeps_the_cost_core_ai_logged(laya_core):
    def handler(request):
        return httpx.Response(200, json={"model": "typesafe/jev-1.14", "usage": {"cost": 0.00002, "input_tokens": 400},
                                         "answers": {"verdict": {"choice": "NOT_SURE", "probabilities": {
                                             "CORRECT": 0.3, "FALSE": 0.2, "NOT_SURE": 0.5}}}})

    laya_core["make"](httpx.MockTransport(handler))
    [a] = JevTeacher().predict([env(1)])
    assert a["verdict"] == "NOT_SURE" and a["probs"]["NOT_SURE"] == pytest.approx(0.5)
    assert a["cost"] == pytest.approx(0.00002)
    [logged] = requests_logged(laya_core["db"])
    assert (logged.provider, logged.purpose) == ("jev", "teacher")


def test_a_failed_card_raises_and_caches_nothing(laya_core):
    laya_core["make"](httpx.MockTransport(lambda r: httpx.Response(400, json={"error": {"message": "API key not valid"}})))
    t = GeminiTeacher()
    with pytest.raises(AiError, match="key"):
        t.predict([env(1)])
    assert t.cache.get(t.key(env(1))) is None
