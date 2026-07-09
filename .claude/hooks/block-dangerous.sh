#!/usr/bin/env bash
set -euo pipefail

input="$(cat 2>/dev/null || true)"

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

deny() {
  local reason
  reason="$(json_escape "$1")"
  printf '{\n'
  printf '  "hookSpecificOutput": {\n'
  printf '    "hookEventName": "PreToolUse",\n'
  printf '    "permissionDecision": "deny",\n'
  printf '    "permissionDecisionReason": "%s"\n' "$reason"
  printf '  }\n'
  printf '}\n'
  exit 0
}

if ! command -v node >/dev/null 2>&1; then
  if printf '%s' "$input" | grep -q '"command"[[:space:]]*:'; then
    deny "하네스가 차단함: node를 찾지 못해 Bash 명령을 안전하게 파싱할 수 없습니다. 하네스 실행 Node를 먼저 연결하세요."
  fi
  exit 0
fi

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

warn() {
  printf '[harness warning] dangerous command pattern detected but HARNESS_HOOK_PROFILE=permissive allows it: %s\n' "$1"
  exit 0
}

dangerous_patterns=(
  'rm[[:space:]]+-rf?[[:space:]]+/'
  'rm[[:space:]]+-fr[[:space:]]+/'
  'rm[[:space:]]+(-r[[:space:]]+-f|-f[[:space:]]+-r)[[:space:]]+/'
  'rm[[:space:]]+--recursive[[:space:]]+--force[[:space:]]+/'
  'rm[[:space:]]+--force[[:space:]]+--recursive[[:space:]]+/'
  'rm[[:space:]]+-rf?[[:space:]]+~'
  'rm[[:space:]]+-fr[[:space:]]+~'
  'rm[[:space:]]+-rf?[[:space:]]+\*'
  'rm[[:space:]]+-fr[[:space:]]+\*'
  'rm[[:space:]]+-rf?[[:space:]]+\.'
  'rm[[:space:]]+-fr[[:space:]]+\.'
  'find[[:space:]].*-exec[[:space:]]+rm[[:space:]]+(-rf?|-fr|--recursive[[:space:]]+--force|--force[[:space:]]+--recursive)'
  'bash[[:space:]][^|><;]*\.sh([[:space:]]|$)'
  'sh[[:space:]][^|><;]*\.sh([[:space:]]|$)'
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
