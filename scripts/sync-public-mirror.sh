#!/usr/bin/env bash
# Re-sync the public code mirror (../syftly-mcp) from this repo's committed HEAD.
# Strategy docs (docs/, RESUME.md, CONTEXT.md) never leave the private repo.
# Commits locally in the mirror; pushing stays a manual, deliberate step.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MIRROR="$ROOT/../syftly-mcp"
[ -d "$MIRROR/.git" ] || { echo "mirror not found at $MIRROR" >&2; exit 1; }

# Replace everything except the mirror's own git history and node_modules.
find "$MIRROR" -mindepth 1 -maxdepth 1 ! -name .git ! -name node_modules -exec rm -rf {} +
git -C "$ROOT" archive HEAD | tar -x -C "$MIRROR"
rm -rf "$MIRROR/docs" "$MIRROR/RESUME.md" "$MIRROR/CONTEXT.md"

git -C "$MIRROR" add -A
if git -C "$MIRROR" diff --cached --quiet; then
  echo "mirror already up to date"
else
  git -C "$MIRROR" commit -m "sync from private repo $(git -C "$ROOT" rev-parse --short HEAD)"
  echo "synced — review and push with: git -C $MIRROR push"
fi
