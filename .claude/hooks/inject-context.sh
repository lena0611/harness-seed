#!/usr/bin/env bash
# scope: harness — 모든 프로젝트에 동일한 본체 훅. 다중 저장소 세션에서는 주 폴더 것으로 충분합니다.
set -euo pipefail

hook_input="$(cat 2>/dev/null || true)"
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
profile="$root/.harness/policy/profile.json"
active_stack="unknown"

if [ -f "$profile" ]; then
  active_stack="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(p.activeStack || 'none')" "$profile" 2>/dev/null || printf 'unknown')"
fi

# 토큰 절약(0.2.155): 전체 안내 두 줄은 세션 시작 훅(session-start-reminder.sh)이 시작·재개·요약·비우기 때마다 한 번 낸다.
# 매 프롬프트에 같은 두 줄(≈190토큰)이 붙으면 대화가 매 턴 통째로 다시 전송되는 구조라 긴 세션에서 그 자체가 비용이다. 여기서는
# 0 이 아니라 한 줄을 남겨 멀리 있는 규칙을 상기시키고(긴 세션에서 모델이 시스템 프롬프트 규칙을 흐리게 기억하는 위험),
# 최종화 규칙은 사용자가 최종화(커밋·푸시·배포·릴리스·최종 검증…)를 말한 프롬프트에만 붙인다. 판정을 못 하면 종전처럼 붙인다.
printf 'Harness: follow CLAUDE.md (the full harness reminder is printed at session start); source of truth is .harness/; activeStack=%s; report work progress as [harness] request/context/impact/action/decision/verify (not for Q&A, casual, or meta-only turns).\n' "$active_stack"
harness_finalize="$(printf '%s' "$hook_input" | node -e '
let raw = "";
process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
  let prompt = null;
  try { const v = JSON.parse(raw).prompt; if (typeof v === "string") prompt = v; } catch (_) {}
  if (prompt === null) { process.stdout.write("unknown"); return; }
  const words = /커밋|푸시|푸쉬|배포|릴리스|릴리즈|태그|머지|병합|최종|commit|push|release|deploy|merge|pull request|final|\bPR\b|\btag\b/i;
  process.stdout.write(words.test(prompt) ? "yes" : "no");
});' 2>/dev/null || printf 'unknown')"
if [ "$harness_finalize" != "no" ]; then
  printf 'Harness finalization: until the user approves completion, report build/test/harness check/commit/push only as candidates. If the user asks for a final check only, run .harness/bin/harness check. If the user asks for commit/push and hooks are installed, trust the pre-commit/pre-push checks and do not run a duplicate manual harness check first.\n'
fi

# 연결 프로젝트(0.2.139): 매 프롬프트에 한 줄 — 해석 규칙은 .harness/bin/linked-projects.mjs.
if [ -f "$root/.harness/bin/linked-projects.mjs" ]; then
  node "$root/.harness/bin/linked-projects.mjs" prompt "$root" 2>/dev/null || true
fi

# 하네스 구동 조건(0.2.149): 세션 도중에 환경이 깨지면(Node 제거·버전 교체·PATH 변경) 세션 시작 표는
# 이미 지나갔고 pull 도 없으면 알려 줄 채널이 없다. 그래서 이 자리에서도 같은 표를 낸다.
# **세션당 한 번만** 찍는다 — 매 프롬프트에 같은 줄이 쌓이면 잡음이 신호를 죽인다(사용자 결정 2026-09-10).
# 세션 구분은 훅 입력의 session_id 로 한다. 그 값이 없으면 중복을 막을 수단이 없으므로 찍지 않는다
# (세션 시작 표가 이미 그 자리를 맡는다 — 조용한 쪽으로 실패한다).
harness_session_id="$(printf '%s' "$hook_input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
if [ -n "$harness_session_id" ] && [ -f "$root/.harness/bin/preflight.sh" ]; then
  harness_seen="$root/.harness/generated/preflight-session"
  if [ "$(cat "$harness_seen" 2>/dev/null || printf '')" != "$harness_session_id" ]; then
    # dual-runtime 전환 안내 한 줄은 이 자리에서 내지 않는다 — 프롬프트마다 붙으면 잡음이다.
    HARNESS_DUAL_RUNTIME_ANNOUNCED=1
    export HARNESS_DUAL_RUNTIME_ANNOUNCED
    . "$root/.harness/bin/preflight.sh"
    harness_preflight_node "$root"
    harness_preflight_hooks_undecidable "$root"
    if [ -n "$HARNESS_GAPS" ]; then
      harness_preflight_print
      mkdir -p "$root/.harness/generated" 2>/dev/null || true
      printf '%s' "$harness_session_id" > "$harness_seen" 2>/dev/null || true
    fi
  fi
fi

