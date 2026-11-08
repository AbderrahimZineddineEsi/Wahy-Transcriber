#!/usr/bin/env bash
# =============================================================================
# Wahy-Finder: one-command launcher (Linux / macOS).
#
#   ./run.sh                          first run installs everything, then serves the app at http://127.0.0.1:8000
#   PORT=9000 ./run.sh                another port
#   HOST=0.0.0.0 ./run.sh             reachable from other machines (Colab and tunnels use this)
#   WAHY_EXTRAS="local-asr laya" ./run.sh
#                                     also install local Whisper (faster-whisper) and local Laya (torch)
#
# Needs: node 22.18+ (npm; the engine worker is TypeScript that node runs directly), uv (https://docs.astral.sh/uv/), ffmpeg. For development with hot reload use scripts/dev.sh.
# =============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"

echo "== Wahy-Finder =="

for tool in node npm uv; do
  command -v "$tool" >/dev/null 2>&1 || { echo "[ERROR] '$tool' is not installed or not in PATH." >&2; exit 1; }
done
node_version="$(node -p 'process.versions.node')"
node_ok="$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); (a>22||(a===22&&b>=18))?1:0')"
[ "$node_ok" = "1" ] || { echo "[ERROR] node $node_version is too old: the engine worker needs node 22.18 or newer." >&2; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || {
  echo "[WARNING] ffmpeg is not installed: transcribing audio will fail."
  echo "          sudo apt install ffmpeg (Debian/Ubuntu), brew install ffmpeg (macOS)"
}

echo "[1/4] Node packages + [2/4] web app..."
# The engine worker (engine/src/worker.ts) has no runtime packages; node_modules is only needed to build the web app,
# so a ready, up-to-date web/dist skips `npm ci` altogether (the Colab notebook restores a cached build this way).
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html web/package.json engine/src -newer web/dist/index.html -type f -print -quit)" ]; then
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci --silent
  fi
  npm run --silent build --workspace web
fi

echo "[3/4] Python packages (server)..."
extras=()
for e in ${WAHY_EXTRAS:-}; do extras+=(--extra "$e"); done
(cd server && uv sync --quiet ${extras[@]+"${extras[@]}"})

mkdir -p data
# the corpus is a public release asset of this repo; the download is checked against its sha256 (scripts/fetch_corpus.sh)
scripts/fetch_corpus.sh data/corpus.json

# API keys are read by the server itself from the gitignored .env (or saved from the Settings screen).
echo "[4/4] Serving at http://$HOST:$PORT  (Ctrl+C to stop)"
cd server
exec uv run uvicorn wahy.main:app --host "$HOST" --port "$PORT" --timeout-graceful-shutdown 5
