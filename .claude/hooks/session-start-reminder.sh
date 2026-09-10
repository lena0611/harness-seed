#!/bin/sh
# scope: harness — 모든 프로젝트에 동일한 본체 훅. 다중 저장소 세션에서는 주 폴더 것으로 충분합니다.
set -eu

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REMINDER="$ROOT/.harness/session/next-session-reminder.md"
QUEUE="$ROOT/.harness/session/developer-input-queue.md"

printf '[harness] session-start\n'

# ── 준비 상태(0.2.149, 사용자 지시 2026-09-10) ────────────────────────────────
# 하네스가 돌기 위한 조건 중 **못 갖춘 것만** 표로 모은다. 사람과 에이전트가 같은 줄을 읽으므로
# 채널을 하나로 둔다. 다 갖춰졌으면 아무것도 찍지 않는다 — 정상은 침묵이 이 훅의 규칙이다.
# 판정 본문은 .harness/bin/preflight.sh 가 소유한다(post-merge 훅과 공유 — 문구를 고칠 자리는 하나다).
# 전환 안내 한 줄은 세션 시작에서 내지 않는다: 이 자리의 채널은 아래 표 하나다.
if [ -f "$ROOT/.harness/bin/preflight.sh" ]; then
  HARNESS_DUAL_RUNTIME_ANNOUNCED=1
  export HARNESS_DUAL_RUNTIME_ANNOUNCED
  . "$ROOT/.harness/bin/preflight.sh"
  harness_preflight_node "$ROOT"
  harness_preflight_hooks_undecidable "$ROOT"
else
  # 옛 설치본(preflight.sh 이전)에서도 훅이 죽지 않게 최소값을 세운다. **침묵하지는 않는다** —
  # no-op 으로 두면 훅 설치 실패 안내가 통째로 사라져 "정상"으로 읽힌다(적대적 리뷰 P1-1 실측).
  HARNESS_NODE_USABLE=1
  HARNESS_GAPS=''
  HARNESS_GAP_DETAIL=''
  harness_gap() { printf '[harness] %s: %s → %s\n' "$1" "$2" "$3"; }
  harness_preflight_print() {
    if [ -n "$HARNESS_GAP_DETAIL" ]; then printf '%s\n' "$HARNESS_GAP_DETAIL"; fi
  }
fi

