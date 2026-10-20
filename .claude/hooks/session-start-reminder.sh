#!/bin/sh
# scope: harness — 모든 프로젝트에 동일한 본체 훅. 다중 저장소 세션에서는 주 폴더 것으로 충분합니다.
set -eu

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# 개인 메모(0.2.153, #48 A): 리마인더는 git 에 올라가지 않는 local/ 에 있다. 옛 자리는 옮기기 전 폴백으로만 읽는다.
REMINDER="$ROOT/.harness/session/local/next-session-reminder.md"
LEGACY_REMINDER="$ROOT/.harness/session/next-session-reminder.md"
QUEUE="$ROOT/.harness/session/developer-input-queue.md"

printf '[harness] session-start\n'

# 전체 안내(0.2.155, 토큰 절약): 매 프롬프트 훅(inject-context.sh)이 싣던 두 줄을 이 자리에서 세션마다 한 번 낸다 —
# 시작·재개·요약(compact)·비우기(clear) 모두 이 훅이 돌므로 요약으로 대화가 접혀도 다시 실린다. 프롬프트마다는 한 줄만 남는다.
printf '[harness] Harness context: CLAUDE.md is the entry point (already loaded into this session); check .harness/policy/ai-standard-guiding-policy.md before work; source of truth is .harness/; before user finalization, report checks as candidates. If user asks final check, run .harness/bin/harness check. If user asks commit/push and hooks are installed, trust pre-commit/pre-push checks and do not run duplicate manual harness:check first.\n'
printf '[harness] Harness reporting: when reporting actual work progress, summarize as [harness] request/context/impact/action/decision/verify. Do not force this format for simple Q&A, casual, or meta-only turns.\n'
# 실패 이벤트는 세션마다 처음 한 번만 전문으로 싣는다(inject-context.sh) — 새 세션·요약 직후에는 다시 한 번 보이도록 표식을 지운다.
# 상위 경로(.harness·generated)가 링크면 지우지 않는다 — 링크 너머의 같은 이름 파일을 지우게 된다(Codex 1R #1). 표식 자체가 링크면
# rm 은 링크만 지운다. 못 지우면 inject-context 가 링크 표식을 믿지 않으므로 어차피 전문이 나간다.
if [ ! -L "$ROOT/.harness" ] && [ ! -L "$ROOT/.harness/generated" ]; then
  rm -f "$ROOT/.harness/generated/agent-event-shown" 2>/dev/null || true
fi

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

# 옛 자리 메모를 local/ 로 옮긴다(옮길 것이 없으면 침묵). 규칙은 session-memos.mjs 한 곳 — Node 를 못 쓰면 건너뛰고 옛 자리를 읽는다.
if [ "${HARNESS_NODE_USABLE:-1}" = "1" ] && [ -f "$ROOT/.harness/bin/session-memos.mjs" ] && command -v node >/dev/null 2>&1; then
  node "$ROOT/.harness/bin/session-memos.mjs" --root "$ROOT" || true
fi

# 링크를 따라 읽지 않는다(Codex 2R #3): 메모까지의 경로 구성요소(.harness·session·local·파일) 중 하나라도 링크면 그 파일은 읽지 않는다 —
# 옮기기가 거부한 링크를 여기서 따라가 그 너머의 내용을 세션에 찍으면 방어가 헛된다. 일반 파일일 때만 참.
harness_memo_plain() {
  [ ! -L "$ROOT/.harness" ] && [ ! -L "$ROOT/.harness/session" ] && [ ! -L "$ROOT/.harness/session/local" ] && [ ! -L "$1" ] && [ -f "$1" ]
}

if ! harness_memo_plain "$REMINDER" && harness_memo_plain "$LEGACY_REMINDER"; then
  REMINDER="$LEGACY_REMINDER"
fi

