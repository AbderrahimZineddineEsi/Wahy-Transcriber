#!/usr/bin/env bash
# Downloads the corpus (Quran + hadith, about 90 MB) into data/corpus.json and checks its sha256. Used by run.sh.
#
#   scripts/fetch_corpus.sh [target-file]      default target: data/corpus.json (nothing happens if it is already there)
#
# The corpus is a public release asset of this repo, so a plain download works on any machine. If that fails, the
# old private source is tried: the GitHub CLI (`gh auth login`), then a GITHUB_TOKEN. Every download is checked
# against the sha256 below before it replaces anything, so a cut-off or wrong file is discarded.
#
# Overrides (tests and forks use them): WAHY_CORPUS_URL, WAHY_CORPUS_SHA256.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TARGET="${1:-data/corpus.json}"
CORPUS_URL="${WAHY_CORPUS_URL:-https://github.com/AbderrahimZineddineEsi/Wahy-Transcriber/releases/download/corpus-v1/corpus.json}"
CORPUS_SHA256="${WAHY_CORPUS_SHA256:-ffe22b8035e0285bb2f44e1824f909ce485ba25fdbcdc07bbf844f7dfdb69f67}"
PRIVATE_REPO="AbderrahimZineddineEsi/Wahy-Finder"
PART="$TARGET.part"

if [ -s "$TARGET" ]; then
  exit 0
fi
mkdir -p "$(dirname "$TARGET")"

sha_ok() {   # does $PART have the expected sha256?
  [ -s "$PART" ] || return 1
  local got
  got="$( (sha256sum "$PART" 2>/dev/null || shasum -a 256 "$PART") | cut -d' ' -f1)"
  [ "$got" = "$CORPUS_SHA256" ]
}

try() {   # try <label> <command...>: run a download into $PART, keep it only if the sha256 matches
  local label="$1"; shift
  rm -f "$PART"
  if "$@" && sha_ok; then
    return 0
  fi
  [ -s "$PART" ] && echo "[corpus] $label gave a file with the wrong sha256: discarded"
  rm -f "$PART"
  return 1
}

echo "Downloading the corpus (about 90 MB) into $TARGET ..."
ok=1
try "the release download" curl -fL --retry 3 --progress-bar -o "$PART" "$CORPUS_URL" && ok=0
if [ $ok -ne 0 ] && command -v gh >/dev/null 2>&1; then
  try "gh" bash -c "gh api -H 'Accept: application/vnd.github.raw' repos/$PRIVATE_REPO/contents/data/corpus.json > '$PART' 2>/dev/null" && ok=0
fi
if [ $ok -ne 0 ] && [ -n "${GITHUB_TOKEN:-}" ]; then
  try "GITHUB_TOKEN" curl -fL --progress-bar -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github.raw" \
    -o "$PART" "https://api.github.com/repos/$PRIVATE_REPO/contents/data/corpus.json" && ok=0
fi

if [ $ok -eq 0 ]; then
  mv "$PART" "$TARGET"
  echo "corpus ready ($TARGET, sha256 checked)"
else
  echo "[WARNING] could not download a valid corpus from $CORPUS_URL (no network, or the file changed)."
  echo "          Try again, or copy corpus.json to $TARGET yourself. Without it the app starts, but detection will fail."
fi
exit 0
