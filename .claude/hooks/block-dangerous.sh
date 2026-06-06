#!/usr/bin/env bash
set -euo pipefail

input="$(cat 2>/dev/null || true)"

cmd="$(
  HARNESS_HOOK_INPUT="$input" node -e '
const raw = process.env.HARNESS_HOOK_INPUT || "{}";
try {
  const data = JSON.parse(raw);
  const toolInput = data.tool_input || {};
  process.stdout.write(String(toolInput.command || ""));
} catch (_) {}
' 2>/dev/null || true
)"

[ -z "$cmd" ] && exit 0

profile="${HARNESS_HOOK_PROFILE:-standard}"

deny() {
  HARNESS_DENY_REASON="$1" node -e '
const reason = process.env.HARNESS_DENY_REASON || "Blocked by harness.";
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason
  }
}, null, 2));
'
  exit 0
}

warn() {
  printf '[harness warning] dangerous command pattern detected but HARNESS_HOOK_PROFILE=permissive allows it: %s\n' "$1"
  exit 0
}

dangerous_patterns=(
  'rm[[:space:]]+-rf?[[:space:]]+/'
  'rm[[:space:]]+-rf?[[:space:]]+~'
  'rm[[:space:]]+-rf?[[:space:]]+\*'
  'rm[[:space:]]+-rf?[[:space:]]+\.'
  'mkfs(\.|[[:space:]])'
  'dd[[:space:]]+if=.*of=/dev/'
  ':\(\)[[:space:]]*\{'
  'sudo[[:space:]]'
  'chmod[[:space:]]+-R[[:space:]]+777'
  'curl[[:space:]].*\|[[:space:]]*(sh|bash|zsh)'
  'wget[[:space:]].*\|[[:space:]]*(sh|bash|zsh)'
  'git[[:space:]]+push[[:space:]].*--force([[:space:]]|$)'
  'git[[:space:]]+push[[:space:]]+(.*[[:space:]])?-f([[:space:]]|$)'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+clean[[:space:]]+-fd'
  '--no-verify'
  '>[[:space:]]*/dev/sd[a-z]'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+[^|><]*\.env([[:space:]]|$|\.)'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+<[[:space:]]*[^|><]*\.env([[:space:]]|$|\.)'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+[^|><]*(id_rsa|id_ed25519)([[:space:]]|$)'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+<[[:space:]]*[^|><]*(id_rsa|id_ed25519)([[:space:]]|$)'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+[^|><]*\.aws/credentials'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+<[[:space:]]*[^|><]*\.aws/credentials'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+[^|><]*\.ssh/id_'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+<[[:space:]]*[^|><]*\.ssh/id_'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+[^|><]*\.pem([[:space:]]|$)'
  '(cat|head|tail|less|more|bat|strings|xxd|od)[[:space:]]+<[[:space:]]*[^|><]*\.pem([[:space:]]|$)'
  '>[[:space:]]*(\.env|.*\.pem|.*id_rsa|.*id_ed25519|.*\.aws/credentials)'
)

for pattern in "${dangerous_patterns[@]}"; do
  if [[ "$cmd" =~ $pattern ]]; then
    if [ "$profile" = "permissive" ]; then
      warn "$pattern"
    fi
    deny "하네스가 차단함: 명령이 위험 패턴 '${pattern}'와 일치합니다. 필요하면 사용자에게 목적과 영향 범위를 명시적으로 확인하세요."
  fi
done

if [ "$profile" = "strict" ]; then
  strict_patterns=(
    'git[[:space:]]+push[[:space:]].*--force-with-lease'
    'chmod[[:space:]]+-R'
    'chown[[:space:]]+-R'
    'truncate[[:space:]]'
    '>[[:space:]]*/etc/'
  )
  for pattern in "${strict_patterns[@]}"; do
    if [[ "$cmd" =~ $pattern ]]; then
      deny "하네스 strict 프로파일이 차단함: 명령이 '${pattern}' 패턴과 일치합니다."
    fi
  done
fi

exit 0
