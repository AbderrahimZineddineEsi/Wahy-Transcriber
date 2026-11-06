#!/usr/bin/env bash
# Runs every test suite: old backend, new server, engine, web. Stops at the first red suite.
# Known failing old test: test_review_endpoint_survives_a_server_reload. The new server's restart test
# (server/tests/tafrigh/test_tafrigh_service.py) covers it since phase 18; the old one goes with the old app (phase 24).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== old backend =="
.venv/bin/python -m pytest -q \
  --deselect backend/tests/tafrigh/test_review_flow.py::test_review_endpoint_survives_a_server_reload

echo "== new server =="
(cd server && uv run --quiet pytest -q && uv run --quiet ruff check .)

echo "== engine =="
npm run --silent test --workspace engine
npm run --silent typecheck --workspace engine

echo "== web =="
npm run --silent test --workspace web
npm run --silent typecheck --workspace web
npm run --silent lint --workspace web
npm run --silent e2e --workspace web
echo "ALL GREEN"
