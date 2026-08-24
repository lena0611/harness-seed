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
  # open/deferred 행만 본다. 재검토일(YYYY-MM-DD) 컬럼이 있으면:
  #   기한 미래 = 이번 세션 침묵(마지막에 유예 집계 한 줄), 기한 도래 = 표시와 함께 출력.
  #   미기재 = 항상 출력(하위호환·fail-loud 기본), 형식 오류 = 숨기지 않고 경고와 함께 출력
  #   (잘못 쓴 날짜가 조용한 은닉 경로가 되지 않게 한다).
  TODAY="$(date +%Y-%m-%d)"
  awk -F '|' -v today="$TODAY" '
    /^[[:space:]]*\|/ {
      for (i = 1; i <= NF; i++) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i) }
      if ($2 == "id" && $3 == "status") {
        reviewCol = 0
        for (i = 4; i <= NF; i++) if ($i == "재검토일" || $i == "nextReviewOn") reviewCol = i
        next
      }
      if ($3 !~ /^(open|deferred)$/) next
      due = (reviewCol > 0 && reviewCol <= NF) ? $reviewCol : ""
      line = "[" $3 "] " $2 " — " $4
      if (due == "" || due == "-" || due == "미정") {
        shown++; if (shown <= 20) print line
      } else if (due ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) {
        if (due <= today) { shown++; if (shown <= 20) print line " (재검토 기한 도래: " due ")" }
        else { snoozed++; if (nextDue == "" || due < nextDue) nextDue = due }
      } else {
        shown++; if (shown <= 20) print line " (재검토일 형식 오류: \"" due "\" — YYYY-MM-DD로 적어야 유예됩니다)"
      }
    }
    END {
      if (shown > 20) print "… 외 " (shown - 20) "건"
      if (snoozed > 0) print "유예 " snoozed "건 — 다음 재검토 " nextDue
      if (shown == 0 && snoozed == 0) print "열린 질문 없음"
    }
  ' "$QUEUE" || true
fi
