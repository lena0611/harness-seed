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
  if printf '%s' "$input" | grep -Eq '"(file_path|path)"[[:space:]]*:'; then
    deny "하네스가 차단함: node를 찾지 못해 쓰기 대상 경로를 안전하게 파싱할 수 없습니다. 하네스 실행 Node를 먼저 연결하세요."
  fi
  exit 0
fi

target_path="$(
  HARNESS_HOOK_INPUT="$input" node -e '
const raw = process.env.HARNESS_HOOK_INPUT || "{}";
try {
  const data = JSON.parse(raw);
  const toolInput = data.tool_input || {};
  process.stdout.write(String(toolInput.file_path || toolInput.path || ""));
} catch (_) {}
' 2>/dev/null || true
)"

[ -z "$target_path" ] && exit 0

case "$target_path" in
  /etc/*|/usr/*|/bin/*|/sbin/*|/boot/*|/sys/*|/proc/*)
    deny "차단됨: 시스템 경로 '${target_path}'에 쓰기를 거부합니다." ;;
  */.git/*)
    deny "차단됨: .git 내부 직접 쓰기를 거부합니다. git 명령을 사용하세요." ;;
  */.env|*/.env.*|*/id_rsa|*/id_ed25519|*/.aws/credentials|*/.ssh/*|*.pem)
    deny "차단됨: secret 또는 자격증명 파일에 쓰기를 거부합니다." ;;
  */node_modules/*|*/vendor/*|*/.venv/*|*/dist/*|*/build/*|*/.next/*|*/target/*)
    deny "차단됨: 의존성 또는 생성물 디렉터리 '${target_path}'에 쓰기를 거부합니다." ;;
  *package-lock.json|*yarn.lock|*pnpm-lock.yaml|*Cargo.lock|*poetry.lock|*Pipfile.lock|*go.sum)
    deny "차단됨: lockfile '${target_path}' 수동 편집을 거부합니다. 패키지 매니저를 사용하세요." ;;
esac

exit 0
