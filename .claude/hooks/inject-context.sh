#!/usr/bin/env bash
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
profile="$root/.harness/policy/profile.json"
active_stack="unknown"

if [ -f "$profile" ]; then
  active_stack="$(node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(p.activeStack || 'none')" "$profile" 2>/dev/null || printf 'unknown')"
fi

printf 'Harness context: read CLAUDE.md first; check .harness/policy/ai-standard-guiding-policy.md before work; source of truth is .harness/; activeStack=%s; before user finalization, report checks as candidates. If user asks final check, run npm run harness:check. If user asks commit/push and hooks are installed, trust pre-commit/pre-push checks and do not run duplicate manual harness:check first.\n' "$active_stack"
printf 'Harness reporting: when reporting actual work progress, summarize as [harness] request/context/impact/action/decision/verify. Do not force this format for simple Q&A, casual, or meta-only turns.\n'

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
