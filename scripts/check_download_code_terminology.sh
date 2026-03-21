#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

TARGETS=(
  "README.md"
  "CHANGELOG.md"
  ".env.example"
  "scripts/cli.js"
  "scripts/publish.js"
  "scripts/buy.js"
  "scripts/config.js"
  "src/index.js"
  "skills"
)

LEGACY_TERM="pass""word"

if rg -n -i --word-regexp "$LEGACY_TERM" "${TARGETS[@]}"; then
  echo "[download-code-terminology] FAIL: found banned legacy access-secret term in user-facing surfaces."
  exit 1
fi

echo "[download-code-terminology] ok: no banned legacy access-secret terminology found."
