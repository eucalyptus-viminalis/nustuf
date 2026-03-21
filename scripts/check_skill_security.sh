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

  if rg -n --glob '**/*.md' --glob '**/*.sh' -- "$pattern" "$SKILLS_DIR"; then
    echo "[skill-security] FAIL: found banned pattern ($label): $pattern"
    FAILED=1
  fi
}

check_banned_pattern "dynamic runtime package exec" "npx -y"
check_banned_pattern "stdin private key mode" "--buyer-private-key-stdin"
check_banned_pattern "key generation guidance" "generate a fresh buyer key"

for skill_file in "$SKILLS_DIR"/*/SKILL.md; do
  [ -f "$skill_file" ] || continue

  # Legacy stub is intentionally a migration bridge and may mention both scopes.
  if [ "$skill_file" = "$SKILLS_DIR/nustuf/SKILL.md" ]; then
    continue
  fi

  if grep -Eqi '\bbuy\b|\bdownload\b' "$skill_file" && grep -Eqi '\bpublish\b|\bsell\b' "$skill_file"; then
    echo "[skill-security] FAIL: mixed buy/publish scope in $skill_file"
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "[skill-security] ok: no banned patterns and no mixed-scope hardened skills"
