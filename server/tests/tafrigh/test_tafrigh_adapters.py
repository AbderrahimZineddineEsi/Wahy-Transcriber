"""The Gemini adapter over the real AI layer: the route, the model discovery, the cost, and what happens when a
model's answer is unusable. (The providers' own HTTP behaviour is tested in tests/test_ai_*.py.)"""

import json

import httpx
import pytest
from ai_helpers import Replay
from pydantic import SecretStr

from wahy.core.ai.types import AiError, Call
from wahy.features.tafrigh.adapters.gemini_adapter import GeminiAdapter, normalize_openrouter_model
from wahy.features.tafrigh.models import SourcePosition, TranscriptSegment
from wahy.features.tafrigh.unit_of_work import UnitOfWork

from .helpers import make_ai


def with_gemini_key(ai):
    ai.settings.gemini_api_key = SecretStr("AIza" + "k" * 30)
    return ai


def uow() -> UnitOfWork:
    seg = TranscriptSegment(id="seg_0001", original_text="هذه جملة", source_pos=SourcePosition(char_start=0, char_end=8))
    return UnitOfWork(uow_id="u", target_segments=[seg], context_before=[], context_after=[], partial_toc=[],
                      current_position_index=0, allowed_choices=[{"tag": "paragraph"}, {"tag": "continuation"}])


def gemini_reply(decisions) -> httpx.Response:
    return httpx.Response(200, json={
        "candidates": [{"content": {"parts": [{"text": json.dumps({"decisions": decisions})}]}}],
        "usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 30}})


def test_gemini_route_sends_the_key_in_a_header_and_counts_tokens():
    replay = Replay(gemini_reply([{"id": "seg_0001", "tag": "paragraph", "confidence": 0.9}]))
    ad = GeminiAdapter(with_gemini_key(make_ai(replay.transport)), model_name="gemini-2.5-flash-lite")
    (item,) = ad.classify_uow(uow())
    req = replay.requests[0]
    assert item.tag.value == "paragraph" and item.trace["provider"] == "gemini"
    assert "AIza" not in str(req.url) and req.headers["x-goog-api-key"].startswith("AIza")
    assert ad.request_count == 1 and ad.input_tokens_total == 120 and ad.output_tokens_total == 30


def test_an_unknown_model_discovers_a_real_flash_lite_and_asks_again():
    ok = gemini_reply([{"id": "seg_0001", "tag": "continuation"}])
    models = httpx.Response(200, json={"models": [
        {"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
        {"name": "models/embedding-001", "supportedGenerationMethods": ["embedContent"]}]})
    replay = Replay(httpx.Response(404, json={"error": {"message": "not found"}}), models, ok)
    ad = GeminiAdapter(with_gemini_key(make_ai(replay.transport)), model_name="gemini-imaginary")
    (item,) = ad.classify_uow(uow())
    assert item.tag.value == "continuation" and ad.model_name == "gemini-2.5-flash-lite"
    assert replay.requests[2].url.path.endswith("gemini-2.5-flash-lite:generateContent")


def chat_reply(content: str, **extra) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                                     "usage": {"prompt_tokens": 80, "completion_tokens": 20, "cost": 0.002}, **extra})


def test_openrouter_route_names_the_model_and_reports_the_provider_cost():
    def handler(req):
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": []})
        return chat_reply(json.dumps({"decisions": [{"id": "seg_0001", "tag": "heading", "level": 1, "confidence": 0.8}]}))

    ad = GeminiAdapter(make_ai(httpx.MockTransport(handler)), route="openrouter", openrouter_model="gemini-3.1-flash-lite")
    (item,) = ad.classify_uow(uow())
    assert item.tag.value == "heading" and item.trace == {
        "provider": "openrouter", "model": "google/gemini-3.1-flash-lite", "raw": item.trace["raw"],
        "answers": {"tag": {"choice": "heading_1", "confidence": 0.8}}}
    assert ad.total_cost_usd == pytest.approx(0.002) and ad.provider_label == "openrouter:google/gemini-3.1-flash-lite"
    assert normalize_openrouter_model("gemini-2.5-flash") == "google/gemini-2.5-flash"


def test_an_unusable_reply_is_an_error_the_pipeline_can_count():
    def handler(req):
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": []})
        return chat_reply("sorry, I cannot help with that")

    ad = GeminiAdapter(make_ai(httpx.MockTransport(handler)), route="openrouter", openrouter_model="deepseek/deepseek-chat")
    with pytest.raises(AiError) as e:
        ad.classify_uow(uow())
    assert "JSON" in str(e.value) and not e.value.fatal


def test_a_stop_raised_by_the_call_reaches_the_caller_untouched():
    class Stop(Exception):
        pass

    def check():
        raise Stop()

    replay = Replay(gemini_reply([]))
    ad = GeminiAdapter(with_gemini_key(make_ai(replay.transport)), Call(purpose="tafrigh", check=check), model_name="gemini-2.5-flash-lite")
    with pytest.raises(Stop):
        ad.classify_uow(uow())
    assert replay.requests == []
