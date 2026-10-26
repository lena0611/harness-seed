#!/usr/bin/env node

import { spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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

// `.git/…` 값은 공통 .git 기준으로 푼다 — 연결 워크트리의 .git은 파일이라 작업 폴더 기준으로는 보관함
// (harness.previousHooksPath=.git/hooks/harness-prev)을 못 찾는다(0.2.146, 외부 리뷰 P1-1).
function gitCommonDir() {
  try {
    return path.resolve(repoRoot, execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim())
  } catch {
    return path.join(repoRoot, '.git')
  }
}

function toAbs(value) {
  if (!value) return ''
  if (path.isAbsolute(value)) return value
  // `~/…` 는 git 처럼 홈 폴더로 편다(0.2.156). 전역 core.hooksPath 가 `~/…` 면 설치기가 그 값을 그대로 보관하는데, 펴지 않으면
  // 작업 폴더 아래(<repo>/~/…)를 찾아 전역 팀 훅이 말없이 빠졌다. `~사용자/…` 형태는 펴지 않는다.
  if (value === '~' || value.startsWith('~/')) return path.join(os.homedir(), value.slice(1))
  if (value === '.git' || value.startsWith('.git/')) return path.join(gitCommonDir(), value.slice(4).replace(/^\//, ''))
  return path.resolve(repoRoot, value)
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

// 팀 훅이 실행되지 못하고 빠지면 말없이 넘어가지 않는다(0.2.156) — 그대로 침묵하면 lint-staged·lock 가드가 꺼진 채 커밋된다.
// 막지는 않는다(알림 vs 차단은 미결).
// - husky 9 배치(<폴더>/_): 실행기 <폴더>/_/<훅> 이 없으면 팀 훅 <폴더>/<훅> 이 돌지 않는다. 실행기 폴더는 gitignore 라 새
//   worktree 에는 통째로 없고, 복사가 덜 되면 빈 폴더만 남는다 — 폴더가 아니라 그 훅의 실행기로 본다(코덱스 1차: 빈 .husky/_ 를
//   정상으로 봤다). 팀 훅이 원래 없으면 빠지는 것도 없으니 조용히 둔다.
// - 그 밖의 폴더: 폴더는 있고 그 훅만 없으면 팀이 그 훅을 안 쓰는 것이라 조용히 둔다. 폴더째 못 찾으면 worktree 와 상관없이 값
//   자체가 틀렸을 수 있어 찾은 위치를 보인다.
function noticeSkippedTeamHook(declared, abs) {
  if (path.basename(abs) === '_') {
    const teamHook = path.join(path.dirname(abs), hookName)
    if (!fs.existsSync(teamHook)) return
    const runner = path.join(abs, hookName)
    console.error(`[harness] 팀 훅 ${path.relative(repoRoot, teamHook) || teamHook} 을 건너뛰었습니다 — husky 실행기(${path.relative(repoRoot, runner) || runner})가 이 작업 폴더에 없습니다. 새 worktree 라면 .harness/project/hook-coexistence.md 「worktree에서 의존성을 설치할 때」를 보세요.`)
    return
  }
  if (fs.existsSync(abs)) return
  console.error(`[harness] 팀 ${hookName} 훅을 건너뛰었습니다 — 이전 훅 폴더를 찾지 못했습니다(harness.previousHooksPath=${declared} → ${abs}).`)
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
  noticeSkippedTeamHook(previousHooksPath, previousHooksAbs)
  process.exit(0)
}

// 0.2.146: 이전 훅 자리가 하네스 래퍼(.git/hooks의 위임 스크립트)이면 자기 자신을 다시 부르는 것이다 —
// 옛 마커('.git/hooks')가 남은 clone에서 생길 수 있는 구성이라, 순환으로 죽이지 않고 조용히 건너뛴다.
if (fs.readFileSync(previousHook, 'utf8').includes('harness-hook-wrapper')) {
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
