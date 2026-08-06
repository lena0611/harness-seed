#!/usr/bin/env node

// 기획 문서 연동(Spec Authority) 런타임.
//
// 설계 전제 (2026-08-05 확정, 2026-08-06 v2):
// - 기획팀은 코드도 하네스도 모른다. 기획 저장소에는 평범한 markdown만 있고 어떤 계약도 지지 않는다.
//   따라서 스펙 식별자는 파일 경로이며, registry/front-matter 같은 구조를 기획에 요구하지 않는다.
// - 스펙 본문은 코드 저장소에 vendoring하지 않는다. 캐시(.harness/generated/spec-cache/)에만 두고
//   커밋되는 것은 "어느 시점 기획을 기준으로 개발했는가"를 남기는 spec-lock.json뿐이다.
// - 연결고리(어느 기획 문서가 어느 코드인지)는 코드 저장소가 소유한다: .harness/project/spec-map.md.
// - lock v2: 문서별 {sha, commit} — 부분 정산(내 몫만)이 만든 혼합 기준을 문서 단위로 재현할 수 있다.
//   selector(include/exclude 사본)도 기록해 선언 변경을 정합 검사가 감지한다.
// - 읽기 경로(status/doc-link/build-context/커밋 검증)는 파일을 수정하지 않고 네트워크를 쓰지 않는다.
//   v1 lock은 메모리에서만 해석하고, v2 기록·네트워크 확보는 명시적 변경 명령(fetch --move-baseline, settle)만 한다.
// - fetch 계약: lock이 없으면 무인자 fetch = 최초 기준 생성. lock이 있으면 무인자 fetch = cache-only.
//   기준 이동은 --move-baseline(전체) / --move-baseline --source <id>(해당 소스만)로만 일어난다.

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRoot = path.join(repoRoot, '.harness')
const sourcesPath = path.join(harnessRoot, 'spec-sources.json')
const lockPath = path.join(harnessRoot, 'spec-lock.json')
const cacheRoot = path.join(harnessRoot, 'generated', 'spec-cache')
const specMapRel = '.harness/project/spec-map.md'

const args = process.argv.slice(2)
const mode = args[0] ?? 'status'
const jsonOutput = args.includes('--json')
const cacheOnly = args.includes('--cache-only')
const atLock = args.includes('--at-lock')
const moveBaseline = args.includes('--move-baseline')
const explicitDocs = args.flatMap((value, index) => (value === '--doc' && args[index + 1] ? [args[index + 1]] : []))
const sourceFilter = args.flatMap((value, index) => (value === '--source' && args[index + 1] ? [args[index + 1]] : []))

