"""The one door to every model (ADR 0004). The server builds one `AiLayer` at start-up (`app.state.ai`);
features ask it, and never call a provider's HTTP API themselves.

    ai = AiLayer(db, settings, gpu)
    answers = ai.verify("gemini", items, call=call, options=GeminiOptions(rpm=5))
    ai.preview("gemini", items[:5], GeminiOptions())   # the request it would send, not sent
    ai.laya.envelope().version            # which envelope Laya's checkpoint reads
    ai.catalog.search("deepseek")         # OpenRouter models with live prices
    ai.groq.transcribe_file(path, call=call)

Verifiers (GLOSSARY: Verifier) all answer `verify(items, *, call, options) -> [Answer]`:

    gemini      Google Gemini, batches of 5 to 10, free-tier pacer          GeminiOptions
    jev         OpenRouter's Decisions API (JEV), calibrated probabilities  JevOptions
    openrouter  any OpenRouter chat model, JSON mode                        ChatOptions
    laya        the local fine-tuned model, through the GPU owner           LayaOptions
    fake        instant canned answers, for tests                           (none)

Keys come from the settings (the gitignored .env) at the moment of each call, so a key saved in the settings
screen works at once. JEV uses the JEV key if one is set, else the OpenRouter key.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Protocol

import httpx

from wahy.core.ai.fake import FakeVerifier
from wahy.core.ai.gemini import GeminiProvider
from wahy.core.ai.groq import GroqAsr
from wahy.core.ai.laya_local import LayaLocal
from wahy.core.ai.log import RequestLog
from wahy.core.ai.openrouter import Catalog, JevProvider, OpenRouterChatProvider
from wahy.core.ai.pacer import Pacer
from wahy.core.ai.types import AiError, Answer, Call, Item
from wahy.core.db import Database
from wahy.core.gpu import GpuOwner
from wahy.core.settings import Settings

VERIFIERS = ("gemini", "jev", "openrouter", "laya", "fake")


class Verifier(Protocol):
    name: str

    def verify(self, items: list[Item], *, call: Call, options: Any = None) -> list[Answer]: ...

    def preview(self, items: list[Item], options: Any = None) -> dict[str, Any]: ...


class AiLayer:
    def __init__(
        self,
        db: Database | None,
        settings: Settings,
        gpu: GpuOwner,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        laya: LayaLocal | None = None,
        fake: FakeVerifier | None = None,
    ):
        self.settings = settings
        self.log = RequestLog(db)
        self.catalog = Catalog(transport=transport)
        self.gemini = GeminiProvider(
            self.log, lambda: settings.key("gemini"), transport=transport, sleep=sleep, pacer=Pacer()
        )
        self.jev = JevProvider(
            self.log,
            lambda: settings.key("jev") or settings.key("openrouter"),
            transport=transport,
            sleep=sleep,
        )
        self.openrouter = OpenRouterChatProvider(
            self.log,
            lambda: settings.key("openrouter"),
            self.catalog,
            self.jev,
            transport=transport,
            sleep=sleep,
        )
        self.groq = GroqAsr(self.log, lambda: settings.key("groq"), transport=transport, sleep=sleep)
        self.laya = laya or LayaLocal(self.log, gpu)
        self.fake = fake or FakeVerifier(self.log)

    def verifier(self, name: str) -> Verifier:
        if name not in VERIFIERS:
            raise AiError(f"unknown verifier {name!r}; use one of {', '.join(VERIFIERS)}", fatal=True)
        return getattr(self, name)

    def verify(self, name: str, items: list[Item], *, call: Call, options: Any = None) -> list[Answer]:
        """Ask verifier `name` about `items`; one Answer per item, in order. Raises AiError when a request
        fails (`fatal`: the next items would fail the same way)."""
        return self.verifier(name).verify(items, call=call, options=options)

    def preview(self, name: str, items: list[Item], options: Any = None) -> dict[str, Any]:
        """What one request of verifier `name` for `items` would send, without sending it:
        {endpoint, model, body}. Gemini puts all of `items` in the request; the others take the first."""
        return self.verifier(name).preview(items, options)

    def ready(self) -> dict[str, bool]:
        """Which verifiers can be asked now (a key is set, Laya is installed)."""
        key = self.settings.key
        return {
            "gemini": key("gemini") is not None,
            "jev": (key("jev") or key("openrouter")) is not None,
            "openrouter": key("openrouter") is not None,
            "laya": self.laya.status().installed,
            "fake": True,
        }
