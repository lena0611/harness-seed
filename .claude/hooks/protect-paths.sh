#!/usr/bin/env bash
set -euo pipefail

input="$(cat 2>/dev/null || true)"

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
