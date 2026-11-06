"""One real call per provider (the phase 13 Feature check). Marked `live`: skipped unless you run

    cd server && uv run pytest tests/test_ai_live.py --live -v

They read the keys from the repo's real `.env`, spend a fraction of a cent each, and write the raw replies to
`data/ai_live_replies/` (git-ignored) so they can become recorded fixtures. Each test skips itself when its key
(or, for Laya, the `laya` extra and the cached checkpoint) is missing. Ask the user before running them.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from ai_helpers import item

from wahy.core.ai.gemini import GeminiOptions
from wahy.core.ai.layer import AiLayer
from wahy.core.ai.openrouter import ChatOptions, JevOptions
from wahy.core.ai.types import Call, Item
from wahy.core.gpu import GpuOwner
from wahy.core.settings import REPO_ROOT, Settings

pytestmark = pytest.mark.live
REPLIES = REPO_ROOT / "data" / "ai_live_replies"
GOLDEN_V3 = REPO_ROOT / "engine" / "golden" / "expected" / "sample" / "v5" / "envelopes.v3.p1.json"


@pytest.fixture
def ai(tmp_path):
    """The real keys (from .env) but a temporary database."""
    from wahy.core.db import Database

    settings = Settings(data_dir=tmp_path / "data", env_path=tmp_path / "unused.env")
    db = Database(settings.db_path)
    db.migrate()
    layer = AiLayer(db, settings, GpuOwner())
    yield layer
    db.dispose()


def need(ai: AiLayer, provider: str) -> None:
    if not ai.settings.key(provider):
        pytest.skip(f"no {provider} key in .env")


def keep(name: str, ai: AiLayer, request_id: int | None) -> None:
    """Save the logged request and reply, so a real reply can become a recorded fixture."""
    from wahy.core.ai.models import AiRequest

    with ai.log.db.session() as s:
        row = s.get(AiRequest, request_id)
        REPLIES.mkdir(parents=True, exist_ok=True)
        (REPLIES / f"{name}.json").write_text(json.dumps({"request": row.request, "response": row.response,
                                                          "tokens": [row.input_tokens, row.output_tokens],
                                                          "cost_usd": row.cost_usd, "latency_ms": row.latency_ms},
                                                         ensure_ascii=False, indent=2), encoding="utf-8")


def tiny() -> Item:
    return item("live-1")


def test_live_gemini(ai):
    need(ai, "gemini")
    (a,) = ai.verify("gemini", [tiny()], call=Call(purpose="test"), options=GeminiOptions(free_tier=True))
    assert a.ok, a.error
    keep("gemini", ai, a.request_id)


def test_live_jev(ai):
    if not (ai.settings.key("jev") or ai.settings.key("openrouter")):
        pytest.skip("no JEV or OpenRouter key in .env")
    (a,) = ai.verify("jev", [tiny()], call=Call(purpose="test"), options=JevOptions())
    assert a.ok and abs(sum(a.probabilities.values()) - 1) < 1e-6
    keep("jev", ai, a.request_id)


def test_live_openrouter_chat_and_catalog(ai):
    need(ai, "openrouter")
    assert any(m.id.startswith("deepseek/") for m in ai.catalog.search("deepseek"))
    (a,) = ai.verify("openrouter", [tiny()], call=Call(purpose="test"),
                     options=ChatOptions(model="deepseek/deepseek-chat", no_thinking=True))
    assert a.ok, a.error
    keep("openrouter_chat", ai, a.request_id)


def test_live_groq(ai, tmp_path):
    need(ai, "groq")
    audio = tmp_path / "beep.mp3"           # 2 seconds of tone: Groq answers (with little or no text)
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=2", str(audio)], check=True)
    data = ai.groq.transcribe_file(audio, call=Call(purpose="test"), duration_s=2.0)
    assert "text" in data


def test_live_laya_on_a_golden_envelope(ai):
    if not ai.laya.status().installed:
        pytest.skip("the laya extra is not installed (uv sync --extra laya)")
    env = ai.laya.envelope()
    if env is None:
        pytest.skip(f"{ai.laya.checkpoint} is not in the Hugging Face cache")
    assert env.version == 3
    golden = json.loads(Path(GOLDEN_V3).read_text(encoding="utf-8"))[0]
    it = Item(id="golden-0", state=golden["state"], questions=golden["questions"])
    (a,) = ai.verify("laya", [it], call=Call(purpose="test"))
    assert a.ok and a.verdict in ("CORRECT", "FALSE", "NOT_SURE")
    keep("laya", ai, a.request_id)
    ai.laya.unload()
