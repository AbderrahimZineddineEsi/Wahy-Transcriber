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
