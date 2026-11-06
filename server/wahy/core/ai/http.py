"""Sending one HTTP request to a provider, with the retry rules every provider shares.

    sender = HttpSender(log, provider="gemini", transport=None, sleep=time.sleep)
    reply = sender.post(url, json=body, headers=..., call=call, model=model, policy=RetryPolicy(...))
    reply.response.json(), reply.latency_ms

What it does on a failure:
- a busy answer (429, 500, 502, 503, 504) or a dropped connection waits and tries again, up to
  `policy.attempts` times in all;
- the wait is the server's own `Retry-After` header (seconds or a date), or Gemini's `RetryInfo.retryDelay` in
  the body, else the policy's next delay (backoff);
- any other status is returned at once: the provider decides what it means (a wrong key is not retried);
- each failed attempt is saved in the request log, so the telemetry shows the 429s too. The successful one is
  saved by the provider, which knows its tokens and cost.

Waiting is done in steps of at most a second, calling `call.check()` between them, so a pause or a cancel
works while a job waits for a rate limit; `call.on_wait(seconds, reason)` is told before each wait.
"""

from __future__ import annotations

import email.utils
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from wahy.core.ai.log import RequestLog
from wahy.core.ai.types import AiError, Call

RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


@dataclass(frozen=True)
class RetryPolicy:
    attempts: int = 4  # tries in all, the first one included
    delays: tuple[float, ...] = (2.0, 4.0, 8.0)  # backoff when the server says nothing; the last repeats
    max_wait_s: float = 120.0  # never wait longer than this for one retry
    retry_after_extra_s: float = 0.0  # added to the server's own delay (Gemini: 1.5 s)
    timeout_s: float = 120.0


@dataclass
class Reply:
    response: httpx.Response
    latency_ms: int
    attempts: int


def retry_after(response: httpx.Response, *, now: Callable[[], datetime] | None = None) -> float | None:
    """The wait the server asks for, in seconds: the `Retry-After` header (a number or an HTTP date), or a
    Google `RetryInfo` detail in the JSON body ({"retryDelay": "20s"}). None when it asks for nothing."""
    header = response.headers.get("retry-after")
    if header:
        header = header.strip()
        try:
            return max(0.0, float(header))
        except ValueError:
            try:
                when = email.utils.parsedate_to_datetime(header)
            except (TypeError, ValueError):
                when = None
            if when is not None:
                if when.tzinfo is None:
                    when = when.replace(tzinfo=UTC)
                current = now() if now else datetime.now(UTC)
                return max(0.0, (when - current).total_seconds())
    try:
        body = response.json()
    except (ValueError, UnicodeDecodeError):
        return None
    details = (
        body.get("error", {}).get("details")
        if isinstance(body, dict) and isinstance(body.get("error"), dict)
        else None
    )
    for d in details if isinstance(details, list) else []:
        if isinstance(d, dict) and "RetryInfo" in str(d.get("@type", "")) and d.get("retryDelay"):
            try:
                return max(0.0, float(str(d["retryDelay"]).rstrip("s")))
            except ValueError:
                return None
    return None


def interruptible_wait(seconds: float, call: Call, sleep: Callable[[float], None]) -> None:
    """Sleep `seconds` in steps of at most 1 s, calling `call.check()` before each step (a paused job blocks
    inside `check`, a cancelled one raises there)."""
    left = seconds
    while True:
        call.check()
        if left <= 0:
            return
        step = min(1.0, left)
        sleep(step)
        left -= step


class HttpSender:
    def __init__(
        self,
        log: RequestLog,
        *,
        provider: str,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.log, self.provider, self.transport, self.sleep = log, provider, transport, sleep

    def client(self, timeout_s: float = 120.0) -> httpx.Client:
        return httpx.Client(timeout=timeout_s, transport=self.transport)

    def post(
        self,
        url: str,
        *,
        call: Call,
        model: str,
        policy: RetryPolicy,
        json: Any = None,
        headers: dict[str, str] | None = None,
        logged_request: Any = None,
        send: Callable[[httpx.Client], httpx.Response] | None = None,
        before_attempt: Callable[[], None] | None = None,
    ) -> Reply:
        """POST `json` to `url` with retries. `logged_request` is what the log shows as the request (default:
        the JSON body). `send` replaces the POST for uploads (Groq sends a file). `before_attempt` runs before
        every attempt, retries included (Gemini's free-tier pacer)."""
        record = logged_request if logged_request is not None else json
        last_error, last_status = "", None
        with self.client(policy.timeout_s) as client:
            for attempt in range(1, policy.attempts + 1):
                call.check()
                if before_attempt:
                    before_attempt()
                t0 = time.perf_counter()
                wait: float | None = None
                try:
                    response = send(client) if send else client.post(url, json=json, headers=headers)
                except httpx.HTTPError as e:
                    latency = round((time.perf_counter() - t0) * 1000)
                    last_error = f"connection failed: {e}"
                    self.log.save(
                        provider=self.provider,
                        model=model,
                        call=call,
                        ok=False,
                        request=record,
                        error=last_error,
                        latency_ms=latency,
                    )
                    reason = "connection error, trying again"
                else:
                    latency = round((time.perf_counter() - t0) * 1000)
                    if response.status_code not in RETRY_STATUS:
                        return Reply(response, latency, attempt)
                    last_error, last_status = (
                        f"HTTP {response.status_code}: {response.text[:300]}",
                        response.status_code,
                    )
                    self.log.save(
                        provider=self.provider,
                        model=model,
                        call=call,
                        ok=False,
                        request=record,
                        response=_body(response),
                        error=last_error,
                        latency_ms=latency,
                    )
                    asked = retry_after(response)
                    if asked is not None:
                        wait = asked + policy.retry_after_extra_s
                    reason = (
                        "rate limit (429), waiting before trying again"
                        if response.status_code == 429
                        else f"server busy ({response.status_code}), trying again"
                    )
                if attempt == policy.attempts:
                    break
                if wait is None:
                    wait = policy.delays[min(attempt - 1, len(policy.delays) - 1)] if policy.delays else 1.0
                wait = min(policy.max_wait_s, wait)
                if call.on_wait:
                    call.on_wait(wait, reason)
                interruptible_wait(wait, call, self.sleep)
        if last_status == 429:
            raise AiError(
                f"{self.provider}: the rate limit (HTTP 429) was still hit after {policy.attempts} "
                f"attempts; wait a minute or lower the requests per minute ({last_error})",
                status=429,
            )
        raise AiError(
            f"{self.provider} failed after {policy.attempts} attempts ({last_error})", status=last_status
        )


def _body(response: httpx.Response) -> Any:
    try:
        return response.json()
    except (ValueError, UnicodeDecodeError):
        return {"text": response.text[:2000]}


def response_body(response: httpx.Response) -> Any:
    """The JSON of a response, or {"text": ...} when it is not JSON (for the request log)."""
    return _body(response)
