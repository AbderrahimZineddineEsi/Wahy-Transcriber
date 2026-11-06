"""The engine client with the real engine worker on the small sample corpus, plus a misbehaving stand-in
worker for crashes and timeouts."""

import os
import signal
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from tests.helpers import wait_for
from wahy.core.engine import EngineClient, EngineCrashed, EngineError, EngineTimeout
from wahy.core.settings import REPO_ROOT

SMALL_CORPUS = REPO_ROOT / "engine" / "src" / "fixtures" / "small-corpus.json"
MISBEHAVING = Path(__file__).parent / "fixtures" / "misbehaving_worker.mjs"
TEXT = "قال الله تعالى قل هو الله أحد الله الصمد ثم قال النبي إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"


def timed(text: str) -> list[dict]:
    return [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4} for i, w in enumerate(text.split())]


@pytest.fixture(scope="module")
def engine():
    client = EngineClient(SMALL_CORPUS, max_heap_mb=1024, timeout_s=60)
    yield client
    client.close()


def test_the_worker_starts_on_the_first_call(engine: EngineClient):
    info = engine.info()
    assert info["quran"] == 11 and info["hadiths"] == 2
    assert "engine/src/v5.js" in info["fingerprint"]["files"]
    status = engine.status()
    assert status.running and status.pid and status.starts == 1


def test_detect_finds_the_verses(engine: EngineClient):
    # v3: v4 and v5 need a full corpus's statistics and find nothing in this 11-verse one (golden tests cover
    # them)
    findings = engine.detect(timed(TEXT), {"engine": "v3"})
    spans = [(f["unitId"], f["wordStartIdx"], f["wordEndIdx"]) for f in findings]
    assert spans == [("112:1", 3, 6), ("112:2", 7, 8)]


def test_envelopes_and_search(engine: EngineClient):
    words = timed(TEXT)
    findings = engine.detect(words, {"engine": "v3"})
    envs = engine.envelopes(findings, words, 3, {"engine": "v3", "passages": True})
    assert envs and all({"members", "state", "questions"} <= set(e) for e in envs)
    covered = sorted(i for e in envs for i in e["members"])
    assert covered == list(range(len(findings)))       # every finding is in exactly one envelope
    hits = engine.search("الصمد", {"engine": "v3"})
    assert any(h["unitId"] == "112:2" for h in hits)


def test_a_bad_request_is_an_error_and_the_worker_keeps_going(engine: EngineClient):
    pid = engine.status().pid
    with pytest.raises(EngineError, match='unknown engine "v9"'):
        engine.detect(timed(TEXT), {"engine": "v9"})
    with pytest.raises(EngineError, match="unknown command"):
        engine.call("nope")
    assert engine.status().pid == pid
    assert engine.call("tokenize", text="قالَ اللهُ تعالى") == ["قال", "الله", "تعالي"]


def test_calls_from_many_threads_each_get_their_own_answer(engine: EngineClient):
    texts = [" ".join(TEXT.split()[i:i + 4]) for i in range(12)]
    expected = [engine.call("tokenize", text=t) for t in texts]
    with ThreadPoolExecutor(8) as pool:
        got = list(pool.map(lambda t: engine.call("tokenize", text=t), texts * 3))
    assert got == expected * 3


def test_a_killed_worker_is_restarted_by_the_next_call(engine: EngineClient):
    engine.info()
    before = engine.status()
    os.kill(before.pid, signal.SIGKILL)
    wait_for(lambda: not engine.status().running, what="the worker to die")    # it crashed between two calls
    assert engine.info()["quran"] == 11
    after = engine.status()
    assert after.running and after.pid != before.pid and after.starts == before.starts + 1


def test_a_worker_that_dies_during_a_call_is_reported_and_replaced():
    client = EngineClient(SMALL_CORPUS, argv=["node", str(MISBEHAVING)], timeout_s=10)
    try:
        assert client.call("ping") == "pong"
        with pytest.raises(EngineCrashed, match=r"(?s)exit code 3.*out of memory \(pretend\)"):
            client.call("crash")
        assert client.call("ping") == "pong"
        assert client.status().starts == 2
    finally:
        client.close()


def test_a_worker_that_hangs_is_stopped_after_the_timeout():
    client = EngineClient(SMALL_CORPUS, argv=["node", str(MISBEHAVING)], timeout_s=0.5)
    try:
        with pytest.raises(EngineTimeout, match="more than 0.5 s"):
            client.call("hang")
        assert not client.status().running
        assert client.call("ping") == "pong"
    finally:
        client.close()


def test_a_missing_corpus_fails_with_the_workers_message(tmp_path):
    client = EngineClient(tmp_path / "missing.json", timeout_s=30)
    with pytest.raises(EngineCrashed, match="(?s)ENOENT|no such file"):
        client.info()
