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
# Needs: node 20+ (npm), uv (https://docs.astral.sh/uv/), ffmpeg. For development with hot reload use scripts/dev.sh.
# =============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
CORPUS_URL="https://raw.githubusercontent.com/AbderrahimZineddineEsi/Wahy-Finder/main/data/corpus.json"

echo "== Wahy-Finder =="

for tool in node npm uv; do
  command -v "$tool" >/dev/null 2>&1 || { echo "[ERROR] '$tool' is not installed or not in PATH." >&2; exit 1; }
done
command -v ffmpeg >/dev/null 2>&1 || {
  echo "[WARNING] ffmpeg is not installed: transcribing audio will fail."
  echo "          sudo apt install ffmpeg (Debian/Ubuntu), brew install ffmpeg (macOS)"
}

echo "[1/4] Node packages (engine + web)..."
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --silent
fi

echo "[2/4] Web app..."
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html web/package.json engine/src -newer web/dist/index.html -type f -print -quit)" ]; then
  npm run --silent build --workspace web
fi

echo "[3/4] Python packages (server)..."
extras=()
for e in ${WAHY_EXTRAS:-}; do extras+=(--extra "$e"); done
(cd server && uv sync --quiet ${extras[@]+"${extras[@]}"})

mkdir -p data
if [ ! -s data/corpus.json ]; then
  # The corpus (Quran + hadith, about 90 MB) lives in the Wahy-Finder repo, which is private: the plain download
  # only works if that repo is public, so fall back to the GitHub CLI (`gh auth login`) or a GITHUB_TOKEN.
  echo "Downloading the corpus (about 90 MB) into data/corpus.json ..."
  rm -f data/corpus.json.part
  if curl -fL --progress-bar -o data/corpus.json.part "$CORPUS_URL" 2>/dev/null; then
    :
  elif command -v gh >/dev/null 2>&1 && gh api -H "Accept: application/vnd.github.raw" \
         "repos/AbderrahimZineddineEsi/Wahy-Finder/contents/data/corpus.json" > data/corpus.json.part 2>/dev/null; then
    :
  elif [ -n "${GITHUB_TOKEN:-}" ] && curl -fL --progress-bar -H "Authorization: Bearer $GITHUB_TOKEN" \
         -H "Accept: application/vnd.github.raw" -o data/corpus.json.part \
         "https://api.github.com/repos/AbderrahimZineddineEsi/Wahy-Finder/contents/data/corpus.json"; then
    :
  else
    rm -f data/corpus.json.part
  fi
  if [ -s data/corpus.json.part ]; then
    mv data/corpus.json.part data/corpus.json
  else
    echo "[WARNING] could not download data/corpus.json (the Wahy-Finder repo is private)."
    echo "          Run 'gh auth login' (or set GITHUB_TOKEN) and start again, or copy the file there yourself."
    echo "          Without it the app starts, but detection will fail."
  fi
fi

# API keys are read by the server itself from the gitignored .env (or saved from the Settings screen).
echo "[4/4] Serving at http://$HOST:$PORT  (Ctrl+C to stop)"
cd server
exec uv run uvicorn wahy.main:app --host "$HOST" --port "$PORT" --timeout-graceful-shutdown 5
