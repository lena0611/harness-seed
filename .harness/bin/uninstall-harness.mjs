#!/usr/bin/env node
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const repoRoot = process.cwd()
const manifestPath = join(repoRoot, '.harness/install-manifest.json')
const packagePath = join(repoRoot, 'package.json')

const HARNESS_HOOKS_PATH = '.githooks'
const HARNESS_COMMIT_TEMPLATE = '.github/commit-template.txt'
// install-hooks가 "설치 전에는 core.hooksPath 없이 .git/hooks 파일만 있었다"를 기록하는 마커 값.
// 이 값의 복원은 설정 재기입이 아니라 해제다.
const DEFAULT_GIT_HOOKS_MARKER = '.git/hooks'
const confirm = process.argv.includes('--confirm')
const dryRun = !confirm || process.argv.includes('--dry-run')

const harnessScriptNames = [
  'harness:guide',
  'harness:scan',
  'harness:handoff',
  'harness:impact',
  'harness:check',
  'harness:check:strict',
  'harness:sync',
  'harness:context',
  'harness:outdated',
  'harness:update',
  'harness:changelog',
  'harness:uninstall',
  'harness:spec:fetch',
  'harness:spec:status',
  'harness:spec:settle',
  'hooks:install',
  'standards:list',
  'templates:list',
  'stack:status',
  'stack:apply',
  'stack:reset',
  'template:status',
  'template:apply',
  'template:reset',
  'template:gap',
]

function readJson(absPath, fallback = null) {
  if (!existsSync(absPath)) return fallback
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'))
  } catch (error) {
    throw new Error(`${absPath} JSON을 읽을 수 없습니다: ${error.message}`)
  }
}

function toPosix(filePath) {
  return filePath.split('\\').join('/')
}

