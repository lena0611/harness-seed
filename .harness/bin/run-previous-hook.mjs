#!/usr/bin/env node

import { spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const hookName = process.argv[2]
const hookArgs = process.argv.slice(3)

const allowedHooks = new Set(['pre-commit', 'pre-push', 'post-merge'])

// previousHooksPath 체인 순환 가드(0.2.131 뒤 실측: 멀티사이트 시뮬레이션에서 깊이 13 관측).
// husky가 hooksPath 주인인 상태에서 하네스 훅 체인이 다시 husky를 부르는 핑퐁 구성 등을
// 프로세스 경계를 넘어서도 잡아내기 위해, 환경변수로 깊이를 자식 프로세스까지 전달한다.
const MAX_HOOK_DEPTH = 3
const CYCLE_MESSAGE =
  'previousHooksPath 체인이 순환하고 있습니다(예: husky가 주인인 상태에서 하네스 훅이 husky를 다시 부름). ' +
  '.harness/project/hook-coexistence.md의 표준 구성(prepare: husky + postprepare: 하네스 훅 설치)을 참고하세요.'

function abortOnCycle() {
  console.error(`이전 git hook 체인 중단: ${CYCLE_MESSAGE}`)
  process.exit(1)
}

function readGitConfig(key) {
  try {
    return execFileSync('git', ['config', '--get', key], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function toAbs(value) {
  if (!value) return ''
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value)
}

function samePath(a, b) {
  if (!a || !b) return false
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return path.resolve(a) === path.resolve(b)
  }
}

function isExecutable(file) {
  try {
    return (fs.statSync(file).mode & 0o111) !== 0
  } catch {
    return false
  }
}

if (!allowedHooks.has(hookName)) {
  console.error(`Unsupported hook name: ${hookName || '(empty)'}`)
  process.exit(1)
}

const rawDepth = Number.parseInt(process.env.HARNESS_PREV_HOOK_DEPTH ?? '0', 10)
const currentDepth = Number.isFinite(rawDepth) && rawDepth > 0 ? rawDepth : 0
const nextDepth = currentDepth + 1
if (nextDepth > MAX_HOOK_DEPTH) {
  abortOnCycle()
}

const previousHooksPath = readGitConfig('harness.previousHooksPath')
const previousHooksAbs = toAbs(previousHooksPath)
const harnessHooksAbs = path.resolve(repoRoot, '.githooks')

if (!previousHooksAbs) {
  process.exit(0)
}

// previousHooksPath가 하네스 자신의 훅 디렉터리를 직행으로 가리키면(자기 자신을 "이전 hook"으로
// 체인하는 구성) 조용히 넘어가지 않는다 — 정상 상태에서는 나올 수 없는 값이라 순환 신호로 본다.
if (samePath(previousHooksAbs, harnessHooksAbs)) {
  abortOnCycle()
}

const previousHook = path.join(previousHooksAbs, hookName)
if (!fs.existsSync(previousHook) || fs.statSync(previousHook).isDirectory()) {
  process.exit(0)
}

console.log(`이전 git hook 실행: ${path.relative(repoRoot, previousHook) || previousHook}`)

const command = isExecutable(previousHook) ? previousHook : 'sh'
const args = isExecutable(previousHook) ? hookArgs : [previousHook, ...hookArgs]

// dual-runtime(0.2.63): hook이 하네스 Node로 전환했어도 기존 프로젝트 hook(husky 등)은
// 전환 전의 PATH(프로젝트 Node)에서 실행한다. 프로젝트 hook이 하네스 Node 계약을 따를 이유가 없다.
const env = process.env.HARNESS_PREV_PATH
  ? { ...process.env, PATH: process.env.HARNESS_PREV_PATH }
  : { ...process.env }

// 자식(이전 hook)이 어떤 경로로든 이 스크립트를 다시 부르는 순환이면 깊이가 여기서부터 이어진다.
env.HARNESS_PREV_HOOK_DEPTH = String(nextDepth)

const result = spawnSync(command, args, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
  env,
})

if (result.error) {
  console.error(`이전 git hook 실행 실패: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status === null || result.status === undefined ? 1 : result.status)
