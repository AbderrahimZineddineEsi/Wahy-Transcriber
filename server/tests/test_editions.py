"""The two editions of one codebase (docs/editions.md): studio has the research screens, tadqeeq (the product)
does not. The edition comes from WAHY_EDITION, else from the EDITION file the product export writes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from wahy.core.settings import Settings, default_edition
from wahy.main import create_app


def test_the_edition_file_names_the_edition_and_anything_else_means_studio(tmp_path):
    assert default_edition(tmp_path) == "studio"                       # no file: this repo
    (tmp_path / "EDITION").write_text("tadqeeq\n", encoding="utf-8")
    assert default_edition(tmp_path) == "tadqeeq"
    (tmp_path / "EDITION").write_text("something else", encoding="utf-8")
    assert default_edition(tmp_path) == "studio"


def test_the_environment_wins_over_the_file(monkeypatch):
    monkeypatch.setenv("WAHY_EDITION", "tadqeeq")
    assert Settings(_env_file=None).edition == "tadqeeq"


def app_of(tmp_path, edition: str) -> TestClient:
    return TestClient(create_app(Settings(data_dir=tmp_path / "data", env_path=tmp_path / ".env", edition=edition,
                                          _env_file=None)))


@pytest.mark.parametrize("edition", ["studio", "tadqeeq"])
def test_health_says_which_edition_answers(tmp_path, edition):
    with app_of(tmp_path, edition) as api:
        assert api.get("/api/health").json()["edition"] == edition


def test_tadqeeq_has_no_training_data_and_no_request_log(tmp_path):
    with app_of(tmp_path, "tadqeeq") as api:
        assert api.get("/api/training").status_code == 404
        assert api.get("/api/telemetry/requests").status_code == 404
        assert api.get("/api/lectures").status_code == 200              # the product itself is all there
        assert api.app.title == "Tadqeeq"


def test_studio_keeps_its_research_screens(tmp_path):
    with app_of(tmp_path, "studio") as api:
        assert api.get("/api/training").status_code == 200
        assert api.get("/api/telemetry/requests").status_code == 200