function readJson(absPath, fallback = null) {
  if (!fs.existsSync(absPath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`)
}

export function sha256Text(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

// 소스 id는 캐시 디렉터리 이름이 되므로 경로 탈출을 막는다.
export function isSafeSourceId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..'
}

// 선언 파싱 + 검증. 잘못된 항목을 조용히 걸러내지 않는다 — 하나라도 틀리면 전체가 invalid이고,
// 모든 소비자(fetch/settle/status/정합 검사/push 게이트)가 같은 판정을 공유한다.
export function validateSourcesConfig(config) {
  if (config === null || config === undefined) {
    return { declared: false, sources: [], errors: [] }
  }
  if (typeof config !== 'object') {
    return { declared: true, sources: [], errors: ['spec-sources.json이 객체가 아닙니다.'] }
  }

  const raw = Array.isArray(config.sources) ? config.sources : []
  const errors = []
  const seen = new Set()

  for (const source of raw) {
    if (!source || typeof source !== 'object') {
      errors.push('sources 배열에 객체가 아닌 항목이 있습니다.')
      continue
    }
    if (!isSafeSourceId(source.id)) {
      errors.push(`source id가 안전하지 않습니다: ${JSON.stringify(source.id ?? null)} (영문/숫자/._- 만 허용)`)
      continue
    }
    if (seen.has(source.id)) {
      errors.push(`source id가 중복됩니다: ${source.id}`)
      continue
    }
    seen.add(source.id)
    if (typeof source.repo !== 'string' || !source.repo.trim()) {
      errors.push(`source '${source.id}'에 repo가 없습니다.`)
    }
  }

  if (raw.length === 0) {
    errors.push('spec-sources.json에 source가 없습니다.')
  }

  return { declared: true, sources: errors.length === 0 ? raw : [], errors }
}

export function normalizeSelector(source) {
  const include = Array.isArray(source?.include) && source.include.length > 0 ? [...source.include] : ['**/*.md']
  const exclude = Array.isArray(source?.exclude) ? [...source.exclude] : []
  return { include: include.sort(), exclude: exclude.sort() }
}

export function selectorsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// lock v1(문서별 sha 문자열) → v2(문서별 {sha, commit}) 메모리 정규화.
// v1 문서의 commit은 소스의 기준 commit으로 본다(부분 정산 이전의 유일한 기준).
// 이 함수는 절대 파일을 쓰지 않는다 — 읽기 경로가 그대로 써도 안전하다.
export function normalizeLock(rawLock) {
  if (!rawLock || typeof rawLock !== 'object' || !rawLock.sources) {
    return { exists: Boolean(rawLock), version: rawLock?.version ?? null, sources: {}, hadV1: false }
  }

  let hadV1 = false
  const sources = {}
  for (const [id, recorded] of Object.entries(rawLock.sources)) {
    const files = {}
    for (const [rel, value] of Object.entries(recorded?.files ?? {})) {
      if (typeof value === 'string') {
        hadV1 = true
        files[rel] = { sha: value, commit: recorded?.commit ?? null, v1: true }
      } else if (value && typeof value === 'object' && typeof value.sha === 'string') {
        files[rel] = { sha: value.sha, commit: value.commit ?? recorded?.commit ?? null }
      }
    }
    sources[id] = {
      repo: recorded?.repo ?? null,
      ref: recorded?.ref ?? null,
      commit: recorded?.commit ?? null,
      fetchedAt: recorded?.fetchedAt ?? null,
      selector: recorded?.selector ?? null,
      files,
    }
  }
  return { exists: true, version: rawLock.version ?? 1, sources, hadV1 }
}

// 같은 상대경로가 두 소스 이상에 있으면 매핑(spec-map)이 어느 문서를 가리키는지 모호해진다.
export function findPathCollisions(lockNorm) {
  const byRel = new Map()
  for (const [id, recorded] of Object.entries(lockNorm?.sources ?? {})) {
    for (const rel of Object.keys(recorded.files ?? {})) {
      if (!byRel.has(rel)) byRel.set(rel, [])
      byRel.get(rel).push(id)
    }
  }
  return [...byRel.entries()].filter(([, ids]) => ids.length > 1).map(([rel, ids]) => ({ rel, sourceIds: ids }))
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replaceAll('**/', '::ANY_DIR::')
    .replaceAll('**', '::DOUBLE_STAR::')
    .replaceAll('*', '[^/]*')
    .replaceAll('::ANY_DIR::', '(?:.*/)?')
    .replaceAll('::DOUBLE_STAR::', '.*')
  return new RegExp(`^${escaped}$`)
}

function matchesAny(rel, globs) {
  return globs.some((glob) => globToRegExp(glob).test(rel))
}

function walkFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, base))
      continue
    }
    out.push(toPosix(path.relative(base, abs)))
  }
  return out
}

// 소스 선언의 include/exclude로 스펙 문서를 고른다. 기본은 모든 markdown.
export function selectSpecFilesBySelector(sourceDir, selector) {
  return walkFiles(sourceDir)
    .filter((rel) => matchesAny(rel, selector.include))
    .filter((rel) => !matchesAny(rel, selector.exclude))
    .sort()
}

function selectSpecFiles(sourceDir, source) {
  return selectSpecFilesBySelector(sourceDir, normalizeSelector(source))
}

function runGit(argsToRun, cwd) {
  return execFileSync('git', argsToRun, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

// git show 결과에 우리 해시 함수를 그대로 적용한다. git blob object id(sha1/sha256 + 헤더)와
// content sha256은 다른 값이므로 절대 직접 비교하지 않는다.
export function gitShowText(dir, commit, rel) {
  try {
    return execFileSync('git', ['show', `${commit}:${rel}`], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

function commitAvailable(dir, commit) {
  try {
    runGit(['cat-file', '-e', `${commit}^{commit}`], dir)
    return true
  } catch {
    return false
  }
}

// 캐시 삭제는 반드시 cacheRoot 내부만. source id 검증과 별개의 마지막 방어선.
function assertInsideCacheRoot(dir) {
  const resolvedRoot = path.resolve(cacheRoot)
  const resolved = path.resolve(dir)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`캐시 경로가 cacheRoot 밖을 가리킵니다: ${dir}`)
  }
}

function cacheDirFor(sourceId) {
  if (!isSafeSourceId(sourceId)) {
    throw new Error(`source id가 안전하지 않습니다: ${sourceId}`)
  }
  const dir = path.join(cacheRoot, sourceId)
  assertInsideCacheRoot(dir)
  return dir
}

// 캐시 저장소를 보장한다. 선언 repo와 캐시 origin이 다르면(저장소 이전) 옛 origin을 계속
// fetch해서 불일치를 숨기지 않도록, containment 검증 후 지우고 새 repo로 다시 clone한다.
function ensureCacheRepo(source) {
  const dir = cacheDirFor(source.id)

  if (fs.existsSync(path.join(dir, '.git'))) {
    let origin = ''
    try {
      origin = runGit(['remote', 'get-url', 'origin'], dir)
    } catch {
      origin = ''
    }
    if (origin === source.repo) {
      return dir
    }
    assertInsideCacheRoot(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }

  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  runGit(['clone', '--quiet', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), source.repo, dir], repoRoot)
  return dir
}

// 특정 commit의 객체를 캐시 저장소에 확보한다(수화·마이그레이션용). 네트워크를 쓸 수 있다.
function ensureCommitAvailable(dir, source, commit) {
  if (commitAvailable(dir, commit)) return
  const ref = source.ref || 'HEAD'
  try {
    runGit(['fetch', '--quiet', '--depth', '1', 'origin', commit], dir)
  } catch {
    try {
      runGit(['fetch', '--quiet', '--unshallow', 'origin', ref], dir)
    } catch {
      runGit(['fetch', '--quiet', 'origin', ref], dir)
    }
  }
  if (!commitAvailable(dir, commit)) {
    throw new Error(`기획 저장소에서 commit ${commit.slice(0, 10)}을 찾을 수 없습니다 (${source.id})`)
  }
}

// 최신 ref를 캐시로 받는다(기준 이동 없음). 반환: 최신 commit.
export function fetchLatestIntoCache(source) {
  const dir = ensureCacheRepo(source)
  const ref = source.ref || 'HEAD'
  runGit(['fetch', '--quiet', '--depth', '1', 'origin', ref], dir)
  runGit(['checkout', '--quiet', '--force', 'FETCH_HEAD'], dir)
  return { dir, commit: runGit(['rev-parse', 'HEAD'], dir) }
}

// 구현 경로 매칭: spec-map의 코드 경로(파일, 글롭, 디렉터리 접두)와 변경 파일을 대조한다.
// policy-harness의 advisory 매칭과 같은 의미를 유지한다.
function codeGlobToRegExp(glob) {
  const escaped = glob
    .split('**')
    .map((segment) => segment.split('*').map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('[^/]*'))
    .join('::DOUBLE_STAR::')
  return new RegExp(`^${escaped.replaceAll('::DOUBLE_STAR::', '.*')}$`)
}

export function codePathMatches(filePath, mapPath) {
  if (filePath === mapPath) return true
  if (codeGlobToRegExp(mapPath).test(filePath)) return true
  const prefix = mapPath.replace(/\/?\*\*$/, '')
  return prefix !== mapPath ? filePath.startsWith(`${prefix}/`) : filePath.startsWith(`${mapPath}/`)
}

// 변경 파일 목록에 매핑으로 걸리는 기획 문서들을 돌려준다(중복 제거).
export function mappedDocsForFiles(files, entries) {
  const hits = []
  for (const entry of entries) {
    const hit = files.some((filePath) => entry.codePaths.some((mapPath) => codePathMatches(filePath, mapPath)))
    if (hit && !hits.some((item) => item.spec === entry.spec)) {
      hits.push(entry)
    }
  }
  return hits
}

// spec-map 표 파싱. 텍스트 기반이라 push 게이트가 tip snapshot 내용에도 같은 파서를 쓴다.
export function parseSpecMapText(text) {
  if (typeof text !== 'string') return []
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !/기획 문서/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2)
    .map(([spec, code, note]) => ({
      spec: spec.replaceAll('`', '').trim(),
      codePaths: code.split(',').map((item) => item.replaceAll('`', '').trim()).filter(Boolean),
      note: note ?? '',
    }))
    .filter((entry) => entry.spec && !entry.spec.startsWith('예:') && entry.spec !== 'TBD')
}

