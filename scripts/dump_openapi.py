"""Writes the server's OpenAPI schema to web/src/api/openapi.json (run by `npm run api:generate` in web/).

The web app's types are generated from that file, so an API change that the web code does not follow fails
the web type check. A server test fails when the committed file is out of date.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from wahy.main import app  # noqa: E402

OUT = ROOT / "web" / "src" / "api" / "openapi.json"


def schema_text() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    OUT.write_text(schema_text(), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
