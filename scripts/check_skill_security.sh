#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_DIR/skills"

if [ ! -d "$SKILLS_DIR" ]; then
  echo "[skill-security] ERROR: skills directory not found: $SKILLS_DIR"
  exit 1
fi

FAILED=0

check_banned_pattern() {
  local label="$1"
  local pattern="$2"

  if grep -rn --include='*.md' --include='*.sh' -F -- "$pattern" "$SKILLS_DIR"; then
    echo "[skill-security] FAIL: found banned pattern ($label): $pattern"
    FAILED=1
  fi
}

check_banned_command() {
  local skill="$1"
  local command="$2"
  local file="$SKILLS_DIR/$skill/SKILL.md"

  if [ -f "$file" ] && grep -n -F -- "$command" "$file"; then
    echo "[skill-security] FAIL: $skill must not run \`$command\`"
    FAILED=1
  fi
}

check_banned_pattern "dynamic runtime package exec" "npx -y"
check_banned_pattern "stdin private key mode" "--buyer-private-key-stdin"
check_banned_pattern "key generation guidance" "generate a fresh buyer key"

check_banned_command "nustuf-buy" "nustuf publish"
check_banned_command "nustuf-buy" "nustuf announce"
check_banned_command "nustuf-publish" "nustuf buy"
check_banned_command "nustuf-discover" "nustuf publish"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "[skill-security] ok: no banned patterns and each skill only runs its own commands"
