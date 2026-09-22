#!/usr/bin/env sh
# preflight.sh — "하네스가 지금 돌 수 있는가"를 판정하고, **못 갖춘 것만** 표로 모은다.
#
# 왜 별도 파일인가: 같은 사실을 말하는 자리가 둘이면 문구를 한쪽만 고치게 된다(0.2.147 #29 ①,
# 0.2.149 설치 진단 실측 — 화면에 찍히던 쪽은 고치지 않은 사본이었다). 세션 시작 훅과 post-merge
# 훅이 이 파일 하나를 source 하므로 문구를 고칠 자리도 하나다.
#
# 계약(.harness/project/commit-push-rules.md "hook 구현 계약"과 같은 규율):
# - POSIX sh 호환(dash 포함). bash 전용 문법을 쓰지 않는다.
# - set -u 안전. 어떤 함수도 비0으로 끝나지 않는다 — 호출자의 set -e 를 죽이지 않는다.
# - 정상은 침묵: 못 갖춘 것이 없으면 아무것도 출력하지 않는다 — 훅이 source 해서 부를 때. 파일을 **직접 실행**하면
#   맨 아래 꼬리가 판정을 돌려 표 또는 "없음" 한 줄을 낸다(0.2.152 #49 — 침묵의 뜻이 둘이면 안 된다).
# - dual-node.sh 를 source 해 nvm 설치본을 찾는다. git 훅과 런처가 쓰는 것과 같은 규칙이다.
#   전환 안내 한 줄을 감출지는 호출자가 HARNESS_DUAL_RUNTIME_ANNOUNCED 로 정한다.

# 최소 버전은 dual-node.sh · check-node-version.mjs · node-env.mjs · init.mjs 와 함께 올린다.
HARNESS_PREFLIGHT_MIN_MAJOR=20
HARNESS_PREFLIGHT_MIN_MINOR=19

HARNESS_GAPS=''
HARNESS_GAP_DETAIL=''
HARNESS_NODE_OK=0
HARNESS_NODE_VER=''
HARNESS_NODE_USABLE=1
HARNESS_NODE_WHY=''

