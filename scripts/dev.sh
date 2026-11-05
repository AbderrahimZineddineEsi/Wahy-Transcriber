#!/usr/bin/env bash
# Starts the new server (port 8120) and the web app (port 5173, proxies /api to the server).
# The old app is still started by ./run.sh (port 8006).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

(cd server && uv run uvicorn wahy.main:app --host 127.0.0.1 --port 8120 --reload) &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
npm run dev --workspace web
