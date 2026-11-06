"""OpenRouter: the model catalog, JEV decisions, and chat models.

    catalog.search("deepseek", category="all")        # [ModelInfo(id, name, prices, context, json, ...)]
    jev.verify(items, call=call, options=JevOptions())          # one Decisions API request per item
    chat.verify(items, call=call, options=ChatOptions(model="deepseek/deepseek-chat"))
    chat.complete_json(system=..., user=..., call=call, options=...)    # any JSON answer (Tafrigh, teachers)

The catalog is OpenRouter's public model list (`/api/v1/models`), fetched live and kept for an hour: prices
per token, context size, and whether a model takes `response_format` (JSON mode) or a `reasoning` switch.

Chat requests follow what the old app learned the hard way (js/ai-verifier.js):
- `max_tokens` is always set (1500): without it OpenRouter reserves the model's whole output limit and refuses
  with 402 on a small balance. A reply cut off by it ("length", a model that spent it thinking) is retried
  once with 4000, and the cut-off reply's cost is added (it was billed too).
- JSON mode is asked for when the catalog says the model has it; a 400/404 about it is retried once without.
- A model chosen from JEV's family goes to the Decisions API instead.
- 401, 402, 403 and 404 are fatal (the same for every finding): the pass stops with the reason.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from wahy.core.ai.http import HttpSender, RetryPolicy, response_body
from wahy.core.ai.log import RequestLog
from wahy.core.ai.prompts import CHAT_OUTPUT_CONTRACT, system_prompt
from wahy.core.ai.types import (
    AiError,
    Answer,
    Call,
    Item,
    answer_from_decisions,
    answer_from_json,
    parse_model_json,
)

MODELS_URL = "https://openrouter.ai/api/v1/models"
CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
DEFAULT_JEV_MODEL = "typesafe/jev-1.14"
DEFAULT_CHAT_MODEL = "deepseek/deepseek-chat"
CATALOG_TTL_S = 3600.0
CHAT_MAX_TOKENS, CHAT_MAX_TOKENS_RETRY = 1500, 4000
HEADERS = {"HTTP-Referer": "https://wahy-transcriber.local", "X-Title": "Wahy Transcriber"}
CHAT_POLICY = RetryPolicy(attempts=4, delays=(3.0, 8.0, 20.0), timeout_s=120.0)
JEV_POLICY = RetryPolicy(attempts=4, delays=(1.0, 2.0, 4.0), timeout_s=60.0)
CATEGORIES = ("all", "jev", "gemini", "chinese", "free")


def is_jev_model(model_id: str) -> bool:
    return "typesafe/jev" in model_id


def normalize_model_id(model_id: str | None, default: str = DEFAULT_CHAT_MODEL) -> str:
    """OpenRouter ids are "provider/model"; a bare Gemini name (Google's own API) 404s there."""
    m = (model_id or "").strip() or default
    return f"google/{m}" if m.lower().startswith("gemini-") else m


# ---- the catalog -------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    context_length: int
    prompt_price: float  # $ per token
    completion_price: float  # $ per token
    description: str = ""
    supported_parameters: tuple[str, ...] | None = None

    @property
    def is_free(self) -> bool:
        return self.prompt_price == 0 or self.id.endswith(":free")

    @property
    def is_jev(self) -> bool:
        return any(x in self.id for x in ("jev", "decider", "liquid/d1"))

    @property
    def is_gemini(self) -> bool:
        return "gemini" in self.id

    @property
    def is_chinese(self) -> bool:
        return any(x in self.id for x in ("deepseek", "qwen", "glm"))

    @property
    def json_mode(self) -> bool:
        """False only when the catalog says the model has no JSON mode (unknown → try it)."""
        if self.supported_parameters is None:
            return True
        return (
            "response_format" in self.supported_parameters
            or "structured_outputs" in self.supported_parameters
        )

    @property
    def can_disable_reasoning(self) -> bool:
        return bool(self.supported_parameters and "reasoning" in self.supported_parameters)

    def in_category(self, category: str) -> bool:
        return {
            "all": True,
            "jev": self.is_jev,
            "gemini": self.is_gemini,
            "chinese": self.is_chinese,
            "free": self.is_free,
        }.get(category, True)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "context_length": self.context_length,
            "prompt_price_per_m": round(self.prompt_price * 1_000_000, 6),
            "completion_price_per_m": round(self.completion_price * 1_000_000, 6),
            "description": self.description,
            "free": self.is_free,
            "jev": self.is_jev,
            "gemini": self.is_gemini,
            "chinese": self.is_chinese,
            "json_mode": self.json_mode,
        }


