import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRootRel = fs.existsSync(path.join(repoRoot, '.harness')) ? '.harness' : '.github'
const harnessRoot = path.join(repoRoot, harnessRootRel)
const registryPath = path.join(harnessRoot, harnessRootRel === '.harness' ? 'documentation' : 'documentation-harness', 'document-registry.json')
const profilePath = path.join(harnessRoot, harnessRootRel === '.harness' ? 'policy' : 'policy-harness', 'profile.json')
const stacksRel = harnessRootRel === '.harness' ? '.harness/stacks' : '.github/stacks'
const stacksRoot = path.join(repoRoot, stacksRel)

const args = process.argv.slice(2)
const strictMode = args.includes('--strict')

function readActiveScaffoldRoot() {
  if (!fs.existsSync(profilePath)) {
    return null
  }

  let profile

  try {
    profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  } catch {
    return null
  }

  const stackId = profile.activeStack

  if (!stackId || stackId === 'none') {
    return null
  }

  const manifestPath = profile.stackManifest
    ? path.resolve(repoRoot, profile.stackManifest)
    : path.join(stacksRoot, stackId, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    return null
  }

  let manifest

  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }

  const scaffoldPath = manifest.source?.path

  if (!scaffoldPath) {
    return null
  }

  const manifestRoot = path.dirname(manifestPath)
  const abs = path.isAbsolute(scaffoldPath)
    ? scaffoldPath
    : scaffoldPath.startsWith('.harness/') || scaffoldPath.startsWith('.github/')
      ? path.join(repoRoot, scaffoldPath)
      : path.join(manifestRoot, scaffoldPath)
  return fs.existsSync(abs) ? abs : null
}

const activeScaffoldRoot = readActiveScaffoldRoot()

// 런타임에만 생성되는 마커/산출물 경로. 문서가 참조해도 실제 파일 부재를 broken으로 보지 않습니다.
const dynamicArtifactPaths = new Set([
  '.harness/.stack-applied.json',
  '.harness/.template-applied.json',
  '.github/.stack-applied.json',
  '.github/.template-applied.json',
  '.claude/settings.local.json',
  'CLAUDE.local.md',
  '.harness/session/project-scan-report.md',
  '.harness/session/handoff.md',
  '.harness/session/task-context.md',
  '.harness/install-manifest.json',
  '.harness/harness-lock.json',
  // npx init 진입점은 사용자 프로젝트에 복사하지 않는다. 시드 결정 로그의
  // 역사적 참조는 사용자 프로젝트에서도 broken reference로 취급하지 않는다.
  'scripts/init.mjs',
  'scripts/test-init.mjs',
])

const dynamicArtifactPrefixes = [
  '.harness/stacks/.applied/',
  '.harness/templates/.applied/',
  '.harness/generated/',
  '.github/stacks/.applied/',
  '.github/templates/.applied/',
]

// 본체(seed-mode) 전용 문서. 소비자 프로젝트에는 배포되지 않으므로 document-registry에 등록하지 않는다.
// 본체 저장소에는 파일이 존재하지만 registry 미등록이 정상이므로 orphan으로 보지 않는다.
// (init.mjs의 SEED_ONLY_DOC_PATHS와 동기화 — 한쪽을 바꾸면 다른 쪽도 함께 갱신)
const seedOnlyDocs = new Set([
  '.harness/project/body-release-checklist.md',
])

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function exists(rel) {
  if (dynamicArtifactPaths.has(rel)) {
    return true
  }

  // seed-only 문서는 소비자 프로젝트에 배포되지 않으므로(소비자엔 부재가 정상),
  // 다른 문서가 이 경로를 링크/코드경로로 참조해도 broken으로 보지 않는다.
  // 본체에는 실제 존재하므로 본체 검사에도 영향이 없다.
  if (seedOnlyDocs.has(rel)) {
    return true
  }

  if (dynamicArtifactPrefixes.some((prefix) => rel.startsWith(prefix))) {
    return true
  }

  if (fs.existsSync(path.join(repoRoot, rel))) {
    return true
  }

  if (activeScaffoldRoot && fs.existsSync(path.join(activeScaffoldRoot, rel))) {
    return true
  }

  return false
}

