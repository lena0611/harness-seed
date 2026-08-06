#!/usr/bin/env node

// 기획 문서 연동(Spec Authority) 런타임.
//
// 설계 전제 (2026-08-05 확정):
// - 기획팀은 코드도 하네스도 모른다. 기획 저장소에는 평범한 markdown만 있고 어떤 계약도 지지 않는다.
//   따라서 스펙 식별자는 파일 경로이며, registry/front-matter 같은 구조를 기획에 요구하지 않는다.
// - 스펙 본문은 코드 저장소에 vendoring하지 않는다. 캐시(.harness/generated/spec-cache/)에만 두고
//   커밋되는 것은 "어느 시점 기획을 기준으로 개발했는가"를 남기는 spec-lock.json뿐이다.
// - 연결고리(어느 기획 문서가 어느 코드인지)는 코드 저장소가 소유한다: .harness/project/spec-map.md.
// - fetch만 네트워크를 쓴다. status/검증은 lock과 캐시 비교로만 동작해 오프라인에서도 커밋이 막히지 않는다.

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
const explicitDocs = args.flatMap((value, index) => (value === '--doc' && args[index + 1] ? [args[index + 1]] : []))

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

function sha256Text(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

// 소스 id는 캐시 디렉터리 이름이 되므로 경로 탈출을 막는다.
function isSafeSourceId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..'
}

function readSources() {
  const config = readJson(sourcesPath)
  if (!config) return { declared: false, sources: [] }

  const sources = Array.isArray(config.sources) ? config.sources : []
  return { declared: true, sources: sources.filter((source) => source && source.repo) }
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
function selectSpecFiles(sourceDir, source) {
  const include = source.include?.length > 0 ? source.include : ['**/*.md']
  const exclude = source.exclude ?? []
  return walkFiles(sourceDir)
    .filter((rel) => matchesAny(rel, include))
    .filter((rel) => !matchesAny(rel, exclude))
    .sort()
}

function hashSpecFiles(sourceDir, files) {
  const map = {}
  for (const rel of files) {
    map[rel] = sha256Text(fs.readFileSync(path.join(sourceDir, rel), 'utf8'))
  }
  return map
}

function runGit(argsToRun, cwd) {
  return execFileSync('git', argsToRun, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

// 기획 저장소는 read-only로만 다룬다. 캐시에 clone/fetch만 하고 push하지 않는다.
function fetchSource(source) {
  const dir = path.join(cacheRoot, source.id)
  const ref = source.ref || 'HEAD'

  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    runGit(['clone', '--quiet', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), source.repo, dir], repoRoot)
  } else {
    runGit(['fetch', '--quiet', '--depth', '1', 'origin', ref], dir)
    runGit(['checkout', '--quiet', '--force', 'FETCH_HEAD'], dir)
  }

  return {
    dir,
    commit: runGit(['rev-parse', 'HEAD'], dir),
  }
}

// 기획 저장소를 lock에 기록된 commit 그대로 받는다(수화 전용 — 기준 이동 없음).
// 얕은 clone에 그 commit이 없으면 전체 이력을 받아서라도 checkout한다.
function fetchSourceAtCommit(source, commit) {
  const dir = path.join(cacheRoot, source.id)
  const ref = source.ref || 'HEAD'

  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    runGit(['clone', '--quiet', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), source.repo, dir], repoRoot)
  }

  try {
    runGit(['checkout', '--quiet', '--force', commit], dir)
  } catch {
    try {
      runGit(['fetch', '--quiet', '--depth', '1', 'origin', commit], dir)
      runGit(['checkout', '--quiet', '--force', 'FETCH_HEAD'], dir)
    } catch {
      try {
        runGit(['fetch', '--quiet', '--unshallow', 'origin', ref], dir)
      } catch {
        runGit(['fetch', '--quiet', 'origin', ref], dir)
      }
      runGit(['checkout', '--quiet', '--force', commit], dir)
    }
  }

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

