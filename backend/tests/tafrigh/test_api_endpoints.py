from fastapi.testclient import TestClient
import pytest
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app import app


def test_api_tafrigh_run_and_review():
    client = TestClient(app)
    text = (
        "الحمد لله رب العالمين. قال المصنف رحمه الله: كتاب الطهارة. "
        "باب المياه. الماء طهور لا ينجسه شيء إلا ما غلب على لونه أو طعمه أو ريحه. "
        "والشرح هنا أن المياه تنقسم إلى أقسام عند الفقهاء."
    )
    resp = client.post("/api/tafrigh/run", json={"raw_text": text})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "run_id" in data
    assert "markdown" in data
    assert "html" in data
    assert "structured_json" in data
    assert len(data["structured_json"]["segments"]) > 0

    run_id = data["run_id"]
    review_items = data.get("review_items", [])
    if review_items:
        seg_id = review_items[0]["segment_id"]
        rev_resp = client.post(
            "/api/tafrigh/review-action",
            json={"run_id": run_id, "segment_id": seg_id, "action": "confirm"},
        )
        assert rev_resp.status_code == 200
        rev_data = rev_resp.json()
        assert rev_data["success"] is True
        assert "html" in rev_data


def test_estimate_counts_requests_per_mode_without_calling_a_model():
    client = TestClient(app)
    text = " ".join(f"هذه الجملة رقم {n} من الدرس وفيها كلام." for n in range(30))
    est = client.post("/api/tafrigh/estimate", json={"raw_text": text, "target_range": [0, 30], "window_size": 10,
                                                     "jev_execution_order": "combined"}).json()
    assert est["success"] and est["sentences"] == 30
    assert est["windowed"]["requests"] == 3
    assert est["per_sentence"]["requests"] >= 30
    assert est["jev"]["requests"] == 30
    # one shared prompt per window instead of one per sentence
    assert est["windowed"]["input_tokens"] < est["per_sentence"]["input_tokens"] / 2


def test_clone_run_gives_an_independent_copy():
    client = TestClient(app)
    data = client.post("/api/tafrigh/run", json={"raw_text": "الحمد لله رب العالمين. باب المياه. الماء طهور لا ينجسه شيء."}).json()
    clone = client.post("/api/tafrigh/clone-run", json={"run_id": data["run_id"]}).json()
    assert clone["success"] and clone["run_id"] != data["run_id"]
    seg_id = data["structured_json"]["segments"][0]["id"]
    client.post("/api/tafrigh/review-action", json={"run_id": clone["run_id"], "segment_id": seg_id, "action": "correct",
                                                     "corrected_tag": "comment"})
    copy_seg = client.post("/api/tafrigh/review-action", json={"run_id": clone["run_id"], "segment_id": seg_id, "action": "confirm"}).json()
    orig_seg = client.post("/api/tafrigh/review-action", json={"run_id": data["run_id"], "segment_id": seg_id, "action": "confirm"}).json()
    assert copy_seg["structured_json"]["segments"][0]["tag"] == "comment"
    assert orig_seg["structured_json"]["segments"][0]["tag"] != "comment"
