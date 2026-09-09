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
  // 첫 줄은 훅 입력의 cwd(실행 폴더) — 셸 스크립트 실행 판정이 상대 경로를 풀 때 쓴다(0.2.146, 리뷰 P1-2).
  process.stdout.write(String(data.cwd || "") + "\n" + out.join("\n"));
} catch (_) {}
' 2>/dev/null || true
)"

hook_cwd="${cmd%%$'\n'*}"
cmd="${cmd#*$'\n'}"
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

# 셸 스크립트 실행(bash/sh <파일>.sh) 완화(0.2.146, smartscore-backend/common 후속 제보 ③ + Codex 설계 리뷰):
# 팀이 커밋한 절차 스크립트(예: bash tools/php/dev-setup.sh)까지 일괄 차단되던 것을, 아래 조건을 모두 만족할 때만 통과시킨다.
#   - 스크립트 경로 토큰을 안전하게 뽑을 수 있다(변수·따옴표·백틱이 섞이면 판정 불가 → 종전대로 차단, fail-closed)
#   - 저장소 안의 일반 파일이다(심볼릭 링크는 실제 경로로 확인 — 저장소 밖을 가리키면 차단)
#   - HEAD에 존재하고, 인덱스·작업 파일이 HEAD와 같다 — "기존 버전 그대로인 진입점"이라는 뜻일 뿐 안전 증명은 아니다.
#     새로 만든 스크립트(git add만 한 것 포함)·고친 스크립트는 종전대로 차단 → 사용자 확인 절차로.
#   - 예외: 인터프리터 옵션 자리의 -n(문법 검사만)은 실행이 아니므로 통과. `sh file.sh -n`은 인자라 예외가 아니다.
# 이 판정은 해당 패턴 하나만 건너뛴다 — 같은 줄의 다른 위험 패턴(sudo, curl|sh 등)은 계속 검사한다.
script_exec_allowed() {
  local seg="$1" before="$2"
  local -a toks
  read -ra toks <<< "$seg"
  local i=1 script="" syntax_only=0
  while [ $i -lt ${#toks[@]} ]; do
    local t="${toks[$i]}"
    case "$t" in
      -n) syntax_only=1 ;;
      -*) ;;
      *) script="$t"; break ;;
    esac
    i=$((i + 1))
  done
  [ "$syntax_only" = "1" ] && return 0
  [ -n "$script" ] || return 1
  case "$script" in *'$'*|*'`'*|*'"'*|*"'"*) return 1 ;; esac
  # 조각 안에 연결 연산자나 또 다른 .sh 토큰이 있으면 실행을 하나씩 확정할 수 없다 → 자동 허용하지 않는다(fail-closed).
  local j=$((i + 1))
  while [ $j -lt ${#toks[@]} ]; do
    case "${toks[$j]}" in '&&'|'||'|';'|'|'|'('|')'|*.sh|*'`'*|*'$('*) return 1 ;; esac
    j=$((j + 1))
  done
  # 실행 대상 파일을 확정할 수 있어야 한다(리뷰 P1-2). 같은 명령 안에서 이 실행보다 앞에 cd 가 있으면 실행 폴더가
  # 바뀌었을 수 있어 상대 경로를 풀 수 없다 → 자동 허용하지 않는다(절대 경로는 cd 와 무관하니 그대로 판정).
  case "$script" in
    /*) ;;
    *) if [[ "$before" =~ (^|[\;\&\|\(\{[:space:]])(cd|pushd|popd)([[:space:]]|$) ]]; then return 1; fi ;;
  esac
  local root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  local base="${hook_cwd:-$root}"
  local rel
  rel="$(HARNESS_SCRIPT_PATH="$script" HARNESS_ROOT="$root" HARNESS_BASE="$base" node -e '
const fs = require("fs"); const path = require("path");
try {
  const root = fs.realpathSync(process.env.HARNESS_ROOT);
  const base = fs.realpathSync(process.env.HARNESS_BASE || root);
  const p = process.env.HARNESS_SCRIPT_PATH;
  const abs = path.isAbsolute(p) ? p : path.resolve(base, p);   // 상대 경로는 실행 폴더(훅 입력 cwd) 기준
  if (!fs.statSync(abs).isFile()) process.exit(1);          // 링크는 따라가 실제 파일인지 본다
  const real = fs.realpathSync(abs);
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) process.exit(1); // 저장소 밖
  process.stdout.write(rel.split(path.sep).join("/"));
} catch { process.exit(1); }
' 2>/dev/null)" || return 1
  [ -n "$rel" ] || return 1
  git -C "$root" cat-file -e "HEAD:$rel" 2>/dev/null || return 1
  git -C "$root" diff --quiet HEAD -- "$rel" 2>/dev/null || return 1
  git -C "$root" diff --quiet --cached HEAD -- "$rel" 2>/dev/null || return 1
  return 0
}

# 한 줄에 셸 스크립트 실행이 여럿이면 **각각** 판정한다(리뷰 P1-1) — 하나가 통과했다고 뒤의 것을 건너뛰지 않는다.
# 하나라도 통과 못 하면 그 실행을 이유로 차단한다. $3 은 같은 명령의 **앞선 줄들**(리뷰 P1-2 잔존): 앞줄의 cd 도
# 뒤 줄의 상대 경로 판정에 반영돼야 한다 — 두 줄로 나눠 쓴 `cd 폴더` + `bash 상대경로` 는 흔한 형태다.
script_execs_all_allowed() {
  local line="$1" pattern="$2" prefix="${3:-}" rest="$1" consumed="" seg judge
  while [[ "$rest" =~ (^|[\;\&\|\(])[[:space:]]*($pattern) ]]; do
    seg="${BASH_REMATCH[2]}"
    judge="${seg%[;&|)]}"          # 경계로 잡힌 종료 연산자는 판정 대상에서 뺀다
    local idx="${rest%%"$seg"*}"
    local before="${prefix}${consumed}${idx}"
    if ! script_exec_allowed "$judge" "$before"; then
      denied_segment="$judge"
      return 1
    fi
    consumed="${consumed}${idx}${seg}"
    rest="${rest#*"$seg"}"
  done
  return 0
}

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
  # & 도 제외한다(0.2.146, 리뷰 P1-1): 넣어 두면 `bash a.sh && bash b.sh` 가 한 조각으로 잡혀 첫 스크립트만 판정된다.
  # .sh 바로 뒤의 ; & | ) 도 경계다(리뷰 P1-1 잔존): 공백 없이 `bash new.sh; …` 로 이어 쓰면 그 실행을 놓쳤다.
  'bash[[:space:]][^|><;&]*\.sh([[:space:]]|$|[;&|)])'
  'sh[[:space:]][^|><;&]*\.sh([[:space:]]|$|[;&|)])'
)
seen_lines=""
while IFS= read -r line; do
  for pattern in "${command_position_patterns[@]}"; do
    if [[ "$line" =~ ^[[:space:]]*($pattern) ]] || [[ "$line" =~ [\;\&\|\(][[:space:]]*($pattern) ]]; then
      case "$pattern" in
        *'\.sh('*)
          denied_segment=""
          if script_execs_all_allowed "$line" "$pattern" "$seen_lines"; then
            continue
          fi
          if [ "$profile" = "permissive" ]; then
            warn "$pattern"
          fi
          deny "하네스가 차단함: 셸 스크립트 실행 '$(printf '%s' "$denied_segment" | cut -c1-120)' — 저장소에 커밋된 그대로(HEAD와 동일)인 저장소 안 스크립트만, 실행 폴더를 확정할 수 있을 때(같은 명령에 앞선 cd 없음) 통과합니다. 새로 만들거나 고친 스크립트, 저장소 밖 스크립트는 사용자에게 목적과 영향 범위를 확인한 뒤 진행하세요. 문법 검사만 하려면 sh -n <파일>."
          ;;
      esac
      if [ "$profile" = "permissive" ]; then
        warn "$pattern"
      fi
      deny "하네스가 차단함: 명령 위치에서 위험 패턴 '${pattern}'와 일치합니다. 걸린 줄: $(printf '%s' "$line" | cut -c1-160). 필요하면 사용자에게 목적과 영향 범위를 확인하세요."
    fi
  done
  seen_lines="${seen_lines}${line}"$'\n'
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
