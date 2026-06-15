#!/usr/bin/env sh
# dual-node.sh — 하네스 실행 Node와 프로젝트 빌드 Node를 분리(dual-runtime)하는 공용 해석 로직.
# git hook(pre-commit/pre-push)과 harness 런처가 source해서 사용한다.
#
# 계약(.harness/project/commit-push-rules.md "hook 구현 계약"):
# - POSIX sh 호환(dash 포함). bash 전용 문법을 쓰지 않는다.
# - set -u 안전: 미설정 변수를 참조하지 않는다.
# - nvm.sh를 source하지 않는다. $NVM_DIR/versions/node 디렉터리 목록만 읽으므로
#   dash + nvm.sh 조합의 무출력 exit 2 사고(0.2.61) 표면을 늘리지 않는다.
# - 활성 node가 이미 최소 버전 이상이면 아무것도 바꾸지 않는다(기존 단일 런타임 거동 유지).
# - 활성 node가 낮거나 없으면 nvm 설치본 중 최소 버전 이상의 최신 Node를 PATH 선두에 적용한다.
# - 전환 시 원래 PATH는 HARNESS_PREV_PATH로, 프로젝트 Node bin 디렉터리는
#   HARNESS_PROJECT_NODE_BIN으로 export한다. run-previous-hook.mjs는 이전 hook을 원래 PATH로
#   실행하고, guard.mjs는 프로젝트 검증(lint/test/build, stack verify)을 프로젝트 Node로 실행한다.
# - 최소 버전을 올리면 check-node-version.mjs, node-env.mjs, scripts/init.mjs도 함께 바꾼다.

HARNESS_MIN_NODE_MAJOR=20
HARNESS_MIN_NODE_MINOR=19

# $1: 버전 문자열(v 접두사 허용). 하네스 최소 버전 이상이면 0을 반환한다.
# set -u 하에서 인자 없이 호출돼도 죽지 않도록 ${1:-}로 가드한다(dash 미설정 참조 = exit 2, 0.2.61 클래스).
harness_node_supported() {
  hns_v=${1:-}
  hns_v=${hns_v#v}
  hns_major=${hns_v%%.*}
  case "$hns_major" in ''|*[!0-9]*) return 1 ;; esac
  hns_rest=${hns_v#"$hns_major"}
  hns_rest=${hns_rest#.}
  hns_minor=${hns_rest%%.*}
  case "$hns_minor" in ''|*[!0-9]*) hns_minor=0 ;; esac
  if [ "$hns_major" -gt "$HARNESS_MIN_NODE_MAJOR" ]; then return 0; fi
  if [ "$hns_major" -eq "$HARNESS_MIN_NODE_MAJOR" ] && [ "$hns_minor" -ge "$HARNESS_MIN_NODE_MINOR" ]; then return 0; fi
  return 1
}

# $1: 버전 문자열(vX.Y.Z) → 비교용 정수 키를 echo한다. 파싱 실패 시 빈 문자열.
harness_node_sort_key() {
  hnk_v=${1:-}
  hnk_v=${hnk_v#v}
  hnk_major=${hnk_v%%.*}
  case "$hnk_major" in ''|*[!0-9]*) echo ''; return 0 ;; esac
  hnk_rest=${hnk_v#"$hnk_major"}
  hnk_rest=${hnk_rest#.}
  hnk_minor=${hnk_rest%%.*}
  case "$hnk_minor" in ''|*[!0-9]*) hnk_minor=0 ;; esac
  hnk_rest=${hnk_rest#"$hnk_minor"}
  hnk_rest=${hnk_rest#.}
  hnk_patch=${hnk_rest%%.*}
  case "$hnk_patch" in ''|*[!0-9]*) hnk_patch=0 ;; esac
  echo $((hnk_major * 1000000 + hnk_minor * 1000 + hnk_patch))
}

# 활성 node가 하네스 최소 버전 미만이면 nvm 설치본 중 최신(>=최소)으로 전환한다.
# 전환할 수 없으면 조용히 돌아가고, 이후 check-node-version.mjs 게이트가 업그레이드를 안내한다.
harness_dual_node_activate() {
  hdn_current=''
  if command -v node >/dev/null 2>&1; then
    hdn_current=$(node --version 2>/dev/null) || hdn_current=''
  fi
  if [ -n "$hdn_current" ] && harness_node_supported "$hdn_current"; then
    return 0
  fi

  hdn_versions_dir="${NVM_DIR:-${HOME:-}/.nvm}/versions/node"
  if [ ! -d "$hdn_versions_dir" ]; then
    return 0
  fi

  hdn_best=''
  hdn_best_name=''
  hdn_best_key=0
  for hdn_candidate in "$hdn_versions_dir"/v*; do
    [ -x "$hdn_candidate/bin/node" ] || continue
    hdn_name=${hdn_candidate##*/}
    harness_node_supported "$hdn_name" || continue
    hdn_key=$(harness_node_sort_key "$hdn_name")
    [ -n "$hdn_key" ] || continue
    if [ "$hdn_key" -gt "$hdn_best_key" ]; then
      hdn_best_key=$hdn_key
      hdn_best=$hdn_candidate
      hdn_best_name=$hdn_name
    fi
  done

  if [ -z "$hdn_best" ]; then
    return 0
  fi

  if [ -n "$hdn_current" ]; then
    # node가 셸 함수/별칭/builtin이면 command -v가 절대경로 대신 'node'를 출력해 dirname이 '.'이 된다.
    # '.'를 export하면 guard가 PATH 선두에 '.'를 붙이는 footgun이 되므로 절대경로일 때만 기록한다.
    hdn_node_path=$(command -v node 2>/dev/null) || hdn_node_path=''
    case "$hdn_node_path" in
      /*)
        HARNESS_PROJECT_NODE_BIN=$(dirname "$hdn_node_path")
        export HARNESS_PROJECT_NODE_BIN
        ;;
    esac
  fi
  HARNESS_PREV_PATH=$PATH
  export HARNESS_PREV_PATH
  PATH="$hdn_best/bin:$PATH"
  export PATH
  # 중첩 호출(hook → 런처)에서는 중간 nvm use가 PATH를 프로젝트 Node로 되돌려 매번 다시 전환한다.
  # 동작은 멱등이지만 안내는 한 번만 보이도록, 상위에서 이미 알린 경우 메시지를 생략한다.
  if [ -z "${HARNESS_DUAL_RUNTIME_ANNOUNCED:-}" ]; then
    echo "[harness] dual-runtime: 하네스 스크립트는 $hdn_best_name, 프로젝트 검증은 ${hdn_current:-PATH 기본 Node}(으)로 실행합니다."
    HARNESS_DUAL_RUNTIME_ANNOUNCED=1
    export HARNESS_DUAL_RUNTIME_ANNOUNCED
  fi
}
