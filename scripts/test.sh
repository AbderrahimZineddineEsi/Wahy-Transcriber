#!/usr/bin/env bash
# Runs every test suite: server, engine, web. Stops at the first red suite.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

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
