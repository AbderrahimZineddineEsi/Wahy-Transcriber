#!/usr/bin/env bash
# Builds the Tadqeeq product (docs/editions.md) from this repo: the committed code minus the research
# (packaging/tadqeeq/exclude.txt), with an EDITION file that makes it the "tadqeeq" edition, the product README and
# its screenshots.
#
#   scripts/export_tadqeeq.sh [target]          write the product into <target> (default: ../tadqeeq)
#   scripts/export_tadqeeq.sh --push [target]   also commit it there and push to the target's origin
#
# Only committed files are exported (git archive HEAD), so commit first. If <target> is a git clone of the product
# repo, the files the last export committed are replaced (what git ignores there, like data/ and .env, is kept), so
# each export becomes one new commit there. A target that is neither empty nor a clone is refused.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"

PUSH=0
if [ "${1:-}" = "--push" ]; then PUSH=1; shift; fi
TARGET="$(realpath -m "${1:-../tadqeeq}")"
case "$TARGET" in "$ROOT"|"$ROOT"/*) echo "[!] the target must be outside this repo" >&2; exit 1 ;; esac

[ -z "$(git status --porcelain)" ] || echo "[note] uncommitted changes are not exported (git archive HEAD)"
SHA="$(git rev-parse --short HEAD)"

echo "== Tadqeeq export from $(git branch --show-current) @ $SHA into $TARGET =="
mkdir -p "$TARGET"
if [ -d "$TARGET/.git" ]; then
  # replace what the last export committed; keep whatever git ignores there (data/, .env, node_modules, .venv)
  (cd "$TARGET" && git ls-files -z | xargs -0 -r rm -f && find . -mindepth 1 -type d -empty -not -path './.git*' -delete)
elif [ -n "$(ls -A "$TARGET")" ]; then
  echo "[!] $TARGET is not empty and not a git clone: refusing to write into it" >&2; exit 1
fi
git archive HEAD | tar -x -C "$TARGET"

while IFS= read -r line; do
  path="${line%%#*}"; path="$(echo "$path" | xargs)"
  [ -n "$path" ] && rm -rf "${TARGET:?}/$path"
done < packaging/tadqeeq/exclude.txt

echo "tadqeeq" > "$TARGET/EDITION"
cp packaging/tadqeeq/README.md "$TARGET/README.md"
mkdir -p "$TARGET/docs/screenshots"
cp packaging/tadqeeq/screenshots/*.png "$TARGET/docs/screenshots/"
sed -i 's|<title>.*</title>|<title>تدقيق · Tadqeeq</title>|' "$TARGET/web/index.html"

# nothing of the research may slip through
leaks="$(cd "$TARGET" && { ls -d server/wahy/laya notebooks graphify-out data/media_cache 2>/dev/null || true; find . -name '*.ipynb' -not -path './.git/*'; })"
[ -z "$leaks" ] || { echo "[!] research files left in the export:" >&2; echo "$leaks" >&2; exit 1; }

echo "exported $(git archive HEAD | tar -t | grep -v '/$' | grep -cvFf <(grep -v '^#' packaging/tadqeeq/exclude.txt | sed '/^ *$/d') || true) files"

if [ "$PUSH" = "1" ]; then
  cd "$TARGET"
  [ -d .git ] || git init -q -b main
  git add -A
  if git diff --cached --quiet; then
    echo "nothing changed since the last export"
  else
    git commit -q -m "Tadqeeq from Wahy-Transcriber $SHA"
    echo "committed: $(git log --oneline -1)"
  fi
  git push -u origin HEAD
fi