export function readSpecMapEntries() {
  const abs = path.join(repoRoot, specMapRel)
  if (!fs.existsSync(abs)) return []
  return parseSpecMapText(fs.readFileSync(abs, 'utf8'))
}

// git이 비ASCII 경로를 "..." octal로 감싸 출력하는 것(core.quotePath 기본값)을 실제 경로로 되돌린다.
export function decodeGitPath(filePath) {
  if (!filePath) return filePath
  if (!(filePath.startsWith('"') && filePath.endsWith('"'))) return filePath

  const inner = filePath.slice(1, -1)
  const bytes = []
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (ch !== '\\') {
      for (const byte of Buffer.from(ch, 'utf8')) bytes.push(byte)
      continue
    }
    const next = inner[i + 1]
    if (/[0-7]/.test(next ?? '')) {
      bytes.push(Number.parseInt(inner.slice(i + 1, i + 4), 8))
      i += 3
    } else if (next === 'n') {
      bytes.push(10)
      i += 1
    } else if (next === 't') {
      bytes.push(9)
      i += 1
    } else if (next) {
      for (const byte of Buffer.from(next, 'utf8')) bytes.push(byte)
      i += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

// lock에 기록된 기준과 현재 캐시를 비교한다. 네트워크를 쓰지 않으므로 오프라인에서도 동작한다.
function diffAgainstLock(lockNorm, sources) {
  const result = { sources: [], changed: 0, added: 0, removed: 0, cacheMissing: [] }

  for (const source of sources) {
    const recorded = lockNorm?.sources?.[source.id]
    let dir
    try {
      dir = cacheDirFor(source.id)
    } catch {
      continue
    }

    if (!fs.existsSync(dir)) {
      result.cacheMissing.push(source.id)
      continue
    }

    const selector = recorded?.selector ?? normalizeSelector(source)
    const files = selectSpecFilesBySelector(dir, selector)
    const previous = recorded?.files ?? {}

    const changed = files.filter((rel) => previous[rel] && previous[rel].sha !== sha256Text(fs.readFileSync(path.join(dir, rel), 'utf8')))
    const added = files.filter((rel) => !previous[rel])
    const removed = Object.keys(previous).filter((rel) => !files.includes(rel))

    result.sources.push({ id: source.id, changed, added, removed, total: files.length })
    result.changed += changed.length
    result.added += added.length
    result.removed += removed.length
  }

  return result
}

function linkedCodePaths(specRel, entries) {
  return entries.filter((entry) => entry.spec === specRel).flatMap((entry) => entry.codePaths)
}

function printNotConfigured() {
  console.log('기획 문서 연동이 아직 설정되지 않았습니다.')
  console.log('- 설정: 에이전트에게 `/기획문서연동` 이라고 요청하면 기획 저장소 주소를 받아 연결과 매핑을 만듭니다.')
  console.log(`- 수동 설정: ${toPosix(path.relative(repoRoot, sourcesPath))}에 기획 저장소를 선언한 뒤 npm run harness:spec:fetch 를 실행합니다.`)
}

function printConfigErrors(errors) {
  console.error('기획 문서 연동 설정이 유효하지 않습니다:')
  for (const message of errors) {
    console.error(`  - ${message}`)
  }
  console.error('spec-sources.json을 고친 뒤 다시 실행하세요. 잘못된 선언은 걸러내지 않고 전체를 중단합니다.')
}

// v1 lock을 v2로 승격한다(변경 명령 전용 — 읽기 경로에서 호출 금지).
// 각 문서의 sha가 기록된 기준 commit의 내용과 일치하는지 검증한 뒤에만 {sha, commit}으로 확정한다.
// allowNetwork=false(settle)면 로컬 객체만 사용하고, 필요한 commit이 없으면 안내 후 중단한다.
function promoteV1Sources(lockNorm, sources, { allowNetwork, skipSourceIds = new Set() }) {
  const failures = []

  for (const source of sources) {
    if (skipSourceIds.has(source.id)) continue
    const recorded = lockNorm.sources[source.id]
    if (!recorded) continue

    const v1Rels = Object.entries(recorded.files).filter(([, value]) => value.v1).map(([rel]) => rel)
    if (v1Rels.length === 0) continue

    if (!recorded.commit) {
      failures.push({ id: source.id, rel: '(전체)', reason: '기준 commit 기록이 없습니다' })
      continue
    }

    const dir = allowNetwork ? ensureCacheRepo(source) : cacheDirFor(source.id)
    if (!fs.existsSync(path.join(dir, '.git'))) {
      failures.push({ id: source.id, rel: '(전체)', reason: '로컬 캐시가 없습니다 — npm run harness:spec:fetch 로 캐시를 먼저 받으세요' })
      continue
    }

    if (!commitAvailable(dir, recorded.commit)) {
      if (allowNetwork) {
        ensureCommitAvailable(dir, source, recorded.commit)
      } else {
        failures.push({ id: source.id, rel: '(전체)', reason: `기준 commit ${recorded.commit.slice(0, 10)}이 로컬 캐시에 없습니다 — npm run harness:spec:fetch 로 먼저 받으세요` })
        continue
      }
    }

    for (const rel of v1Rels) {
      const shown = gitShowText(dir, recorded.commit, rel)
      if (shown === null) {
        failures.push({ id: source.id, rel, reason: '기준 commit에 이 문서가 없습니다' })
        continue
      }
      if (sha256Text(shown) !== recorded.files[rel].sha) {
        failures.push({ id: source.id, rel, reason: '기록된 해시가 기준 commit 내용과 다릅니다' })
        continue
      }
      recorded.files[rel] = { sha: recorded.files[rel].sha, commit: recorded.commit }
    }
  }

  return failures
}

function printPromotionFailures(failures) {
  console.error('v1 기준(lock)을 검증할 수 없어 중단합니다:')
  for (const failure of failures) {
    console.error(`  - [${failure.id}] ${failure.rel}: ${failure.reason}`)
  }
  console.error('')
  console.error('확인된 소비자에는 이 상태가 없어야 정상입니다. 위 문서의 변경 내용을 검토한 뒤')
  console.error('npm run harness:spec:fetch -- --move-baseline [--source <id>] 로 기준을 재생성하세요.')
}

function serializeLock(lockNorm) {
  const sources = {}
  for (const [id, recorded] of Object.entries(lockNorm.sources)) {
    const files = {}
    for (const rel of Object.keys(recorded.files).sort()) {
      const value = recorded.files[rel]
      files[rel] = { sha: value.sha, commit: value.commit }
    }
    sources[id] = {
      repo: recorded.repo,
      ref: recorded.ref,
      commit: recorded.commit,
      fetchedAt: recorded.fetchedAt,
      selector: recorded.selector,
      files,
    }
  }
  return { version: 2, sources }
}

// 다른 하네스 스크립트(build-context, policy-harness, doc-link)가 쓰는 조회 API.
// 파일을 수정하지 않고 네트워크를 쓰지 않는다.
export function readSpecState() {
  const config = readJson(sourcesPath)
  const { declared, sources, errors } = validateSourcesConfig(config)
  const lock = normalizeLock(readJson(lockPath))
  const entries = readSpecMapEntries()
  const collisions = findPathCollisions(lock)
  const valid = errors.length === 0

  return {
    configured: declared && (valid ? sources.length > 0 : true),
    declared,
    valid,
    errors,
    sources,
    lock,
    entries,
    collisions,
    cacheRoot,
    diff: declared && valid && sources.length > 0 ? diffAgainstLock(lock, sources) : null,
  }
}

// 한 소스의 새 기준을 최신 기획으로 만든다(전체 fetch). files 해시는 작업 트리 파일이 아니라
// checkout된 commit의 git 객체 내용(git show)에 sha256을 적용해 기록한다.
function buildBaselineForSource(source) {
  const { dir, commit } = fetchLatestIntoCache(source)
  const selector = normalizeSelector(source)
  const files = {}
  for (const rel of selectSpecFilesBySelector(dir, selector)) {
    const shown = gitShowText(dir, commit, rel)
    if (shown === null) continue
    files[rel] = { sha: sha256Text(shown), commit }
  }
  return {
    repo: source.repo,
    ref: source.ref ?? null,
    commit,
    fetchedAt: new Date().toISOString(),
    selector,
    files,
  }
}

function summarizeBaselineChange(previousFiles, nextFiles) {
  const prevRels = Object.keys(previousFiles ?? {})
  const nextRels = Object.keys(nextFiles)
  return {
    changed: nextRels.filter((rel) => previousFiles?.[rel] && previousFiles[rel].sha !== nextFiles[rel].sha),
    added: nextRels.filter((rel) => !previousFiles?.[rel]),
    removed: prevRels.filter((rel) => !nextFiles[rel]),
    total: nextRels.length,
  }
}

function runFetch() {
  const state = readSpecState()
  if (!state.declared) {
    printNotConfigured()
    return
  }
  if (!state.valid) {
    printConfigErrors(state.errors)
    process.exitCode = 1
    return
  }

  const lockExists = fs.existsSync(lockPath)

  if (sourceFilter.length > 0) {
    const unknown = sourceFilter.filter((id) => !state.sources.some((source) => source.id === id))
    if (unknown.length > 0) {
      console.error(`선언에 없는 source입니다: ${unknown.join(', ')}`)
      process.exitCode = 1
      return
    }
    if (!moveBaseline) {
      console.error('--source는 --move-baseline과 함께 씁니다. (캐시 갱신은 소스 구분 없이 전체가 안전합니다)')
      process.exitCode = 1
      return
    }
  }

  if (atLock) {
    runRehydrateAtLock(state)
    return
  }

  // 최초 연동: lock이 없을 때만 무인자 fetch가 기준을 만든다.
  if (!lockExists) {
    const lockNorm = { exists: true, version: 2, sources: {}, hadV1: false }
    const summaries = []
    for (const source of state.sources) {
      let baseline
      try {
        baseline = buildBaselineForSource(source)
      } catch (error) {
        console.error('')
        console.error(`기획 저장소를 가져오지 못했습니다: ${source.id} (${source.repo})`)
        console.error(`원인: ${String(error.message ?? error).split('\n')[0]}`)
        console.error('확인: 저장소 주소, 브랜치 이름, 그리고 이 저장소에 대한 git 읽기 권한.')
        process.exitCode = 1
        return
      }
      lockNorm.sources[source.id] = { ...baseline, files: Object.fromEntries(Object.entries(baseline.files)) }
      summaries.push({ id: source.id, commit: baseline.commit, total: Object.keys(baseline.files).length })
    }

    writeJson(lockPath, serializeLock(lockNorm))

    console.log('기획 문서 동기화 완료')
    for (const summary of summaries) {
      console.log('')
      console.log(`- ${summary.id}: 문서 ${summary.total}건, commit ${summary.commit.slice(0, 10)}`)
      console.log('  최초 연동입니다. 매핑은 .harness/project/spec-map.md에 기록합니다.')
    }
    console.log('')
    console.log(`기준 시점은 ${toPosix(path.relative(repoRoot, lockPath))}에 기록했습니다. 이 파일은 커밋해서 팀과 공유합니다.`)
    console.log('스펙 본문은 캐시에만 두며 저장소에 커밋하지 않습니다.')
    return
  }

  if (moveBaseline) {
    runMoveBaseline(state)
    return
  }

  // lock이 있는 프로젝트의 무인자 fetch = cache-only. 팀 기준(도장)은 절대 움직이지 않는다.
  runCacheOnly(state, { explicitFlag: cacheOnly })
}

function runCacheOnly(state, { explicitFlag }) {
  const summaries = []
  for (const source of state.sources) {
    let fetched
    try {
      fetched = fetchLatestIntoCache(source)
    } catch (error) {
      console.error('')
      console.error(`기획 저장소를 가져오지 못했습니다: ${source.id} (${source.repo})`)
      console.error(`원인: ${String(error.message ?? error).split('\n')[0]}`)
      console.error('확인: 저장소 주소, 브랜치 이름, 그리고 이 저장소에 대한 git 읽기 권한.')
      process.exitCode = 1
      return
    }
    const recorded = state.lock.sources[source.id]
    const selector = recorded?.selector ?? normalizeSelector(source)
    const latest = {}
    for (const rel of selectSpecFilesBySelector(fetched.dir, selector)) {
      const shown = gitShowText(fetched.dir, fetched.commit, rel)
      if (shown !== null) latest[rel] = { sha: sha256Text(shown), commit: fetched.commit }
    }
    summaries.push({
      id: source.id,
      commit: fetched.commit,
      hasBaseline: Boolean(recorded),
      ...summarizeBaselineChange(recorded?.files, latest),
    })
  }

  console.log('기획 캐시 갱신 완료 (기준 이동 없음)')
  for (const summary of summaries) {
    console.log('')
    console.log(`- ${summary.id}: 문서 ${summary.total}건, 원격 commit ${summary.commit.slice(0, 10)}`)
    if (!summary.hasBaseline) {
      console.log(`  아직 기준에 편입되지 않은 소스입니다. 편입: npm run harness:spec:fetch -- --move-baseline --source ${summary.id}`)
      continue
    }
    const pending = summary.changed.length + summary.added.length + summary.removed.length
    if (pending === 0) {
      console.log('  기준 시점과 차이가 없습니다.')
      continue
    }
    console.log(`  기준 대비 미정산: 변경 ${summary.changed.length} / 추가 ${summary.added.length} / 삭제 ${summary.removed.length}`)
    for (const rel of [...summary.changed, ...summary.added].slice(0, 10)) {
      console.log(`    - ${rel}`)
    }
  }
  console.log('')
  console.log('기준(lock)은 옮기지 않았습니다. 살펴본 문서는 npm run harness:spec:settle 로 정산합니다.')
  if (!explicitFlag) {
    console.log('전체 기준 이동이 필요하면: npm run harness:spec:fetch -- --move-baseline [--source <id>]')
  }
}

function runMoveBaseline(state) {
  const targets = sourceFilter.length > 0 ? sourceFilter : state.sources.map((source) => source.id)
  const targetSet = new Set(targets)

  // 이동하지 않는 소스의 v1 항목은 검증 승격만 한다(내용 불변). 검증 불가면 결정적으로 중단한다.
  const failures = promoteV1Sources(state.lock, state.sources, { allowNetwork: true, skipSourceIds: targetSet })
  if (failures.length > 0) {
    printPromotionFailures(failures)
    process.exitCode = 1
    return
  }

  const summaries = []
  for (const source of state.sources) {
    if (!targetSet.has(source.id)) continue
    const previous = state.lock.sources[source.id]
    let baseline
    try {
      baseline = buildBaselineForSource(source)
    } catch (error) {
      console.error('')
      console.error(`기획 저장소를 가져오지 못했습니다: ${source.id} (${source.repo})`)
      console.error(`원인: ${String(error.message ?? error).split('\n')[0]}`)
      process.exitCode = 1
      return
    }
    summaries.push({ id: source.id, commit: baseline.commit, firstBaseline: !previous, ...summarizeBaselineChange(previous?.files, baseline.files) })
    state.lock.sources[source.id] = baseline
  }

  writeJson(lockPath, serializeLock(state.lock))

  console.log(`기준 이동 완료 (${targets.join(', ')})`)
  for (const summary of summaries) {
    console.log('')
    console.log(`- ${summary.id}: 문서 ${summary.total}건, commit ${summary.commit.slice(0, 10)}`)
    if (summary.firstBaseline) {
      console.log('  이 소스의 최초 기준입니다.')
      continue
    }
    console.log(`  변경 ${summary.changed.length} / 추가 ${summary.added.length} / 삭제 ${summary.removed.length}`)
    for (const rel of [...summary.changed, ...summary.added].slice(0, 10)) {
      console.log(`    - ${rel}`)
    }
  }
  console.log('')
  console.log(`기준 시점을 ${toPosix(path.relative(repoRoot, lockPath))}에 기록했습니다. 이 파일은 커밋해서 팀과 공유합니다.`)
  console.log('기준 이동은 "그 사이 기획 변경을 살펴봤다"는 선언입니다. 검토 결과를 decision-log에 남기세요.')
}

// --at-lock: lock이 기록한 정확한 파일 집합을 캐시에 복원한다(기준 이동 없음).
// base commit checkout 후, selector에 걸리지만 lock에 없는 파일(삭제 정산분, 이전 수화 잔재)을
// 제거하고, 모든 lock 문서를 기록된 commit에서 개별 수화한 뒤 sha까지 검증한다.
function runRehydrateAtLock(state) {
  if (!state.lock.exists) {
    console.error('기준 시점이 없어 --at-lock 수화를 할 수 없습니다.')
    console.error('먼저 npm run harness:spec:fetch 로 최초 기준을 만듭니다.')
    process.exitCode = 1
    return
  }

  const mismatches = []
  const summaries = []

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded?.commit) {
      console.error(`기준 시점이 없어 --at-lock 수화를 할 수 없습니다: ${source.id}`)
      console.error(`편입: npm run harness:spec:fetch -- --move-baseline --source ${source.id}`)
      process.exitCode = 1
      return
    }

    let dir
    try {
      dir = ensureCacheRepo(source)
      ensureCommitAvailable(dir, source, recorded.commit)
      runGit(['checkout', '--quiet', '--force', recorded.commit], dir)
    } catch (error) {
      console.error(`기획 저장소를 가져오지 못했습니다: ${source.id} (${source.repo})`)
      console.error(`원인: ${String(error.message ?? error).split('\n')[0]}`)
      process.exitCode = 1
      return
    }

    const selector = recorded.selector ?? normalizeSelector(source)

    // 1) lock에 없는 selector 대상 파일 제거 — 삭제 정산된 문서와 이전 수화의 잔재가 되살아나지 않게.
    for (const rel of selectSpecFilesBySelector(dir, selector)) {
      if (!recorded.files[rel]) {
        const abs = path.join(dir, rel)
        assertInsideCacheRoot(abs)
        fs.rmSync(abs, { force: true })
      }
    }

    // 2) 모든 lock 문서를 기록된 commit에서 수화하고 sha 검증.
    for (const [rel, value] of Object.entries(recorded.files)) {
      const docCommit = value.commit ?? recorded.commit
      try {
        ensureCommitAvailable(dir, source, docCommit)
      } catch (error) {
        mismatches.push({ id: source.id, rel, reason: String(error.message ?? error).split('\n')[0] })
        continue
      }
      const shown = gitShowText(dir, docCommit, rel)
      if (shown === null) {
        mismatches.push({ id: source.id, rel, reason: `commit ${String(docCommit).slice(0, 10)}에 문서가 없습니다` })
        continue
      }
      if (sha256Text(shown) !== value.sha) {
        mismatches.push({ id: source.id, rel, reason: '기록된 해시와 commit 내용이 다릅니다' })
        continue
      }
      const abs = path.join(dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, shown)
    }

    summaries.push({ id: source.id, commit: recorded.commit, total: Object.keys(recorded.files).length })
  }

  if (mismatches.length > 0) {
    console.error('기준 수화를 완료할 수 없습니다 (기준 기록과 기획 이력이 어긋남):')
    for (const item of mismatches) {
      console.error(`  - [${item.id}] ${item.rel}: ${item.reason}`)
    }
    console.error('변경 내용을 검토한 뒤 npm run harness:spec:fetch -- --move-baseline [--source <id>] 로 기준을 재생성하세요.')
    process.exitCode = 1
    return
  }

  console.log('기준 시점 수화 완료 (기준 이동 없음)')
  for (const summary of summaries) {
    console.log(`- ${summary.id}: 기준 commit ${summary.commit.slice(0, 10)} 문서 ${summary.total}건을 캐시에 복원했습니다.`)
  }
  console.log('')
  console.log('팀 기준(lock) 그대로의 본문입니다. 최신 기획 확인은 --cache-only, 기준 이동은 --move-baseline 을 사용합니다.')
}

