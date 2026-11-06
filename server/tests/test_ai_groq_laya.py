"""Groq (moved to core/ai), local Laya through the real GPU owner with a fake model (F-093, F-097, F-098), the fake
verifier, the AiLayer and its routes."""

from __future__ import annotations

import json

import httpx
import pytest
from ai_helpers import Replay, Waits, item, ok

from wahy.core.ai.fake import FakeVerifier
from wahy.core.ai.groq import GroqAsr, audio_cost
from wahy.core.ai.laya_local import (
    LayaLocal,
    LayaOptions,
    LoadedLaya,
    envelope_from_config,
    read_checkpoint_config,
)
from wahy.core.ai.layer import VERIFIERS, AiLayer
from wahy.core.ai.log import RequestLog
from wahy.core.ai.models import AiRequest
from wahy.core.ai.types import AiError, Call
from wahy.core.gpu import GpuOwner
from wahy.core.jobs import JobCancelled

# ---- Groq -------------------------------------------------------------------------------------------------------


def test_groq_sends_the_file_and_logs_the_audio_cost(db, tmp_path):
    audio = tmp_path / "chunk.mp3"
    audio.write_bytes(b"ID3fake")
    replay = Replay(ok("groq_verbose"))
    groq = GroqAsr(RequestLog(db), lambda: "gsk_" + "k" * 30, transport=replay.transport, sleep=Waits().sleep)
    data = groq.transcribe_file(audio, call=Call(purpose="transcribe"), duration_s=1800.0)
    assert [w["word"].strip() for w in data["words"]] == ["قال", "الله", "تعالى"]
    req = replay.requests[0]
    assert str(req.url).endswith("/audio/transcriptions") and b"whisper-large-v3-turbo" in req.content
    with db.session() as s:
        row = s.query(AiRequest).one()
        assert (row.provider, row.purpose, row.cost_usd) == ("groq", "transcribe", pytest.approx(0.02))
        assert row.request["file"] == {"name": "chunk.mp3", "bytes": 7, "duration_s": 1800.0}
    assert audio_cost(3.0) == pytest.approx(10 / 3600 * 0.04)        # at least 10 seconds are billed


def test_groq_wrong_key_is_fatal(tmp_path):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    groq = GroqAsr(RequestLog(None), lambda: "gsk_bad", transport=Replay(httpx.Response(401, text="bad")).transport)
    with pytest.raises(AiError, match="HTTP 401") as e:
        groq.transcribe_file(audio, call=Call())
    assert e.value.fatal


# ---- Laya -------------------------------------------------------------------------------------------------------

V3_CONFIG = {"max_len": 2048, "head_max_len": 256, "wahy_envelope": 3, "wahy_envelope_options": {"passages": True},
             "wahy_questions": ["verdict"]}


class FakeAgent:
    """What `laya.load(...)` returns, as far as the app uses it."""

    def __init__(self, answers=None, error=None):
        self.cfg = dict(V3_CONFIG)
        self.answers, self.error, self.seen = answers, error, []

    def predict(self, state, questions, max_len):
        self.seen.append((state, questions, max_len))
        if self.error:
            raise RuntimeError(self.error)
        return {"answers": self.answers or {
            "verdict": {"choice": "CORRECT", "confidence": 0.97,
                        "probabilities": {"CORRECT": 0.97, "FALSE": 0.02, "NOT_SURE": 0.01}},
            "start_missing": {"noul": 0.1}, "end_missing": {"noul": 0.8}}}


class Loads:
    def __init__(self, agent=None):
        self.agent = agent or FakeAgent()
        self.calls: list[tuple[str, str]] = []

    def __call__(self, checkpoint, device):
        self.calls.append((checkpoint, device))
        return LoadedLaya(self.agent, checkpoint, "cpu" if device == "cpu" else "cuda", dict(self.agent.cfg))