# 재개(resume)는 대화가 그대로 살아 있다 — 같은 세션이 같은 메모를 이미 봤으면 전문 대신 한 줄(0.2.155, 토큰 절약).
# 판정은 '이 세션 id + 메모 내용 해시'를 표식과 비교한다: 메모가 그사이 바뀌었거나(다른 세션·사람이 고침) 다른 세션이면 전문.
# 시작·요약·비우기는 항상 전문이다. Node 를 못 쓰거나 입력을 못 읽으면 전문 — 정보를 잃는 쪽으로 실패하지 않는다.
MEMO_MODE='full'
# 판정 스크립트(작은따옴표 안 — 셸이 건드리지 않는다). 훅 입력은 이 node 가 **시간 제한(1.5초)을 두고** 직접 읽는다: 입력을 닫지 않는
# 호출자가 있어도 세션 시작 안내 전체가 멈추지 않는다(Codex 1R #4 — 예전에는 이 훅이 stdin 을 아예 읽지 않았다). 시간 안에 못 읽으면
# 입력 불명 = 전문. 표식은 경로에 링크가 하나라도 있으면 읽지도(믿지 않음 — 1R #3) 쓰지도 않는다. 쓰기는 마지막 조각을 O_NOFOLLOW
# 로 열어 검사와 쓰기 사이에 링크로 바꿔치는 경우도 막는다(1R #2 — 상위 폴더를 실행 도중 바꾸는 경쟁은 이미 저장소에 마음대로 쓸 수
# 있는 공격자라 범위 밖).
MEMO_JS='
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const seenFile = process.env.HARNESS_MEMO_SEEN;
const noLink = (file) => [path.dirname(path.dirname(file)), path.dirname(file), file].every((p) => {
  try { return !fs.lstatSync(p).isSymbolicLink(); } catch (e) { return Boolean(e) && e.code === "ENOENT"; }
});
let raw = "";
let done = false;
// complete=false(시간 초과·입력 오류)는 입력 불명이다 — 받은 조각이 온전한 JSON 이어도 판정에 쓰지 않고 전문, 표식도 그대로(Codex 2R #1).
const finish = (complete) => {
  if (done) return;
  done = true;
  if (!complete) { process.stdout.write("full"); process.exit(0); }
  let input = {};
  try { input = JSON.parse(raw) || {}; } catch (_) {}
  const sid = typeof input.session_id === "string" ? input.session_id : "";
  const source = typeof input.source === "string" ? input.source : "";
  let sha = "";
  try { sha = crypto.createHash("sha256").update(fs.readFileSync(process.env.HARNESS_MEMO)).digest("hex"); } catch (_) { process.stdout.write("full"); process.exit(0); }
  const key = `${sid}:${sha}`;
  const trusted = noLink(seenFile);
  let seen = "";
  // 읽기도 마지막 조각을 O_NOFOLLOW 로 연다 — 검사와 열기 사이에 링크로 바뀌면 열기가 실패하고 "본 적 없음"이 된다(Codex 2R #2).
  if (trusted) {
    try {
      const fd = fs.openSync(seenFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try { seen = fs.readFileSync(fd, "utf8").trim(); } finally { fs.closeSync(fd); }
    } catch (_) {}
  }
  const same = Boolean(sid) && source === "resume" && seen === key;
  if (!same && sid && trusted) {
    try {
      fs.mkdirSync(path.dirname(seenFile), { recursive: true });
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(seenFile, flags, 0o644);
      try { fs.writeSync(fd, key); } finally { fs.closeSync(fd); }
    } catch (_) {}
  }
  process.stdout.write(same ? "same" : "full");
  process.exit(0);
};
setTimeout(() => finish(false), 1500);
process.stdin.on("data", (d) => { raw += d; }).on("end", () => finish(true)).on("error", () => finish(false));
'
if harness_memo_plain "$REMINDER" && [ "${HARNESS_NODE_USABLE:-1}" = "1" ] && command -v node >/dev/null 2>&1; then
  if [ -t 0 ]; then
    # 터미널에서 직접 부른 경우 — 입력이 없다. 기다리지 않는다.
    MEMO_MODE="$(HARNESS_MEMO="$REMINDER" HARNESS_MEMO_SEEN="$ROOT/.harness/generated/memo-shown" node -e "$MEMO_JS" </dev/null 2>/dev/null || printf 'full')"
  else
    MEMO_MODE="$(HARNESS_MEMO="$REMINDER" HARNESS_MEMO_SEEN="$ROOT/.harness/generated/memo-shown" node -e "$MEMO_JS" 2>/dev/null || printf 'full')"
  fi
fi

if harness_memo_plain "$REMINDER" && [ "$MEMO_MODE" = "same" ]; then
  printf '\n[harness] next-session-reminder: 이 대화에 이미 있습니다(재개 — 그 뒤 내용 변화 없음). 원문: %s\n' "${REMINDER#"$ROOT"/}"
elif harness_memo_plain "$REMINDER"; then
  printf '\n[harness] next-session-reminder\n'
  sed -n '1,120p' "$REMINDER"
else
  printf '\n[harness] next-session-reminder: 파일 없음 (개인 메모 — 필요할 때 .harness/session/local/next-session-reminder.md 에 만듭니다)\n'
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