export function readSpecMapEntries() {
  const abs = path.join(repoRoot, specMapRel)
  if (!fs.existsSync(abs)) return []

  // critical-paths.md와 같은 표 파싱 관례를 따른다: | 기획 문서 | 구현 경로 | 비고 |
  return fs.readFileSync(abs, 'utf8')
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

// lock에 기록된 해시와 현재 캐시를 비교한다. 네트워크를 쓰지 않으므로 오프라인에서도 동작한다.
function diffAgainstLock(lock) {
  const result = { sources: [], changed: 0, added: 0, removed: 0, cacheMissing: [] }
  const { sources } = readSources()

  for (const source of sources) {
    const recorded = lock?.sources?.[source.id]
    const dir = path.join(cacheRoot, source.id)

    if (!fs.existsSync(dir)) {
      result.cacheMissing.push(source.id)
      continue
    }

    const files = selectSpecFiles(dir, source)
    const current = hashSpecFiles(dir, files)
    const previous = recorded?.files ?? {}

    const changed = files.filter((rel) => previous[rel] && previous[rel] !== current[rel])
    const added = files.filter((rel) => !previous[rel])
    const removed = Object.keys(previous).filter((rel) => !current[rel])

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

function runFetch({ cacheOnly = false, atLock = false } = {}) {
  const { declared, sources } = readSources()
  if (!declared || sources.length === 0) {
    printNotConfigured()
    return
  }

  const lock = readJson(lockPath, { version: 1, sources: {} })
  const nextLock = { version: 1, sources: { ...(lock.sources ?? {}) } }
  const summaries = []

  for (const source of sources) {
    if (!isSafeSourceId(source.id)) {
      console.error(`source id가 안전하지 않습니다: ${source.id} (영문/숫자/._- 만 허용)`)
      process.exitCode = 1
      return
    }

    const recordedCommit = nextLock.sources[source.id]?.commit
    if (atLock && !recordedCommit) {
      console.error(`기준 시점이 없어 --at-lock 수화를 할 수 없습니다: ${source.id}`)
      console.error('먼저 npm run harness:spec:fetch 로 기준을 만듭니다(최초 연동은 팀 기준 이동을 겸합니다).')
      process.exitCode = 1
      return
    }

    let fetched
    try {
      fetched = atLock ? fetchSourceAtCommit(source, recordedCommit) : fetchSource(source)
    } catch (error) {
      console.error('')
      console.error(`기획 저장소를 가져오지 못했습니다: ${source.id} (${source.repo})`)
      console.error(`원인: ${String(error.message ?? error).split('\n')[0]}`)
      console.error('확인: 저장소 주소, 브랜치 이름, 그리고 이 저장소에 대한 git 읽기 권한.')
      process.exitCode = 1
      return
    }

    const files = selectSpecFiles(fetched.dir, source)
    const current = hashSpecFiles(fetched.dir, files)
    const previous = nextLock.sources[source.id]?.files ?? {}

    summaries.push({
      id: source.id,
      commit: fetched.commit,
      total: files.length,
      changed: files.filter((rel) => previous[rel] && previous[rel] !== current[rel]),
      added: files.filter((rel) => !previous[rel]),
      removed: Object.keys(previous).filter((rel) => !current[rel]),
      firstFetch: !nextLock.sources[source.id],
    })

    nextLock.sources[source.id] = {
      repo: source.repo,
      ref: source.ref ?? null,
      commit: fetched.commit,
      fetchedAt: new Date().toISOString(),
      files: current,
    }
  }

  if (atLock) {
    console.log('기준 시점 수화 완료 (기준 이동 없음)')
    for (const summary of summaries) {
      console.log(`- ${summary.id}: 기준 commit ${summary.commit.slice(0, 10)} 본문 ${summary.total}건을 캐시에 받았습니다.`)
    }
    console.log('')
    console.log('팀 기준(lock) 그대로의 본문입니다. 최신 기획 확인은 --cache-only, 기준 이동은 fetch를 사용합니다.')
    return
  }

  if (cacheOnly) {
    console.log('기획 캐시 갱신 완료 (기준 이동 없음)')
    for (const summary of summaries) {
      console.log('')
      console.log(`- ${summary.id}: 문서 ${summary.total}건, 원격 commit ${summary.commit.slice(0, 10)}`)
      if (summary.firstFetch) {
        console.log('  기준 시점이 아직 없습니다. 기준을 만들려면 npm run harness:spec:fetch 를 실행합니다.')
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
    return
  }

  writeJson(lockPath, nextLock)

  console.log('기획 문서 동기화 완료')
  for (const summary of summaries) {
    console.log('')
    console.log(`- ${summary.id}: 문서 ${summary.total}건, commit ${summary.commit.slice(0, 10)}`)
    if (summary.firstFetch) {
      console.log('  최초 연동입니다. 매핑은 .harness/project/spec-map.md에 기록합니다.')
      continue
    }
    console.log(`  변경 ${summary.changed.length} / 추가 ${summary.added.length} / 삭제 ${summary.removed.length}`)
    for (const rel of [...summary.changed, ...summary.added].slice(0, 10)) {
      console.log(`    - ${rel}`)
    }
  }

  console.log('')
  console.log(`기준 시점은 ${toPosix(path.relative(repoRoot, lockPath))}에 기록했습니다. 이 파일은 커밋해서 팀과 공유합니다.`)
  console.log('스펙 본문은 캐시에만 두며 저장소에 커밋하지 않습니다.')
  console.log('주의: fetch는 팀 기준 이동입니다. 본문만 받으려면 --at-lock(기준 시점) 또는 --cache-only(최신 확인)를 사용합니다.')
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

// 정산: 살펴본 기획 문서의 lock 해시를 현재 캐시 값으로 전진시킨다(그 문서만).
// "정산 = 그 변경을 우리가 확인했다"는 선언이므로, 범위 밖 문서(남의 몫)는 절대 건드리지 않는다.
function runSettle({ docs = [] } = {}) {
  const { declared, sources } = readSources()
  if (!declared || sources.length === 0) {
    printNotConfigured()
    return
  }

  const lock = readJson(lockPath)
  if (!lock?.sources) {
    console.error('기준 시점이 없습니다. 먼저 npm run harness:spec:fetch 로 최초 연동을 만듭니다.')
    process.exitCode = 1
    return
  }

  const entries = readSpecMapEntries()
  let scopeDocs = docs
  if (scopeDocs.length === 0) {
    const outgoing = collectOutgoingFiles()
    scopeDocs = mappedDocsForFiles(outgoing, entries).map((entry) => entry.spec)
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

  for (const source of sources) {
    const recorded = lock.sources[source.id]
    if (!recorded?.files) continue
    const dir = path.join(cacheRoot, source.id)
    if (!fs.existsSync(dir)) {
      console.error(`로컬 캐시가 없어 정산할 수 없습니다: ${source.id}`)
      console.error('먼저 npm run harness:spec:fetch -- --cache-only 로 최신 기획을 받은 뒤 다시 실행합니다.')
      process.exitCode = 1
      return
    }

    for (const rel of scopeDocs) {
      if (!(rel in recorded.files)) {
        const abs = path.join(dir, rel)
        if (fs.existsSync(abs)) {
          // 기준에는 없지만 캐시에 있는 신규 문서를 명시 정산하면 기준에 편입한다.
          recorded.files[rel] = sha256Text(fs.readFileSync(abs, 'utf8'))
          settled.push(rel)
        } else if (!missing.includes(rel)) {
          missing.push(rel)
        }
        continue
      }

      const abs = path.join(dir, rel)
      if (!fs.existsSync(abs)) {
        delete recorded.files[rel]
        removed.push(rel)
        continue
      }

      const currentSha = sha256Text(fs.readFileSync(abs, 'utf8'))
      if (recorded.files[rel] === currentSha) {
        unchanged.push(rel)
      } else {
        recorded.files[rel] = currentSha
        settled.push(rel)
      }
    }
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

  writeJson(lockPath, lock)

  console.log('기획 문서 정산 완료 (범위 안 문서만 기준 전진)')
  for (const rel of settled) {
    const linked = linkedCodePaths(rel, entries)
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
  const { declared, sources } = readSources()
  if (!declared || sources.length === 0) {
    printNotConfigured()
    return
  }

  const lock = readJson(lockPath)
  const entries = readSpecMapEntries()
  const diff = diffAgainstLock(lock)

  console.log('기획 문서 연동 상태')
  console.log('')

  for (const source of sources) {
    const recorded = lock?.sources?.[source.id]
    console.log(`- ${source.id}: ${source.repo}${source.ref ? ` (${source.ref})` : ''}`)
    if (!recorded) {
      console.log('  기준 시점 없음 — npm run harness:spec:fetch 로 먼저 가져옵니다.')
      continue
    }
    console.log(`  기준 commit: ${recorded.commit.slice(0, 10)} (${recorded.fetchedAt})`)
    console.log(`  기준 문서: ${Object.keys(recorded.files ?? {}).length}건`)
  }

  if (diff.cacheMissing.length > 0) {
    console.log('')
    console.log(`로컬 캐시 없음: ${diff.cacheMissing.join(', ')}`)
    console.log('- 이 환경에서는 문서 본문을 아직 읽을 수 없습니다. npm run harness:spec:fetch 를 실행하세요.')
  }

  console.log('')
  console.log(`매핑: ${entries.length}건 (${specMapRel})`)

  if (diff.changed + diff.added + diff.removed > 0) {
    console.log('')
    console.log('기준 시점 이후 캐시에서 감지된 변화:')
    for (const source of diff.sources) {
      for (const rel of source.changed) {
        const linked = linkedCodePaths(rel, entries)
        console.log(`  - [변경] ${rel}${linked.length > 0 ? ` → 연결 코드: ${linked.join(', ')}` : ' (매핑 없음)'}`)
      }
      for (const rel of source.added) {
        console.log(`  - [추가] ${rel} (매핑 검토 대상)`)
      }
      for (const rel of source.removed) {
        console.log(`  - [삭제] ${rel}${linkedCodePaths(rel, entries).length > 0 ? ' — 매핑이 남아 있습니다' : ''}`)
      }
    }
    console.log('')
    console.log('판단: 기획 변경이 구현에 영향을 주면 코드/테스트를 반영하고, 영향이 없으면 근거를 decision-log에 남깁니다.')
    console.log('기준 시점을 새 기획으로 옮기려면 npm run harness:spec:fetch 를 다시 실행합니다.')
  } else if (lock) {
    console.log('기준 시점과 캐시가 일치합니다.')
  }

  console.log('')
  console.log('원격 최신 여부는 이 명령이 확인하지 않습니다(네트워크 미사용). 최신화는 harness:spec:fetch로 실행합니다.')
}

// 다른 하네스 스크립트(build-context, policy-harness)가 쓰는 조회 API.
export function readSpecState() {
  const { declared, sources } = readSources()
  const lock = readJson(lockPath)
  const entries = readSpecMapEntries()
  return {
    configured: declared && sources.length > 0,
    sources,
    lock,
    entries,
    cacheRoot,
    diff: declared && sources.length > 0 ? diffAgainstLock(lock) : null,
  }
}

function main() {
  if (mode === 'fetch') {
    if (cacheOnly && atLock) {
      console.error('--cache-only와 --at-lock은 함께 쓸 수 없습니다. (최신 확인 vs 기준 시점 수화)')
      process.exit(1)
    }
    runFetch({ cacheOnly, atLock })
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
  console.error('사용법: node .harness/bin/spec-sync.mjs [fetch|status|settle] [--cache-only|--at-lock] [--doc <경로>] [--json]')
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