function sha256(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

async function fileMatchesManifest(rel, entry) {
  const abs = join(repoRoot, rel)
  if (!existsSync(abs) || !statSync(abs).isFile()) return false
  if (!entry?.sha256) return false
  return sha256(abs) === entry.sha256
}

function removeEmptyParents(rel) {
  let dir = dirname(join(repoRoot, rel))
  while (dir.startsWith(join(repoRoot, '.harness')) || dir.startsWith(join(repoRoot, '.claude')) || dir.startsWith(join(repoRoot, '.codex')) || dir.startsWith(join(repoRoot, '.githooks')) || dir.startsWith(join(repoRoot, '.github'))) {
    try {
      rmSync(dir, { recursive: false })
    } catch {
      break
    }
    dir = dirname(dir)
  }
}

function scriptLooksManaged(value) {
  return typeof value === 'string' && value.includes('.harness/bin/')
}

function isGitRepository() {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'true'
  } catch {
    return false
  }
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

// install-hooks.mjs의 저장 로직과 대칭: 설치가 core.hooksPath/commit.template을 하네스 값으로
// 바꾸며 이전 값을 harness.previous*에 남기므로, 제거는 그 기록으로 설치 전 상태를 복원한다.
// 복원 없이 managed 파일만 지우면 git 설정이 삭제된 hook 경로와 템플릿을 계속 가리킨다.
// 사용자가 설치 후 직접 바꾼 값(하네스 값이 아닌 값)은 건드리지 않는다.
function planGitConfigRestore() {
  if (!isGitRepository()) return { actions: [], keeps: [] }
  const actions = []
  const keeps = []
  const hooksPath = readGitConfig('core.hooksPath')
  const storedHooksPath = readGitConfig('harness.previousHooksPath')
  const commitTemplate = readGitConfig('commit.template')
  const storedCommitTemplate = readGitConfig('harness.previousCommitTemplate')

  if (hooksPath === HARNESS_HOOKS_PATH) {
    if (storedHooksPath && storedHooksPath !== DEFAULT_GIT_HOOKS_MARKER) {
      actions.push({
        args: ['config', 'core.hooksPath', storedHooksPath],
        label: `core.hooksPath: '${storedHooksPath}' 복원 (설치 전 hook 경로)`,
      })
    } else {
      actions.push({
        args: ['config', '--unset', 'core.hooksPath'],
        label: 'core.hooksPath: 해제 (설치 전에는 없던 설정)',
      })
    }
  } else if (hooksPath) {
    keeps.push(`core.hooksPath='${hooksPath}' — 하네스 값(${HARNESS_HOOKS_PATH})이 아니라 유지합니다.`)
  }
  if (storedHooksPath) {
    actions.push({
      args: ['config', '--unset', 'harness.previousHooksPath'],
      label: 'harness.previousHooksPath: 기록 제거',
    })
  }

  if (commitTemplate === HARNESS_COMMIT_TEMPLATE) {
    if (storedCommitTemplate) {
      actions.push({
        args: ['config', 'commit.template', storedCommitTemplate],
        label: `commit.template: '${storedCommitTemplate}' 복원 (설치 전 템플릿)`,
      })
    } else {
      actions.push({
        args: ['config', '--unset', 'commit.template'],
        label: 'commit.template: 해제 (설치 전에는 없던 설정)',
      })
    }
  } else if (commitTemplate) {
    keeps.push(`commit.template='${commitTemplate}' — 하네스 값(${HARNESS_COMMIT_TEMPLATE})이 아니라 유지합니다.`)
  }
  if (storedCommitTemplate) {
    actions.push({
      args: ['config', '--unset', 'harness.previousCommitTemplate'],
      label: 'harness.previousCommitTemplate: 기록 제거',
    })
  }

  return { actions, keeps }
}

function applyGitConfigRestore(plan) {
  for (const action of plan.actions) {
    try {
      execFileSync('git', action.args, { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch {
      console.warn(`git 설정 복원에 실패했습니다. 직접 실행해 주세요: git ${action.args.join(' ')}`)
    }
  }
}

async function main() {
  const manifest = readJson(manifestPath)
  if (!manifest?.managedFiles) {
    console.error('하네스 설치 manifest가 없습니다: .harness/install-manifest.json')
    console.error('자동 제거 대상을 확정할 수 없어 중단합니다. 수동 정리가 필요하면 먼저 파일 목록을 확인하세요.')
    process.exit(1)
  }

  const removable = []
  const preserved = []

  for (const [rel, entry] of Object.entries(manifest.managedFiles)) {
    const normalized = toPosix(rel)
    const abs = join(repoRoot, normalized)
    if (!existsSync(abs)) continue
    if (await fileMatchesManifest(normalized, entry)) {
      removable.push(normalized)
    } else {
      preserved.push(normalized)
    }
  }

  const pkg = readJson(packagePath, null)
  const scriptRemovals = []
  if (pkg?.scripts) {
    for (const name of harnessScriptNames) {
      if (scriptLooksManaged(pkg.scripts[name])) {
        scriptRemovals.push(name)
      }
    }
  }

  console.log('::: 공통 하네스 제거 계획 :::')
  console.log(`프로젝트: ${repoRoot}`)
  console.log(`모드: ${dryRun ? 'dry-run' : 'confirm'}`)
  console.log('')
  console.log(`삭제할 managed 파일: ${removable.length}개`)
  for (const rel of removable.slice(0, 30)) console.log(`  - ${rel}`)
  if (removable.length > 30) console.log(`  ... 외 ${removable.length - 30}개`)
  console.log('')
  console.log(`보존할 로컬 수정/출처 불명 파일: ${preserved.length}개`)
  for (const rel of preserved.slice(0, 30)) console.log(`  - ${rel}`)
  if (preserved.length > 30) console.log(`  ... 외 ${preserved.length - 30}개`)
  console.log('')
  console.log(`package.json에서 제거할 하네스 명령: ${scriptRemovals.length}개`)
  for (const name of scriptRemovals) console.log(`  - ${name}`)

  const gitPlan = planGitConfigRestore()
  console.log('')
  console.log(`복원할 git 설정: ${gitPlan.actions.length}개`)
  for (const action of gitPlan.actions) console.log(`  - ${action.label}`)
  for (const keep of gitPlan.keeps) console.log(`  - 유지: ${keep}`)

  if (dryRun) {
    console.log('')
    console.log('실제 제거하려면 다음 명령을 실행하세요:')
    console.log('  npm run harness:uninstall -- --confirm')
    return
  }

  for (const rel of removable) {
    rmSync(join(repoRoot, rel), { force: true })
    removeEmptyParents(rel)
  }

  if (pkg?.scripts && scriptRemovals.length > 0) {
    for (const name of scriptRemovals) delete pkg.scripts[name]
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
  }

  applyGitConfigRestore(gitPlan)

  console.log('')
  console.log('공통 하네스 managed 파일과 하네스 npm 명령을 제거했습니다.')
  if (gitPlan.actions.length > 0) {
    console.log('git 설정(hook 경로/커밋 템플릿)을 설치 전 상태로 복원했습니다.')
  }
  if (preserved.length > 0) {
    console.log('로컬 수정/출처 불명 파일은 보존했습니다. 필요하면 내용을 확인한 뒤 직접 삭제하세요.')
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
