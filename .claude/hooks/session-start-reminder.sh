#!/bin/sh
set -eu

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REMINDER="$ROOT/.harness/session/next-session-reminder.md"
QUEUE="$ROOT/.harness/session/developer-input-queue.md"

printf '[harness] session-start\n'

# 커밋·푸시 검사(git hook) 자동 복원 (결정 94 보강, 2026-08-28):
# 훅 설정은 저장소가 아니라 각자 PC의 .git/config에 저장되므로 clone에는 따라오지 않는다.
# clone 직후의 "꺼짐"은 누가 끈 선택이 아니라 물리 기본값이다 — 팀은 하네스를 저장소에
# 넣으며 이미 이 검사를 쓰기로 했으므로, 세션 시작이 그 상태를 복원한다.
# 멱등·fail-open: 이미 켜져 있으면 침묵, 실패해도 세션은 계속된다.
if [ -d "$ROOT/.git" ] || git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HOOKS_PATH="$(git -C "$ROOT" config core.hooksPath 2>/dev/null || printf '')"
  AUTO_ENABLE="$(git -C "$ROOT" config harness.hooksAutoEnable 2>/dev/null || printf '')"
  # harness.hooksAutoEnable=false 는 이 PC의 명시적 옵트아웃(init --no-hooks가 기록) — 존중한다.
  if [ "$HOOKS_PATH" != ".githooks" ] && [ "$AUTO_ENABLE" != "false" ] && [ -f "$ROOT/.harness/bin/install-hooks.mjs" ]; then
    if (cd "$ROOT" && node .harness/bin/install-hooks.mjs >/dev/null 2>&1); then
      printf '[harness] 커밋·푸시 검사가 꺼져 있어 자동으로 켰습니다. (이 설정은 PC마다 따로라 clone에는 따라오지 않습니다 — 사용자에게 이 사실을 한 줄로 알려주세요)\n'
    else
      printf '[harness] 커밋·푸시 검사가 꺼져 있는데 자동으로 켜지 못했습니다. .harness/bin/harness hooks:install 을 직접 실행해 원인을 확인하세요.\n'
    fi
  fi
fi

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
