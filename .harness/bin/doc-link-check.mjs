import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findDeclarationLockIssues, readSpecState } from './spec-sync.mjs'

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
  '.harness/session/template-gap-report.md',
  '.harness/session/task-context.md',
  '.harness/install-manifest.json',
  '.harness/harness-lock.json',
  // 기획 문서 연동(0.2.99): 연결/기준 시점 파일은 /기획문서연동 실행 시점에 생성된다.
  '.harness/spec-sources.json',
  '.harness/spec-lock.json',
  // 이슈 어댑터 실물(결정 82): 프로젝트가 견본을 복사해 만드는 켬 스위치 — 존재가 정상이고
  // registry에는 견본만 등록된다. 본체 자신도 실물을 가진다(관문 이슈 조회).
  '.harness/project/issue-adapter.md',
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
  '.harness/project/body-roadmap.md',
  '.harness/project/standards-adoption-roadmap.md',
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

    // decision-log 아카이브는 파일명이 동적이라 registry에 사전 등록할 수 없다.
    // (decision-log.md 자체는 registry에 등록되어 있어 이 분기에 도달하지 않는다.)
    if (isHistoryLogPath(file)) {
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

// 소유(ownership)와 선택성(optionality)은 다른 속성이다(0.2.102 리뷰 P1-8).
//
// "업데이트가 덮어쓰지 않는다"(project-owned)와 "없어도 정상이다"(optional)를 하나로 묶으면
// profile.json·config-contract.md·.claude/settings.json 삭제까지 조용해진다. 그래서 optional은
// 기능을 쓰지 않으면 존재할 이유가 없는 파일만 좁게 열거한다. project-owned라는 이유만으로는
// 면제하지 않으며, 링크 검사는 대상이 optional이어도 링크가 실재하면 깨진 링크로 본다.
const OPTIONAL_DOC_PATHS = new Set([
  // 기획 문서 연동을 쓰지 않는 프로젝트에는 존재할 이유가 없다.
  '.harness/project/spec-map.md',
  '.harness/spec-sources.json',
  '.harness/spec-lock.json',
  // 개인 로컬 산출물(팀 공유 대상이 아니며 없는 것이 기본값).
  '.harness/project/personal-methodology.local.md',
  'CLAUDE.local.md',
  '.claude/settings.local.json',
])

// 연동을 이미 쓰는 프로젝트에서는 매핑 표가 선택 사항이 아니다 — 지우면 기획 연동 검사와
// push 게이트가 통째로 꺼진다(0.2.103 자체 검토 P2-5). 연동 여부에 따라 판정이 달라진다.
const specLinkInUse = fs.existsSync(path.join(harnessRoot, 'spec-lock.json'))
  || fs.existsSync(path.join(harnessRoot, 'spec-sources.json'))

export function isOptionalProjectOwnedDoc(rel) {
  const normalized = toPosix(rel)
  if (specLinkInUse && normalized === '.harness/project/spec-map.md') return false
  return OPTIONAL_DOC_PATHS.has(normalized)
}

function findMissingFromRegistry(registered) {
  const missing = []

  for (const file of registered) {
    if (!exists(file) && !isOptionalProjectOwnedDoc(file)) {
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

// 이력 로그 문서 판별. decision-log와 그 아카이브(/decision 관례: decision-log-YYYYH1.md,
// thread-handoff-YYYY-MM-DD.md)는 append-only 이력이라, 과거 항목이 언급한 코드 경로는
// 파일이 삭제된 뒤에도 남는 것이 정상이다(역사 참조 ≠ 라이브 참조).
// - 백틱 코드 경로는 무결성 검사에서 제외한다. 고칠 수 없는 경고가 매 커밋 쌓이면
//   출력 자체를 읽지 않게 되어 진짜 신호까지 죽는다(score-print 2026-08-04 P3).
// - `[텍스트](경로)` 마크다운 링크는 탐색용이므로 계속 검사한다.
// - 아카이브 파일명은 동적이라 document-registry에 사전 등록할 수 없으므로 orphan 검사도 제외한다.
// - active-context, project-memory 같은 살아있는 세션 문서는 현재 상태 서술이므로 계속 검사한다.
export function isHistoryLogPath(rel) {
  return /^(?:\.harness|\.github)\/session\/(?:decision-log(?:-[^/]+)?|thread-handoff-[^/]+)\.md$/.test(rel)
}

function stripFence(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}

// 링크 검사에서만 인라인 코드를 제거한다. 코드로 표기한 것은 링크가 아니므로
// `` `[화면](./로그인.html)` `` 같은 예시가 깨진 링크로 오인되면 안 된다.
// 코드 경로 검사에는 적용하지 않는다 — 그쪽은 백틱 표기 자체가 검사 대상이다.
function stripInlineCode(text) {
  return text.replace(/`[^`\n]*`/g, '')
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

    for (const match of stripInlineCode(text).matchAll(linkPattern)) {
      const target = match[1]

      if (isExternal(target)) {
        continue
      }

      const resolved = resolveRelative(file, target)

      if (!resolved) {
        continue
      }

      // 링크는 optional 대상이어도 면제하지 않는다: 지금 문서가 실제로 링크하고 있으면 그 링크는 깨진 것이다.
      if (!exists(resolved)) {
        broken.push({ file, target, resolved })
      }
    }

    // 이력 로그의 백틱 코드 경로는 역사 참조라 라이브 무결성 검사 대상이 아니다.
    if (isHistoryLogPath(file)) {
      continue
    }

    for (const match of text.matchAll(codePathPattern)) {
      const target = match[1]

      if (isIgnorableCodePath(target)) {
        continue
      }

      if (!exists(target) && !isOptionalProjectOwnedDoc(target)) {
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

// 기획 문서 연동 정합(0.2.99 도입, 0.2.100 확장, 오프라인): 커밋된 연동 상태(선언/기준/매핑)가
// 자기모순이 없는지 본다. npm ci가 lock↔package.json 정합을 검사하는 것의 대응물이다.
// 검증·파싱은 spec-sync의 공용 API를 그대로 써서 fetch/settle/push 게이트와 판정이 갈리지 않는다.
// 미연동 프로젝트는 대상이 아니다. 잘못된 선언은 걸러내지 않고 전체를 invalid로 만든다.
export function findSpecLinkInconsistencies() {
  if (harnessRootRel !== '.harness') return []
  // 선언이 사라졌는데 기준만 남은 상태도 정합 검사 대상이다 — 둘 중 하나만 있어도 검사한다.
  const hasSources = fs.existsSync(path.join(harnessRoot, 'spec-sources.json'))
  const hasLock = fs.existsSync(path.join(harnessRoot, 'spec-lock.json'))
  if (!hasSources && !hasLock) return []

  // 기준만 남고 선언이 사라진 상태는 명시적 정합 오류다. state.declared로만 판단하면
  // 여기서 조용히 빠져나가 "연동 안 함"이 된다(3차 리뷰 P2-2).
  if (hasLock && !hasSources) {
    return ['spec-lock.json은 있는데 spec-sources.json이 없습니다 — 연동 선언이 사라졌습니다. 선언을 복원하거나(권장) 더 이상 연동하지 않는다면 spec-lock.json도 함께 제거하세요.']
  }

  let state
  try {
    state = readSpecState()
  } catch (error) {
    return [`기획 연동 상태를 읽지 못했습니다: ${String(error.message ?? error).split('\n')[0]}`]
  }
  if (!state.declared) return []

  const issues = []

  if (!state.valid) {
    // 손상 파일은 이미 어느 파일인지 메시지에 담겨 있다(재리뷰 P1-3) — 접두사로 덧씌우지 않는다.
    issues.push(...state.errors.map((message) => (
      message.startsWith('spec-') ? message : `spec-sources.json: ${message}`
    )))
    return issues
  }

  // 판정 규칙은 push 게이트와 공유한다(spec-sync.findDeclarationLockIssues) — 한쪽만 검사하면
  // 정상인 작업 트리로 커밋 검증을 통과시키고 불일치 상태를 push할 수 있다.
  // 복구 명령은 상황별로 다르다. 유령 source에 --move-baseline을 쓰면 "선언에 없는 source"로 거부된다.
  issues.push(...findDeclarationLockIssues(state.sources, state.lock).map((message) => (
    message.includes('선언(spec-sources.json)에서 사라졌습니다')
      ? `${message} spec-lock.json에서 해당 항목을 제거하거나 선언을 복원하세요.`
      : `${message} 확인 후 npm run harness:spec:fetch -- --move-baseline --source <id> 로 기준을 재생성하세요.`
  )))

  for (const collision of state.collisions) {
    issues.push(`경로 충돌: '${collision.rel}' 이 여러 소스(${collision.sourceIds.join(', ')})에 있습니다 — 활성 소스 전역에서 문서 상대경로는 유일해야 합니다. include/exclude로 겹침을 없애세요.`)
  }

  const lockFiles = new Set(
    Object.values(state.lock.sources).flatMap((recorded) => Object.keys(recorded?.files ?? {})),
  )

  const specCodePathExists = (mapPath) => {
    const starIndex = mapPath.indexOf('*')
    if (starIndex === -1) {
      return fs.existsSync(path.join(repoRoot, mapPath))
    }
    const prefix = mapPath.slice(0, starIndex)
    const probe = prefix.endsWith('/') ? prefix.slice(0, -1) : path.dirname(prefix)
    return probe === '' || probe === '.' ? true : fs.existsSync(path.join(repoRoot, probe))
  }

  // lock의 files를 통째로 비워도 매핑 검사가 꺼지면 안 된다 — `lockFiles.size > 0` 가드가
  // 그 상태를 "아직 기준이 없는 초기"로 오인했다(4차 리뷰 P1-3). 매핑 행이 있는데 기준이 비었으면
  // 그 자체가 정합 오류다.
  if (state.entries.length > 0 && lockFiles.size === 0 && state.lock.exists) {
    issues.push('spec-lock.json에 기준 문서가 하나도 없는데 spec-map에는 매핑 행이 있습니다 — 기준이 비면 매핑된 문서가 어떤 검사도 받지 않습니다. npm run harness:spec:fetch -- --move-baseline 로 기준을 재생성하세요.')
  }

  for (const entry of state.entries) {
    if (lockFiles.size > 0 && !lockFiles.has(entry.spec)) {
      issues.push(`spec-map: '${entry.spec}' — 기준(spec-lock)에 없는 기획 문서입니다. 경로 오타이거나 폐기된 문서면 행을 정리하세요.`)
    }
    if (entry.codePaths.length > 0 && !entry.codePaths.some(specCodePathExists)) {
      issues.push(`spec-map: '${entry.spec}' → ${entry.codePaths.join(', ')} — 구현 경로가 저장소에 없습니다. 파일 이동/이름 변경을 반영하세요.`)
    }
  }

  return issues
}

function readSpecEnforcement() {
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'))?.specEnforcement ?? 'advisory'
  } catch {
    return 'advisory'
  }
}

function main() {
  const registry = readRegistry()
  const registered = collectRegisteredFiles(registry)
  const orphans = findOrphans(registered)
  const missing = findMissingFromRegistry(registered)
  const broken = findBrokenLinks()
  const stackViolations = findStackIsolationViolations()
  const specIssues = findSpecLinkInconsistencies()

  const hasIssue = orphans.length > 0 || missing.length > 0 || broken.length > 0 || stackViolations.length > 0 || specIssues.length > 0

  // \ud1b5\uacfc \uc2dc\uc5d0\ub294 1\uc904\ub85c \ub05d\ub0b8\ub2e4. \ub9e4 \ucee4\ubc0b \ucd9c\ub825\uc5d0\uc11c \uc2e0\ud638 \ub300 \uc7a1\uc74c\ube44\ub97c \uc9c0\ud0a4\ub294 \uac83\uc774 \ubaa9\uc801\uc774\ub2e4(P4).
  if (!hasIssue) {
    console.log('Doc link / registry check OK: \ub808\uc9c0\uc2a4\ud2b8\ub9ac \uc77c\uad00\uc131, \ub9c1\ud06c, \ucf54\ub4dc \uacbd\ub85c \ucc38\uc870 \ubaa8\ub450 \uc720\ud6a8\ud569\ub2c8\ub2e4.')
    return
  }

  console.log('Doc link / registry check')
  console.log('')

  if (orphans.length > 0) {
    console.log('Orphan markdown files (registry\uc5d0 \uc5c6\uc74c):')
    for (const f of orphans) {
      console.log(`  - ${f}`)
    }
    console.log('')
  }

  if (missing.length > 0) {
    console.log('Registry\uc5d0\ub294 \uc788\uc9c0\ub9cc \ud30c\uc77c\uc774 \uc874\uc7ac\ud558\uc9c0 \uc54a\uc74c:')
    for (const f of missing) {
      console.log(`  - ${f}`)
    }
    console.log('')
  }

  if (broken.length > 0) {
    console.log('Broken link / dead code path reference:')
    for (const b of broken) {
      console.log(`  - ${b.file} -> ${b.target} (resolved: ${b.resolved}${b.kind ? `, ${b.kind}` : ''})`)
    }
    console.log('')
  }

  if (stackViolations.length > 0) {
    console.log('Stack isolation violation (\ud55c \uc2a4\ud0dd \ud3f4\ub354\uac00 \ub2e4\ub978 \uc2a4\ud0dd \ud3f4\ub354\ub97c \ucc38\uc870\ud568):')
    for (const v of stackViolations) {
      console.log(`  - ${v.file} -> ${stacksRel}/${v.otherStack}/`)
    }
    console.log('')
  }

  if (specIssues.length > 0) {
    console.log('\uae30\ud68d \ubb38\uc11c \uc5f0\ub3d9 \uc815\ud569 \ubb38\uc81c (\uc120\uc5b8\u2194\uae30\uc900\u2194\ub9e4\ud551\u2194\ucf54\ub4dc):')
    for (const issue of specIssues) {
      console.log(`  - ${issue}`)
    }
    console.log('')
  }

  // \uc815\ud569 \ubb38\uc81c\ub294 push \uac8c\uc774\ud2b8/advisory\uc758 \ud310\uc815 \uc815\ud655\ub3c4\ub97c \uc9c1\uc811 \uae68\ub728\ub9ac\ubbc0\ub85c,
  // \uac8c\uc774\ud2b8\ub97c \uc635\ud2b8\uc778(specEnforcement=gate)\ud55c \ud504\ub85c\uc81d\ud2b8\uc5d0\uc11c\ub294 strict\uac00 \uc544\ub2c8\uc5b4\ub3c4 \ucc28\ub2e8\ud55c\ub2e4.
  if (specIssues.length > 0 && readSpecEnforcement() === 'gate') {
    process.exitCode = 1
  }

  if (strictMode) {
    process.exitCode = 1
  }
}

// 직접 실행할 때만 검사를 돌린다. 테스트가 분류 함수를 import할 때는 부작용이 없어야 한다.
// tmpdir(/var → /private/var) 같은 심볼릭 링크 경로에서도 동작하도록 realpath로 비교한다
// (changelog-delta.mjs의 invokedDirectly와 같은 패턴). path.resolve 단독 비교는 심링크 경로에서
// 어긋나 main()이 조용히 건너뛰어져 검사가 fail-open으로 꺼졌다.
function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return fs.realpathSync(entry) === fs.realpathSync(__filename)
  } catch {
    return path.resolve(entry) === __filename
  }
}

if (invokedDirectly()) {
  main()
}