def laya_with(db=None, loads=None, configs=None):
    gpu = GpuOwner(free_memory=lambda: None, poll_s=0.01)
    gpu.register("whisper:small", load=lambda: "whisper")
    loads = loads or Loads()
    laya = LayaLocal(RequestLog(db), gpu, loader=loads, read_config=lambda c: (configs or {}).get(c),
                     installed=lambda: True, vram=lambda: {"cuda_available": True, "free_mb": 1500.0})
    return laya, gpu, loads


def test_the_envelope_version_comes_from_the_checkpoints_config(tmp_path, monkeypatch):
    """F-093: a v3 checkpoint reads envelope 3; one without `wahy_envelope` (the base model) reads 1."""
    folder = tmp_path / "my-checkpoint"
    folder.mkdir()
    (folder / "rl_agent_config.json").write_text(json.dumps(V3_CONFIG))
    info = envelope_from_config(read_checkpoint_config(str(folder)))
    assert (info.version, info.options, info.questions, info.max_len) == (3, {"passages": True}, ["verdict"], 2048)
    assert envelope_from_config({"max_len": 1024}).version == 1

    # a Hugging Face repo id is found in the local cache without the network
    hub = tmp_path / "hub" / "models--Owner--laya-x"
    (hub / "refs").mkdir(parents=True)
    (hub / "refs" / "main").write_text("abc123")
    (hub / "snapshots" / "abc123").mkdir(parents=True)
    (hub / "snapshots" / "abc123" / "rl_agent_config.json").write_text(json.dumps({"wahy_envelope": 2}))
    monkeypatch.setenv("HF_HUB_CACHE", str(tmp_path / "hub"))
    assert read_checkpoint_config("Owner/laya-x") == {"wahy_envelope": 2}
    assert read_checkpoint_config("Owner/not-downloaded") is None


def test_laya_status_before_and_after_loading():
    """F-097: the status shows loaded or not, the device, VRAM and the envelope version."""
    laya, gpu, loads = laya_with(configs={"ckpt/a": V3_CONFIG})
    laya.select("ckpt/a")
    before = laya.status()
    assert (before.loaded, before.device, before.envelope.version) == (False, None, 3)  # known before loading
    after = laya.load(device="cuda")
    assert (after.loaded, after.checkpoint, after.device, after.envelope.version) == (True, "ckpt/a", "cuda", 3)
    assert after.vram["free_mb"] == 1500.0 and gpu.status().resident == "laya:ckpt/a"
    assert laya.unload().loaded is False and gpu.status().resident is None
    with pytest.raises(ValueError, match="unknown device"):
        laya.select(device="tpu")


def test_laya_and_whisper_take_turns_on_the_gpu():
    """F-098: load Laya, then use Whisper: Laya is unloaded first and is loaded again when it is needed."""
    laya, gpu, loads = laya_with()
    laya.load("ckpt/a")
    with gpu.use("whisper:small") as whisper:
        assert whisper == "whisper" and laya.status().loaded is False
    laya.verify([item("1")], call=Call())
    assert loads.calls == [("ckpt/a", "auto"), ("ckpt/a", "auto")] and laya.status().loaded


def test_choosing_another_device_loads_it_again():
    laya, gpu, loads = laya_with()
    laya.load("ckpt/a", "cpu")
    laya.load("ckpt/a", "cpu")                      # same choice: nothing is reloaded
    laya.load("ckpt/a", "cuda")
    assert loads.calls == [("ckpt/a", "cpu"), ("ckpt/a", "cuda")]


def test_laya_verifies_each_item_without_the_engines_own_score(db):
    laya, _gpu, loads = laya_with(db)
    a, b = laya.verify([item("1"), item("2")], call=Call(purpose="verify"), options=LayaOptions(checkpoint="ckpt/a"))
    state, _questions, max_len = loads.agent.seen[0]
    assert "engine_score" not in state and "engine_confidence_band" not in state and max_len == 2048
    assert (a.verdict, a.probabilities["CORRECT"], a.end_missing, a.provider) == ("CORRECT", 0.97, 0.8, "laya")
    with db.session() as s:
        rows = s.query(AiRequest).order_by(AiRequest.id).all()
    assert [r.id for r in rows] == [a.request_id, b.request_id]
    assert rows[0].cost_usd == 0.0 and rows[0].request["checkpoint"] == "ckpt/a"
    assert rows[0].response["answers"]["verdict"]["choice"] == "CORRECT"


