#!/usr/bin/env node
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative } from 'path'
import { lstatSync, readdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync } from 'fs'
import { LEGACY_HOOKS_PATH, OLD_DEFAULT_MARKER, OVERRIDE_KEY, PARKED_HOOKS_PATH, PREV_DIR_NAME, WRAPPED_HOOKS, effectiveGitHooksDir, gitHooksDir, isWrapper, readLocalGitConfig, relToRepo, resolveHooksPath, samePath } from './hooks-state.mjs'

const repoRoot = process.cwd()
const manifestPath = join(repoRoot, '.harness/install-manifest.json')
const packagePath = join(repoRoot, 'package.json')

const HARNESS_HOOKS_PATH = LEGACY_HOOKS_PATH // 0.2.145 이전 설치가 core.hooksPath에 넣던 값
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
// 0.2.146 래퍼 방식: git 기본 훅 폴더(.git/hooks)의 하네스 래퍼와 보관함(harness-prev)을 판정·정리한다.
function wrapperState() {
  if (!isGitRepository()) return { installed: false, hooksDir: '', wrappers: [], prevFiles: [] }
  const hooksDir = gitHooksDir(repoRoot)
  const wrappers = WRAPPED_HOOKS.filter((name) => isWrapper(join(hooksDir, name)))
  const prevDir = join(hooksDir, PREV_DIR_NAME)
  let prevFiles = []
  try {
    prevFiles = readdirSync(prevDir).filter((name) => WRAPPED_HOOKS.includes(name))
  } catch {
    prevFiles = []
  }
  return { installed: wrappers.length > 0, hooksDir, wrappers, prevFiles }
}

// 래퍼 파일을 지우고 보관해 둔 원본을 제자리로 돌려놓는다. 래퍼가 아닌 파일은 절대 건드리지 않는다.
function planWrapperCleanup() {
  const state = wrapperState()
  const lines = []
  const rel = state.hooksDir ? relToRepo(repoRoot, state.hooksDir) : '.git/hooks'
  for (const name of state.wrappers) lines.push(`${rel}/${name} (하네스 래퍼 삭제)`)
  for (const name of state.prevFiles) lines.push(`${rel}/${PREV_DIR_NAME}/${name} → ${rel}/${name} (원래 자리로 복원)`)
  return { state, lines }
}

function applyWrapperCleanup(plan) {
  const { state } = plan
  if (!state.hooksDir) return
  for (const name of state.wrappers) {
    try { rmSync(join(state.hooksDir, name), { force: true }) } catch {}
  }
  const prevDir = join(state.hooksDir, PREV_DIR_NAME)
  for (const name of state.prevFiles) {
    try {
      const src = join(prevDir, name)
      const dest = join(state.hooksDir, name)
      if (existsSync(dest)) continue
      const st = lstatSync(src)
      if (st.isSymbolicLink()) {
        // 링크는 대상을 원래 자리 기준으로 다시 잇는다(P2-1) — 링크째 옮기면 상대 기준이 바뀌어 끊어진다.
        const target = readlinkSync(src)
        const absTarget = target.startsWith('/') ? target : join(prevDir, target)
        symlinkSync(target.startsWith('/') ? target : relativeFrom(state.hooksDir, absTarget), dest)
        unlinkSync(src)
      } else {
        renameSync(src, dest)
      }
    } catch (error) {
      console.warn(`훅 원본 복원에 실패했습니다(${name}): ${error.message} — ${relToRepo(repoRoot, prevDir)} 에 그대로 있습니다.`)
    }
  }
  try {
    const leftovers = existsSync(prevDir) ? readdirSync(prevDir) : []
    if (leftovers.length === 0) rmSync(prevDir, { recursive: true, force: true })
    else console.log(`보관함에 이전 사본이 남아 있습니다(${leftovers.length}개, 예: ${leftovers[0]}) — 필요 없으면 ${relToRepo(repoRoot, prevDir)} 을 지우세요.`)
  } catch {}
}

function relativeFrom(fromDir, absTarget) {
  const rel = relative(fromDir, absTarget)
  return rel || '.'
}

