"""OpenRouter through core/ai, against recorded replies: the live catalog (F-083), JEV decisions (F-082) and
chat models (JSON mode, cut-off replies, fatal errors)."""

from __future__ import annotations

import json

import httpx
import pytest
from ai_helpers import Replay, Waits, item, ok, recorded

from wahy.core.ai.log import RequestLog
from wahy.core.ai.models import AiRequest
from wahy.core.ai.openrouter import (
    Catalog,
    ChatOptions,
    JevOptions,
    JevProvider,
    OpenRouterChatProvider,
    normalize_model_id,
)
from wahy.core.ai.types import AiError, Call

KEY = "sk-or-v1-" + "a" * 40


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def catalog(clock=None):
    replay = Replay(ok("openrouter_models"), ok("openrouter_models"))
    return Catalog(transport=replay.transport, clock=clock or Clock()), replay


# ---- the catalog ------------------------------------------------------------------------------------------------


def test_searching_deepseek_lists_its_models_with_prices():
    """F-083: type "deepseek"; the list shows DeepSeek models with prices, cheapest first."""
    cat, _ = catalog()
    hits = cat.search("deepseek")
    assert [m.id for m in hits] == ["deepseek/deepseek-chat:free", "deepseek/deepseek-chat", "deepseek/deepseek-r1"]
    chat = hits[1].as_dict()
    assert chat["prompt_price_per_m"] == 0.27 and chat["completion_price_per_m"] == 1.1
    assert chat["context_length"] == 163840 and chat["json_mode"] and chat["chinese"] and not chat["free"]
    assert hits[0].is_free and not hits[0].json_mode


def test_categories_and_caching():
    clock = Clock()
    cat, replay = catalog(clock)
    assert {m.id for m in cat.search(category="jev")} == {"typesafe/jev-1.14"}
    assert {m.id for m in cat.search(category="gemini")} == {"google/gemini-3.1-flash-lite"}
    assert {m.id for m in cat.search(category="free")} == {"deepseek/deepseek-chat:free"}
    assert {m.id for m in cat.search("v3", category="chinese")} == {"deepseek/deepseek-chat",
                                                                     "deepseek/deepseek-chat:free"}
    assert len(replay.requests) == 1                    # fetched once
    clock.t = 3601
    cat.search("x")
    assert len(replay.requests) == 2                    # an hour later it is fetched again


def test_an_unknown_model_fails_before_any_finding_is_sent():
    cat, _ = catalog()
    with pytest.raises(AiError, match="Did you mean: deepseek/deepseek-chat") as e:
        cat.check_exists("deepseek-ai/deepseek-chat")     # the right name, a wrong owner
    assert e.value.fatal
    cat.check_exists("deepseek/deepseek-r1")            # exists: nothing happens


def test_a_bare_gemini_name_gets_googles_prefix():
    assert normalize_model_id("gemini-3.1-flash-lite") == "google/gemini-3.1-flash-lite"
    assert normalize_model_id("") == "deepseek/deepseek-chat"


# ---- JEV --------------------------------------------------------------------------------------------------------


def jev(replay, db=None, key=KEY):
    return JevProvider(RequestLog(db), lambda: key, transport=replay.transport, sleep=Waits().sleep)


def test_jev_gets_the_envelope_as_it_is_and_answers_with_calibrated_probabilities(db):
    """F-082: verify one finding with JEV; it gets calibrated probabilities."""
    replay = Replay(ok("jev_decision_ok"))
    it = item("12")
    (a,) = jev(replay, db).verify([it], call=Call(), options=JevOptions())
    req = replay.requests[0]
    assert str(req.url) == "https://openrouter.ai/api/alpha/decisions"
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert replay.body() == {"model": "typesafe/jev-1.14", "state": it.state, "questions": it.questions}
    assert (a.verdict, a.probabilities["CORRECT"], a.boundary) == ("CORRECT", 0.91, "MISSING_START")
    assert a.boundary_probabilities["MISSING_START"] == 0.66
    with db.session() as s:
        row = s.get(AiRequest, a.request_id)
        assert (row.provider, row.cost_usd, row.input_tokens) == ("jev", 0.0000312, 742)
        assert KEY not in json.dumps(row.request)


def test_jev_retries_a_429_and_a_wrong_key_is_fatal():
    replay = Replay(httpx.Response(429, headers={"retry-after": "2"}), ok("jev_decision_ok"))
    (a,) = jev(replay).verify([item("1")], call=Call())
    assert a.ok and len(replay.requests) == 2
    with pytest.raises(AiError, match="refused the key") as e:
        jev(Replay(httpx.Response(401, json={"error": {"message": "No auth credentials found"}}))).verify(
            [item("1")], call=Call())
    assert e.value.fatal
    with pytest.raises(AiError, match="no OpenRouter \\(JEV\\) API key"):
        jev(Replay(), key=None).verify([item("1")], call=Call())


