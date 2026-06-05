#!/bin/sh
set -eu

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REMINDER="$ROOT/.harness/session/next-session-reminder.md"
QUEUE="$ROOT/.harness/session/developer-input-queue.md"

printf '[harness] session-start\n'

if [ -f "$REMINDER" ]; then
  printf '\n[harness] next-session-reminder\n'
  sed -n '1,120p' "$REMINDER"
else
  printf '\n[harness] next-session-reminder: 파일 없음\n'
fi

if [ -f "$QUEUE" ]; then
  printf '\n[harness] developer-input-queue check\n'
  grep -nE '^[[:space:]]*\|[^|]+\|[[:space:]]*(open|deferred)[[:space:]]*\|' "$QUEUE" | head -20 || true
fi
