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
cd backend
exec uvicorn app:app --host 127.0.0.1 --port 8000 --reload
