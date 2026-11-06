"""The Laya path sends the golden envelopes for the golden findings (ROADMAP phase 14, F-093, ADR 0003).

Each golden input goes through the API (detect with engine v5, then a verification pass with Laya), with a fake
Laya model that records what it reads. For every envelope version and option set a checkpoint can ask for, what
Laya read must be the old app's envelope (engine/golden/expected/<input>/v5/envelopes.*.json), less the engine
score fields Laya never sees. A prompt-driven verifier with every prompt option off reads the v1 envelopes as they
are. Skipped without data/corpus.json.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from wahy.core.ai.fake import FakeVerifier
from wahy.core.ai.laya_local import HIDDEN_STATE_KEYS, LayaLocal, LoadedLaya
from wahy.core.ai.log import RequestLog
from wahy.core.gpu import GpuOwner
from wahy.core.settings import REPO_ROOT, Settings
from wahy.features.lectures.parsing import TimedWord
from wahy.main import create_app

FULL_CORPUS = REPO_ROOT / "data" / "corpus.json"
GOLDEN = REPO_ROOT / "engine" / "golden"
manifest = json.loads((GOLDEN / "expected" / "manifest.json").read_text(encoding="utf-8"))

# golden file → the checkpoint config that asks for it
CONFIGS = {
    "envelopes.v3.p1.json": {"wahy_envelope": 3, "wahy_envelope_options": {"passages": True}},
    "envelopes.v3.p0.json": {"wahy_envelope": 3, "wahy_envelope_options": {"passages": False}},
    **{f"envelopes.v2.{tag}.json": {"wahy_envelope": 2, "wahy_envelope_options": opts}
       for tag, opts in manifest["v2_options"].items()},
    "envelopes.v1.json": {},                                     # no wahy_envelope: a run 1-2 checkpoint
}

pytestmark = pytest.mark.skipif(not FULL_CORPUS.exists(), reason="data/corpus.json is missing (./run.sh downloads it)")


class RecordingAgent:
    def __init__(self):
        self.seen: list[tuple[dict, dict]] = []

    def predict(self, state, questions, max_len):
        self.seen.append((state, questions))
        return {"answers": {"verdict": {"choice": "CORRECT", "confidence": 0.9},
                            "boundary_status": {"choice": "COMPLETE_SPAN"}}}


@pytest.fixture(scope="module")
def golden(tmp_path_factory):
    settings = Settings(data_dir=tmp_path_factory.mktemp("golden-verify") / "data", corpus_path=FULL_CORPUS,
                        engine_max_heap_mb=3584, engine_timeout_s=900, _env_file=None)
    with TestClient(create_app(settings)) as c:
        c.lectures = {}
        for name in manifest["inputs"]:
            source = json.loads((GOLDEN / "inputs" / f"{name}.json").read_text(encoding="utf-8"))
            if "text" in source:
                lecture_id = c.post("/api/lectures", json={"text": source["text"].strip(), "title": name}).json()["id"]
            else:
                lectures = c.app.state.lectures
                lecture_id = lectures.create_empty(title=name, source_kind="text")
                lectures.replace_words(lecture_id, [TimedWord(w["word"], w["start"], w["end"])
                                                    for w in source["words"]])
            job = c.post(f"/api/lectures/{lecture_id}/detect", json={"engine": "v5"}).json()["job"]
            assert c.app.state.jobs.wait(job["id"], timeout=900).status == "done"
            c.lectures[name] = lecture_id
        yield c


def expected(name: str, file: str) -> list[dict]:
    return json.loads((GOLDEN / "expected" / name / "v5" / file).read_text(encoding="utf-8"))


def verify(client, lecture_id: int, options: dict) -> None:
    started = client.post(f"/api/lectures/{lecture_id}/verification", json={"scope": "ALL", "options": options})
    assert started.status_code == 202, started.text
    job = client.app.state.jobs.wait(started.json()["job"]["id"], timeout=300)
    assert job.status == "done", job.error


@pytest.mark.parametrize("file", list(CONFIGS))
@pytest.mark.parametrize("name", list(manifest["inputs"]))
def test_laya_reads_the_golden_envelopes(golden, name, file):
    agent = RecordingAgent()
    config = CONFIGS[file]
    golden.app.state.ai.laya = LayaLocal(
        RequestLog(golden.app.state.db), GpuOwner(free_memory=lambda: None, poll_s=0.01),
        loader=lambda c, d: LoadedLaya(agent, c, "cpu", dict(config)), read_config=lambda c: dict(config),
        installed=lambda: True, vram=lambda: {})
    verify(golden, golden.lectures[name], {"provider": "laya", "laya_checkpoint": f"golden/{file}"})

    want = expected(name, file)
    assert len(agent.seen) == len(want)
    for i, ((state, questions), env) in enumerate(zip(agent.seen, want, strict=True)):
        assert state == {k: v for k, v in env["state"].items() if k not in HIDDEN_STATE_KEYS}, f"envelope {i}: state"
        assert questions == env["questions"], f"envelope {i}: questions"


@pytest.mark.parametrize("name", list(manifest["inputs"]))
def test_a_prompted_verifier_with_every_option_off_reads_the_golden_v1_envelopes(golden, name):
    seen: list[tuple[dict, dict]] = []

    def record(item):
        seen.append((item.state, item.questions))
        return {"verdict": "CORRECT"}

    golden.app.state.ai.fake = FakeVerifier(golden.app.state.ai.log, answer=record)
    off = {"ignore_asr_errors": False, "citation_cues": False, "passages": False, "suggest_merges": False}
    verify(golden, golden.lectures[name], {"provider": "fake", "prompt": {"rules": off}})
    want = expected(name, "envelopes.v1.json")
    assert [(s, q) for s, q in seen] == [(e["state"], e["questions"]) for e in want]
