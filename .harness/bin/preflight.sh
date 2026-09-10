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
# - 정상은 침묵: 못 갖춘 것이 없으면 아무것도 출력하지 않는다.
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
