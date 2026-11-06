"""Helpers for the Tafrigh tests: the real AI layer over a fake provider server."""

from __future__ import annotations

import json

import httpx

from wahy.core.ai.layer import AiLayer
from wahy.core.gpu import GpuOwner
from wahy.core.settings import Settings
from wahy.features.tafrigh.adapters.jev_adapter import JEVAdapter

KEY = "sk-or-v1-" + "a" * 40


def make_ai(transport=None, key=KEY, db=None):
    """The real AI layer over a fake provider server (no database: requests are not logged here)."""
    settings = Settings(openrouter_api_key=key, _env_file=None) if key else Settings(_env_file=None)
    return AiLayer(db, settings, GpuOwner(), transport=transport, sleep=lambda s: None)


def jev(transport=None, key=KEY, **kw):
    return JEVAdapter(make_ai(transport, key), **kw)


def unsure_transport() -> httpx.MockTransport:
    """A JEV whose every tag answer is a 57/43 coin-flip between paragraph and continuation, so every sentence
    lands in the review queue."""

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        out = {}
        for k in body["questions"]:
            if k == "tag":
                out[k] = {"choice": "paragraph", "confidence": 0.14,
                          "probabilities": {"paragraph": 0.57, "continuation": 0.43}}
            else:
                out[k] = {"choice": "false", "probabilities": {"false": 0.9, "true": 0.1}}
        return httpx.Response(200, json={"answers": out})

    return httpx.MockTransport(handler)


def unsure_jev() -> JEVAdapter:
    return jev(unsure_transport())