// push 대기 중인 커밋 + 작업 트리의 변경 파일. settle의 기본 정산 범위를 만든다.
// 원격이 없는 저장소(테스트/초기)는 전체 커밋이 outgoing으로 잡히는데, 그것이 맞는 의미다.
function collectOutgoingFiles() {
  const files = new Set()
  try {
    const logged = runGit(['log', '--name-only', '--pretty=format:', 'HEAD', '--not', '--remotes'], repoRoot)
    for (const line of logged.split(/\r?\n/)) {
      if (line.trim()) files.add(toPosix(decodeGitPath(line.trim())))
    }
  } catch {
    // HEAD가 없는 빈 저장소 등 — 작업 트리 변경만 본다.
  }
  try {
    // --untracked-files=all: 새 디렉터리를 'src/'로 접지 않고 안의 파일까지 나열해야 매핑이 걸린다.
    const dirty = runGit(['status', '--porcelain', '--untracked-files=all'], repoRoot)
    for (const line of dirty.split(/\r?\n/)) {
      if (!line.trim()) continue
      const rel = line.slice(3).trim().split(' -> ').pop()
      if (rel) files.add(toPosix(decodeGitPath(rel)))
    }
  } catch {
    // git 저장소가 아니면 비워 둔다.
  }
  return [...files]
}

