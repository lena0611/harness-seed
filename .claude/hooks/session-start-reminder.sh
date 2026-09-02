#!/bin/sh
# scope: harness — 모든 프로젝트에 동일한 본체 훅. 다중 저장소 세션에서는 주 폴더 것으로 충분합니다.
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

# 연결 프로젝트(0.2.139): 프론트/백엔드처럼 저장소가 둘인데 한 대화창에서 둘 다 다루는 개발자용.
# Claude Code는 추가 디렉터리(--add-dir)의 파일·스킬·명령은 열지만 그쪽 세션 훅·설정은 돌리지 않고,
# 중첩 CLAUDE.md(서비스 룰)는 파일을 읽어도 로드하지 않는다(2026-09-02 실측). 그래서 profile.linkedProjects에
# 선언된 저장소의 기준 문서 위치·런처 경로·커밋 규칙을 여기서 대신 주입한다. 읽기만 하며 그쪽을 고치지 않는다.
PROFILE="$ROOT/.harness/policy/profile.json"
if [ -f "$PROFILE" ]; then
  node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
let linked = [];
try { linked = JSON.parse(fs.readFileSync(path.join(root, ".harness/policy/profile.json"), "utf8")).linkedProjects || []; } catch {}
if (!Array.isArray(linked) || linked.length === 0) process.exit(0);
console.log("");
console.log("[harness] 연결 프로젝트 (이 세션에서 함께 다루는 다른 저장소)");
for (const item of linked) {
  if (!item || typeof item.path !== "string") continue;
  const abs = path.resolve(root, item.path);
  const label = item.label || item.path;
  const focus = typeof item.focus === "string" && item.focus ? item.focus.replace(/\/+$/, "") : null;
  if (!fs.existsSync(abs)) {
    console.log(`- ${label}: ${item.path} — 경로가 없습니다(clone 위치 확인). 이 저장소 작업은 이 세션에서 할 수 없습니다.`);
    continue;
  }
  const hasHarness = fs.existsSync(path.join(abs, ".harness/bin/harness"));
  console.log(`- ${label}: ${abs}${focus ? ` (관심 영역 ${focus})` : ""}${hasHarness ? "" : " — 하네스 미설치(기준 문서 없음, 파일 작업만)"}`);
  const docs = [path.join(abs, "CLAUDE.md")];
  if (focus) docs.push(path.join(abs, focus, "CLAUDE.md"));
  const existing = docs.filter((d) => fs.existsSync(d));
  if (existing.length) console.log(`  그쪽 파일을 읽거나 고치기 전에 반드시 먼저 읽기: ${existing.join(", ")}`);
  if (hasHarness) {
    console.log(`  그쪽 하네스 명령은 ${path.join(abs, ".harness/bin/harness")} <명령> 으로 실행합니다(이 저장소 런처가 아님). 커밋·푸시는 그 저장소 안에서 — 그쪽 git 훅이 검사합니다.`);
    console.log(`  ⚠ 그쪽 훅(쓰기 시점 차단·검사)은 이 세션에서 자동 실행되지 않습니다 — 그쪽 파일을 고쳤으면 그 저장소에서 커밋해 훅 검사를 받고, 필요하면 위 런처로 check를 돌리세요.`);
    const rem = path.join(abs, ".harness/session/next-session-reminder.md");
    if (fs.existsSync(rem)) {
      const heads = fs.readFileSync(rem, "utf8").split(/\r?\n/).filter((l) => /^## /.test(l)).slice(0, 3);
      if (heads.length) console.log(`  그쪽 리마인더 최근 항목: ${heads.map((h) => h.replace(/^## /, "")).join(" / ")} (전문: ${rem})`);
    }
  }
}
console.log("  같은 이름의 슬래시 명령(/하네스업데이트 등)은 이 저장소 것만 뜹니다 — 연결 저장소 작업은 위 런처 경로로.");
' "$ROOT" 2>/dev/null || true
fi