# 하네스 스크립트를 돌릴 수 있는 버전인가. 외부 함수에 기대지 않는다 — 기대면 그 파일이 없거나
# 옛 버전일 때 판정이 조용히 사라지거나(낮은 Node 가 통과) 뒤집힌다(멀쩡한 Node 를 낮다고 단정).
# 둘 다 적대적 리뷰에서 실측된 경로다(P1-2·P1-3).
harness_preflight_node_ok_version() {
  hpv=${1:-}
  hpv=${hpv#v}
  hpv_major=${hpv%%.*}
  case "$hpv_major" in ''|*[!0-9]*) return 1 ;; esac
  hpv_rest=${hpv#"$hpv_major"}
  hpv_rest=${hpv_rest#.}
  hpv_minor=${hpv_rest%%.*}
  case "$hpv_minor" in ''|*[!0-9]*) hpv_minor=0 ;; esac
  if [ "$hpv_major" -gt "$HARNESS_PREFLIGHT_MIN_MAJOR" ]; then return 0; fi
  if [ "$hpv_major" -eq "$HARNESS_PREFLIGHT_MIN_MAJOR" ] && [ "$hpv_minor" -ge "$HARNESS_PREFLIGHT_MIN_MINOR" ]; then return 0; fi
  return 1
}

# $1 항목 · $2 지금 · $3 해결
harness_gap() {
  HARNESS_GAPS="${HARNESS_GAPS}| $1 | $2 | $3 |
"
}

# Node 는 하네스 스크립트 전부의 전제다. 셸에서 먼저 본다 — node 없이 상태를 물으면 조회가 실패하고
# 그 실패가 "꺼짐"으로 폴백해 **모름이 단정으로 둔갑한다**(실측: 훅이 켜져 있는데도 꺼졌다고 알렸다).
# 판정 기준은 "있나 없나"가 아니라 "하네스 스크립트를 돌릴 수 있나"다. Node 12 는 존재하지만
# 최신 문법에서 죽으므로 없는 것과 같이 다룬다.
# $1: 저장소 루트
harness_preflight_node() {
  hpn_root=$1
  HARNESS_NODE_OK=0
  HARNESS_NODE_VER=''
  HARNESS_NODE_USABLE=1
  HARNESS_NODE_WHY=''
  if [ -f "$hpn_root/.harness/bin/dual-node.sh" ]; then
    . "$hpn_root/.harness/bin/dual-node.sh"
    # 함수가 실제로 정의됐을 때만 부른다 — 파일 존재만 보고 부르면 옛·깨진 파일에서 훅이 죽는다.
    if command -v harness_dual_node_activate >/dev/null 2>&1; then
      harness_dual_node_activate || true
    fi
  fi
  if command -v node >/dev/null 2>&1; then
    HARNESS_NODE_VER="$(node --version 2>/dev/null || printf '')"
    if [ -n "$HARNESS_NODE_VER" ]; then HARNESS_NODE_OK=1; fi
  fi
  if [ "$HARNESS_NODE_OK" = "0" ]; then
    HARNESS_NODE_USABLE=0
    HARNESS_NODE_WHY='Node 없음'
    harness_gap '하네스 실행 Node' 'PATH·nvm 어디에도 없음' 'Node 20.19+ 설치 (nvm 쓰면 nvm install 20)'
  elif ! harness_preflight_node_ok_version "$HARNESS_NODE_VER"; then
    HARNESS_NODE_USABLE=0
    HARNESS_NODE_WHY="Node $HARNESS_NODE_VER — 하네스 최소 20.19 미만"
    harness_gap '하네스 실행 Node 20.19+' "$HARNESS_NODE_VER (낮음 — 하네스 스크립트가 이 버전에서 실행되지 않습니다)" 'Node 20.19+ 설치 (nvm 쓰면 nvm install 20 — 프로젝트 Node 는 그대로 둡니다)'
  fi
  # 호출자가 따로 부르게 두지 않는다. 세 채널(세션 시작·프롬프트·pull)이 모두 이 함수를 부르므로
  # 여기서 이어 부르면 **어느 채널도 빠뜨릴 수 없다** — 빠뜨리면 그것이 이 표가 막으려는 조용한 부재다.
  harness_preflight_project_node "$hpn_root"
  return 0
}

# 프로젝트가 요구하는 Node(.nvmrc)와 지금 셸의 Node가 다른가. 위 판정은 "하네스가 돌 수 있나"(20.19+)만 보므로,
# 둘 다 20.19 이상이면서 서로 다른 경우가 통째로 비어 있었다 — 그 사이에 프로젝트 빌드가 틀린 Node 로 돈다.
# 실증(clubadm ORP-218, 2026-09-16): .nvmrc 가 v24.14.0(x64)인데 셸 기본이 v24.19.0(arm64)이었다. 표는 침묵했고,
# 에이전트가 그 Node 로 빌드해 실패하자 **정상이던 x64 node_modules 를 "오염"으로 오진**하고 npm ci 로 갈아엎어
# 개발자의 npm run dev 를 깨뜨렸다. 팀이 리마인더에 "nvm use 부터"를 손으로 적어 두었지만 그건 읽는 글이라
# 무시됐다 — 같은 사실이 이 표에 있으면 장치가 된다.
# $1: 저장소 루트
harness_preflight_project_node() {
  hpp_root=$1
  # Node 자체를 못 쓰는 상태면 위 행이 이미 말했다. 여기서 또 말하면 같은 문제를 두 줄로 센다.
  [ "$HARNESS_NODE_USABLE" = "1" ] || return 0
  [ -f "$hpp_root/.nvmrc" ] || return 0

  hpp_spec=$(tr -d ' \t\r\n' < "$hpp_root/.nvmrc" 2>/dev/null || printf '')
  hpp_spec=${hpp_spec#v}
  [ -n "$hpp_spec" ] || return 0
  # lts/* · node 같은 별칭은 이 자리에서 해석하지 않는다. 모르는 것을 단정하지 않는다.
  case "$hpp_spec" in *[!0-9.]*) return 0 ;; esac
  # dual-runtime(.nvmrc 가 하네스 최소 미만)은 **선언된 정상 상태**다. 어긋남이 아니므로 침묵한다 —
  # 항상 켜져 있는 경고는 무시당하고, 그러면 진짜 어긋남까지 같이 묻힌다.
  harness_preflight_node_ok_version "$hpp_spec" || return 0

  hpp_now=${HARNESS_NODE_VER#v}
  # spec 이 적은 자리까지만 본다: `24` 는 24.x 전부를, `24.14` 는 24.14.x 전부를 만족한다(nvm 규칙).
  case "$hpp_now" in
    "$hpp_spec") return 0 ;;
    "$hpp_spec".*) return 0 ;;
  esac

  harness_gap '프로젝트 Node' "$HARNESS_NODE_VER — .nvmrc 는 v$hpp_spec" "nvm use v$hpp_spec (없으면 nvm install v$hpp_spec 먼저) — 프로젝트 빌드·설치 명령 전에"
  return 0
}

