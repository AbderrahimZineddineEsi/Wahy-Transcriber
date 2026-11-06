"""The web app's types are generated from web/src/api/openapi.json. If the server's API changes and the file
is not regenerated (`npm run api:generate` in web/), this fails, so the web app never builds against an old API."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_committed_openapi_matches_the_server():
    spec = importlib.util.spec_from_file_location("dump_openapi", ROOT / "scripts" / "dump_openapi.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    committed = (ROOT / "web" / "src" / "api" / "openapi.json").read_text(encoding="utf-8")
    assert committed == module.schema_text(), "API changed: run `npm run api:generate` in web/ and commit"
