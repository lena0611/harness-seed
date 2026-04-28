#!/usr/bin/env bash
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0

branch="$(git branch --show-current 2>/dev/null || printf 'no-git')"
dirty="clean"
if [ -n "$(git status --short 2>/dev/null || true)" ]; then
  dirty="dirty"
fi

profile=".harness/policy/profile.json"
active_stack="none"
if [ -f "$profile" ]; then
  active_stack="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(p.activeStack || 'none')" "$profile" 2>/dev/null || printf 'unknown')"
fi

printf 'harness %s | %s | stack:%s' "$branch" "$dirty" "$active_stack"
