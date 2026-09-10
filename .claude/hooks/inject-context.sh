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

printf 'Harness context: read CLAUDE.md first; check .harness/policy/ai-standard-guiding-policy.md before work; source of truth is .harness/; activeStack=%s; before user finalization, report checks as candidates. If user asks final check, run .harness/bin/harness check. If user asks commit/push and hooks are installed, trust pre-commit/pre-push checks and do not run duplicate manual harness:check first.\n' "$active_stack"
printf 'Harness reporting: when reporting actual work progress, summarize as [harness] request/context/impact/action/decision/verify. Do not force this format for simple Q&A, casual, or meta-only turns.\n'

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
  HARNESS_EVENTS_FILE="$events" HARNESS_AGENT_EVENT_TTL_MINUTES="${HARNESS_AGENT_EVENT_TTL_MINUTES:-120}" node -e '
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
  const input = event.input ? ` input=${event.input}` : "";
  const error = event.error ? ` error=${event.error}` : "";
  console.log(`Recent harness event: ${kind}; tool=${tool}; do not repeat the same attempt without addressing the cause.${input}${error}`);
} catch (_) {}
' 2>/dev/null || true
fi