function planGitConfigRestore() {
  if (!isGitRepository()) return { actions: [], keeps: [] }
  const actions = []
  const keeps = []
  const hooksPath = readGitConfig('core.hooksPath')
  const storedHooksPath = readGitConfig('harness.previousHooksPath')
  const commitTemplate = readGitConfig('commit.template')
  const storedCommitTemplate = readGitConfig('harness.previousCommitTemplate')

  // 0.2.146: 래퍼 방식은 core.hooksPath가 해제돼 있거나(전역 값이 있을 때) 로컬에 기본 훅 폴더가 명시돼 있다.
  // 보관함(harness-prev)·옛 마커가 아닌 저장값(husky 등)은 "설치 전 다른 주인이 있었다"는 뜻이라 그 값으로 복원한다 —
  // 단, 해제 뒤에도 전역에서 같은 값이 내려오면(전역 hooksPath였던 경우) 로컬에 다시 적지 않는다(적용 시점에 판정).
  const localHooksPath = readLocalGitConfig(repoRoot, 'core.hooksPath')
  const storedIsMarker = !storedHooksPath || storedHooksPath === DEFAULT_GIT_HOOKS_MARKER || storedHooksPath === PARKED_HOOKS_PATH || storedHooksPath.endsWith(`/${PREV_DIR_NAME}`)
  const wrappers = wrapperState()
  // 우리가 전역을 덮기 위해 적은 로컬 값(기록 키와 같음), 또는 git 의미로 기본 훅 폴더를 가리키는 로컬 값.
  const recordedOverride = readLocalGitConfig(repoRoot, OVERRIDE_KEY)
  const ourOverride = Boolean(localHooksPath) && (
    (recordedOverride && localHooksPath === recordedOverride)
    || (wrappers.hooksDir && samePath(effectiveGitHooksDir(repoRoot, localHooksPath), wrappers.hooksDir))
    || (wrappers.hooksDir && samePath(resolveHooksPath(repoRoot, localHooksPath), wrappers.hooksDir)) // 키 없는 옛 상대 값(.git/hooks)
  )
  if (hooksPath === HARNESS_HOOKS_PATH || ourOverride) {
    actions.push({
      restoreHooksPath: { stored: storedIsMarker ? '' : storedHooksPath },
      label: storedIsMarker
        ? `core.hooksPath: 해제 (설치 전에는 없던 설정${ourOverride ? ' — 전역 설정을 덮던 로컬 명시 제거' : ''})`
        : `core.hooksPath: '${storedHooksPath}' 복원 (설치 전 hook 경로 — 전역에서 같은 값이 내려오면 로컬에 다시 적지 않음)`,
    })
  } else if (!hooksPath && wrappers.installed) {
    if (!storedIsMarker) {
      actions.push({
        restoreHooksPath: { stored: storedHooksPath },
        label: `core.hooksPath: '${storedHooksPath}' 복원 (설치 전 hook 경로 — 래퍼 방식은 해제 상태였음)`,
      })
    }
  } else if (hooksPath) {
    keeps.push(`core.hooksPath='${hooksPath}' — 하네스 값이 아니라 유지합니다.`)
  }
  if (recordedOverride) {
    actions.push({
      args: ['config', '--unset', OVERRIDE_KEY],
      label: `${OVERRIDE_KEY}: 기록 제거`,
    })
  }
  if (storedHooksPath) {
    actions.push({
      args: ['config', '--unset', 'harness.previousHooksPath'],
      label: 'harness.previousHooksPath: 기록 제거',
    })
  }

  if (readGitConfig('harness.hooksAutoEnable')) {
    actions.push({
      args: ['config', '--unset', 'harness.hooksAutoEnable'],
      label: 'harness.hooksAutoEnable: 기록 제거',
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
    if (action.restoreHooksPath) {
      // 로컬 값을 지운 뒤 유효 값을 다시 읽는다 — 전역·시스템에서 같은 값이 내려오면 그것이 곧 복원이다(P2-2).
      try { execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] }) } catch {}
      const stored = action.restoreHooksPath.stored
      if (stored && readGitConfig('core.hooksPath') !== stored) {
        try {
          execFileSync('git', ['config', 'core.hooksPath', stored], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] })
        } catch {
          console.warn(`git 설정 복원에 실패했습니다. 직접 실행해 주세요: git config core.hooksPath ${stored}`)
        }
      }
      continue
    }
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
  const wrapperPlan = planWrapperCleanup()
  if (wrapperPlan.lines.length > 0) {
    console.log('')
    console.log(`정리할 git 훅 래퍼(0.2.146): ${wrapperPlan.lines.length}개`)
    for (const line of wrapperPlan.lines) console.log(`  - ${line}`)
  }

  if (dryRun) {
    console.log('')
    console.log('실제 제거하려면 다음 명령을 실행하세요:')
    console.log('  .harness/bin/harness uninstall --confirm')
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
  applyWrapperCleanup(wrapperPlan)

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
