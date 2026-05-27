import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
console.log('      기존 pre-commit hook이 있으면 먼저 실행한 뒤 seed-mode 확인과 npm run harness:check를 실행합니다.')
console.log('  - .githooks/pre-push')
console.log('      기존 pre-push hook이 있으면 먼저 실행한 뒤 npm run harness:check -- --fast를 실행합니다.')
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