function walk(dir) {
  const out = []

  if (!fs.existsSync(dir)) {
    return out
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      out.push(...walk(full))
      continue
    }

    out.push(full)
  }

  return out
}

function listMarkdownFiles() {
  const markdownFiles = walk(harnessRoot)
    .filter((f) => f.endsWith('.md'))
    .map((f) => toPosix(path.relative(repoRoot, f)))
    .filter((rel) => !rel.includes('/scaffold/') && !rel.includes('/.applied/') && !rel.startsWith('.harness/generated/'))

  if (fs.existsSync(path.join(repoRoot, '.claude'))) {
    markdownFiles.push(
      ...walk(path.join(repoRoot, '.claude'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => toPosix(path.relative(repoRoot, f))),
    )
  }

  for (const rel of ['AGENTS.md', 'CLAUDE.md']) {
    if (fs.existsSync(path.join(repoRoot, rel))) {
      markdownFiles.push(rel)
    }
  }

  return markdownFiles
}

function readRegistry() {
  if (!fs.existsSync(registryPath)) {
    return { groups: [] }
  }

  return JSON.parse(fs.readFileSync(registryPath, 'utf8'))
}

function collectRegisteredFiles(registry) {
  const set = new Set()

  for (const group of registry.groups ?? []) {
    if (group.index) {
      set.add(group.index)
    }

    for (const child of group.children ?? []) {
      set.add(child)
    }
  }

  return set
}

function findOrphans(registered) {
  const all = listMarkdownFiles()
  const orphans = []

  for (const file of all) {
    if (registered.has(file)) {
      continue
    }

    if (dynamicArtifactPaths.has(file)) {
      continue
    }

    if (seedOnlyDocs.has(file)) {
      continue
    }

    if (file.startsWith('.github/ISSUE_TEMPLATE/')) {
      continue
    }

    if (file === '.github/pull_request_template.md') {
      continue
    }

    orphans.push(file)
  }

  return orphans
}

function findMissingFromRegistry(registered) {
  const missing = []

  for (const file of registered) {
    if (!exists(file)) {
      missing.push(file)
    }
  }

  return missing
}

const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g
const codePathPattern = /`((?:src|scripts|\.github|\.harness|\.claude|\.githooks)\/[A-Za-z0-9_./-]+)`/g

// 백틱 코드 경로 중 "특정 파일 참조"가 아니라 무결성 검사 대상에서 빼야 하는 경로를 판별한다.
// - glob/생략(`*`, `...`)은 패턴 표기.
// - trailing slash(`.github/workflows/`, `.harness/policy/`)는 "이런 위치를 보라"는 디렉토리 예시이지 파일 링크가 아니다.
// - `.github/workflows/` 하위는 본체 CI 어댑터 경로다. 소비자 프로젝트에는 기본 주입되지 않으므로(소비자 환경엔 없을 수 있음) 검사하지 않는다.
//   본체에선 실제 존재하므로 검사해도 통과하지만, 소비자에서의 환경 의존 오탐을 없애기 위해 항상 제외한다.
export function isIgnorableCodePath(target) {
  if (target.includes('*') || target.includes('...')) {
    return true
  }

  if (target.endsWith('/')) {
    return true
  }

  if (target.startsWith('.github/workflows/')) {
    return true
  }

  return false
}

function stripFence(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}

function isExternal(target) {
  return /^[a-z]+:\/\//i.test(target) || target.startsWith('mailto:') || target.startsWith('#')
}

function resolveRelative(fromFile, target) {
  const cleaned = target.split('#')[0].split('?')[0]

  if (!cleaned) {
    return null
  }

  if (cleaned.startsWith('/')) {
    return cleaned.replace(/^\/+/, '')
  }

  const baseDir = path.posix.dirname(fromFile)
  return path.posix.normalize(path.posix.join(baseDir, cleaned))
}

function findBrokenLinks() {
  const broken = []

  for (const file of listMarkdownFiles()) {
    const raw = fs.readFileSync(path.join(repoRoot, file), 'utf8')
    const text = stripFence(raw)

    for (const match of text.matchAll(linkPattern)) {
      const target = match[1]

      if (isExternal(target)) {
        continue
      }

      const resolved = resolveRelative(file, target)

      if (!resolved) {
        continue
      }

      if (!exists(resolved)) {
        broken.push({ file, target, resolved })
      }
    }

    for (const match of text.matchAll(codePathPattern)) {
      const target = match[1]

      if (isIgnorableCodePath(target)) {
        continue
      }

      if (!exists(target)) {
        broken.push({ file, target, resolved: target, kind: 'code-path' })
      }
    }
  }

  return broken
}

function findStackIsolationViolations() {
  if (!fs.existsSync(stacksRoot)) {
    return []
  }

  const stackIds = fs.readdirSync(stacksRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  const violations = []

  for (const stackId of stackIds) {
    const stackDir = path.join(stacksRoot, stackId)
    const files = walk(stackDir).filter((f) => f.endsWith('.md') || f.endsWith('.json'))

    for (const file of files) {
      const rel = toPosix(path.relative(repoRoot, file))

      if (rel.includes('/scaffold/') || rel.includes('/.applied/')) {
        continue
      }

      const content = fs.readFileSync(file, 'utf8')
      const otherStacks = stackIds.filter((id) => id !== stackId)

      for (const other of otherStacks) {
        const needle = `${stacksRel}/${other}/`

        if (content.includes(needle)) {
          violations.push({ file: rel, otherStack: other })
        }
      }
    }
  }

  return violations
}

function main() {
  const registry = readRegistry()
  const registered = collectRegisteredFiles(registry)
  const orphans = findOrphans(registered)
  const missing = findMissingFromRegistry(registered)
  const broken = findBrokenLinks()
  const stackViolations = findStackIsolationViolations()

  let hasIssue = false

  console.log('Doc link / registry check')
  console.log('')

  if (orphans.length > 0) {
    hasIssue = true
    console.log('Orphan markdown files (registry\uc5d0 \uc5c6\uc74c):')
    for (const f of orphans) {
      console.log(`  - ${f}`)
    }
    console.log('')
  }

  if (missing.length > 0) {
    hasIssue = true
    console.log('Registry\uc5d0\ub294 \uc788\uc9c0\ub9cc \ud30c\uc77c\uc774 \uc874\uc7ac\ud558\uc9c0 \uc54a\uc74c:')
    for (const f of missing) {
      console.log(`  - ${f}`)
    }
    console.log('')
  }

  if (broken.length > 0) {
    hasIssue = true
    console.log('Broken link / dead code path reference:')
    for (const b of broken) {
      console.log(`  - ${b.file} -> ${b.target} (resolved: ${b.resolved}${b.kind ? `, ${b.kind}` : ''})`)
    }
    console.log('')
  }

  if (stackViolations.length > 0) {
    hasIssue = true
    console.log('Stack isolation violation (\ud55c \uc2a4\ud0dd \ud3f4\ub354\uac00 \ub2e4\ub978 \uc2a4\ud0dd \ud3f4\ub354\ub97c \ucc38\uc870\ud568):')
    for (const v of stackViolations) {
      console.log(`  - ${v.file} -> ${stacksRel}/${v.otherStack}/`)
    }
    console.log('')
  }

  if (!hasIssue) {
    console.log('OK: \ub808\uc9c0\uc2a4\ud2b8\ub9ac \uc77c\uad00\uc131, \ub9c1\ud06c, \ucf54\ub4dc \uacbd\ub85c \ucc38\uc870 \ubaa8\ub450 \uc720\ud6a8\ud569\ub2c8\ub2e4.')
    return
  }

  if (strictMode) {
    process.exitCode = 1
  }
}

// 직접 실행할 때만 검사를 돌린다. 테스트가 isIgnorableCodePath를 import할 때는 부작용이 없어야 한다.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
}