def _price(value: Any) -> float:
    try:
        return max(0.0, float(value or 0))
    except (TypeError, ValueError):
        return 0.0


class Catalog:
    """OpenRouter's model list with live prices, fetched at most once an hour (`refresh=True` forces it)."""

    def __init__(
        self, *, transport: httpx.BaseTransport | None = None, clock: Callable[[], float] = time.monotonic
    ):
        self.transport, self.clock = transport, clock
        self._lock = threading.Lock()
        self._models: list[ModelInfo] = []
        self._fetched_at: float | None = None

    def models(self, *, refresh: bool = False) -> list[ModelInfo]:
        with self._lock:
            fresh = self._fetched_at is not None and self.clock() - self._fetched_at < CATALOG_TTL_S
            if self._models and fresh and not refresh:
                return list(self._models)
            try:
                with httpx.Client(timeout=30.0, transport=self.transport) as client:
                    resp = client.get(MODELS_URL)
                if resp.status_code != 200:
                    raise AiError(
                        f"OpenRouter's model list answered HTTP {resp.status_code}", status=resp.status_code
                    )
                self._models = [_model_info(m) for m in resp.json().get("data", []) if m.get("id")]
                self._fetched_at = self.clock()
            except (httpx.HTTPError, ValueError) as e:
                if not self._models:
                    raise AiError(f"could not fetch OpenRouter's model list: {e}") from e
            return list(self._models)

    def get(self, model_id: str) -> ModelInfo | None:
        """The model's entry, or None (also when the catalog can't be fetched: the request then decides)."""
        try:
            models = self.models()
        except AiError:
            return None
        return next((m for m in models if m.id == model_id), None)

    def cached(self, model_id: str) -> ModelInfo | None:
        """The model's entry if the catalog was already fetched (never touches the network)."""
        with self._lock:
            return next((m for m in self._models if m.id == model_id), None)

    def search(self, query: str = "", *, category: str = "all", limit: int = 60) -> list[ModelInfo]:
        """Models whose id or name contains every word of `query`, in `category`, cheapest first."""
        words = [w for w in query.lower().split() if w]
        hits = [
            m
            for m in self.models()
            if m.in_category(category) and all(w in f"{m.id} {m.name}".lower() for w in words)
        ]
        hits.sort(key=lambda m: (m.prompt_price + m.completion_price, m.id))
        return hits[:limit]

    def check_exists(self, model_id: str) -> None:
        """Fail before any finding is sent when the model is not on OpenRouter (else every finding gets the
        same 404). Says which close names exist. Does nothing when the catalog can't be fetched."""
        try:
            models = self.models()
        except AiError:
            return
        if not models or any(m.id == model_id for m in models) or is_jev_model(model_id):
            return
        key = model_id.split("/")[-1].split(":")[0].lower()
        close = [m.id for m in models if key and key in m.id.lower()][:4]
        hint = f" Did you mean: {', '.join(close)}?" if close else " Pick one from the model search."
        raise AiError(f"OpenRouter has no model {model_id!r}.{hint}", status=404, fatal=True)


def _model_info(m: dict[str, Any]) -> ModelInfo:
    params = m.get("supported_parameters")
    pricing = m.get("pricing") or {}
    return ModelInfo(
        id=str(m["id"]),
        name=str(m.get("name") or m["id"]),
        context_length=int(m.get("context_length") or 0),
        prompt_price=_price(pricing.get("prompt")),
        completion_price=_price(pricing.get("completion")),
        description=str(m.get("description") or ""),
        supported_parameters=tuple(params) if isinstance(params, list) else None,
    )


