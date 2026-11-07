"""API keys for the research side: read from the app's settings (the gitignored .env at the repo root), the one
place keys are read (ADR 0004). Teachers never need this: core/ai reads their keys itself."""
from __future__ import annotations

from . import context

# the .env names the old datagen used -> the settings' provider names
_PROVIDERS = {"GEMINI_API_KEY": "gemini", "OPENROUTER_API_KEY": "openrouter", "GROQ_API_KEY": "groq",
              "JEV_API_KEY": "jev"}


def key(name: str) -> str:
    v = context.settings().key(_PROVIDERS[name])
    if not v:
        raise RuntimeError(f"{name} is not set (add it to .env, or save it in the app's settings)")
    return v
