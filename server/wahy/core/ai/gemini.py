"""Google Gemini, called directly (generativelanguage.googleapis.com), as a verifier and as a plain JSON
model.

    gemini.verify(items, call=call, options=GeminiOptions(rpm=5, batch_size=5))   # [Answer, ...]
    gemini.generate(system="...", prompt="...", call=call, options=...)          # GeminiResult(data=...)
    gemini.list_models()                                                         # names this key can call

Verification sends the items in batches of 5 to 10 per request (one JSON array back, matched by `finding_id`).
On the free tier a shared pacer keeps the requests under `rpm` a minute, and the cost saved is 0 (the price it
would have had is in `shadow_cost_usd`). Busy answers (429, 503) wait for Google's `RetryInfo` delay plus 1.5
s or the backoff 5, 15, 35, 65 s, and give up with a clear message after 5 attempts (F-094). The key goes in a
header, never in the URL, so it can't leak into the request log.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from wahy.core.ai.http import HttpSender, RetryPolicy, response_body
from wahy.core.ai.log import RequestLog
from wahy.core.ai.pacer import Pacer
from wahy.core.ai.prompts import GEMINI_BATCH_INSTRUCTION, GEMINI_RESPONSE_SCHEMA, system_prompt
from wahy.core.ai.types import AiError, Answer, Call, Item, answer_from_json, parse_model_json

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-3.5-flash-lite"
POLICY = RetryPolicy(attempts=5, delays=(5.0, 15.0, 35.0, 65.0), retry_after_extra_s=1.5, max_wait_s=120.0)
# $ per million tokens (input, output), first matching part of the model name wins
PRICES: list[tuple[str, tuple[float, float]]] = [("3.5-flash-lite", (0.30, 2.50)), ("", (0.15, 0.60))]
# the order to pick a model in when none is chosen or the chosen one does not exist for this key
PREFERRED = [
    "3.5-flash-lite",
    "flash-lite-latest",
    "3.1-flash-lite",
    "2.5-flash-lite",
    "flash-lite",
    "flash-latest",
    "flash",
]
MIN_BATCH, MAX_BATCH = 5, 10


@dataclass
class GeminiOptions:
    model: str = DEFAULT_MODEL
    free_tier: bool = True  # pace the requests and count them as free
    rpm: int = 12  # requests per minute on the free tier
    batch_size: int = 5  # findings per request, 5 to 10
    temperature: float = 0.1
    system_prompt: str | None = None
    reason_lang: str = "ar"
    reason_detail: str = "brief"


@dataclass
class GeminiResult:
    data: Any  # the parsed JSON reply
    text: str
    request_id: int | None
    input_tokens: int
    output_tokens: int
    cost_usd: float
    shadow_cost_usd: float
    latency_ms: int


def price(model: str, input_tokens: int, output_tokens: int) -> float:
    rate_in, rate_out = next(rates for part, rates in PRICES if part in model)
    return (input_tokens * rate_in + output_tokens * rate_out) / 1_000_000


def pick_model(available: list[str], wanted: str | None = None) -> str | None:
    """A generateContent model from the names a key can call: the wanted one if it exists, else the first
    PREFERRED match (no preview, speech or image models)."""
    names = [n.split("/", 1)[-1] for n in available]
    if wanted and wanted in names:
        return wanted
    for hint in PREFERRED:
        hits = sorted(
            (n for n in names if hint in n and not any(x in n for x in ("preview", "tts", "image"))),
            reverse=True,
        )
        if hits:
            return hits[0]
    return None


class GeminiProvider:
    name = "gemini"

    def __init__(
        self,
        log: RequestLog,
        key: Callable[[], str | None],
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        pacer: Pacer | None = None,
    ):
        self.log, self._key, self.sleep = log, key, sleep
        self.http = HttpSender(log, provider=self.name, transport=transport, sleep=sleep)
        self.pacer = pacer or Pacer()

    # ---- verification --------------------------------------------------------------------------------------

    def verify(self, items: list[Item], *, call: Call, options: GeminiOptions | None = None) -> list[Answer]:
        """Answers for `items`, in their order, asking `batch_size` at a time."""
        o = options or GeminiOptions()
        size = min(MAX_BATCH, max(MIN_BATCH, int(o.batch_size)))
        answers: list[Answer] = []
        for start in range(0, len(items), size):
            answers += self._verify_batch(items[start : start + size], call, o)
        return answers

    @staticmethod
    def batch_prompt(batch: list[Item], o: GeminiOptions) -> tuple[str, str]:
        """(system prompt, user prompt) of one verification request."""
        payload = [{"finding_id": it.id, "state": it.state, "questions": it.questions} for it in batch]
        prompt = GEMINI_BATCH_INSTRUCTION + json.dumps(payload, ensure_ascii=False, indent=2)
        system = system_prompt(o.system_prompt, reason_lang=o.reason_lang, reason_detail=o.reason_detail)
        return system, prompt

    def preview(self, items: list[Item], options: GeminiOptions | None = None) -> dict[str, Any]:
        """What one verification request for `items` (one batch) would send: {endpoint, model, body}."""
        o = options or GeminiOptions()
        model = (o.model or DEFAULT_MODEL).strip()
        system, prompt = self.batch_prompt(items, o)
        return {"endpoint": f"{BASE_URL}/models/{model}:generateContent", "model": model,
                "body": request_body(system, prompt, o, GEMINI_RESPONSE_SCHEMA)}

    def _verify_batch(self, batch: list[Item], call: Call, o: GeminiOptions) -> list[Answer]:
        system, prompt = self.batch_prompt(batch, o)
        result = self.generate(
            system=system, prompt=prompt, call=call, options=o, schema=GEMINI_RESPONSE_SCHEMA, expect=list
        )
        rows = result.data if isinstance(result.data, list) else [result.data]
        by_id = {str(r.get("finding_id")): r for r in rows if isinstance(r, dict)}
        if len(batch) == 1 and len(by_id) == 1 and batch[0].id not in by_id:
            by_id = {batch[0].id: next(iter(by_id.values()))}  # one item: the id it echoed does not matter
        out = []
        for it in batch:
            row = by_id.get(it.id)
            if row is None:
                out.append(
                    Answer(
                        item_id=it.id,
                        provider=self.name,
                        model=o.model,
                        request_id=result.request_id,
                        error="Gemini's reply had no answer for this finding",
                    )
                )
                continue
            a = answer_from_json(it, row, provider=self.name, model=o.model)
            a.request_id = result.request_id
            out.append(a)
        return out

    # ---- any JSON request ----------------------------------------------------------------------------------

    def generate(
        self,
        *,
        system: str,
        prompt: str,
        call: Call,
        options: GeminiOptions | None = None,
        schema: dict[str, Any] | None = None,
        expect: type | None = None,
    ) -> GeminiResult:
        """One generateContent request answered in JSON (with `schema` when given). Saved in the request log;
        raises AiError when it fails or the reply is not JSON (`expect`: list or dict, when it must be
        one)."""
        o = options or GeminiOptions()
        key = self._key()
        if not key:
            raise AiError("no Gemini API key: set it in the settings", fatal=True)
        model = (o.model or DEFAULT_MODEL).strip()
        body = request_body(system, prompt, o, schema)
        url = f"{BASE_URL}/models/{model}:generateContent"
        reply = self.http.post(
            url,
            json=body,
            headers={"x-goog-api-key": key},
            call=call,
            model=model,
            policy=POLICY,
            logged_request={"model": model, **body},
            before_attempt=(lambda: self.pacer.take(limit=o.rpm, call=call, sleep=self.sleep))
            if o.free_tier
            else None,
        )
        resp = reply.response
        data = response_body(resp)
        if resp.status_code != 200:
            error = self._describe(resp.status_code, data, model)
            rid = self.log.save(
                provider=self.name,
                model=model,
                call=call,
                ok=False,
                request={"model": model, **body},
                response=data,
                error=str(error),
                latency_ms=reply.latency_ms,
            )
            error.request_id = rid
            raise error
        usage = data.get("usageMetadata") or {}
        tokens_in = int(usage.get("promptTokenCount") or 0)
        tokens_out = int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)
        shadow = price(model, tokens_in, tokens_out)
        cost = 0.0 if o.free_tier else shadow
        text = _reply_text(data)
        parsed = parse_model_json(text) if text else None
        problem = None
        if parsed is None:
            block = (data.get("promptFeedback") or {}).get("blockReason")
            problem = (
                f"Gemini blocked the request ({block})"
                if block
                else f"Gemini's reply is not JSON: {text[:160]!r}"
            )
        elif expect is not None and not isinstance(parsed, expect | dict):
            problem = f"Gemini's reply is not a JSON {expect.__name__}"
        rid = self.log.save(
            provider=self.name,
            model=model,
            call=call,
            ok=problem is None,
            request={"model": model, **body},
            response=data,
            error=problem,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            cost_usd=cost,
            latency_ms=reply.latency_ms,
        )
        if problem:
            raise AiError(problem, request_id=rid)
        return GeminiResult(parsed, text, rid, tokens_in, tokens_out, cost, shadow, reply.latency_ms)

    def list_models(self) -> list[str]:
        """Names of the models this key can call with generateContent ("fetch models available to my key")."""
        key = self._key()
        if not key:
            raise AiError("no Gemini API key: set it in the settings", fatal=True)
        names: list[str] = []
        token = ""
        try:
            with self.http.client(20.0) as client:
                for _ in range(5):
                    params: dict[str, Any] = {"pageSize": 200, **({"pageToken": token} if token else {})}
                    resp = client.get(f"{BASE_URL}/models", params=params, headers={"x-goog-api-key": key})
                    if resp.status_code != 200:
                        raise self._describe(resp.status_code, response_body(resp), "")
                    data = resp.json()
                    for m in data.get("models", []):
                        if "generateContent" in (m.get("supportedGenerationMethods") or []):
                            names.append(str(m.get("name", "")).split("/", 1)[-1])
                    token = data.get("nextPageToken", "")
                    if not token:
                        break
        except httpx.HTTPError as e:
            raise AiError(f"could not reach Gemini: {e}") from e
        return names

    @staticmethod
    def _describe(status: int, data: Any, model: str) -> AiError:
        message = (
            data.get("error", {}).get("message")
            if isinstance(data, dict) and isinstance(data.get("error"), dict)
            else str(data)[:300]
        )
        if status in (400, 401, 403) and "key" in str(message).lower():
            return AiError(f"Gemini refused the key (HTTP {status}): {message}", status=status, fatal=True)
        if status == 404:
            return AiError(
                f"Gemini has no model {model!r} for this key (HTTP 404): {message}", status=status, fatal=True
            )
        return AiError(
            f"Gemini refused the request (HTTP {status}): {message}",
            status=status,
            fatal=status in (401, 403),
        )


def request_body(system: str, prompt: str, o: GeminiOptions, schema: dict[str, Any] | None) -> dict[str, Any]:
    """The generateContent body (without the model, which goes in the URL)."""
    config: dict[str, Any] = {"temperature": o.temperature, "responseMimeType": "application/json"}
    if schema is not None:
        config["responseSchema"] = schema
    return {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": config,
    }


def _reply_text(data: dict[str, Any]) -> str:
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return ""
    return "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict) and not p.get("thought"))
