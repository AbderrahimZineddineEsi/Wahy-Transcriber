"""The Laya export of the new app's own labels matches the golden export for the same records (ROADMAP phase
20, F-101). Skipped without data/corpus.json.

make_golden.mjs layaExport() opened the sample lecture with engine v5, gave the user's verdict to findings 0, 1
and 2 (correct, false, not sure) and put three AI verdicts on findings 3, 4 and 5. Here the same happens through
the API (the AI verdicts are written as a verification pass saves them), with the clock fixed at the golden
time. The file must be the golden one byte for byte, except the ids: the old app's were random
(`wahy_dec_<time>_<random>`) or a request id shared by every finding of a batch; the new ones are
`wahy_dec_<time>_<label id>` and `wahy_verdict_<verdict id>`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from wahy.core.settings import REPO_ROOT, Settings
from wahy.features.training import service as training_service
from wahy.features.training.models import Label
from wahy.features.verification.models import Verdict
from wahy.main import create_app

FULL_CORPUS = REPO_ROOT / "data" / "corpus.json"
GOLDEN = REPO_ROOT / "engine" / "golden"
manifest = json.loads((GOLDEN / "expected" / "manifest.json").read_text(encoding="utf-8"))
FIXED = datetime.fromtimestamp(manifest["fixed_now_ms"] / 1000, UTC).replace(tzinfo=None)
FIXED_TS = manifest["fixed_now_ms"] // 1000
TITLE = "محاضرة تجريبية — آيات وأحاديث وأذكار"

pytestmark = pytest.mark.skipif(not FULL_CORPUS.exists(), reason="data/corpus.json is missing (./run.sh downloads it)")


def test_the_new_apps_labels_export_as_the_golden_file(tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / "data", corpus_path=FULL_CORPUS, engine_max_heap_mb=3584,
                        engine_timeout_s=900, _env_file=None)
    with TestClient(create_app(settings)) as c:
        text = json.loads((GOLDEN / "inputs" / "sample.json").read_text(encoding="utf-8"))["text"].strip()
        lecture_id = c.post("/api/lectures", json={"text": text, "title": TITLE}).json()["id"]
        job = c.post(f"/api/lectures/{lecture_id}/detect", json={"engine": "v5"}).json()["job"]
        assert c.app.state.jobs.wait(job["id"], timeout=900).status == "done"
        found = sorted(c.get(f"/api/lectures/{lecture_id}/findings").json()["findings"], key=lambda f: f["idx"])
        assert len(found) >= 6

        for f, v in zip(found[:3], ["CORRECT", "FALSE", "NOT_SURE"], strict=True):
            assert c.put(f"/api/findings/{f['id']}/verdict", json={"verdict": v}).status_code == 200
        ai = [
            Verdict(finding_id=found[3]["id"], verifier="gemini", model="gemini-3.5-flash-lite", verdict="CORRECT",
                    confidence=0.91, boundary="MISSING_END",
                    details={"probabilities": {"CORRECT": 0.91, "FALSE": 0.06, "NOT_SURE": 0.03},
                             "boundary_confidence": 0.8,
                             "boundary_probabilities": {"COMPLETE_SPAN": 0.1, "MISSING_START": 0.05,
                                                        "MISSING_END": 0.8, "MISSING_BOTH": 0.05}}),
            # the old app's provider name, as the golden record has it
            Verdict(finding_id=found[4]["id"], verifier="openrouter_chat", model=None, verdict="FALSE",
                    confidence=0.7),
            Verdict(finding_id=found[5]["id"], verifier="gemini", model="gemini-3.5-flash-lite", verdict="CORRECT"),
        ]
        with c.app.state.db.session() as s:
            for v in ai:
                v.created_at = FIXED
                s.add(v)
            for lab in s.query(Label):
                lab.created_at = lab.updated_at = FIXED
            s.flush()
            label_ids = [lab.id for lab in s.query(Label).order_by(Label.id)]
            verdict_ids = [v.id for v in ai]
        monkeypatch.setattr(training_service, "utcnow", lambda: FIXED)

        got = c.get("/api/training/export").text

    expected = []
    new_ids = [f"wahy_dec_{FIXED_TS}_{i}" for i in label_ids] + [f"wahy_verdict_{i}" for i in verdict_ids]
    for line, new_id in zip((GOLDEN / "expected" / "laya_export.jsonl").read_text(encoding="utf-8").splitlines(),
                            new_ids, strict=True):
        old_id = json.loads(line)["id"]
        assert line.startswith(f'{{"id":"{old_id}",')
        expected.append(line.replace(f'{{"id":"{old_id}",', f'{{"id":"{new_id}",', 1))
    assert got == "\n".join(expected) + "\n"
