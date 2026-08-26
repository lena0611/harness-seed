#!/usr/bin/env bash
set -euo pipefail

root="${CODEX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
profile="$root/.harness/policy/profile.json"
active_stack="unknown"

if [ -f "$profile" ]; then
  active_stack="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(p.activeStack || 'none')" "$profile" 2>/dev/null || printf 'unknown')"
fi

printf 'Harness context: read CLAUDE.md first; source of truth is .harness/; activeStack=%s; before user finalization, report checks as candidates. If user asks final check, run .harness/bin/harness check. If user asks commit/push and hooks are installed, trust pre-commit/pre-push checks and do not run duplicate manual harness:check first.\n' "$active_stack"
printf 'Harness reporting: when reporting actual work progress, summarize as [harness] request/context/impact/action/decision/verify. Do not force this format for simple Q&A, casual, or meta-only turns.\n'

# 훅 미설치 감지(결정 94): 훅 설정은 clone으로 공유되지 않으므로 새로 받은 clone은 관문이 꺼져 있다. fail-open.
if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hooks_path="$(git -C "$root" config core.hooksPath 2>/dev/null || printf '')"
  if [ "$hooks_path" != ".githooks" ]; then
    printf 'Harness hooks not installed in this clone: commit/push gates are OFF. Tell the user, and on request run .harness/bin/harness hooks:install (idempotent, preserves existing hooks by chaining).\n'
  fi
fi

# 기획 문서 연동 프로젝트에서는 코드 변경 전에 관련 기획을 먼저 확인한다(절차 정본은 .harness/project/spec-authority-workflow.md).
if [ -f "$root/.harness/spec-lock.json" ]; then
  printf 'Planning spec link is active: before changing code, follow .harness/project/spec-authority-workflow.md and check related planning docs first (regardless of task size).\n'
fi
