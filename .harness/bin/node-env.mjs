// node-env.mjs — dual-runtime(하네스 Node ↔ 프로젝트 Node) 해석 공용 모듈.
// dual-node.sh(셸 레이어)와 같은 규칙을 Node 레이어(guard.mjs, install-hooks.mjs)에 제공한다.
// 해석 규칙이나 최소 버전을 바꾸면 dual-node.sh, check-node-version.mjs, scripts/init.mjs도 함께 바꾼다.
// nvm 셸 함수에 의존하지 않고 $NVM_DIR/versions/node 디렉터리 목록만 읽는다.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MIN_NODE = { major: 20, minor: 19, label: '20.19.0' }

// 'v12', '12.18', 'v22.14.0' 같은 버전 표기를 파싱한다. 별칭(lts/* 등)은 null.
export function parseNodeSpec(raw) {
  const value = String(raw ?? '').trim()
  const match = value.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (!match) return null
  return {
    raw: value,
    major: Number(match[1]),
    minor: match[2] === undefined ? null : Number(match[2]),
    patch: match[3] === undefined ? null : Number(match[3]),
  }
}

export function isSupportedNode(parsed) {
  if (!parsed) return false
  if (parsed.major > MIN_NODE.major) return true
  return parsed.major === MIN_NODE.major && (parsed.minor ?? 0) >= MIN_NODE.minor
}

export function nvmDir(env = process.env) {
  return env.NVM_DIR || path.join(os.homedir(), '.nvm')
}

export function hasNvm(env = process.env) {
  const dir = nvmDir(env)
  return fs.existsSync(path.join(dir, 'nvm.sh')) || fs.existsSync(path.join(dir, 'versions', 'node'))
}

function compareParsed(a, b) {
  return (a.major - b.major) || ((a.minor ?? 0) - (b.minor ?? 0)) || ((a.patch ?? 0) - (b.patch ?? 0))
}

// nvm 설치본 목록을 오름차순으로 반환한다: [{ name: 'v22.14.0', parsed, binDir }]
export function listInstalledNodeVersions(env = process.env) {
  const versionsDir = path.join(nvmDir(env), 'versions', 'node')
  let entries = []
  try {
    entries = fs.readdirSync(versionsDir)
  } catch {
    return []
  }
  return entries
    .map((name) => ({ name, parsed: parseNodeSpec(name), binDir: path.join(versionsDir, name, 'bin') }))
    .filter((entry) => entry.parsed && fs.existsSync(path.join(entry.binDir, 'node')))
    .sort((a, b) => compareParsed(a.parsed, b.parsed))
}

// spec(.nvmrc 내용 등)에 맞는 설치본 중 최신을 고른다. spec이 minor/patch를 생략하면 prefix 매칭.
export function resolveInstalledForSpec(spec, env = process.env) {
  const parsed = typeof spec === 'string' ? parseNodeSpec(spec) : spec
  if (!parsed) return null
  const matches = listInstalledNodeVersions(env).filter((entry) =>
    entry.parsed.major === parsed.major &&
    (parsed.minor === null || entry.parsed.minor === parsed.minor) &&
    (parsed.patch === null || entry.parsed.patch === parsed.patch))
  return matches.at(-1) ?? null
}

// 하네스 실행에 쓸 수 있는 설치본 중 최신(>= 20.19)을 고른다. dual-node.sh와 같은 선택 규칙.
export function resolveHarnessNodeBest(env = process.env) {
  const supported = listInstalledNodeVersions(env).filter((entry) => isSupportedNode(entry.parsed))
  return supported.at(-1) ?? null
}

// 프로젝트 루트의 .nvmrc를 읽는다. 없으면 null, 있으면 { raw, parsed }.
export function readNvmrc(rootDir) {
  const nvmrcPath = path.join(rootDir, '.nvmrc')
  if (!fs.existsSync(nvmrcPath)) return null
  const raw = fs.readFileSync(nvmrcPath, 'utf8').trim()
  return { raw, parsed: parseNodeSpec(raw) }
}