// 정산: 살펴본 기획 문서의 lock 기준을 현재 캐시 HEAD로 전진시킨다(그 문서만).
// "정산 = 그 변경을 우리가 확인했다"는 선언이므로, 범위 밖 문서(남의 몫)는 절대 건드리지 않는다.
// 기록 전에 provenance를 검증한다: 캐시 파일 해시 == 캐시 HEAD의 git 객체 내용 해시.
function runSettle({ docs = [] } = {}) {
  const state = readSpecState()
  if (!state.declared) {
    printNotConfigured()
    return
  }
  if (!state.valid) {
    printConfigErrors(state.errors)
    process.exitCode = 1
    return
  }
  if (!state.lock.exists) {
    console.error('기준 시점이 없습니다. 먼저 npm run harness:spec:fetch 로 최초 연동을 만듭니다.')
    process.exitCode = 1
    return
  }

  // settle은 오프라인 명령이다 — v1 승격도 로컬 git 객체로만 검증하고, 부족하면 중단·안내한다.
  // 승격에 성공하면 즉시 저장한다(변경 명령이므로 lock 기록 허용) — 매 실행 재검증을 피한다.
  const failures = promoteV1Sources(state.lock, state.sources, { allowNetwork: false })
  if (failures.length > 0) {
    printPromotionFailures(failures)
    process.exitCode = 1
    return
  }
  if (state.lock.hadV1) {
    writeJson(lockPath, serializeLock(state.lock))
    console.log('기준 형식을 v2로 승격했습니다 (내용 변화 없음 — 문서별 기준 commit 기록).')
  }

  const collisionRels = new Set(state.collisions.map((item) => item.rel))

  let scopeDocs = docs
  if (scopeDocs.length === 0) {
    const outgoing = collectOutgoingFiles()
    scopeDocs = mappedDocsForFiles(outgoing, state.entries).map((entry) => entry.spec)
  }

  if (scopeDocs.length === 0) {
    console.log('정산 범위가 비어 있습니다: push 대기 변경에 매핑된 기획 문서가 없습니다.')
    console.log('특정 문서를 명시하려면: npm run harness:spec:settle -- --doc <기획 문서 경로>')
    return
  }

  const settled = []
  const removed = []
  const unchanged = []
  const missing = []
  const refusedCollision = []
  const provenanceFailures = []

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded) continue
    const dir = cacheDirFor(source.id)
    if (!fs.existsSync(dir)) {
      console.error(`로컬 캐시가 없어 정산할 수 없습니다: ${source.id}`)
      console.error('먼저 npm run harness:spec:fetch -- --cache-only 로 최신 기획을 받은 뒤 다시 실행합니다.')
      process.exitCode = 1
      return
    }
    const cacheHead = runGit(['rev-parse', 'HEAD'], dir)

    for (const rel of scopeDocs) {
      if (collisionRels.has(rel)) {
        if (!refusedCollision.includes(rel)) refusedCollision.push(rel)
        continue
      }

      const abs = path.join(dir, rel)
      const inLock = rel in recorded.files
      const shown = gitShowText(dir, cacheHead, rel)

      if (!inLock) {
        if (shown !== null) {
          // 기준에 없지만 캐시 HEAD에 있는 신규 문서를 명시 정산하면 기준에 편입한다.
          recorded.files[rel] = { sha: sha256Text(shown), commit: cacheHead }
          settled.push(rel)
        } else if (!missing.includes(rel)) {
          missing.push(rel)
        }
        continue
      }

      if (shown === null) {
        // 기획에서 사라진 문서(HEAD에 없음) — 기준에서도 정리한다.
        delete recorded.files[rel]
        removed.push(rel)
        continue
      }

      const shownSha = sha256Text(shown)
      if (fs.existsSync(abs) && sha256Text(fs.readFileSync(abs, 'utf8')) !== shownSha) {
        provenanceFailures.push(rel)
        continue
      }

      if (recorded.files[rel].sha === shownSha && recorded.files[rel].commit === cacheHead) {
        unchanged.push(rel)
      } else if (recorded.files[rel].sha === shownSha) {
        // 내용 동일, 기준 commit만 전진 — 정산으로 기록한다(문서 기준이 그 시점으로 이동).
        recorded.files[rel] = { sha: shownSha, commit: cacheHead }
        unchanged.push(rel)
      } else {
        recorded.files[rel] = { sha: shownSha, commit: cacheHead }
        settled.push(rel)
      }
    }
  }

  if (provenanceFailures.length > 0) {
    console.error('캐시가 임의 수정되어 정산을 중단합니다 (기준에 손편집본이 들어가는 것을 막습니다):')
    for (const rel of provenanceFailures) {
      console.error(`  - ${rel}`)
    }
    console.error('npm run harness:spec:fetch -- --cache-only 로 캐시를 재수화한 뒤 다시 정산하세요.')
    process.exitCode = 1
    return
  }

  if (refusedCollision.length > 0) {
    console.error('여러 소스에 같은 경로가 있어 정산을 거부합니다 (어느 소스의 기준을 옮길지 모호합니다):')
    for (const rel of refusedCollision) {
      console.error(`  - ${rel} (${state.collisions.find((item) => item.rel === rel)?.sourceIds.join(', ')})`)
    }
    console.error('소스 선언의 include/exclude로 경로가 겹치지 않게 조정하세요. 활성 소스 전역에서 문서 상대경로는 유일해야 합니다.')
    process.exitCode = 1
    return
  }

  const realMissing = missing.filter((rel) => !settled.includes(rel) && !removed.includes(rel) && !unchanged.includes(rel))

  if (settled.length === 0 && removed.length === 0) {
    console.log('정산할 변경이 없습니다: 범위 안 문서가 이미 기준과 일치합니다.')
    for (const rel of unchanged.slice(0, 10)) {
      console.log(`  - [일치] ${rel}`)
    }
    for (const rel of realMissing) {
      console.log(`  - [없음] ${rel} — 기준에도 캐시에도 없는 문서입니다. 경로를 확인하세요.`)
    }
    if (realMissing.length > 0) process.exitCode = 1
    return
  }

  writeJson(lockPath, serializeLock(state.lock))

  console.log('기획 문서 정산 완료 (범위 안 문서만 기준 전진)')
  for (const rel of settled) {
    const linked = linkedCodePaths(rel, state.entries)
    console.log(`  - [정산] ${rel}${linked.length > 0 ? ` (연결 코드: ${linked.join(', ')})` : ''}`)
  }
  for (const rel of removed) {
    console.log(`  - [삭제 정산] ${rel} — 기획에서 사라진 문서입니다. spec-map.md의 해당 행을 정리하세요.`)
  }
  for (const rel of realMissing) {
    console.log(`  - [없음] ${rel} — 기준에도 캐시에도 없는 문서입니다. 경로를 확인하세요.`)
  }
  console.log('')
  console.log('정산은 "이 기획 변경을 살펴봤다"는 선언입니다. 코드 반영 또는 영향 없음 근거를 decision-log에 남기고,')
  console.log(`${toPosix(path.relative(repoRoot, lockPath))} 변경을 커밋에 포함해 다시 push 하세요.`)
  if (realMissing.length > 0) process.exitCode = 1
}

