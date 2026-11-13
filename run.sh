#!/usr/bin/env bash
# =============================================================================
# Start the app with one command (Linux, macOS, Windows through WSL).
# The same launcher serves both editions (docs/editions.md): this repo is "studio", the exported product
# (an EDITION file says "tadqeeq") is Tadqeeq.
#
#   ./run.sh                              installs what it needs the first time, then opens http://127.0.0.1:8000
#   PORT=9000 ./run.sh                    use another port
#   HOST=0.0.0.0 ./run.sh                 let other devices on your network open it
#   WAHY_EXTRAS="local-asr" ./run.sh      also install local Whisper (transcription on your own NVIDIA GPU, no key)
#   WAHY_EXTRAS="local-asr laya" ./run.sh studio: also local Laya (torch)
#   WAHY_EDITION=tadqeeq ./run.sh         studio: preview the product
#   NO_BROWSER=1 ./run.sh                 do not open the browser
#
# Needs: Node.js 22.18+ (the engine worker is TypeScript that node runs directly), uv (offered if missing),
# ffmpeg (for audio and video). For development with hot reload use scripts/dev.sh.
# =============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
URL="http://127.0.0.1:$PORT"
NAME="Wahy Studio"
[ "${WAHY_EDITION:-$(cat EDITION 2>/dev/null || true)}" = "tadqeeq" ] && NAME="Tadqeeq"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m[!] %s\033[0m\n' "$*" >&2; exit 1; }

say "== $NAME =="

# --- 1. the tools ------------------------------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail "Node.js is not installed. Install the LTS version from https://nodejs.org (22.18 or newer), then run ./run.sh again."
fi
node_ok="$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); (a>22||(a===22&&b>=18))?1:0')"
[ "$node_ok" = "1" ] || fail "Node.js $(node -v) is too old. Install 22.18 or newer from https://nodejs.org, then run ./run.sh again."

if ! command -v uv >/dev/null 2>&1; then
  [ -x "$HOME/.local/bin/uv" ] && export PATH="$HOME/.local/bin:$PATH"
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "uv (it installs Python for the app) is not installed."
  answer="y"
  if [ -t 0 ]; then read -r -p "Install it now from https://astral.sh/uv ? [Y/n] " answer || true; fi
  case "${answer:-y}" in
    [nN]*) fail "uv is needed. Install it from https://docs.astral.sh/uv/getting-started/installation/ and run ./run.sh again." ;;
  esac
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null 2>&1 || fail "uv was installed but is not on your PATH yet. Open a new terminal and run ./run.sh again."
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[note] ffmpeg is not installed: pasted text and subtitle files work, but audio, video and YouTube need it."
  echo "       Ubuntu/Debian/WSL: sudo apt install ffmpeg    macOS: brew install ffmpeg"
fi

# --- 2. the web app (built once, rebuilt only when its sources change) ------------------------------------------
# A ready, up-to-date web/dist skips `npm ci` altogether (the Colab notebook restores a cached build this way).
say "[1/3] Preparing the web app..."
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html web/package.json engine/src -newer web/dist/index.html -type f -print -quit)" ]; then
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    npm ci --silent --no-audit --no-fund
  fi
  npm run --silent build --workspace web
fi

# --- 3. the server ----------------------------------------------------------------------------------------------
say "[2/3] Preparing the server (the first time this downloads Python and its packages)..."
extras=()
for e in ${WAHY_EXTRAS:-}; do extras+=(--extra "$e"); done
(cd server && uv sync --quiet ${extras[@]+"${extras[@]}"})

mkdir -p data
# the Quran and hadith texts (about 90 MB, downloaded once, checked against its sha256: scripts/fetch_corpus.sh)
scripts/fetch_corpus.sh data/corpus.json

# --- 4. start, and open the browser once the server answers ----------------------------------------------------
# API keys are read by the server itself from the gitignored .env (or saved from the Settings screen).
say "[3/3] $NAME is starting at $URL   (press Ctrl+C to stop)"
if [ -z "${NO_BROWSER:-}" ]; then
  (
    for _ in $(seq 1 60); do
      if curl -fs "$URL/api/health" >/dev/null 2>&1; then
        if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
        elif command -v open >/dev/null 2>&1; then open "$URL"
        elif command -v wslview >/dev/null 2>&1; then wslview "$URL"
        fi
        exit 0
      fi
      sleep 1
    done
  ) &
fi
cd server
exec uv run uvicorn wahy.main:app --host "$HOST" --port "$PORT" --timeout-graceful-shutdown 5
