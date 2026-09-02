#!/usr/bin/env bash
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
profile="$root/.harness/policy/profile.json"
active_stack="unknown"

if [ -f "$profile" ]; then
  active_stack="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(p.activeStack || 'none')" "$profile" 2>/dev/null || printf 'unknown')"
fi

printf 'Harness context: read CLAUDE.md first; check .harness/policy/ai-standard-guiding-policy.md before work; source of truth is .harness/; activeStack=%s; before user finalization, report checks as candidates. If user asks final check, run .harness/bin/harness check. If user asks commit/push and hooks are installed, trust pre-commit/pre-push checks and do not run duplicate manual harness:check first.\n' "$active_stack"
printf 'Harness reporting: when reporting actual work progress, summarize as [harness] request/context/impact/action/decision/verify. Do not force this format for simple Q&A, casual, or meta-only turns.\n'

# 연결 프로젝트(0.2.139): 매 프롬프트에 한 줄 — 그쪽 파일 작업 전 기준 문서 읽기·런처 경로·커밋 위치 상기.
if [ -f "$profile" ]; then
  node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
let linked = [];
try { linked = JSON.parse(fs.readFileSync(path.join(root, ".harness/policy/profile.json"), "utf8")).linkedProjects || []; } catch {}
for (const it of Array.isArray(linked) ? linked : []) {
  if (!it || typeof it.path !== "string") continue;
  const abs = path.resolve(root, it.path);
  if (!fs.existsSync(abs)) continue;
  const label = it.label || it.path;
  const focus = typeof it.focus === "string" && it.focus ? it.focus : "";
  console.log(`Linked project ${label}: ${abs}${focus ? ` (focus ${focus})` : ""} — before touching files there, read its CLAUDE.md${focus ? ` and ${focus}/CLAUDE.md` : ""}; run its harness via ${abs}/.harness/bin/harness; commit inside that repo (its own git hooks check).`);
}
' "$root" 2>/dev/null || true
fi

# 훅 미설치 감지(결정 94): 훅 설정은 clone으로 공유되지 않으므로 새로 받은 clone은 관문이 꺼져 있다.
# 매 세션 한 줄로 알려 에이전트가 사용자에게 안내하고, 요청 시 켜줄 수 있게 한다. fail-open.
if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hooks_path="$(git -C "$root" config core.hooksPath 2>/dev/null || printf '')"
  auto_enable="$(git -C "$root" config harness.hooksAutoEnable 2>/dev/null || printf '')"
  if [ "$hooks_path" != ".githooks" ] && [ "$auto_enable" != "false" ]; then
    printf 'Harness hooks are OFF in this clone (hook config does not travel with git clone; the team already opted in by adding the harness). Turn them on NOW by running .harness/bin/harness hooks:install (idempotent, preserves existing hooks by chaining), then tell the user in one line that you enabled them.\n'
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
