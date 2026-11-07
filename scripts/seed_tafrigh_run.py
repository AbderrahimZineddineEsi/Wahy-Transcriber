"""Make a finished Tafrigh run offline, for the web app's Playwright test (and for looking at the screens).

    cd server && uv run python ../scripts/seed_tafrigh_run.py <data dir> <lecture id> [sentences]

It runs the real Tafrigh service on a throw-away app and data folder, with the fake provider server that the server's
tests use as the model (every sentence lands in the review queue), then copies the run folder into
`<data dir>/tafrigh_runs/` with the lecture id of the running app. It prints the run id.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER))

from fastapi.testclient import TestClient  # noqa: E402

from tests.tafrigh.helpers import make_ai, unsure_transport  # noqa: E402
from wahy.core.settings import Settings  # noqa: E402
from wahy.main import create_app  # noqa: E402


def main(data_dir: Path, lecture_id: int, sentences: int) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        settings = Settings(data_dir=tmp_path / "data", env_path=tmp_path / ".env", _env_file=None)
        with TestClient(create_app(settings)) as client:
            service = client.app.state.tafrigh
            service.ai = make_ai(unsure_transport(), db=client.app.state.db)
            service.settings = service.ai.settings
            service.settings.tafrigh_runs_dir = settings.tafrigh_runs_dir
            lecture = client.post("/api/lectures/sample").json()["id"]
            r = client.post(f"/api/lectures/{lecture}/tafrigh/runs",
                            json={"model_candidate": "jev_hybrid", "first_n": sentences, "name": "تفريغ الاختبار"})
            assert r.status_code == 202, r.text
            job = client.app.state.jobs.wait(r.json()["job"]["id"], timeout=60)
            assert job.status == "done", job
            run_id = job.result["run_id"]
        source = settings.tafrigh_runs_dir / run_id
        target = data_dir / "tafrigh_runs" / run_id
        shutil.copytree(source, target)
        # the run belongs to the lecture of the app that will show it
        for name in ("session.json", "meta.json"):
            path = target / name
            doc = json.loads(path.read_text(encoding="utf-8"))
            meta = doc["meta"] if name == "session.json" else doc
            meta["lecture_id"] = lecture_id
            if name == "session.json":
                doc["manifest"]["lecture_id"] = lecture_id
            path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        return run_id


if __name__ == "__main__":
    print(main(Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 8))
