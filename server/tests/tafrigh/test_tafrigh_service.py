"""Tafrigh through the API: preview, a run as a job, stop, review that survives a restart, clone, compare.
The model is a fake provider server behind the real AI layer (tests/tafrigh/helpers.py)."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from wahy.core.settings import Settings
from wahy.main import create_app

from .helpers import make_ai, unsure_transport


@pytest.fixture
def api(client: TestClient):
    """The app, its AI layer replaced by one over `use(transport)` (the key is set)."""
    svc = client.app.state.tafrigh

    def use(transport: httpx.BaseTransport | None, key: str | None = "sk-or-v1-" + "c" * 40) -> None:
        svc.ai = make_ai(transport, key, client.app.state.db)
        svc.settings = svc.ai.settings
        svc.settings.tafrigh_runs_dir = client.app.state.settings.tafrigh_runs_dir

    client.use = use
    return client


def sample(client) -> int:
    return client.post("/api/lectures/sample").json()["id"]


def finish(client, started: dict, timeout: float = 30) -> dict:
    return client.app.state.jobs.wait(started["job"]["id"], timeout=timeout).model_dump()


def run(client, lecture_id: int, **body) -> dict:
    r = client.post(f"/api/lectures/{lecture_id}/tafrigh/runs", json=body)
    assert r.status_code == 202, r.text
    job = finish(client, r.json())
    assert job["status"] == "done", job
    return job


def test_preview_shows_the_sentences_and_statistics_before_any_model_call(api):
    lid = sample(api)
    r = api.post(f"/api/lectures/{lid}/tafrigh/preview", json={"seg_config": {"max_words": 10}})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["stats"]["sentences"] == len(data["sentences"]) > 5
    assert max(s["words"] for s in data["sentences"]) <= 10          # F-107: the cap is respected
    assert data["stats"]["cut_reasons"] and data["words"] > 0


def test_a_run_is_a_job_that_saves_a_folder_and_lists_as_a_saved_run(api):
    api.use(unsure_transport())
    lid = sample(api)
    job = run(api, lid, model_candidate="jev_hybrid", first_n=6, name="الأولى")
    run_id = job["result"]["run_id"]
    assert job["result"]["sentences"] == 6
    folder = api.app.state.settings.tafrigh_runs_dir / run_id
    assert (folder / "session.json").is_file() and (folder / "report.json").is_file()

    runs = api.get("/api/tafrigh/runs", params={"lecture_id": lid}).json()
    assert [r["run_id"] for r in runs] == [run_id] and runs[0]["name"] == "الأولى"
    assert runs[0]["needs_review"] == 6 and runs[0]["target_range"] == [0, 6]

    detail = api.get(f"/api/tafrigh/runs/{run_id}").json()
    assert len(detail["structured_json"]["segments"]) == 6 and detail["markdown"] and detail["html"]
    # the request log (telemetry) saw every request, attributed to this job
    with api.app.state.db.session() as s:
        from sqlalchemy import func, select

        from wahy.core.ai.models import AiRequest
        n = s.scalar(select(func.count()).select_from(AiRequest).where(AiRequest.job_id == job["id"]))
    assert n >= 6


def test_a_relabel_survives_a_server_restart(api, settings: Settings):
    """The test that failed in the old app: its runs lived in memory and a reload lost them."""
    api.use(unsure_transport())
    lid = sample(api)
    job = run(api, lid, model_candidate="jev_hybrid", first_n=4)
    run_id = job["result"]["run_id"]
    detail = api.get(f"/api/tafrigh/runs/{run_id}").json()
    seg = detail["review_items"][0]["segment_id"]

    r = api.post(f"/api/tafrigh/runs/{run_id}/review",
                 json={"segment_id": seg, "action": "correct", "corrected_tag": "heading", "corrected_level": 1})
    assert r.status_code == 200, r.text
    assert len(r.json()["review_items"]) == 3
    api.app.state.tafrigh.store.forget_cache()

    with TestClient(create_app(settings)) as fresh:         # a new process: nothing in memory
        again = fresh.get(f"/api/tafrigh/runs/{run_id}").json()
        by_id = {s["id"]: s for s in again["structured_json"]["segments"]}
        assert by_id[seg]["tag"] == "heading" and by_id[seg]["level"] == 1
        assert len(again["review_items"]) == 3
        assert any(h["segment_id"] == seg for h in again["outline"])
        assert [x["run_id"] for x in fresh.get("/api/tafrigh/runs").json()] == [run_id]


def test_clone_is_independent_and_compare_lists_the_sentences_that_differ(api):
    api.use(unsure_transport())
    lid = sample(api)
    run_id = run(api, lid, model_candidate="jev_hybrid", first_n=5)["result"]["run_id"]
    clone = api.post(f"/api/tafrigh/runs/{run_id}/clone", json={"name": "نسخة"}).json()
    assert clone["run_id"] != run_id and clone["copied_from"] == run_id and clone["name"] == "نسخة"
    seg = api.get(f"/api/tafrigh/runs/{clone['run_id']}").json()["review_items"][0]["segment_id"]
    api.post(f"/api/tafrigh/runs/{clone['run_id']}/review",
             json={"segment_id": seg, "action": "correct", "corrected_tag": "comment"})

    original = {s["id"]: s["tag"] for s in api.get(f"/api/tafrigh/runs/{run_id}").json()["structured_json"]["segments"]}
    assert original[seg] != "comment"                               # the first run is unchanged

    cmp = api.post("/api/tafrigh/compare", json={"run_ids": [run_id, clone["run_id"]]}).json()
    assert [r["name"] for r in cmp["runs"]][1] == "نسخة"
    diffs = cmp["comparisons"][0]["disagreements"]
    assert [d["segment_id"] for d in diffs] == [seg] and "comment" in diffs[0]["run_b"]
    assert "Per-Segment Disagreements" in cmp["markdown"]


def test_rename_delete_and_unknown_runs(api):
    api.use(unsure_transport())
    run_id = run(api, sample(api), model_candidate="jev_hybrid", first_n=3)["result"]["run_id"]
    assert api.patch(f"/api/tafrigh/runs/{run_id}", json={"name": "جديد"}).json()["name"] == "جديد"
    assert api.delete(f"/api/tafrigh/runs/{run_id}").status_code == 204
    assert api.get(f"/api/tafrigh/runs/{run_id}").status_code == 404
    assert api.get("/api/tafrigh/runs/..%2f..%2fetc").status_code == 404
    assert api.get("/api/tafrigh/runs/run_0123456789ab").status_code == 404


def test_export_files(api):
    api.use(unsure_transport())
    run_id = run(api, sample(api), model_candidate="jev_hybrid", first_n=3, name="تصدير")["result"]["run_id"]
    md = api.get(f"/api/tafrigh/runs/{run_id}/export", params={"format": "md"}).json()
    html = api.get(f"/api/tafrigh/runs/{run_id}/export", params={"format": "html"}).json()
    js = api.get(f"/api/tafrigh/runs/{run_id}/export", params={"format": "json"}).json()
    assert md["filename"].endswith(".md") and md["content"].strip()
    assert html["content"].startswith("<!DOCTYPE html>") and 'dir="rtl"' in html["content"]
    assert len(json.loads(js["content"])["segments"]) == 3


def test_stop_keeps_the_finished_sentences(api):
    state = {"n": 0}
    inner = unsure_transport()

    def handler(req: httpx.Request) -> httpx.Response:
        state["n"] += 1
        if state["n"] == 9:            # a few sentences in: the user presses stop
            for event in list(api.app.state.tafrigh._stops.values()):
                event.set()
        return inner.handle_request(req)

    api.use(httpx.MockTransport(handler))
    job = run(api, sample(api), model_candidate="jev_hybrid", first_n=12)
    assert job["result"]["stopped"] is True
    assert 0 < job["result"]["sentences"] < 12
    assert any("إيقاف" in w for w in job["result"]["warnings"])


def test_windowed_run_sends_one_request_per_window(api):
    """F-111: 12 sentences in windows of 6 are two classification requests."""
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": []})
        body = json.loads(req.content)
        calls.append(body)
        targets = json.loads(body["messages"][1]["content"].split("\n\n")[-1])["targets"]
        decisions = [{"id": t["id"], "tag": "paragraph", "confidence": 0.95} for t in targets]
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps({"decisions": decisions})}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "cost": 0.0001}})

    api.use(httpx.MockTransport(handler))
    job = run(api, sample(api), model_candidate="openrouter_chat", openrouter_chat_model="deepseek/deepseek-chat",
              processing_mode="windowed", window_size=6, first_n=12, typo_strategy="off")
    assert len(calls) == 2 and job["result"]["sentences"] == 12
    assert job["result"]["cost_usd"] > 0


def test_a_run_without_the_needed_key_or_with_an_empty_range_is_refused_at_once(api):
    api.use(None, key=None)
    lid = sample(api)
    r = api.post(f"/api/lectures/{lid}/tafrigh/runs", json={"model_candidate": "jev_hybrid"})
    assert r.status_code == 422 and "key" in r.text
    r = api.post(f"/api/lectures/{lid}/tafrigh/runs", json={"target_range": [500, 600]})
    assert r.status_code == 422
    assert api.post("/api/lectures/999/tafrigh/preview", json={}).status_code == 404


def test_the_offline_fallback_runs_without_any_key_and_says_so(api):
    api.use(None, key=None)
    job = run(api, sample(api), first_n=5)
    assert any("مفتاح" in w for w in job["result"]["warnings"])


def test_no_run_changes_the_original_words(api):
    """F-123: Tafrigh labels and fixes typos in a copy; the speaker's words are never altered."""
    api.use(unsure_transport())
    lid = sample(api)
    preview = api.post(f"/api/lectures/{lid}/tafrigh/preview", json={}).json()
    run_id = run(api, lid, model_candidate="jev_hybrid", first_n=len(preview["sentences"]))["result"]["run_id"]
    segs = api.get(f"/api/tafrigh/runs/{run_id}").json()["structured_json"]["segments"]
    assert [s["original_text"].strip() for s in segs] == [s["text"] for s in preview["sentences"]]
