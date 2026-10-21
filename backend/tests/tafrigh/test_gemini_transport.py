"""Gemini transport: key handling, model discovery, retries, JSON recovery, and abort-on-config-error."""

import json

import httpx
import pytest

from backend.tafrigh.adapters.gemini_adapter import (
    GeminiAdapter,
    GeminiAPIError,
    parse_model_json,
    pick_model,
    redact_secrets,
)
from backend.tafrigh.pipeline import TafrighModelError, TafrighPipeline
from backend.tafrigh.schemas import PipelineConfig

KEY = "AIzaSyFAKEKEYFORTESTS_1234567890"
OK_BODY = {
    "candidates": [{"content": {"parts": [{"text": '{"decisions": [{"id": "seg_0001", "tag": "paragraph"}]}'}]}}],
    "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
}
MODELS_BODY = {"models": [
    {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
    {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
]}


def make(handler, **kw):
    return GeminiAdapter(api_key=KEY, transport=httpx.MockTransport(handler), sleep_fn=lambda s: None, **kw)


def test_key_goes_in_header_never_in_url():
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(200, json=OK_BODY)

    make(handler, model_name="gemini-2.5-flash-lite")._call_model("hi")
    assert KEY not in str(seen[0].url)
    assert seen[0].headers["x-goog-api-key"] == KEY


def test_unknown_model_404_discovers_a_real_flash_lite_and_retries():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=MODELS_BODY)
        if "gemini-2.0-flash:" in req.url.path:
            return httpx.Response(404, json={"error": {"message": "not found"}})
        return httpx.Response(200, json=OK_BODY)

    ad = make(handler, model_name="gemini-2.0-flash")
    ad._call_model("hi")
    assert ad.model_name == "gemini-2.5-flash-lite"


def test_auto_model_resolves_before_first_call():
    def handler(req):
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=MODELS_BODY)
        return httpx.Response(200, json=OK_BODY)

    ad = make(handler, model_name="auto")
    ad._call_model("hi")
    assert ad.model_name == "gemini-2.5-flash-lite"


def test_rate_limit_is_retried_then_succeeds():
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        return httpx.Response(429, text="slow down") if n["c"] < 3 else httpx.Response(200, json=OK_BODY)

    res = make(handler, model_name="gemini-2.5-flash-lite")._call_model("hi")
    assert res["parsed"]["decisions"][0]["id"] == "seg_0001" and n["c"] == 3


def test_fenced_or_chatty_json_is_recovered():
    assert parse_model_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_model_json('Sure! {"a": 2} hope it helps') == {"a": 2}
    assert parse_model_json('[{"id": "x"}]') == {"decisions": [{"id": "x"}]}
    with pytest.raises(ValueError):
        parse_model_json("no json here")


def test_secrets_are_redacted_everywhere():
    url = f"https://x/v1beta/models/m:generateContent?key={KEY}"
    assert KEY not in redact_secrets(f"Client error for url '{url}'")
    assert KEY not in str(GeminiAPIError(f"boom {url}"))


def test_pick_model_prefers_flash_lite_and_skips_unsuitable():
    names = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash-preview-tts", "gemini-3-pro"]
    assert pick_model(names) == "gemini-2.5-flash-lite"
    assert pick_model(names, "gemini-3-pro") == "gemini-3-pro"
    assert pick_model(["gemini-3-pro"]) is None


def test_pipeline_stops_with_clear_error_on_rejected_key():
    def handler(req):
        return httpx.Response(403, json={"error": {"message": "API key not valid"}})

    ad = make(handler, model_name="gemini-2.5-flash-lite")
    pipe = TafrighPipeline(PipelineConfig(processing_mode="per_sentence"), adapters={"gemini": ad})
    with pytest.raises(TafrighModelError) as e:
        pipe.run(raw_text="هذه جملة أولى. وهذه جملة ثانية. وهذه ثالثة.")
    assert "403" in str(e.value) and KEY not in str(e.value)


def test_pipeline_survives_isolated_failures_and_flags_segments():
    n = {"c": 0}

    def handler(req):
        n["c"] += 1
        if n["c"] == 2:
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "garbage"}]}}]})
        body = {"candidates": [{"content": {"parts": [{"text": json.dumps({"decisions": [{"id": f"seg_{(n['c']):04d}", "tag": "paragraph"}]})}]}}]}
        return httpx.Response(200, json=body)

    ad = make(handler, model_name="gemini-2.5-flash-lite", max_retries=0)
    pipe = TafrighPipeline(PipelineConfig(processing_mode="per_sentence"), adapters={"gemini": ad})
    res = pipe.run(raw_text="جملة أولى. جملة ثانية. جملة ثالثة.")
    assert len(res.segments) == 3
    assert "".join(s.original_text for s in res.segments) == "جملة أولى. جملة ثانية. جملة ثالثة."
    assert any("MODEL_ERROR" in s.review_flags for s in res.segments)


def test_split_points_are_normalised_without_touching_text():
    from backend.tafrigh.adapters.gemini_adapter import normalize_split_points

    assert normalize_split_points([0, 4, 4, 10, 99, -1, "x", True], 12) == [4, 10]
    assert normalize_split_points(None, 5) == []
