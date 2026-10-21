#!/usr/bin/env bash
# =============================================================================
# Wahy-Finder v2.0 — Linux / macOS Startup Script
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================================"
echo "  Wahy-Finder v2.0 — FastAPI + Whisper/Groq Launcher"
echo "========================================================"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[WARNING] ffmpeg is not installed or not in PATH."
  echo "          Install it via: sudo apt install ffmpeg (Ubuntu/Debian) or brew install ffmpeg (macOS)"
fi

if [ ! -d ".venv" ]; then
  echo "[1/3] Creating Python virtual environment (.venv)..."
  python3 -m venv .venv
fi

echo "[2/3] Activating virtual environment & installing dependencies..."
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt

echo "[3/3] Starting Wahy-Finder v2.0 server at http://127.0.0.1:8000 ..."
CORPUS_URL="https://raw.githubusercontent.com/AbderrahimZineddineEsi/Wahy-Finder/main/data/corpus.json"
if [ ! -s data/corpus.json ]; then
  echo "Downloading corpus (≈90 MB) into data/corpus.json ..."
  curl -fL --progress-bar -o data/corpus.json.part "$CORPUS_URL" && mv data/corpus.json.part data/corpus.json \
    || echo "[WARNING] corpus download failed; the app will fall back to the remote sources."
fi

cd backend
# --timeout-graceful-shutdown: a reload must not wait forever on a stalled download (e.g. a backgrounded tab
# that stopped reading the 90 MB corpus), or the server stops answering after any backend edit
exec uvicorn app:app --host 127.0.0.1 --port 8000 --reload --timeout-graceful-shutdown 5