# ---- chat models ------------------------------------------------------------------------------------------------


def chat(*answers, db=None):
    cat, _ = catalog()
    cat.models()                                         # the catalog is already fetched
    replay = Replay(*answers)
    j = JevProvider(RequestLog(db), lambda: KEY, transport=replay.transport, sleep=Waits().sleep)
    provider = OpenRouterChatProvider(RequestLog(db), lambda: KEY, cat, j, transport=replay.transport,
                                      sleep=Waits().sleep)
    return provider, replay


def test_a_chat_model_gets_the_prompt_and_its_fenced_json_is_read(db):
    provider, replay = chat(ok("openrouter_chat_ok"), db=db)
    it = item("5")
    (a,) = provider.verify([it], call=Call(), options=ChatOptions(model="deepseek/deepseek-chat"))
    body = replay.body()
    assert body["model"] == "deepseek/deepseek-chat" and body["max_tokens"] == 1500
    assert body["response_format"] == {"type": "json_object"} and "reasoning" not in body
    assert body["messages"][0]["content"].endswith("\"merge_gap_type\": \"PART_OF_QUOTE\" | \"COMMENTARY\".")
    assert json.loads(body["messages"][1]["content"]) == {"questions": it.questions, "state": it.state}
    assert (a.verdict, a.confidence, a.reason) == ("NOT_SURE", 0.6, "الكلمات مشوشة.")
    with db.session() as s:
        assert s.get(AiRequest, a.request_id).cost_usd == 0.00042


def test_thinking_off_is_sent_only_to_models_that_take_it():
    provider, replay = chat(ok("openrouter_chat_ok"), ok("openrouter_chat_ok"))
    provider.verify([item("1")], call=Call(), options=ChatOptions(model="deepseek/deepseek-r1", no_thinking=True))
    provider.verify([item("1")], call=Call(), options=ChatOptions(model="deepseek/deepseek-chat", no_thinking=True))
    assert replay.body(0)["reasoning"] == {"enabled": False} and "reasoning" not in replay.body(1)


def test_a_cut_off_reply_is_retried_once_with_more_room_and_both_costs_count(db):
    provider, replay = chat(ok("openrouter_chat_cut_off"), ok("openrouter_chat_ok"), db=db)
    result = provider.complete_json(system="s", user="u", call=Call(), options=ChatOptions(model="deepseek/deepseek-r1"))
    assert [replay.body(i)["max_tokens"] for i in range(2)] == [1500, 4000]
    assert result.cost_usd == pytest.approx(0.0031 + 0.00042) and result.output_tokens == 1500 + 61
    with db.session() as s:
        assert [r.ok for r in s.query(AiRequest).order_by(AiRequest.id)] == [False, True]


def test_json_mode_refused_is_retried_without_it():
    refused = httpx.Response(400, json={"error": {"message": "response_format is not supported by this model"}})
    provider, replay = chat(refused, ok("openrouter_chat_ok"))
    provider.complete_json(system="s", user="u", call=Call(), options=ChatOptions(model="anthropic/claude-sonnet-5.5"))
    assert "response_format" in replay.body(0) and "response_format" not in replay.body(1)


def test_no_credit_is_fatal_and_says_what_to_do():
    provider, _ = chat(ok("openrouter_402", 402))
    with pytest.raises(AiError, match="not enough credit") as e:
        provider.verify([item("1")], call=Call(), options=ChatOptions(model="deepseek/deepseek-chat"))
    assert e.value.fatal and e.value.status == 402


def test_an_empty_reply_and_a_200_with_an_error_are_errors():
    empty = recorded("openrouter_chat_ok")
    empty["choices"][0]["message"]["content"] = ""
    provider, _ = chat(httpx.Response(200, json=empty))
    with pytest.raises(AiError, match="empty reply"):
        provider.complete_json(system="s", user="u", call=Call(), options=ChatOptions(model="deepseek/deepseek-chat"))
    failed = dict(recorded("openrouter_chat_ok"), error={"message": "upstream timed out"})
    provider, _ = chat(httpx.Response(200, json=failed))
    with pytest.raises(AiError, match="upstream timed out"):
        provider.complete_json(system="s", user="u", call=Call(), options=ChatOptions(model="deepseek/deepseek-chat"))


def test_a_jev_model_picked_in_the_chat_search_goes_to_the_decisions_api():
    provider, replay = chat(ok("jev_decision_ok"))
    (a,) = provider.verify([item("1")], call=Call(), options=ChatOptions(model="typesafe/jev-1.14"))
    assert str(replay.requests[0].url).endswith("/alpha/decisions") and a.provider == "jev"
