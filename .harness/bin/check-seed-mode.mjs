#!/usr/bin/env node
// Seed-mode pre-commit guard.
// .harness-seed-mode 파일이 있을 때만 동작하며, stack:apply 산출물(scaffold 파일들 + 머지된 package.json)이
// staged 상태로 commit되는 것을 차단합니다.
//
// 일반 사용자(자기 프로젝트로 쓰는 경우)는 .harness-seed-mode를 삭제하면 이 가드가 자동으로 비활성화됩니다.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const markerPath = path.join(repoRoot, '.harness-seed-mode')
if (!fs.existsSync(markerPath)) {
  process.exit(0)
}

const harnessRootRel = fs.existsSync(path.join(repoRoot, '.harness')) ? '.harness' : '.github'
const harnessRoot = path.join(repoRoot, harnessRootRel)
const profilePath = path.join(harnessRoot, harnessRootRel === '.harness' ? 'policy' : 'policy-harness', 'profile.json')
const stacksRoot = path.join(harnessRoot, 'stacks')

function readJson(absPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function walkScaffold(absDir, relDir, out) {
  if (!fs.existsSync(absDir)) return
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === 'package.merge.json' && relDir === '') continue
    const absChild = path.join(absDir, entry.name)
    const relChild = relDir ? `${relDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      walkScaffold(absChild, relChild, out)
    } else {
      out.add(relChild.split(path.sep).join('/'))
    }
  }
}

const profile = readJson(profilePath, {})
const stackId = profile.activeStack
const scaffoldFiles = new Set()
let packageMergeData = null

if (stackId && stackId !== 'none') {
  const manifestPath = profile.stackManifest
    ? path.resolve(repoRoot, profile.stackManifest)
    : path.join(stacksRoot, stackId, 'manifest.json')
  const manifest = readJson(manifestPath)
  const manifestRoot = path.dirname(manifestPath)
  const scaffoldRel = manifest?.source?.path
  if (scaffoldRel) {
    const scaffoldRoot = path.isAbsolute(scaffoldRel)
      ? scaffoldRel
      : scaffoldRel.startsWith('.harness/') || scaffoldRel.startsWith('.github/')
        ? path.join(repoRoot, scaffoldRel)
        : path.join(manifestRoot, scaffoldRel)
    walkScaffold(scaffoldRoot, '', scaffoldFiles)
  }
  const packageMergeRel = manifest?.source?.packageMerge
  if (packageMergeRel) {
    const packageMergePath = path.isAbsolute(packageMergeRel)
      ? packageMergeRel
      : packageMergeRel.startsWith('.harness/') || packageMergeRel.startsWith('.github/')
        ? path.join(repoRoot, packageMergeRel)
        : path.join(manifestRoot, packageMergeRel)
    packageMergeData = readJson(packageMergePath)
  }
}

const stagedRaw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
const staged = stagedRaw.trim().split('\n').filter(Boolean)

const violations = []

for (const f of staged) {
  if (scaffoldFiles.has(f)) {
    violations.push({ file: f, reason: 'scaffold 산출물 (stack:apply로 생성된 파일)' })
  }
}

if (staged.includes('package.json') && packageMergeData) {
  const pkg = readJson(path.join(repoRoot, 'package.json'), {})
  const mergedKeys = []
  for (const section of ['dependencies', 'devDependencies', 'scripts']) {
    const mergeSection = packageMergeData[section] ?? {}
    const pkgSection = pkg[section] ?? {}
    for (const key of Object.keys(mergeSection)) {
      if (key in pkgSection) mergedKeys.push(`${section}.${key}`)
    }
  }
  if (mergedKeys.length > 0) {
    violations.push({
      file: 'package.json',
      reason: `stack 머지본 포함 (${mergedKeys.slice(0, 3).join(', ')}${mergedKeys.length > 3 ? ', ...' : ''})`,
    })
  }
}

if (violations.length === 0) {
  process.exit(0)
}

console.error('')
console.error('❌ seed-mode commit blocked')
console.error('   이 저장소는 시드 하네스(.harness-seed-mode 존재)로 운영 중입니다.')
console.error('   다음 파일은 시드 정체성을 깨므로 commit할 수 없습니다:')
console.error('')
for (const v of violations) {
  console.error(`   - ${v.file}`)
  console.error(`       ${v.reason}`)
}
console.error('')
console.error('해결 중 하나를 고르세요:')
console.error('  A) 이 저장소를 자기 프로젝트로 쓰는 경우')
console.error('       rm .harness-seed-mode')
console.error('       git add -A && git commit  (이번 커밋에 포함)')
console.error('')
console.error('  B) 시드 하네스를 계속 운영하는 경우 (harness-seed 본 저장소)')
console.error('       npm run stack:reset    # root를 슬림 상태로')
console.error('       git add -u             # 변경 다시 staging')
console.error('       git commit             # 다시 시도')
console.error('')
console.error('자세한 설명: cat .harness-seed-mode')
console.error('')
process.exit(1)