function runStatus() {
  const state = readSpecState()
  if (!state.declared) {
    printNotConfigured()
    return
  }
  if (!state.valid) {
    printConfigErrors(state.errors)
    process.exitCode = 1
    return
  }

  const diff = state.diff

  console.log('기획 문서 연동 상태')
  console.log('')

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    console.log(`- ${source.id}: ${source.repo}${source.ref ? ` (${source.ref})` : ''}`)
    if (!recorded) {
      console.log(`  기준 시점 없음 — npm run harness:spec:fetch${state.lock.exists ? ` -- --move-baseline --source ${source.id}` : ''} 로 먼저 편입합니다.`)
      continue
    }
    console.log(`  기준 commit: ${recorded.commit?.slice(0, 10) ?? '(없음)'} (${recorded.fetchedAt ?? '기록 없음'})`)
    console.log(`  기준 문서: ${Object.keys(recorded.files).length}건`)
    if (recorded.selector && !selectorsEqual(recorded.selector, normalizeSelector(source))) {
      console.log('  ⚠ 선언의 include/exclude가 기준 기록과 다릅니다 — 기준 재생성(--move-baseline) 검토 대상입니다.')
    }
  }

  if (state.lock.hadV1) {
    console.log('')
    console.log('lock이 v1 형식입니다. 다음 기준 변경(fetch --move-baseline 또는 settle)에서 검증 후 v2로 승격됩니다.')
  }

  if (state.collisions.length > 0) {
    console.log('')
    console.log('경로 충돌: 같은 문서 경로가 여러 소스에 있습니다 (매핑이 모호해집니다):')
    for (const item of state.collisions) {
      console.log(`  - ${item.rel} (${item.sourceIds.join(', ')})`)
    }
  }

  if (diff && diff.cacheMissing.length > 0) {
    console.log('')
    console.log(`로컬 캐시 없음: ${diff.cacheMissing.join(', ')}`)
    console.log('- 이 환경에서는 문서 본문을 아직 읽을 수 없습니다. 기준 시점 본문은 npm run harness:spec:fetch -- --at-lock 으로 받습니다.')
  }

  console.log('')
  console.log(`매핑: ${state.entries.length}건 (${specMapRel})`)

  if (diff && diff.changed + diff.added + diff.removed > 0) {
    console.log('')
    console.log('기준 시점 이후 캐시에서 감지된 변화:')
    for (const source of diff.sources) {
      for (const rel of source.changed) {
        const linked = linkedCodePaths(rel, state.entries)
        console.log(`  - [변경] ${rel}${linked.length > 0 ? ` → 연결 코드: ${linked.join(', ')}` : ' (매핑 없음)'}`)
      }
      for (const rel of source.added) {
        console.log(`  - [추가] ${rel} (매핑 검토 대상)`)
      }
      for (const rel of source.removed) {
        console.log(`  - [삭제] ${rel}${linkedCodePaths(rel, state.entries).length > 0 ? ' — 매핑이 남아 있습니다' : ''}`)
      }
    }
    console.log('')
    console.log('판단: 기획 변경이 구현에 영향을 주면 코드/테스트를 반영하고, 영향이 없으면 근거를 decision-log에 남깁니다.')
    console.log('살펴본 문서는 npm run harness:spec:settle 로 정산합니다. 전체 기준 이동은 --move-baseline 입니다.')
  } else if (state.lock.exists && diff && diff.cacheMissing.length === 0) {
    console.log('기준 시점과 캐시가 일치합니다.')
  }

  console.log('')
  console.log('원격 최신 여부는 이 명령이 확인하지 않습니다(네트워크 미사용). 최신 확인은 harness:spec:fetch -- --cache-only 입니다.')
}

