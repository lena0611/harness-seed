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

# 프로젝트 자체 소스가 vendor/·target/ 같은 이름의 폴더에 사는 경우(smartscore-backend/common #61 ②: ss/vendor/ 는 PHP 컨트롤러,
# ss/js/mng/target/ 은 자체 코드). 폴더 이름만으로는 의존성·생성물과 구분할 수 없으므로, 프로젝트가 .harness/policy/profile.json 의
# protectedPathAllow 에 { path, reason } 를 적으면 그 path 아래만 "의존성·생성물" 규칙에서 뺀다. 안전장치를 여는 선언이라 이유(reason)가
# 없는 항목은 선언으로 치지 않는다. 시스템 경로·.git·비밀 파일·lockfile 규칙은 선언과 무관하게 그대로다(case 순서상 먼저 판정).
# 저장소 밖 경로는 선언해도 통하지 않고, 대상까지의 경로 구성요소에 링크가 하나라도 있으면(끊어진 링크 포함) 선언이 적용되지 않는다 —
# 링크 너머에 쓰는 것을 선언으로 열어 주지 않는다. profile.json 은 프로젝트 소유라 업데이트가 덮지 않는다. 못 읽으면 차단(fail-closed).
harness_project_allows() {
  local root
  root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  [ -f "$root/.harness/policy/profile.json" ] || return 1
  HARNESS_ROOT="$root" HARNESS_TARGET="$1" node -e '
const fs = require("fs");
const path = require("path");
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch (_) { return false; } };
const real = (p) => { try { return fs.realpathSync(p); } catch (_) { return null; } };
try {
  const root = process.env.HARNESS_ROOT;
  const target = process.env.HARNESS_TARGET;
  const profile = JSON.parse(fs.readFileSync(path.join(root, ".harness/policy/profile.json"), "utf8"));
  const allow = Array.isArray(profile.protectedPathAllow) ? profile.protectedPathAllow : [];
  const realRoot = real(root);
  if (!realRoot) process.exit(1);
  // 대상은 루트(또는 실제 경로의 루트 — macOS 의 /var → /private/var) **문자열 아래**에 있어야 한다. 실제 경로로 풀어서 비교하지 않는다:
  // 풀면 링크 너머가 루트 안으로 들어와(public.txt → .env) 접두가 맞아 버린다. 다른 드라이브·UNC·`..` 로 벗어난 경로는 접두가 안 맞아 밖이다.
  // 원본 경로에 `..` 가 있으면 선언을 적용하지 않는다(Codex 2R #1): normalize 가 `link/..` 를 지워 링크 검사를 건너뛰게 만들지만
  // 파일시스템은 그 링크를 따라간다. 구분자는 `/`·`\` 둘 다로 자른다(Windows Git Bash 의 혼합 표기, Codex 2R #3).
  const splitAny = (p) => String(p).split(/[\\/]+/).filter(Boolean);
  if (splitAny(target).includes("..")) process.exit(1);
  const abs = path.isAbsolute(target) ? path.normalize(target) : path.resolve(process.cwd(), target);
  const underneath = (base) => (abs.startsWith(base + path.sep) ? abs.slice(base.length + 1) : null);
  const relNative = underneath(path.normalize(root)) ?? underneath(realRoot);
  if (!relNative) process.exit(1);
  const parts = relNative.split(path.sep).filter(Boolean);
  if (parts.length === 0 || parts.includes("..") || parts.includes(".")) process.exit(1);
  // 루트 아래 구성요소를 하나씩 lstat 한다 — 어느 하나라도 링크면(잎·폴더·끊어진 링크 모두) 선언을 적용하지 않는다.
  // existsSync 는 링크를 따라가 끊어진 링크를 "없는 파일"로 보지만 lstat 은 링크 자체를 본다.
  let probe = realRoot;
  for (const part of parts) { probe = path.join(probe, part); if (isLink(probe)) process.exit(1); }
  // 선언과 무관한 규칙(.git·비밀 파일·lockfile)을 여기서 한 번 더 본다 — 위 bash case 는 대소문자를 가리고 `\` 경계를 모르므로,
  // 대소문자를 안 가리는 파일시스템(macOS 기본)에서 `.ENV`·`PACKAGE-LOCK.JSON` 이나 `.git\config` 가 선언으로 열린다(Codex 2R #2·#3).
  const partsAll = parts.flatMap(splitAny).map((p) => p.toLowerCase());
  const base = partsAll[partsAll.length - 1] || "";
  const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "cargo.lock", "poetry.lock", "pipfile.lock", "go.sum"];
  if (partsAll.includes(".git") || partsAll.includes(".ssh") || partsAll.includes(".aws")) process.exit(1);
  if (base === ".env" || base.startsWith(".env.") || base === "id_rsa" || base === "id_ed25519" || base.endsWith(".pem") || lockfiles.includes(base)) process.exit(1);
  const relPosix = parts.join("/");
  const ok = allow.some((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string") return false;
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") return false;
    const raw = entry.path.trim();
    if (raw === "" || path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith("\\\\")) return false;
    const prefix = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (prefix === "" || prefix === "." || prefix === ".." || prefix.startsWith("../") || prefix.includes("/../")) return false;
    return relPosix === prefix || relPosix.startsWith(prefix + "/");
  });
  process.exit(ok ? 0 : 1);
} catch (_) {
  process.exit(1);
}
' 2>/dev/null
}

case "$target_path" in
  /etc/*|/usr/*|/bin/*|/sbin/*|/boot/*|/sys/*|/proc/*)
    deny "차단됨: 시스템 경로 '${target_path}'에 쓰기를 거부합니다." ;;
  */.git/*)
    deny "차단됨: .git 내부 직접 쓰기를 거부합니다. git 명령을 사용하세요." ;;
  */.env|*/.env.*|*/id_rsa|*/id_ed25519|*/.aws/credentials|*/.ssh/*|*.pem)
    deny "차단됨: secret 또는 자격증명 파일에 쓰기를 거부합니다." ;;
  *package-lock.json|*yarn.lock|*pnpm-lock.yaml|*Cargo.lock|*poetry.lock|*Pipfile.lock|*go.sum)
    deny "차단됨: lockfile '${target_path}' 수동 편집을 거부합니다. 패키지 매니저를 사용하세요." ;;
  # lockfile 판정을 이 분기보다 앞에 둔다 — 선언으로 연 폴더 안의 lockfile 도 계속 막혀야 한다(Codex 리뷰 #1).
  */node_modules/*|*/vendor/*|*/.venv/*|*/dist/*|*/build/*|*/.next/*|*/target/*)
    if ! harness_project_allows "$target_path"; then
      deny "차단됨: 의존성 또는 생성물 디렉터리 '${target_path}'에 쓰기를 거부합니다. 프로젝트 자체 소스라면 .harness/policy/profile.json 의 protectedPathAllow 에 { \"path\": \"ss/vendor/\", \"reason\": \"왜 자체 소스인지\" } 처럼 저장소 기준 경로와 이유를 적으세요."
    fi ;;
esac

exit 0