# Node 를 못 쓰면 훅 상태는 "꺼짐"이 아니라 "판정 불가"다. 처방으로 hooks:install 을 주지도 않는다 —
# 그 명령도 Node 로 돌기 때문에 같은 이유로 실패할 명령이다.
# $1: 저장소 루트
harness_preflight_hooks_undecidable() {
  hpu_root=$1
  if [ "$HARNESS_NODE_USABLE" = "0" ] && [ -f "$hpu_root/.harness/bin/hooks-state.mjs" ] \
    && git -C "$hpu_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    harness_gap '커밋·푸시 훅' "판정 불가 ($HARNESS_NODE_WHY)" '위 Node 부터 — 훅 판정·설치가 Node 로 돕니다'
  fi
  return 0
}

harness_preflight_print() {
  if [ -n "$HARNESS_GAPS" ]; then
    printf '\n[harness] 준비 안 된 항목 — 이 상태로는 하네스가 제대로 돌지 않습니다. 해결 열의 방법을 그대로 따르면 됩니다.\n'
    printf '| 항목 | 지금 | 해결 |\n'
    printf '| --- | --- | --- |\n'
    printf '%s' "$HARNESS_GAPS"
    if [ -n "$HARNESS_GAP_DETAIL" ]; then
      printf '%s\n' "$HARNESS_GAP_DETAIL"
    fi
  fi
  return 0
}

# ── 직접 실행됐을 때(0.2.152, scorecard-print #49 ①) ─────────────────────────────────────────────────
# 이 파일은 훅이 source 하는 라이브러리지만 실행 비트와 shebang 이 있어 실행되는 파일처럼 보인다. 직접 실행하면
# 함수만 정의하고 끝나 **아무 말 없이 exit 0** 이었다 — "정상은 침묵"을 배운 사람은 그 빈 화면을 정상으로 읽었고,
# 침묵의 이유가 둘(정상 / 잘못 부름)인데 화면이 같았다. 그래서 직접 실행되면 판정을 실제로 돌려 표를 내고, 못 갖춘
# 것이 없으면 그렇다고 한 줄 말한다 — 침묵을 없애는 것이 아니라 **침묵의 뜻을 하나로** 만든다.
#
# 판정은 $0 의 파일명이다. 훅이 source 하면 $0 은 훅 파일(session-start-reminder.sh·post-merge·inject-context.sh)이라
# 걸리지 않고 라이브러리로만 동작한다. zsh 는 source 할 때도 $0 을 이 파일로 바꾸는데(FUNCTION_ARGZERO, 기본 on) 그때
# 표가 나오는 것은 의도한 동작이다 — 손으로 source 하는 사람도 표를 보려는 사람이다. 그 경우를 위해 여기서 exit 하지
# 않는다(source 한 셸을 죽인다). `. preflight.sh` 뒤 함수를 직접 부르는 옛 방법도 그대로 동작한다.
case "${0##*/}" in
  preflight.sh)
    case "$0" in */*) hpd_dir=${0%/*} ;; *) hpd_dir=. ;; esac
    hpd_root=$(CDPATH= cd -- "$hpd_dir/../.." 2>/dev/null && pwd) || hpd_root=$(pwd)
    # 경로로 루트를 못 찾으면(PATH 로 찾은 파일을 source 한 경우 등) 지금 폴더의 저장소 루트를 쓴다 — 틀린 루트에서
    # .nvmrc 를 못 보고 "준비됨"이라 하면 거짓 안내다.
    if [ ! -d "$hpd_root/.harness" ]; then hpd_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); fi
    harness_preflight_node "$hpd_root"
    harness_preflight_hooks_undecidable "$hpd_root"
    if [ -n "$HARNESS_GAPS" ]; then
      harness_preflight_print
    else
      hpd_nvmrc='없음'
      if [ -f "$hpd_root/.nvmrc" ]; then hpd_nvmrc=$(tr -d ' \t\r\n' < "$hpd_root/.nvmrc" 2>/dev/null || printf '?'); fi
      printf '[harness] 준비됨 — 못 갖춘 항목 없음 (셸 Node %s · .nvmrc %s)\n' "${HARNESS_NODE_VER:-없음}" "$hpd_nvmrc"
    fi
    printf '  이 표는 세션 시작·pull 때 자동으로 나옵니다 — 못 갖춘 것이 있을 때만. 직접 실행할 필요는 없습니다.\n'
    ;;
esac