# 커밋·푸시 검사(git hook) 자동 복원 (결정 94 보강, 2026-08-28):
# 훅 설정은 저장소가 아니라 각자 PC의 .git/config에 저장되므로 clone에는 따라오지 않는다.
# clone 직후의 "꺼짐"은 누가 끈 선택이 아니라 물리 기본값이다 — 팀은 하네스를 저장소에
# 넣으며 이미 이 검사를 쓰기로 했으므로, 세션 시작이 그 상태를 복원한다.
# 멱등·fail-open: 이미 켜져 있으면 침묵, 실패해도 세션은 계속된다.
if [ "$HARNESS_NODE_USABLE" = "1" ] && [ -f "$ROOT/.harness/bin/hooks-state.mjs" ] && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # 판정은 hooks-state.mjs가 정본이다(0.2.146): installed(래퍼 방식) · legacy(예전 core.hooksPath=.githooks) ·
  # off · optout(harness.hooksAutoEnable=false — 이 PC의 명시적 선택, 존중) · nogit
  # 조회 실패를 "꺼짐"으로 폴백하지 않는다 — 모름을 단정으로 바꾸는 것이 이번 릴리스가 고친 결함이고,
  # 원인이 Node 가 아닐 때도(스크립트 예외 등) 같은 오진이 났다(적대적 리뷰 P2-7 실측).
  HOOKS_STATE="$(cd "$ROOT" && node .harness/bin/hooks-state.mjs 2>/dev/null)" || HOOKS_STATE=''
  if [ -z "$HOOKS_STATE" ]; then
    harness_gap '커밋·푸시 훅' '판정 불가 (상태 조회 실패)' '.harness/bin/harness hooks:status 로 원인을 확인하세요'
  fi
  if [ "$HOOKS_STATE" = "off" ] || [ "$HOOKS_STATE" = "legacy" ]; then
    # 성공·실패는 종료코드가 아니라 **결과 상태**로 가른다(multisite #35, 0.2.148). "켜졌는가"를 묻는 자리에서
    # "명령이 0으로 끝났는가"를 대신 묻고 있었다 — 전환은 끝났는데 "켜지 못했다"고 알린 실측. 같은 구조로는 반대 방향
    # (실패를 성공으로 알리는 것)도 막지 못한다. 실패로 갈릴 때만 설치기의 stderr 를 남긴다 — 버리면 재현이 안 되는
    # 순간 증거가 통째로 사라진다(그 리포트가 정확히 그 경우였다).
    # 종료코드는 성공 판정에 쓰지 않지만(아래) 버리지도 않는다 — 비정상 종료면 stderr 를 항상 남긴다(적대적 리뷰 C-1:
    # 상태만 보면 래퍼 2/16개만 깔린 부분 설치를 성공으로 알리고 그 이유를 버린다). set -e 를 타지 않게 || 로 받는다.
    INSTALL_RC=0
    INSTALL_ERR="$(cd "$ROOT" && node .harness/bin/install-hooks.mjs 2>&1 >/dev/null)" || INSTALL_RC=$?
    # 판정 정본(hooks-state.mjs)이 계산한 missing 까지 본다: installed 는 pre-commit·pre-push 둘만 보는 요약이라
    # 나머지 14개가 빠진 부분 설치도 installed 다 — 팀이 체인한 commit-msg 같은 훅이 조용히 멈추는 상태다.
    # 재조회 실패도 "꺼짐"이 아니다(코덱스 리뷰 P1-2). 빈 값으로 두고 아래에서 판정 불가로 가른다.
    HOOKS_JSON="$(cd "$ROOT" && node .harness/bin/hooks-state.mjs --json 2>/dev/null)" || HOOKS_JSON=''
    HOOKS_AFTER="$(printf '%s' "$HOOKS_JSON" | node -e 'var s="";process.stdin.on("data",function(d){s+=d}).on("end",function(){try{var j=JSON.parse(s);process.stdout.write(String(j.state||"off"))}catch(e){process.stdout.write("off")}})' 2>/dev/null || printf 'off')"
    MISSING_AFTER="$(printf '%s' "$HOOKS_JSON" | node -e 'var s="";process.stdin.on("data",function(d){s+=d}).on("end",function(){try{var j=JSON.parse(s);process.stdout.write(String((j.missing||[]).length))}catch(e){process.stdout.write("99")}})' 2>/dev/null || printf '99')"
    if [ "$HOOKS_AFTER" = "installed" ] && [ "$MISSING_AFTER" = "0" ]; then
      if [ "$HOOKS_STATE" = "legacy" ]; then
        printf '[harness] 커밋·푸시 훅을 브랜치 무관 래퍼 방식으로 갱신했습니다 (0.2.146) — 하네스 없는 브랜치로 옮겨도 훅이 사라지지 않고, 그 브랜치에서는 한 줄 알린 뒤 통과합니다.\n'
      else
        printf '[harness] 커밋·푸시 검사가 꺼져 있어 자동으로 켰습니다. 이 설정은 PC마다 따로 저장되어 clone에는 따라오지 않습니다 — 저장소를 새로 받으면 이렇게 한 번 켜집니다.\n'
      fi
      if [ "$INSTALL_RC" != "0" ] && [ -n "$INSTALL_ERR" ]; then
        printf '[harness] 다만 설치기가 경고를 남겼습니다(종료코드 %s) — 아래 내용을 확인하세요:\n' "$INSTALL_RC"
        printf '%s\n' "$INSTALL_ERR" | head -n 5 | sed 's/^/         설치기: /'
      fi
    else
      if [ -z "$HOOKS_JSON" ]; then
        harness_gap '커밋·푸시 훅' '판정 불가 (설치 뒤 상태 조회 실패 — 켜졌는지 확인하지 못했습니다)' '.harness/bin/harness hooks:status 로 확인하세요'
      elif [ "$HOOKS_AFTER" = "installed" ]; then
        harness_gap '커밋·푸시 훅' "일부만 설치 (래퍼 $MISSING_AFTER개 누락 — 팀이 체인한 훅이 멈출 수 있습니다)" '.harness/bin/harness hooks:install'
      else
        harness_gap '커밋·푸시 훅' "꺼짐 (자동으로 켜지 못했습니다 — 지금 상태: $HOOKS_AFTER)" '.harness/bin/harness hooks:install'
      fi
      if [ -n "$INSTALL_ERR" ]; then
        HARNESS_GAP_DETAIL="$(printf '%s\n' "$INSTALL_ERR" | head -n 5 | sed 's/^/         설치기: /')"
      fi
    fi
  fi
fi

# 출력 본문은 preflight.sh 가 소유한다 — 여기 복사해 두면 문구가 두 벌이 된다(이 파일의 존재 이유).
harness_preflight_print

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

# 연결 프로젝트(0.2.139, 해석기 0.2.140): 팀 공유 profile.linkedProjects의 저장소를 이 PC 경로로 풀어
# 기준 문서 위치·런처·커밋 규칙·게이트 미실행 경고를 주입한다. 해석 규칙은 .harness/bin/linked-projects.mjs.
if [ -f "$ROOT/.harness/bin/linked-projects.mjs" ]; then
  node "$ROOT/.harness/bin/linked-projects.mjs" session "$ROOT" 2>/dev/null || true
fi
