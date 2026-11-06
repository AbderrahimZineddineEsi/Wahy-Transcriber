"""Real provider replies, saved from the live check on 2026-11-06 (tests/fixtures/ai/real_*.json), played back
through each provider: the parsers must read what the services really send, not only the documented shapes."""

from __future__ import annotations

import httpx
import pytest
from ai_helpers import Replay, Waits, recorded
from test_ai_groq_laya import Loads, laya_with

from wahy.core.ai.gemini import GeminiOptions, GeminiProvider
from wahy.core.ai.log import RequestLog
from wahy.core.ai.models import AiRequest
from wahy.core.ai.openrouter import Catalog, ChatOptions, JevProvider, OpenRouterChatProvider
from wahy.core.ai.pacer import Pacer
from wahy.core.ai.types import Call, Item


def test_a_real_gemini_reply(db):
    rec = recorded("real_gemini")
    payload = rec["request"]["contents"][0]["parts"][0]["text"]
    assert '"finding_id": "live-1"' in payload
    it = Item("live-1", {"unmatched_corpus_prefix_words": "قال", "unmatched_corpus_suffix_words": "والله"}, {})
    replay = Replay(httpx.Response(200, json=rec["response"]))
    provider = GeminiProvider(RequestLog(db), lambda: "AIza" + "k" * 30, transport=replay.transport,
                              sleep=Waits().sleep, pacer=Pacer())
    (a,) = provider.verify([it], call=Call(), options=GeminiOptions(free_tier=True))
    assert (a.verdict, a.probabilities["CORRECT"], a.boundary) == ("CORRECT", 0.99, "COMPLETE_SPAN")
    assert a.reason == "المتكلم قرأ البسملة كاملة وصحيحة."
    with db.session() as s:
        row = s.get(AiRequest, a.request_id)
        assert (row.input_tokens, row.output_tokens, row.cost_usd) == (852, 119, 0.0)


def test_a_real_jev_reply(db):
    rec = recorded("real_jev")
    it = Item("live-1", rec["request"]["state"], rec["request"]["questions"])
    replay = Replay(httpx.Response(200, json=rec["response"]))
    (a,) = JevProvider(RequestLog(db), lambda: "x" * 20, transport=replay.transport).verify([it], call=Call())
    assert replay.body() == rec["request"]
    assert (a.verdict, a.probabilities, a.confidence) == (
        "CORRECT", {"CORRECT": 0.8, "FALSE": 0.14, "NOT_SURE": 0.06}, 0.7)
    assert a.boundary is None and a.model == "typesafe/jev-1.14-20261014"   # only the verdict was asked
    with db.session() as s:
        assert s.get(AiRequest, a.request_id).cost_usd == pytest.approx(1.7346e-05)


def test_a_real_openrouter_chat_reply(db):
    rec = recorded("real_openrouter_chat")
    replay = Replay(httpx.Response(200, json=rec["response"]))
    catalog = Catalog(transport=Replay(httpx.Response(200, json=recorded("openrouter_models"))).transport)
    jev = JevProvider(RequestLog(db), lambda: "x" * 20, transport=replay.transport)
    chat = OpenRouterChatProvider(RequestLog(db), lambda: "x" * 20, catalog, jev, transport=replay.transport)
    it = Item("live-1", {"unmatched_corpus_prefix_words": "قال"}, {})
    (a,) = chat.verify([it], call=Call(), options=ChatOptions(model="deepseek/deepseek-chat"))
    assert (a.verdict, a.confidence, a.boundary, a.boundary_confidence) == ("CORRECT", 0.95, "COMPLETE_SPAN", 0.9)
    with db.session() as s:
        row = s.get(AiRequest, a.request_id)
        assert (row.input_tokens, row.output_tokens, row.cost_usd) == (924, 104, 0.00038824)


def test_a_real_laya_answer(db):
    """Laya's real answers carry extra fields (type, answer_confidence, action) and v2-style yes/no questions."""
    rec = recorded("real_laya")
    answers = rec["response"]["answers"]

    class Agent:
        cfg = {"max_len": 2048}

        def predict(self, state, questions, max_len):
            return {"answers": answers}

    laya, _gpu, _ = laya_with(db, loads=Loads(Agent()))
    it = Item("golden-0", rec["request"]["state"], rec["request"]["questions"])
    (a,) = laya.verify([it], call=Call())
    assert (a.verdict, a.probabilities["CORRECT"], a.confidence) == ("CORRECT", 0.5063, 0.147)
    assert (a.start_missing, a.end_missing) == (0.737, 0.7022)
