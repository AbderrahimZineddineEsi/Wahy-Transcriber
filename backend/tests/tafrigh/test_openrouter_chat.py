"""Any OpenRouter chat model as the Tafrigh classifier (the "openrouter_chat" provider)."""

import json
import re

import httpx
from fastapi.testclient import TestClient

from backend.tafrigh.adapters.gemini_adapter import (
    OPENROUTER_MAX_TOKENS,
    OPENROUTER_MAX_TOKENS_RETRY,
    GeminiAdapter,
)

KEY = "sk-or-v1-" + "a" * 40
DECISION = {"decisions": [{"id": "seg_0001", "tag": "paragraph"}]}


def chat_reply(content, finish="stop"):
    return {"choices": [{"message": {"content": content}, "finish_reason": finish}], "usage": {"cost": 0.0001}}


def make(handler, model="anthropic/claude-sonnet-4.5"):
    return GeminiAdapter(openrouter_api_key=KEY, openrouter_model=model,
                         transport=httpx.MockTransport(handler), sleep_fn=lambda s: None)


def test_request_caps_max_tokens_so_small_balances_are_not_refused():
    seen = []

    def handler(req):
        seen.append(json.loads(req.content))
        return httpx.Response(200, json=chat_reply(json.dumps(DECISION)))

    make(handler)._call_model("hi")
    assert seen[0]["model"] == "anthropic/claude-sonnet-4.5"
    assert seen[0]["max_tokens"] == OPENROUTER_MAX_TOKENS


def test_bare_gemini_name_gets_the_openrouter_prefix():
    assert make(lambda r: None, model="gemini-2.5-flash").openrouter_model == "google/gemini-2.5-flash"


def test_model_without_json_mode_is_asked_again_without_response_format():
    seen = []

    def handler(req):
        body = json.loads(req.content)
        seen.append(body)
        if "response_format" in body:
            return httpx.Response(400, json={"error": {"message": "response_format is not supported by this model"}})
        return httpx.Response(200, json=chat_reply("```json\n" + json.dumps(DECISION) + "\n```"))

    out = make(handler)._call_model("hi")
    assert out["parsed"] == DECISION
    assert "response_format" in seen[0] and "response_format" not in seen[1]


def test_reply_cut_short_is_retried_with_more_tokens():
    seen = []

    def handler(req):
        body = json.loads(req.content)
        seen.append(body["max_tokens"])
        if len(seen) == 1:
            return httpx.Response(200, json=chat_reply("", finish="length"))
        return httpx.Response(200, json=chat_reply(json.dumps(DECISION)))

    assert make(handler)._call_model("hi")["parsed"] == DECISION
    assert seen == [OPENROUTER_MAX_TOKENS, OPENROUTER_MAX_TOKENS_RETRY]


def test_decision_trace_names_the_openrouter_model():
    def handler(req):
        return httpx.Response(200, json=chat_reply(json.dumps(DECISION)))

    from backend.tafrigh.pipeline import TafrighPipeline
    from backend.tafrigh.schemas import PipelineConfig

    pipe = TafrighPipeline(PipelineConfig(model_candidate="gemini_all"), adapters={"gemini": make(handler)})
    res = pipe.run(raw_text="هذه جملة أولى في الدرس.")
    assert res.segments[0].trace["decision"]["model"] == "anthropic/claude-sonnet-4.5"


def test_run_endpoint_routes_openrouter_chat_through_the_chosen_model(monkeypatch, tmp_path):
    import backend.app as A

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(A, "GLOBAL_TRAINING_STORE", A.TrainingStore(str(tmp_path / "train.jsonl")))
    built = {}
    real = A.GeminiAdapter

    def answer(req):
        seg_id = re.search(r'"id": "([^"]+)"', json.loads(req.content)["messages"][1]["content"]).group(1)
        return httpx.Response(200, json=chat_reply(json.dumps({"decisions": [{"id": seg_id, "tag": "paragraph"}]})))

    def spy(**kw):
        built.update(kw)
        return real(**kw, transport=httpx.MockTransport(answer), sleep_fn=lambda s: None)

    monkeypatch.setattr(A, "GeminiAdapter", spy)
    c = TestClient(A.app)
    r = c.post("/api/tafrigh/run", json={"raw_text": "هذه جملة أولى في الدرس.", "model_candidate": "openrouter_chat",
                                         "openrouter_chat_model": "deepseek/deepseek-chat",
                                         "openrouter_api_key": KEY}).json()
    assert r["success"]
    assert built["openrouter_model"] == "deepseek/deepseek-chat"
    assert built["openrouter_api_key"] == KEY


def test_run_endpoint_explains_a_missing_chat_model():
    import backend.app as A

    r = TestClient(A.app).post("/api/tafrigh/run", json={"raw_text": "نص", "model_candidate": "openrouter_chat",
                                                         "openrouter_api_key": KEY}).json()
    assert not r["success"] and "OpenRouter Chat" in r["message"]
