#!/usr/bin/env bash
# scope: harness — 모든 프로젝트에 동일한 본체 훅. 다중 저장소 세션에서는 주 폴더 것으로 충분합니다.
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ "${HARNESS_AGENT_CHECK_DISABLED:-}" = "1" ]; then
  printf 'Harness agent check skipped by HARNESS_AGENT_CHECK_DISABLED=1\n'
  exit 0
fi

if [ "${HARNESS_AGENT_CHECK_APPROVED:-}" != "1" ]; then
  printf '사용자 완료 승인 전이므로 harness:check를 실행하지 않았습니다.\n'
  printf '최종화가 승인되면 HARNESS_AGENT_CHECK_APPROVED=1 .harness/bin/harness check 를 실행하세요.\n'
  exit 0
fi

if [ ! -f "$root/package.json" ]; then
  printf 'Harness agent check skipped: package.json not found\n'
  exit 0
fi

cd "$root"
printf 'Harness agent completion check: .harness/bin/harness check\n'
.harness/bin/harness check
