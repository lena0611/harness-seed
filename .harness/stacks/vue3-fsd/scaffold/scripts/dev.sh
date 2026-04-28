#!/usr/bin/env bash
# Node version management + env bootstrap + dependency sync + local Vite runner.

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NVMRC_PATH="$ROOT_DIR/.nvmrc"
ENV_LOCAL="$ROOT_DIR/.env.local"
ENV_LOCAL_EXAMPLE="$ROOT_DIR/.env.local.example"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
PACKAGE_FILE="$ROOT_DIR/package.json"
HASH_FILE="$ROOT_DIR/.package-json.hash"
NODE_VERSION_FILE="$ROOT_DIR/.node-version.cache"
PID_FILE="$ROOT_DIR/.vite.pid"

cd "$ROOT_DIR"

if [ ! -f "$ENV_LOCAL" ]; then
  if [ -f "$ENV_LOCAL_EXAMPLE" ]; then
    cp "$ENV_LOCAL_EXAMPLE" "$ENV_LOCAL"
    echo ".env.local 파일이 없어 .env.local.example을 복사했습니다."
  elif [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_LOCAL"
    echo ".env.local 파일이 없어 .env.example을 복사했습니다."
  fi
fi

if [ ! -f "$NVMRC_PATH" ]; then
  echo ".nvmrc 파일이 존재하지 않습니다."
  exit 1
fi

REQUIRED_VERSION="$(tr -d 'v\n\r' < "$NVMRC_PATH")"

NVM_SCRIPT=""
[ -s "$HOME/.nvm/nvm.sh" ] && NVM_SCRIPT="$HOME/.nvm/nvm.sh"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && NVM_SCRIPT="/opt/homebrew/opt/nvm/nvm.sh"
[ -s "/usr/local/opt/nvm/nvm.sh" ] && NVM_SCRIPT="/usr/local/opt/nvm/nvm.sh"

if [ -z "$NVM_SCRIPT" ]; then
  echo "nvm이 설치되어 있지 않습니다. 자동 설치를 시작합니다..."

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl이 필요합니다. 먼저 설치하세요."
    exit 1
  fi

  export NVM_DIR="$HOME/.nvm"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

  if [ -s "$NVM_DIR/nvm.sh" ]; then
    NVM_SCRIPT="$NVM_DIR/nvm.sh"
  else
    echo "nvm 설치 후 로드에 실패했습니다."
    exit 1
  fi
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [ -n "${npm_config_prefix:-}" ]; then
  unset npm_config_prefix
fi

if [ -s "$NVM_SCRIPT" ]; then
  # shellcheck disable=SC1090
  . "$NVM_SCRIPT"
else
  echo "nvm 스크립트를 찾을 수 없습니다."
  exit 1
fi

nvm install "$REQUIRED_VERSION"
nvm use "$REQUIRED_VERSION" >/dev/null

if ! command -v node >/dev/null 2>&1; then
  echo "Node 설치에 실패했습니다."
  exit 1
fi

node scripts/check-node-version.mjs

CURRENT_NODE_VERSION="$(node -v)"
SAVED_NODE_VERSION=""
[ -f "$NODE_VERSION_FILE" ] && SAVED_NODE_VERSION="$(cat "$NODE_VERSION_FILE")"

if [ "$CURRENT_NODE_VERSION" != "$SAVED_NODE_VERSION" ] && [ -d "node_modules" ]; then
  echo ""
  if [ -n "$SAVED_NODE_VERSION" ]; then
    echo "Node 버전 변경 감지: $SAVED_NODE_VERSION -> $CURRENT_NODE_VERSION"
  else
    echo "Node 버전 기록 없음 (node_modules 호환성 불명)"
  fi
  echo "네이티브 모듈 호환성을 위해 node_modules를 재설치합니다."
  echo ""
  rm -rf node_modules "$HASH_FILE"
fi

install_deps_if_needed() {
  if [ ! -f "$PACKAGE_FILE" ]; then
    echo "package.json이 존재하지 않습니다."
    exit 1
  fi

  CURRENT_HASH="$(shasum "$PACKAGE_FILE" | awk '{print $1}')"
  SAVED_HASH=""
  [ -f "$HASH_FILE" ] && SAVED_HASH="$(cat "$HASH_FILE")"

  if [ ! -d "node_modules" ]; then
    echo ""
    echo "node_modules 없음 -> npm install 실행"
    echo ""
    npm install && npm prune
    echo "$CURRENT_HASH" > "$HASH_FILE"
    echo "$CURRENT_NODE_VERSION" > "$NODE_VERSION_FILE"
    return
  fi

  if [ "$CURRENT_HASH" != "$SAVED_HASH" ]; then
    echo ""
    echo "package.json 변경 감지 -> 패키지 동기화 중..."
    echo ""
    npm install && npm prune
    echo "$CURRENT_HASH" > "$HASH_FILE"
    echo "$CURRENT_NODE_VERSION" > "$NODE_VERSION_FILE"
  fi
}

check_vite() {
  if [ ! -f "node_modules/.bin/vite" ]; then
    echo "vite가 로컬에 설치되어 있지 않습니다."
    echo "devDependencies에 vite가 있는지 확인하세요."
    exit 1
  fi
}

VITE_PID=""

cleanup() {
  rm -f "$PID_FILE"
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null
    wait "$VITE_PID" 2>/dev/null || true
    VITE_PID=""
  fi
}

trap 'cleanup' EXIT

while true; do
  install_deps_if_needed
  check_vite

  node_modules/.bin/vite "$@" &
  VITE_PID=$!
  echo "$VITE_PID" > "$PID_FILE"

  trap '' INT
  EXIT_CODE=0
  wait "$VITE_PID" || EXIT_CODE=$?
  trap - INT
  VITE_PID=""

  rm -f "$PID_FILE"

  if [ "$EXIT_CODE" -eq 0 ] || [ "$EXIT_CODE" -eq 130 ]; then
    exit 0
  fi

  echo ""
  echo "Vite 재기동 중 (패키지 업데이트 반영)..."
  sleep 1
done
