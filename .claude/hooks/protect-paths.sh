#!/usr/bin/env bash
# scope: harness — 모든 프로젝트에 동일한 본체 훅. 다중 저장소 세션에서는 주 폴더 것으로 충분합니다. 프로젝트·스택이 규칙을 추가했다면 'scope: project'로 바꾸세요(상대 저장소 세션에도 얹어야 함).
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

# nvm 만 쓰는 PC(PATH 에 node 없음)에서도 하네스 실행 Node 를 찾는다(smartscore-backend/common #61 ①, 0.2.153 핫픽스): 커밋 훅·
# 세션 시작과 같은 dual-node 탐색(~/.nvm/versions/node)을 거친다. PATH 에 있는 node 는 버전과 무관하게 그대로 쓰고(JSON 파싱뿐),
# nvm 자동 탐색 후보는 dual-node 규칙대로 20.19 이상만 — 규칙을 둘로 두지 않는다. 전환 안내는 내지 않는다 — 이 훅의 stdout 은
# 판정 JSON 한 덩어리여야 한다. 파일이 없거나 실패하면 종전 판정으로 간다.
harness_hook_find_node() {
  local dual="" candidate
  for candidate in "$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)/.harness/bin/dual-node.sh" "${CLAUDE_PROJECT_DIR:-}/.harness/bin/dual-node.sh"; do
    if [ -f "$candidate" ]; then dual="$candidate"; break; fi
  done
  [ -n "$dual" ] || return 0
  HARNESS_DUAL_RUNTIME_ANNOUNCED=1
  export HARNESS_DUAL_RUNTIME_ANNOUNCED
  # shellcheck disable=SC1090
  . "$dual" 2>/dev/null || return 0
  if command -v harness_dual_node_activate >/dev/null 2>&1; then
    harness_dual_node_activate >/dev/null 2>&1 || true
  fi
}
harness_hook_find_node

# 있어도 실행이 안 되면(아키텍처 불일치·공유 라이브러리 누락, 또는 node 가 아닌 실행 파일) 없는 것과 같다(Codex 핫픽스 리뷰 #1):
# 그대로 두면 파싱 결과가 비거나 엉뚱한 문자열이 돼 "허용"으로 떨어진다 — 찾지 못한 경우와 똑같이 막는다.
harness_hook_node_usable() {
  command -v node >/dev/null 2>&1 && [ "$(node -e 'process.stdout.write("ok")' 2>/dev/null)" = "ok" ]
}

if ! harness_hook_node_usable; then
  if printf '%s' "$input" | grep -Eq '"(file_path|path)"[[:space:]]*:'; then
    deny "하네스가 차단함: node를 찾지 못해 쓰기 대상 경로를 안전하게 파싱할 수 없습니다(찾았지만 실행이 안 되는 경우 포함). 하네스 실행 Node를 먼저 연결하세요."
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