# 훅 미설치 감지(결정 94): 훅 설정은 clone으로 공유되지 않으므로 새로 받은 clone은 관문이 꺼져 있다.
# 매 세션 한 줄로 알려 에이전트가 사용자에게 안내하고, 요청 시 켜줄 수 있게 한다. fail-open.
if [ -f "$root/.harness/bin/hooks-state.mjs" ] && git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # 판정 정본은 hooks-state.mjs(0.2.146). off 는 항상 상기하고, optout 은 존중한다.
  # legacy(예전 방식)는 **자동 갱신 배선이 없을 때만** 알린다(0.2.147, 적대적 리뷰): Claude 세션 시작 훅이
  # 배선된 프로젝트는 그 세션이 알아서 갱신하지만, 터미널·Codex 전용 clone 은 알려 주는 채널이 여기뿐이었다.
  # 조회 실패를 "꺼짐"으로 폴백하지 않는다(0.2.149) — 모름을 단정으로 바꾸는 것이 이 릴리스가 고친
  # 결함이고, 이 채널만 옛 방식으로 남아 있었다. Node 가 아예 없으면 판정 자체가 불가능한데, 그 사실은
  # 세션 시작 표가 이미 말하므로 매 프롬프트마다 반복하지 않는다(잡음이 신호를 죽인다).
  hooks_state=''
  if command -v node >/dev/null 2>&1; then
    hooks_state="$(cd "$root" && node .harness/bin/hooks-state.mjs 2>/dev/null)" || hooks_state=''
    if [ -z "$hooks_state" ]; then
      printf 'Harness hook state could not be determined in this clone (the state probe failed; do NOT tell the user the hooks are off). Run .harness/bin/harness hooks:status, and relay what it reports in one line.\n'
    fi
  fi
  if [ "$hooks_state" = "off" ]; then
    printf 'Harness hooks are OFF in this clone (hook config does not travel with git clone; the team already opted in by adding the harness). Turn them on NOW by running .harness/bin/harness hooks:install and tell the user in one line.\n'
  elif [ "$hooks_state" = "legacy" ] \
    && [ "$(cd "$root" && node .harness/bin/hooks-state.mjs --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",function(d){s+=d}).on("end",function(){try{process.stdout.write(String(JSON.parse(s).autoMigrates))}catch(e){process.stdout.write("true")}})' 2>/dev/null || printf 'true')" = "false" ]; then
    printf 'Harness hooks in this clone still use the pre-0.2.146 wiring and nothing will migrate them automatically here. Run .harness/bin/harness hooks:install once and tell the user in one line.\n'
  fi
fi

events="$root/.harness/generated/agent-events.ndjson"
if [ -f "$events" ]; then
  # 같은 실패를 TTL(120분) 동안 매 프롬프트에 전문으로 붙이지 않는다(0.2.155, 토큰 절약): 이 세션에서 처음 볼 때만 전문을 싣고,
  # 그 뒤로는 한 줄로 줄인다. 세션 시작 훅이 표식을 지우므로 요약(compact)·재개 직후에는 다시 한 번 전문이 나온다.
  # session_id 가 없으면 중복을 가릴 수 없으니 종전대로 매번 전문을 싣는다(정보를 잃는 쪽으로 실패하지 않는다).
  HARNESS_EVENTS_FILE="$events" HARNESS_EVENT_SEEN_FILE="$root/.harness/generated/agent-event-shown" HARNESS_SESSION_ID="${harness_session_id:-}" HARNESS_AGENT_EVENT_TTL_MINUTES="${HARNESS_AGENT_EVENT_TTL_MINUTES:-120}" node -e '
const fs = require("fs");
const file = process.env.HARNESS_EVENTS_FILE;
const ttlMinutes = Math.max(1, Number(process.env.HARNESS_AGENT_EVENT_TTL_MINUTES || 120));
try {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) process.exit(0);
  const event = JSON.parse(lines[lines.length - 1]);
  if (!event || !event.type) process.exit(0);
  const ts = Date.parse(event.ts || "");
  if (!Number.isFinite(ts) || Date.now() - ts > ttlMinutes * 60 * 1000) process.exit(0);
  const kind = event.type === "permission_denied" ? "permission denied" : "tool failure";
  const tool = event.tool || "unknown";
  const sid = process.env.HARNESS_SESSION_ID || "";
  const seenFile = process.env.HARNESS_EVENT_SEEN_FILE;
  const key = `${sid}:${event.ts}`;
  // 표식은 경로(.harness·generated·표식)에 링크가 하나라도 있으면 읽지도(믿지 않음) 쓰지도 않는다 — 링크 너머 파일을 덮지 않고,
  // 링크로 읽은 값을 "이미 보였다"의 증거로 쓰지 않는다(Codex 1R #3). 그럴 땐 종전처럼 전문이 나간다.
  const path = require("path");
  const trusted = [path.dirname(path.dirname(seenFile)), path.dirname(seenFile), seenFile].every((p) => {
    try { return !fs.lstatSync(p).isSymbolicLink(); } catch (e) { return Boolean(e) && e.code === "ENOENT"; }
  });
  let seen = "";
  // 읽기도 마지막 조각을 O_NOFOLLOW 로 연다 — 검사와 열기 사이에 링크로 바뀌면 열기가 실패하고 "본 적 없음"이 된다(Codex 2R #2).
  if (trusted) {
    try {
      const fd = fs.openSync(seenFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try { seen = fs.readFileSync(fd, "utf8").trim(); } finally { fs.closeSync(fd); }
    } catch (_) {}
  }
  if (sid && seen === key) {
    console.log(`Recent harness event: ${kind}; tool=${tool} (already shown in full earlier in this session); do not repeat the same attempt without addressing the cause.`);
    process.exit(0);
  }
  const input = event.input ? ` input=${event.input}` : "";
  const error = event.error ? ` error=${event.error}` : "";
  console.log(`Recent harness event: ${kind}; tool=${tool}; do not repeat the same attempt without addressing the cause.${input}${error}`);
  // 쓰기는 마지막 조각을 O_NOFOLLOW 로 열어 검사와 쓰기 사이에 링크로 바꿔치는 경우도 막는다(Codex 1R #2). 못 쓰면 다음에도 전문일 뿐이다.
  if (sid && trusted) {
    try {
      fs.mkdirSync(path.dirname(seenFile), { recursive: true });
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(seenFile, flags, 0o644);
      try { fs.writeSync(fd, key); } finally { fs.closeSync(fd); }
    } catch (_) {}
  }
} catch (_) {}
' 2>/dev/null || true
fi
