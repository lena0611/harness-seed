#!/usr/bin/env bash
# scope: harness — 모든 프로젝트에 동일한 본체 훅. 다중 저장소 세션에서는 주 폴더 것으로 충분합니다.
set -euo pipefail

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

# 훅 미설치 감지(결정 94): 훅 설정은 clone으로 공유되지 않으므로 새로 받은 clone은 관문이 꺼져 있다.
# 매 세션 한 줄로 알려 에이전트가 사용자에게 안내하고, 요청 시 켜줄 수 있게 한다. fail-open.
if [ -f "$root/.harness/bin/hooks-state.mjs" ] && git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # 판정 정본은 hooks-state.mjs(0.2.146). off 는 항상 상기하고, optout 은 존중한다.
  # legacy(예전 방식)는 **자동 갱신 배선이 없을 때만** 알린다(0.2.147, 적대적 리뷰): Claude 세션 시작 훅이
  # 배선된 프로젝트는 그 세션이 알아서 갱신하지만, 터미널·Codex 전용 clone 은 알려 주는 채널이 여기뿐이었다.
  hooks_state="$(cd "$root" && node .harness/bin/hooks-state.mjs 2>/dev/null || printf 'off')"
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
