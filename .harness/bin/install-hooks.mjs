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

function isGitRepository() {
  try {
    const result = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return result === 'true'
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

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel))
}

if (!isGitRepository()) {
  console.error('git 저장소가 아니라 hook을 설치하지 않았습니다.')
  console.error('먼저 프로젝트 루트에서 git init을 실행한 뒤 다시 시도하세요:')
  console.error('  .harness/bin/harness hooks:install')
  process.exit(1)
}

const previousHooksPath = readGitConfig('core.hooksPath')
const storedPreviousHooksPath = readGitConfig('harness.previousHooksPath')
const previousCommitTemplate = readGitConfig('commit.template')
const legacyHookFiles = [
  '.git/hooks/pre-commit',
  '.git/hooks/pre-push',
  '.git/hooks/post-merge',
].filter(exists)
const shouldStoreCustomHooksPath = previousHooksPath && previousHooksPath !== '.githooks'
const shouldStoreDefaultGitHooks = !previousHooksPath && !storedPreviousHooksPath && legacyHookFiles.length > 0

if (shouldStoreCustomHooksPath) {
  // 체인 교체 경고(0.2.135, clubadm D): 보관함은 한 칸이라 새 값이 오면 옛 체인이 실행에서
  // 빠진다(예: .git/hooks 체인 중에 husky를 나중에 얹는 표준 경로). 파일은 그대로지만
  // 기능이 조용히 사라지므로, 덮어쓰는 순간만큼은 무엇이 밀려나는지 말한다.
  if (storedPreviousHooksPath && storedPreviousHooksPath !== previousHooksPath) {
    console.log(`⚠ 이전 훅 체인 '${storedPreviousHooksPath}' 가 '${previousHooksPath}' 로 교체됩니다.`)
    console.log(`  '${storedPreviousHooksPath}' 의 훅은 더 이상 실행되지 않습니다 — 필요하면 새 훅에서 직접 호출하세요.`)
  }
  runGit(['config', 'harness.previousHooksPath', previousHooksPath])
} else if (shouldStoreDefaultGitHooks) {
  runGit(['config', 'harness.previousHooksPath', '.git/hooks'])
}

// commit.template도 hooksPath와 대칭으로 저장한다 — uninstall이 설치 전 템플릿으로 복원할 수 있게.
const shouldStoreCustomCommitTemplate = Boolean(previousCommitTemplate && previousCommitTemplate !== '.github/commit-template.txt')

if (shouldStoreCustomCommitTemplate) {
  runGit(['config', 'harness.previousCommitTemplate', previousCommitTemplate])
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
console.log('      스테이징이 .harness/session/* 뿐인 기록 커밋은 통합 검사를 자동 생략합니다(0.2.124).')
console.log('      .harness/bin/harness check와 같은 검사이며, package.json 없는 비-Node 프로젝트에서도 동작합니다.')
console.log('      에이전트가 커밋 요청을 처리할 때는 이 hook 검증을 신뢰하고 선행 harness:check를 중복 실행하지 않습니다.')
console.log('  - .githooks/pre-push')
console.log('      사용자가 git push를 실행한 뒤 기존 pre-push hook과 .harness/bin/harness check --fast를 실행합니다.')
console.log('      pre-push는 커밋 직전 전체 검증 반복을 줄이기 위해 정책/문서/버전/lint 중심으로 빠르게 확인합니다.')
console.log('  - .githooks/post-merge')
console.log('      git pull(merge) 직후 기획 문서 본문을 팀 기준(spec-lock)에 맞춥니다. 기준은 옮기지 않습니다.')
console.log('      기획문서연동을 쓰지 않는 프로젝트에서는 아무 일도 하지 않고, 실패해도 pull은 성공합니다.')
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
  console.log(`  - 기존 값은 harness.previousCommitTemplate='${previousCommitTemplate}'로 저장했으며, 하네스 제거 시 복원됩니다.`)
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

// 기획 본문 준비(0.2.112): clone 직후의 구멍을 여기서 닫는다.
//
// 기획 본문은 코드 저장소에 vendoring하지 않으므로 clone에는 없다. post-merge 훅이 pull 경로를
// 덮지만 **clone은 merge가 아니라 그 훅이 돌지 않고**, 그 시점엔 훅이 설치조차 안 돼 있다.
// 결과적으로 "아직 안 받은 것"이 "기획서가 없는 것"처럼 보이는 구간이 생긴다 — post-merge 훅을
// 만들 때 문제로 규정했던 바로 그 상황이고, clone 경로만 비어 있었다.
//
// 훅 설치는 클론 직후 누구나 거치는 유일한 필수 단계라 여기가 그 자리다.
// post-merge와 같은 fail-open 성질: 실패해도 훅 설치는 성공이다(오프라인·권한 없음이 설치를 막지 않는다).
if (exists('.harness/spec-lock.json')) {
  console.log('')
  console.log('기획 본문 준비:')
  try {
    execFileSync(process.execPath, [path.join(repoRoot, '.harness/bin/spec-sync.mjs'), 'hydrate', '--timeout-ms', '15000'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    console.log('  - 기준 시점(spec-lock)의 기획 본문을 준비했습니다.')
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? '').trim().split('\n')[0]
    console.warn(`  - 준비하지 못했습니다${detail ? `: ${detail}` : '.'}`)
    console.warn('    훅 설치는 정상 완료됐습니다. 기획 저장소 접근 권한과 네트워크를 확인하세요.')
    console.warn('    재시도: .harness/bin/harness spec:fetch --at-lock')
  }
}