function main() {
  if (mode === 'fetch') {
    const exclusive = [cacheOnly, atLock, moveBaseline].filter(Boolean).length
    if (exclusive > 1) {
      console.error('--cache-only / --at-lock / --move-baseline 은 함께 쓸 수 없습니다. (최신 확인 / 기준 수화 / 기준 이동)')
      process.exit(1)
    }
    runFetch()
    return
  }

  if (mode === 'settle') {
    runSettle({ docs: explicitDocs })
    return
  }

  if (mode === 'status') {
    if (jsonOutput) {
      const state = readSpecState()
      console.log(JSON.stringify({
        configured: state.configured,
        valid: state.valid,
        errors: state.errors,
        lockVersion: state.lock.exists ? (state.lock.hadV1 ? 1 : 2) : null,
        collisions: state.collisions,
        sources: state.sources.map((source) => ({ id: source.id, repo: source.repo, ref: source.ref ?? null })),
        mappings: state.entries.length,
        diff: state.diff,
      }, null, 2))
      return
    }
    runStatus()
    return
  }

  console.error(`Unknown mode: ${mode}`)
  console.error('사용법: node .harness/bin/spec-sync.mjs [fetch|status|settle] [--cache-only|--at-lock|--move-baseline] [--source <id>] [--doc <경로>] [--json]')
  process.exit(1)
}

if (process.argv[1]) {
  try {
    if (fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) {
      main()
    }
  } catch {
    if (path.resolve(process.argv[1]) === __filename) {
      main()
    }
  }
}
