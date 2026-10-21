"""Human review queue: why an item is queued, and confirm / correct really take it out."""

import json

import httpx
from fastapi.testclient import TestClient

from backend.tafrigh.adapters.jev_adapter import JEVAdapter
from backend.tafrigh.review_queue import ReviewQueueManager
from backend.tafrigh.pipeline import TafrighPipeline
from backend.tafrigh.schemas import PipelineConfig

KEY = "sk-or-v1-" + "b" * 40


def unsure_jev():
    """Every tag answer is a 57/43 coin-flip between paragraph and continuation."""

    def handler(req):
        body = json.loads(req.content)
        out = {}
        for k, q in body["questions"].items():
            opts = list(q["criteria"])
            if k == "tag":
                pick = "paragraph"
                out[k] = {"choice": pick, "confidence": 0.14, "probabilities": {"paragraph": 0.57, "continuation": 0.43}}
            else:
                out[k] = {"choice": "false", "probabilities": {"false": 0.9, "true": 0.1}}
        return httpx.Response(200, json={"answers": out})

    return JEVAdapter(api_key=KEY, transport=httpx.MockTransport(handler), sleep_fn=lambda s: None)


def run_three():
    pipe = TafrighPipeline(PipelineConfig(model_candidate="jev_hybrid"), adapters={"jev": unsure_jev()})
    return pipe.run(raw_text="هذه جملة أولى في الدرس. وهذه جملة ثانية فيه. وهذه ثالثة وأخيرة.")


def test_low_confidence_items_say_why_and_leave_the_queue_once_reviewed():
    res = run_three()
    mgr = ReviewQueueManager(res.segments)
    items = mgr.get_items()
    assert len(items) == 3
    assert "low_confidence" in items[0].reasons and items[0].tag_probabilities == {"paragraph": 0.57, "continuation": 0.43}

    mgr.confirm_decision(items[0].segment_id)
    from backend.tafrigh.models import StructuralTag
    mgr.correct_decision(items[1].segment_id, corrected_tag=StructuralTag.CONTINUATION)
    left = mgr.get_items()
    assert [i.segment_id for i in left] == [items[2].segment_id]
    assert res.segments[1].final_decision.tag == StructuralTag.CONTINUATION


def test_review_endpoint_survives_a_server_reload(monkeypatch, tmp_path):
    import backend.app as A

    monkeypatch.chdir(tmp_path)                     # run folders + session.json land in tmp
    monkeypatch.setattr(A, "JEVAdapter", lambda **kw: unsure_jev())
    monkeypatch.setattr(A, "GLOBAL_TRAINING_STORE", A.TrainingStore(str(tmp_path / "train.jsonl")))
    c = TestClient(A.app)
    r = c.post("/api/tafrigh/run", json={"raw_text": "هذه جملة أولى في الدرس. وهذه جملة ثانية فيه.",
                                         "model_candidate": "jev_hybrid", "openrouter_api_key": KEY}).json()
    assert r["success"] and len(r["review_items"]) == 2
    A.ACTIVE_TAFRIGH_SESSIONS.clear()               # what a uvicorn --reload does to the in-memory runs
    seg = r["review_items"][0]["segment_id"]
    out = c.post("/api/tafrigh/review-action", json={"run_id": r["run_id"], "segment_id": seg, "action": "correct",
                                                      "corrected_tag": "heading", "corrected_level": 1}).json()
    assert out["success"] and len(out["review_items"]) == 1
    assert "# هذه جملة أولى" in out["markdown"]
    assert out["structured_json"]["segments"][0]["tag"] == "heading"
    rec = json.loads((tmp_path / "train.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert rec["review_status"]["provenance"] == "human_corrected"


def test_bookkeeping_flags_alone_do_not_queue_a_sentence():
    res = run_three()
    for s in res.segments:
        s.final_decision.confidence = 0.95
    res.segments[0].review_flags += ["FROM_SPLIT", "UNRELIABLE_TIMESTAMP_MAPPING"]
    res.segments[1].review_flags += ["FROM_SPLIT", "MODEL_ERROR"]
    items = ReviewQueueManager(res.segments).get_items()
    assert [i.segment_id for i in items] == [res.segments[1].id] and items[0].reasons == ["MODEL_ERROR"]