def describe_error(status: int, body: Any, model_id: str, provider: str = "OpenRouter") -> AiError:
    """An OpenRouter error answer → AiError; fatal when every finding would get the same answer."""
    message = (
        body.get("error", {}).get("message")
        if isinstance(body, dict) and isinstance(body.get("error"), dict)
        else (body.get("text") if isinstance(body, dict) else str(body))
    )
    message = str(message or "")[:300]
    lower = message.lower()
    if status == 401:
        return AiError(f"{provider} refused the key (401): {message}", status=status, fatal=True)
    if status == 402:
        return AiError(
            f"{provider}: not enough credit or the key's limit is too low for this model (402). Top up, "
            f"raise the key's limit, or pick a cheaper model: {message}",
            status=status,
            fatal=True,
        )
    if status == 403:
        return AiError(
            f"{provider} refused the request (403): the model may be blocked for this account, or the "
            f"content was refused: {message}",
            status=status,
            fatal=True,
        )
    if status == 404:
        if any(x in lower for x in ("data policy", "privacy", "guardrail")):
            return AiError(
                f"no provider serves {model_id!r} with this account's privacy settings; allow "
                f"providers at openrouter.ai/settings/privacy (404): {message}",
                status=status,
                fatal=True,
            )
        return AiError(f"{provider} has no model {model_id!r} (404): {message}", status=status, fatal=True)
    return AiError(f"{provider} error ({status}) for {model_id}: {message}", status=status)


def _key_or_fail(key: Callable[[], str | None], what: str) -> str:
    value = key()
    if not value:
        raise AiError(f"no {what} API key: set it in the settings", fatal=True)
    return value


# ---- JEV (the Decisions API) -------------------------------------------------------------------------------


@dataclass
class JevOptions:
    model: str = DEFAULT_JEV_MODEL


