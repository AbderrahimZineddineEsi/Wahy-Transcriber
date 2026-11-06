"""Groq's hosted Whisper (moved here from features/transcription in phase 13, ADR 0004): one audio file in,
the `verbose_json` transcription out, with retries and a request log row per call.

    reply = groq.transcribe_file(chunk.path, call=call, duration_s=chunk.duration_s)
    reply["words"]       # [{"word": " قال", "start": 0.52, "end": 0.9}, ...] (times inside this file)

Cutting long audio into chunks and putting the words back on the lecture's clock stays in
features/transcription (it is about audio, not about the provider). Busy answers (429, 5xx) and dropped
connections are retried (Retry-After, at most 60 s, else 2 s then 4 s); a wrong key is not. The cost saved is
Groq's price for the audio's length (billed per hour, at least 10 seconds a request).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from wahy.core.ai.http import HttpSender, RetryPolicy, response_body
from wahy.core.ai.log import RequestLog
from wahy.core.ai.types import AiError, Call

URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MODEL = "whisper-large-v3-turbo"
PRICE_PER_HOUR = 0.04  # $ per hour of audio for whisper-large-v3-turbo
MIN_BILLED_S = 10.0
ARABIC_PROMPT = (
    "إن الحمد لله نحمده ونستعينه ونستغفره، قال الله تعالى في القرآن الكريم، "
    "وقال رسول الله صلى الله عليه وسلم في الحديث الصحيح:"
)


def audio_cost(duration_s: float | None) -> float | None:
    if duration_s is None:
        return None
    return max(MIN_BILLED_S, duration_s) / 3600 * PRICE_PER_HOUR


class GroqAsr:
    name = "groq"

    def __init__(
        self,
        log: RequestLog,
        key: Callable[[], str | None],
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        attempts: int = 3,
    ):
        self.log, self._key = log, key
        self.http = HttpSender(log, provider=self.name, transport=transport, sleep=sleep)
        self.policy = RetryPolicy(attempts=attempts, delays=(2.0, 4.0, 8.0), max_wait_s=60.0, timeout_s=300.0)

    def has_key(self) -> bool:
        return bool(self._key())

    def transcribe_file(
        self,
        path: Path,
        *,
        call: Call,
        duration_s: float | None = None,
        language: str = "ar",
        prompt: str = ARABIC_PROMPT,
    ) -> dict[str, Any]:
        key = self._key()
        if not key:
            raise AiError("no Groq API key: set GROQ_API_KEY in .env, or pick a local model", fatal=True)
        form = {
            "model": MODEL,
            "language": language,
            "response_format": "verbose_json",
            "prompt": prompt,
            "timestamp_granularities[]": ["word", "segment"],
        }
        logged = {**form, "file": {"name": path.name, "bytes": path.stat().st_size, "duration_s": duration_s}}

        def send(client: httpx.Client) -> httpx.Response:
            with open(path, "rb") as fp:
                return client.post(
                    URL,
                    headers={"Authorization": f"Bearer {key}"},
                    files={"file": (path.name, fp, "audio/mpeg")},
                    data=form,
                )

        reply = self.http.post(
            URL, call=call, model=MODEL, policy=self.policy, logged_request=logged, send=send
        )
        data = response_body(reply.response)
        ok = reply.response.status_code == 200 and isinstance(data, dict)
        error = (
            None
            if ok
            else f"Groq rejected the request (HTTP {reply.response.status_code}: {reply.response.text[:300]})"
        )
        rid = self.log.save(
            provider=self.name,
            model=MODEL,
            call=call,
            ok=ok,
            request=logged,
            response=data,
            error=error,
            cost_usd=audio_cost(duration_s) if ok else None,
            latency_ms=reply.latency_ms,
        )
        if not ok:
            raise AiError(
                error or "",
                status=reply.response.status_code,
                fatal=reply.response.status_code in (401, 403),
                request_id=rid,
            )
        return data
