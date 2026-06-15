import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_NODE, hasNvm, isSupportedNode, readNvmrc, resolveHarnessNodeBest, resolveInstalledForSpec } from './node-env.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

function runGit(args) {
  execFileSync('git', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
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

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel))
}

const previousHooksPath = readGitConfig('core.hooksPath')
const storedPreviousHooksPath = readGitConfig('harness.previousHooksPath')
const previousCommitTemplate = readGitConfig('commit.template')
const legacyHookFiles = [
  '.git/hooks/pre-commit',
  '.git/hooks/pre-push',
].filter(exists)
const shouldStoreCustomHooksPath = previousHooksPath && previousHooksPath !== '.githooks'
const shouldStoreDefaultGitHooks = !previousHooksPath && !storedPreviousHooksPath && legacyHookFiles.length > 0

if (shouldStoreCustomHooksPath) {
  runGit(['config', 'harness.previousHooksPath', previousHooksPath])
} else if (shouldStoreDefaultGitHooks) {
  runGit(['config', 'harness.previousHooksPath', '.git/hooks'])
}

runGit(['config', 'core.hooksPath', '.githooks'])
runGit(['config', 'commit.template', '.github/commit-template.txt'])

const chainedHooksPath = shouldStoreCustomHooksPath
  ? previousHooksPath
  : shouldStoreDefaultGitHooks
    ? '.git/hooks'
    : storedPreviousHooksPath

console.log('')
console.log('하네스 git hook 설치 완료')
console.log('')
console.log('설치된 git 설정:')
console.log('  - core.hooksPath: .githooks')
console.log('  - commit.template: .github/commit-template.txt')
console.log('')
console.log('활성화되는 hook:')
console.log('  - .githooks/pre-commit')
console.log('      사용자가 git commit을 실행한 뒤 기존 pre-commit hook, seed-mode 확인, .harness/bin/harness check를 실행합니다.')
console.log('      npm run harness:check와 같은 검사이며, package.json 없는 비-Node 프로젝트에서도 동작합니다.')
console.log('      에이전트가 커밋 요청을 처리할 때는 이 hook 검증을 신뢰하고 선행 harness:check를 중복 실행하지 않습니다.')
console.log('  - .githooks/pre-push')
console.log('      사용자가 git push를 실행한 뒤 기존 pre-push hook과 .harness/bin/harness check --fast를 실행합니다.')
console.log('      pre-push는 커밋 직전 전체 검증 반복을 줄이기 위해 정책/문서/버전/lint 중심으로 빠르게 확인합니다.')
console.log('')
console.log('커밋 메시지 템플릿:')
console.log('  - .github/commit-template.txt')
console.log('      한글 요약, 하이픈 상세, 검증 목록 형식을 안내합니다.')

if (previousHooksPath && previousHooksPath !== '.githooks') {
  console.log('')
  console.log('기존 hooksPath 안내:')
  console.log(`  - 이전 core.hooksPath는 '${previousHooksPath}'였습니다.`)
  console.log('  - 이번 설치로 Git은 .githooks를 기준 hook 디렉터리로 사용합니다.')
  console.log(`  - 기존 hook은 harness.previousHooksPath='${previousHooksPath}'로 저장했으며, .githooks에서 먼저 실행됩니다.`)
}

if (!previousHooksPath && legacyHookFiles.length > 0) {
  console.log('')
  console.log('기존 .git/hooks 안내:')
  for (const file of legacyHookFiles) {
    console.log(`  - ${file}`)
  }
  console.log("  - 기존 hook 경로를 harness.previousHooksPath='.git/hooks'로 저장했습니다.")
  console.log('  - .githooks/pre-commit 또는 .githooks/pre-push가 기존 hook을 먼저 실행한 뒤 하네스 검사를 실행합니다.')
}

if (chainedHooksPath && !shouldStoreCustomHooksPath && !shouldStoreDefaultGitHooks) {
  console.log('')
  console.log('기존 hook 체인 안내:')
  console.log(`  - harness.previousHooksPath='${chainedHooksPath}'를 유지합니다.`)
  console.log('  - 해당 경로에 pre-commit/pre-push가 있으면 .githooks에서 먼저 실행합니다.')
}

if (previousCommitTemplate && previousCommitTemplate !== '.github/commit-template.txt') {
  console.log('')
  console.log('기존 commit template 안내:')
  console.log(`  - 이전 commit.template은 '${previousCommitTemplate}'였습니다.`)
  console.log('  - 이번 설치로 .github/commit-template.txt를 사용합니다.')
}

// dual-runtime(0.2.63): hook이 실제로 동작할 수 있는 Node 환경인지 설치 시점에 진단한다.
// hook은 fresh 셸에서 실행되므로 "지금 이 셸의 node"가 아니라 nvm 설치본 기준으로 본다.
const nvmrc = readNvmrc(repoRoot)
const dualRuntime = Boolean(nvmrc?.parsed && !isSupportedNode(nvmrc.parsed))

console.log('')
console.log('node 환경 진단:')
if (!hasNvm()) {
  if (dualRuntime) {
    console.warn(`  - nvm 없음: .nvmrc ${nvmrc.raw}(저버전) 프로젝트의 dual-runtime 전환에는 nvm이 필요합니다.`)
    console.warn('    nvm 설치 전까지 hook이 Node 버전 게이트에서 실패할 수 있습니다: https://github.com/nvm-sh/nvm')
  } else {
    console.log(`  - nvm 없음: hook은 PATH의 node를 사용합니다 (>=${MIN_NODE.label} 필요).`)
  }
} else {
  const best = resolveHarnessNodeBest()
  if (best) {
    console.log(`  - 하네스 Node(>=${MIN_NODE.label}): ${best.name} 설치됨`)
  } else {
    console.warn(`  - 하네스 Node(>=${MIN_NODE.label}): nvm에 없음 → nvm install ${MIN_NODE.major} 이상을 설치해야 hook이 동작합니다.`)
  }
  if (nvmrc) {
    const installed = nvmrc.parsed ? resolveInstalledForSpec(nvmrc.parsed) : null
    if (installed) {
      console.log(`  - 프로젝트 Node(.nvmrc ${nvmrc.raw}): ${installed.name} 설치됨`)
    } else if (nvmrc.parsed) {
      console.warn(`  - 프로젝트 Node(.nvmrc ${nvmrc.raw}): nvm에 없음 → nvm install ${nvmrc.raw} 후 프로젝트 검증(lint/test/build)이 동작합니다.`)
    } else {
      console.warn(`  - 프로젝트 Node(.nvmrc ${nvmrc.raw}): 버전 표기를 해석하지 못했습니다. 숫자 버전 사용을 권장합니다.`)
    }
    if (dualRuntime) {
      console.log('  - dual-runtime: hook은 하네스 Node로 검사를 실행하고, lint/test/build는 .nvmrc Node로 실행합니다.')
    }
  } else {
    console.log('  - .nvmrc 없음: hook은 PATH 기본 Node가 낮으면 nvm 설치본(>=20.19)으로 자동 전환합니다.')
  }
}
