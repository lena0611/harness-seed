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
  const cmd = String(toolInput.command || "");
  // ⑧(0.2.136, 백엔드 첫 적용 리포트): heredoc 본문은 데이터일 수 있다. 받는 명령이
  // 순수 쓰기(cat/tee)면 본문을 검사 대상에서 뺀다 — 위험 명령을 "언급"하는 문서 작성이
  // 차단되지 않게. bash/sh/python 등 해석기로 가는 heredoc은 본문이 실행이므로 그대로 둔다.
  const lines = cmd.split("\n");
  const out = [];
  let term = null;
  for (const line of lines) {
    if (term !== null) {
      if (line.trim() === term) term = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) {
      let head = line.replace(/^\s+/, "");
      while (/^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+/.test(head)) {
        head = head.replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+/, "");
      }
      const recv = head.split(/\s+/)[0];
      if (recv === "cat" || recv === "tee") term = m[2];
    }
  }
  process.stdout.write(out.join("\n"));
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
  'mkfs(\.|[[:space:]])'
  'dd[[:space:]]+if=.*of=/dev/'
  ':\(\)[[:space:]]*\{'
  'curl[[:space:]].*\|[[:space:]]*(sh|bash|zsh)'
  'wget[[:space:]].*\|[[:space:]]*(sh|bash|zsh)'
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

# 줄 어디에 있어도 위험한 부분문자열(파괴·유출 계열). 검사는 줄 단위다 —
# 전체 텍스트로 하면 [^|><]* 같은 조각이 줄바꿈을 넘어 이어 붙어, 서로 무관한 두 줄이
# 하나의 "위험 명령"으로 오탐된다(0.2.136 구현 중 실측: tail -1 …\n… .env 파일명).
while IFS= read -r line; do
  for pattern in "${dangerous_patterns[@]}"; do
    if [[ "$line" =~ $pattern ]]; then
      if [ "$profile" = "permissive" ]; then
        warn "$pattern"
      fi
      deny "하네스가 차단함: 명령이 위험 패턴 '${pattern}'와 일치합니다. 걸린 줄: $(printf '%s' "$line" | cut -c1-160) (cat/tee heredoc 본문은 검사 제외 — 이 매칭은 실행부입니다). 필요하면 사용자에게 목적과 영향 범위를 확인하세요."
    fi
  done
done <<< "$cmd"

# 명령 위치에서만 위험한 것들(⑧, 0.2.136): 문서 본문·산문에서 이름만 언급되는 경우가 잦아
# 줄머리(또는 ; & | ( 뒤)에서 시작할 때만 잡는다. --no-verify는 git 명령줄에 묶는다.
command_position_patterns=(
  'sudo[[:space:]]'
  'chmod[[:space:]]+-R[[:space:]]+777'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+clean[[:space:]]+-fd'
  'git[[:space:]]+push[[:space:]].*--force([[:space:]]|$)'
  'git[[:space:]]+push[[:space:]]+(.*[[:space:]])?-f([[:space:]]|$)'
  'git[[:space:]][^;|&]*--no-verify'
  'bash[[:space:]][^|><;]*\.sh([[:space:]]|$)'
  'sh[[:space:]][^|><;]*\.sh([[:space:]]|$)'
)
while IFS= read -r line; do
  for pattern in "${command_position_patterns[@]}"; do
    if [[ "$line" =~ ^[[:space:]]*($pattern) ]] || [[ "$line" =~ [\;\&\|\(][[:space:]]*($pattern) ]]; then
      if [ "$profile" = "permissive" ]; then
        warn "$pattern"
      fi
      deny "하네스가 차단함: 명령 위치에서 위험 패턴 '${pattern}'와 일치합니다. 걸린 줄: $(printf '%s' "$line" | cut -c1-160). 필요하면 사용자에게 목적과 영향 범위를 확인하세요."
    fi
  done
done <<< "$cmd"

if [ "$profile" = "strict" ]; then
  strict_patterns=(
    'git[[:space:]]+push[[:space:]].*--force-with-lease'
    'chmod[[:space:]]+-R'
    'chown[[:space:]]+-R'
    'truncate[[:space:]]'
    '>[[:space:]]*/etc/'
  )
  while IFS= read -r line; do
    for pattern in "${strict_patterns[@]}"; do
      if [[ "$line" =~ $pattern ]]; then
        deny "하네스 strict 프로파일이 차단함: 명령이 '${pattern}' 패턴과 일치합니다. 걸린 줄: $(printf '%s' "$line" | cut -c1-160)"
      fi
    done
  done <<< "$cmd"
fi

exit 0