def test_a_laya_failure_is_logged_and_a_cancel_stops_between_items(db):
    laya, _gpu, _ = laya_with(db, loads=Loads(FakeAgent(error="CUDA error: no kernel image")))
    with pytest.raises(AiError, match="no kernel image") as e:
        laya.verify([item("1")], call=Call())
    with db.session() as s:
        assert s.get(AiRequest, e.value.request_id).ok is False

    laya, _gpu, loads = laya_with()
    checks = []

    def check():
        checks.append(1)
        if len(loads.agent.seen) >= 1:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        laya.verify([item("1"), item("2"), item("3")], call=Call(check=check))
    assert len(loads.agent.seen) == 1


# ---- the fake, the layer and the routes -------------------------------------------------------------------------


def test_the_fake_verifier_answers_logs_and_can_fail(db):
    fake = FakeVerifier(RequestLog(db), answer=lambda it: {"verdict": "FALSE"}, fail={"bad"}, fatal_fail={"worse"})
    (a,) = fake.verify([item("1")], call=Call())
    assert a.verdict == "FALSE" and a.request_id is not None and fake.calls == [["1"]]
    with pytest.raises(AiError) as e:
        fake.verify([item("bad")], call=Call())
    assert not e.value.fatal
    with pytest.raises(AiError) as e:
        fake.verify([item("worse")], call=Call())
    assert e.value.fatal


def test_the_layer_routes_by_verifier_name_and_reads_keys_at_call_time(db, settings):
    laya, gpu, _ = laya_with(db)
    ai = AiLayer(db, settings, gpu, laya=laya)
    assert set(VERIFIERS) == {"gemini", "jev", "openrouter", "laya", "fake"}
    assert ai.verify("fake", [item("1")], call=Call())[0].verdict == "CORRECT"
    assert ai.ready() == {"gemini": False, "jev": False, "openrouter": False, "laya": True, "fake": True}
    settings.set_key("openrouter", "sk-or-v1-" + "b" * 40)
    assert ai.ready()["jev"] and ai.ready()["openrouter"]          # JEV falls back to the OpenRouter key
    with pytest.raises(AiError, match="unknown verifier"):
        ai.verify("gpt", [item("1")], call=Call())


def test_the_settings_routes_for_models_and_laya(client):
    state = client.app.state
    laya, gpu, _ = laya_with(configs={"ZenoAbderrahim/laya-wahy-r6-v3_mixed": V3_CONFIG})
    state.ai = AiLayer(state.db, state.settings, gpu, laya=laya)
    state.ai.catalog.transport = Replay(ok("openrouter_models")).transport

    r = client.get("/api/settings/ai/openrouter/models", params={"q": "deepseek"})
    assert r.status_code == 200 and r.json()[1]["id"] == "deepseek/deepseek-chat"
    assert r.json()[1]["prompt_price_per_m"] == 0.27
    assert client.get("/api/settings/ai/openrouter/models", params={"category": "nope"}).status_code == 422

    assert client.get("/api/settings/ai/gemini/models").status_code == 424        # no key: a clear refusal

    status = client.get("/api/settings/laya").json()
    assert status["loaded"] is False and status["envelope"]["version"] == 3
    loaded = client.post("/api/settings/laya/load", json={"device": "cpu"}).json()
    assert (loaded["loaded"], loaded["device"]) == (True, "cpu")
    assert client.post("/api/settings/laya/load", json={"device": "tpu"}).status_code == 422
    assert client.post("/api/settings/laya/unload").json()["loaded"] is False
