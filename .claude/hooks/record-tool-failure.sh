#!/usr/bin/env bash
set -euo pipefail

input="$(cat 2>/dev/null || true)"
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
events_dir="$root/.harness/generated"
events_file="$events_dir/agent-events.ndjson"
max_events="${HARNESS_AGENT_EVENT_CAP:-50}"

mkdir -p "$events_dir" 2>/dev/null || exit 0

HARNESS_HOOK_INPUT="$input" HARNESS_EVENTS_FILE="$events_file" HARNESS_MAX_EVENTS="$max_events" node <<'NODE'
const fs = require("fs");

const raw = process.env.HARNESS_HOOK_INPUT || "{}";
const eventsFile = process.env.HARNESS_EVENTS_FILE;
const maxEvents = Math.max(1, Number(process.env.HARNESS_MAX_EVENTS || 50));
const eventType = process.env.HARNESS_AGENT_EVENT_TYPE || "tool_failure";

function valueAt(data, path) {
  return path.reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, data);
}

function truncate(text, max) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function redact(text) {
  return String(text || "")
    .replace(/sk-(ant-|proj-)?[A-Za-z0-9_-]{16,}/g, "sk-REDACTED")
    .replace(/ghp_[A-Za-z0-9]{16,}/g, "ghp_REDACTED")
    .replace(/github_pat_[A-Za-z0-9_]{16,}/g, "github_pat_REDACTED")
    .replace(/ghs_[A-Za-z0-9]{16,}/g, "ghs_REDACTED")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA_REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]{16,}={0,2}/g, "Bearer REDACTED")
    .replace(/(password|passwd|pwd)\s*[=:]\s*\S+/gi, "$1=REDACTED")
    .replace(/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, "PRIVATE_KEY_REDACTED");
}

let data;
try {
  data = JSON.parse(raw);
} catch (_) {
  process.exit(0);
}

if (data.is_interrupt === true) process.exit(0);

const tool = String(data.tool_name || "unknown");
const command = valueAt(data, ["tool_input", "command"]) ||
  valueAt(data, ["tool_input", "file_path"]) ||
  valueAt(data, ["tool_input", "path"]) ||
  "";
const error = data.reason || data.error || valueAt(data, ["tool_response", "error"]) || data.tool_response || "";

const event = {
  ts: new Date().toISOString(),
  type: eventType,
  tool,
  input: truncate(redact(command), 300),
  error: truncate(redact(error), 500)
};

let events = [];
try {
  if (fs.existsSync(eventsFile)) {
    events = fs.readFileSync(eventsFile, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  }
} catch (_) {
  events = [];
}

events.push(event);
events = events.slice(-maxEvents);

try {
  fs.writeFileSync(eventsFile, `${events.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
} catch (_) {
  process.exit(0);
}

const output = {
  hookSpecificOutput: {
    hookEventName: eventType === "permission_denied" ? "PermissionDenied" : "PostToolUseFailure",
    additionalContext: "하네스가 최근 tool 실패를 .harness/generated/agent-events.ndjson에 값 redaction 후 capped 기록했습니다. 같은 입력을 그대로 반복하지 말고 원인을 먼저 확인하세요."
  }
};

if (eventType === "permission_denied") {
  output.hookSpecificOutput.retry = false;
  delete output.hookSpecificOutput.additionalContext;
}

console.log(JSON.stringify(output, null, 2));
NODE

exit 0