class JevProvider:
    """JEV answers each question of the envelope with calibrated probabilities. One request per item; the
    envelope is sent as it is (no prompt)."""

    name = "jev"

    def __init__(
        self,
        log: RequestLog,
        key: Callable[[], str | None],
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.log, self._key = log, key
        self.http = HttpSender(log, provider=self.name, transport=transport, sleep=sleep)

    def preview(self, items: list[Item], options: JevOptions | None = None) -> dict[str, Any]:
        """What the request for the first of `items` would send (JEV asks one item per request)."""
        o = options or JevOptions()
        model = (o.model or DEFAULT_JEV_MODEL).strip()
        it = items[0]
        return {"endpoint": DECISIONS_URL, "model": model,
                "body": {"model": model, "state": it.state, "questions": it.questions}}

    def verify(self, items: list[Item], *, call: Call, options: JevOptions | None = None) -> list[Answer]:
        o = options or JevOptions()
        return [self._one(it, call, (o.model or DEFAULT_JEV_MODEL).strip()) for it in items]

    def decide(
        self, state: dict[str, Any], questions: dict[str, Any], *, call: Call, model: str = DEFAULT_JEV_MODEL
    ) -> tuple[dict[str, Any], int | None]:
        """One raw Decisions request (Tafrigh asks its own questions): (the reply's JSON, request id)."""
        key = _key_or_fail(self._key, "OpenRouter (JEV)")
        body = {"model": model, "state": state, "questions": questions}
        reply = self.http.post(
            DECISIONS_URL,
            json=body,
            call=call,
            model=model,
            policy=JEV_POLICY,
            headers={"Authorization": f"Bearer {key}", **HEADERS},
        )
        data = response_body(reply.response)
        if reply.response.status_code != 200:
            error = describe_error(reply.response.status_code, data, model, "OpenRouter JEV")
            error.request_id = self.log.save(
                provider=self.name,
                model=model,
                call=call,
                ok=False,
                request=body,
                response=data,
                error=str(error),
                latency_ms=reply.latency_ms,
            )
            raise error
        usage = data.get("usage") or {}
        tokens_in = int(usage.get("input_tokens") or 0) or max(20, round(len(json.dumps(state)) / 3))
        cost = float(usage["cost"]) if isinstance(usage.get("cost"), int | float) else tokens_in * 0.000000042
        ok = isinstance(data.get("answers"), dict)
        rid = self.log.save(
            provider=self.name,
            model=str(data.get("model") or model),
            call=call,
            ok=ok,
            request=body,
            response=data,
            error=None if ok else "the reply has no answers",
            input_tokens=tokens_in,
            output_tokens=int(usage.get("output_tokens") or 0),
            cost_usd=cost,
            latency_ms=reply.latency_ms,
        )
        if not ok:
            raise AiError("JEV's reply has no answers", request_id=rid)
        return data, rid

    def _one(self, item: Item, call: Call, model: str) -> Answer:
        data, rid = self.decide(item.state, item.questions, call=call, model=model)
        a = answer_from_decisions(
            item,
            data["answers"],
            provider=self.name,
            model=str(data.get("model") or model),
            reason="JEV decision with calibrated probabilities.",
        )
        a.request_id = rid
        return a


# ---- chat models -------------------------------------------------------------------------------------------


@dataclass
class ChatOptions:
    model: str = DEFAULT_CHAT_MODEL
    temperature: float = 0.1
    no_thinking: bool = False  # ask a reasoning model not to think (its thinking is billed as output)
    system_prompt: str | None = None
    reason_lang: str = "ar"
    reason_detail: str = "brief"
    max_tokens: int = CHAT_MAX_TOKENS
    max_tokens_retry: int = CHAT_MAX_TOKENS_RETRY


@dataclass
class ChatResult:
    data: Any
    text: str
    model: str
    request_id: int | None
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int
    extra: dict[str, Any] = field(default_factory=dict)


class OpenRouterChatProvider:
    name = "openrouter"

    def __init__(
        self,
        log: RequestLog,
        key: Callable[[], str | None],
        catalog: Catalog,
        jev: JevProvider,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.log, self._key, self.catalog, self.jev = log, key, catalog, jev
        self.http = HttpSender(log, provider=self.name, transport=transport, sleep=sleep)

    @staticmethod
    def messages(item: Item, o: ChatOptions) -> tuple[str, str]:
        """(system message, user message) of the verification request for one item."""
        system = (
            system_prompt(o.system_prompt, reason_lang=o.reason_lang, reason_detail=o.reason_detail)
            + "\n\n"
            + CHAT_OUTPUT_CONTRACT
        )
        return system, json.dumps({"questions": item.questions, "state": item.state}, ensure_ascii=False)

    def preview(self, items: list[Item], options: ChatOptions | None = None) -> dict[str, Any]:
        """What the request for the first of `items` would send (one item per request). JSON mode and
        "thinking off" depend on the model's catalog entry, read only if the catalog is already loaded."""
        o = options or ChatOptions()
        model = normalize_model_id(o.model)
        if is_jev_model(model):
            return self.jev.preview(items, JevOptions(model=model))
        system, user = self.messages(items[0], o)
        meta = self.catalog.cached(model)
        body: dict[str, Any] = {
            "model": model,
            "temperature": o.temperature,
            "max_tokens": o.max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if meta is None or meta.json_mode:
            body["response_format"] = {"type": "json_object"}
        if o.no_thinking and meta is not None and meta.can_disable_reasoning:
            body["reasoning"] = {"enabled": False}
        return {"endpoint": CHAT_URL, "model": model, "body": body}

    def verify(self, items: list[Item], *, call: Call, options: ChatOptions | None = None) -> list[Answer]:
        o = options or ChatOptions()
        model = normalize_model_id(o.model)
        if is_jev_model(model):
            return self.jev.verify(items, call=call, options=JevOptions(model=model))
        self.catalog.check_exists(model)
        answers = []
        for it in items:
            system, user = self.messages(it, o)
            result = self.complete_json(system=system, user=user, call=call, options=o)
            data = result.data[0] if isinstance(result.data, list) and result.data else result.data
            if not isinstance(data, dict):
                answers.append(
                    Answer(
                        item_id=it.id,
                        provider=self.name,
                        model=result.model,
                        request_id=result.request_id,
                        error="the reply is not a JSON object",
                    )
                )
                continue
            a = answer_from_json(
                it,
                data,
                provider=self.name,
                model=result.model,
                default_reason="checked by an OpenRouter model.",
            )
            a.request_id = result.request_id
            answers.append(a)
        return answers

    def complete_json(
        self, *, system: str, user: str, call: Call, options: ChatOptions | None = None
    ) -> ChatResult:
        """One chat request whose reply must hold JSON. Saved in the request log (a cut-off first reply too);
        raises AiError when it fails or no JSON comes back."""
        o = options or ChatOptions()
        key = _key_or_fail(self._key, "OpenRouter")
        model = normalize_model_id(o.model)
        meta = self.catalog.get(model)
        json_mode = meta.json_mode if meta else True
        max_tokens = o.max_tokens
        wasted_cost, wasted_out = 0.0, 0

        def payload() -> dict[str, Any]:
            p: dict[str, Any] = {
                "model": model,
                "temperature": o.temperature,
                "max_tokens": max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            }
            if json_mode:
                p["response_format"] = {"type": "json_object"}
            if o.no_thinking and meta is not None and meta.can_disable_reasoning:
                p["reasoning"] = {"enabled": False}
            return p

        headers = {"Authorization": f"Bearer {key}", **HEADERS}
        while True:
            body = payload()
            reply = self.http.post(
                CHAT_URL, json=body, headers=headers, call=call, model=model, policy=CHAT_POLICY
            )
            resp, data = reply.response, response_body(reply.response)
            if resp.status_code != 200:
                text = json.dumps(data, ensure_ascii=False)
                if (
                    json_mode
                    and resp.status_code in (400, 404)
                    and any(x in text.lower() for x in ("response_format", "json", "parameter"))
                ):
                    self.log.save(
                        provider=self.name,
                        model=model,
                        call=call,
                        ok=False,
                        request=body,
                        response=data,
                        error=f"HTTP {resp.status_code}: JSON mode refused, trying without it",
                        latency_ms=reply.latency_ms,
                    )
                    json_mode = False
                    continue
                error = describe_error(resp.status_code, data, model)
                error.request_id = self.log.save(
                    provider=self.name,
                    model=model,
                    call=call,
                    ok=False,
                    request=body,
                    response=data,
                    error=str(error),
                    latency_ms=reply.latency_ms,
                )
                raise error
            usage = data.get("usage") or {}
            tokens_in = int(usage.get("prompt_tokens") or 0)
            tokens_out = int(usage.get("completion_tokens") or 0)
            cost = (
                float(usage["cost"])
                if isinstance(usage.get("cost"), int | float)
                else (tokens_in * meta.prompt_price + tokens_out * meta.completion_price if meta else 0.0)
            )
            choice = (data.get("choices") or [{}])[0] if isinstance(data.get("choices"), list) else {}
            text = str(((choice or {}).get("message") or {}).get("content") or "")
            finish = (choice or {}).get("finish_reason")
            parsed = parse_model_json(text) if text.strip() else None
            if isinstance(data.get("error"), dict):  # a 200 that carries a provider's failure
                message = str(data["error"].get("message"))[:300]
                problem = f"the model's provider failed through OpenRouter: {message}"
            elif parsed is None and finish == "length" and max_tokens < o.max_tokens_retry:
                self.log.save(
                    provider=self.name,
                    model=model,
                    call=call,
                    ok=False,
                    request=body,
                    response=data,
                    error=f"cut off at max_tokens={max_tokens}, trying again with more room",
                    input_tokens=tokens_in,
                    output_tokens=tokens_out,
                    cost_usd=cost,
                    latency_ms=reply.latency_ms,
                )
                wasted_cost, wasted_out = wasted_cost + cost, wasted_out + tokens_out
                max_tokens = o.max_tokens_retry
                continue
            elif parsed is None:
                problem = (
                    f"the model did not answer in JSON: {text[:160]!r}"
                    if text.strip()
                    else f"empty reply from {model!r}"
                    + (f" (finish_reason: {finish})" if finish else "")
                    + "; try another model"
                )
            else:
                problem = None
            used_model = str(data.get("model") or model)
            rid = self.log.save(
                provider=self.name,
                model=used_model,
                call=call,
                ok=problem is None,
                request=body,
                response=data,
                error=problem,
                input_tokens=tokens_in,
                output_tokens=tokens_out,
                cost_usd=cost,
                latency_ms=reply.latency_ms,
            )
            if problem:
                raise AiError(problem, request_id=rid)
            return ChatResult(
                parsed,
                text,
                used_model,
                rid,
                tokens_in,
                tokens_out + wasted_out,
                cost + wasted_cost,
                reply.latency_ms,
                {"finish_reason": finish},
            )
