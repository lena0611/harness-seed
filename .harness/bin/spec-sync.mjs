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
// 저장 공간 세 자리(0.2.103):
//  - cacheRoot   : 팀 기준(lock) 본문 전용. 쓰는 주체는 hydrate/--at-lock 둘뿐이다.
//                  **정본은 lock이고 캐시는 그 사본이다** — 수화가 실패하면 어긋난 채 남고,
//                  그 소스는 컨텍스트 주입에서 제외된다(계약을 구현보다 세게 쓰지 않는다, 재리뷰 P2-4).
//  - git objects : 최신 확인용(캐시 저장소의 .git). 작업 트리를 checkout하지 않는다.
//  - latestRoot  : 사람이 읽는 최신 사본 + manifest. settle이 정산하는 "검토 스냅샷"의 근거다.
// 셋 다 generated 산출물이라 git 추적 대상이 아니며 지워도 재생성된다.
const generatedRoot = path.join(harnessRoot, 'generated')
const cacheRoot = path.join(generatedRoot, 'spec-cache')
const specMapRel = '.harness/project/spec-map.md'

const args = process.argv.slice(2)
const mode = args[0] ?? 'status'
const jsonOutput = args.includes('--json')
const cacheOnly = args.includes('--cache-only')
const atLock = args.includes('--at-lock')
const moveBaseline = args.includes('--move-baseline')
const explicitDocs = args.flatMap((value, index) => (value === '--doc' && args[index + 1] ? [args[index + 1]] : []))
const sourceFilter = args.flatMap((value, index) => (value === '--source' && args[index + 1] ? [args[index + 1]] : []))

// 상태 파일 읽기는 "없음"과 "깨짐"을 반드시 구분한다.
// 둘을 하나의 fallback으로 뭉개면 spec-sources.json이 깨진 프로젝트가 "연동 안 함"으로 보이고,
// spec-lock.json이 깨진 프로젝트가 "기준 없음"으로 축소되어 에이전트가 기획 없이 작업한다
// — 손상이 조용한 무력화로 바뀌는 fail-open이다(0.2.103 재리뷰 P1-3).
export function readJsonStrict(absPath) {
  let text
  try {
    text = fs.readFileSync(absPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, valid: true, value: null, error: null }
    return { exists: true, valid: false, value: null, error: `읽을 수 없습니다: ${String(error.message ?? error).split('\n')[0]}` }
  }
  try {
    return { exists: true, valid: true, value: JSON.parse(text), error: null }
  } catch (error) {
    return { exists: true, valid: false, value: null, error: `JSON 형식이 아닙니다: ${String(error.message ?? error).split('\n')[0]}` }
  }
}

// 손상 판정이 필요 없는 보조 캐시(수화 상태 기록) 전용. 핵심 상태 파일에는 쓰지 않는다.
function readJsonSoft(absPath, fallback = null) {
  const read = readJsonStrict(absPath)
  return read.exists && read.valid ? read.value : fallback
}

// 임시 파일 + rename. spec-lock.json은 커밋되는 파일이라, 쓰다가 죽어 반쪽 JSON이 남으면
// 팀 공유 기록이 파괴된다(그리고 그 상태는 이제 fail-closed라 작업 자체가 막힌다).
function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  const tmp = path.join(path.dirname(absPath), `.tmp-${path.basename(absPath)}-${process.pid}-${nextTempId()}`)
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
    fs.renameSync(tmp, absPath)
  } catch (error) {
    fs.rmSync(tmp, { force: true }) // 추적 디렉터리에 임시 파일을 남기지 않는다.
    throw error
  }
}

let tempCounter = 0
function nextTempId() {
  tempCounter += 1
  return tempCounter
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
    if (normalizeScreenLinks(source) === null) {
      errors.push(`source '${source.id}'의 screenLinks 선언이 올바르지 않습니다 — [".html"] 형태의 확장자 배열이어야 합니다.`)
    }
  }

  if (raw.length === 0) {
    errors.push('spec-sources.json에 source가 없습니다.')
  }

  return { declared: true, sources: errors.length === 0 ? raw : [], errors }
}

// 화면 기획 쌍 계약(0.2.103): 기획자와 합의한 저장 규칙을 실행 계약으로 옮긴 것.
//
//   features/로그인.md   ← 정책·동작 기준
//   features/로그인.html ← 와이어프레임
//
// 이 둘은 **하나의 화면 기획**이다. 따로 정산하면 "정책은 B, 화면은 A" 같은 혼합 기준이 생겨
// 에이전트가 서로 안 맞는 두 문서를 근거로 구현한다. 그래서 한 단위로 묶어 함께 정산한다.
// `features/` 밖의 공통 정책 MD는 짝이 필요 없다 — 경로로 구분한다(향후 화면이 아닌 문서가
// features/에 들어가면 경로만으로 구분할 수 없으므로 그때 documentType 메타데이터를 도입한다).
const DEFAULT_SCREEN_LINK_EXTENSIONS = ['.html']

function isExtension(value) {
  return typeof value === 'string' && /^\.[A-Za-z0-9]+$/.test(value)
}

// 선언에 screenLinks가 없으면 기본값(.html). `"screenLinks": []`로 끈다.
export function normalizeScreenLinks(source) {
  const raw = source?.screenLinks
  if (raw === undefined || raw === null) return [...DEFAULT_SCREEN_LINK_EXTENSIONS]
  if (!Array.isArray(raw) || !raw.every(isExtension)) return null
  return [...new Set(raw)].sort()
}

export function screenLinksEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// 기준 기록에 남은 계약이 있으면 그것을 쓴다(선언이 바뀌어도 기준 시점 판정은 그 시점 계약으로).
// 선언↔기록 불일치는 findDeclarationLockIssues가 따로 잡는다.
function screenLinksFor(recorded, source) {
  return recorded?.screenLinks ?? normalizeScreenLinks(source) ?? []
}

// markdown 본문에서 같은 저장소 안의 화면 파일 링크를 뽑는다.
//
// 화면 여부를 **경로 관례가 아니라 문서가 선언한 링크**로 판정한다: 관련 화면이 있으면 링크가 있고,
// 정책만 다루는 문서에는 링크가 없다. 경로로 판정하면 `features/README.md` 같은 안내 문서까지
// 화면으로 잡히고, 기획팀은 하네스 때문에 폴더 관례를 배워야 한다.
// 외부 URL·절대 경로·앵커는 대상이 아니다(저장소 안의 파일만 검증할 수 있다).
export function extractScreenLinks(mdRel, content, extensions) {
  if (!extensions || extensions.length === 0 || typeof content !== 'string') return []
  const targets = new Set()
  const baseDir = path.posix.dirname(mdRel)
  const patterns = [/\]\(\s*([^)\s]+)/g, /<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi]

  // 코드로 표기한 것은 링크가 아니다. 기획 저장소 안내문은 "이렇게 링크하세요"라는 **예시**를
  // 코드 블록에 담는데, 그걸 실제 링크로 읽으면 안내문 자체가 연동 오류를 낸다(실물 E2E에서 발견).
  const body = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')

  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const raw = String(match[1] ?? '').trim()
      if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#') || raw.startsWith('/')) continue
      const cleaned = decodeURIComponent(raw.split('#')[0].split('?')[0])
      if (!cleaned || !extensions.some((ext) => cleaned.toLowerCase().endsWith(ext.toLowerCase()))) continue

      const resolved = path.posix.normalize(baseDir === '.' ? cleaned : `${baseDir}/${cleaned}`)
      if (resolved.startsWith('../') || resolved.startsWith('/') || resolved === '..') continue
      try {
        assertSafeRelPath(resolved)
      } catch {
        continue
      }
      targets.add(resolved)
    }
  }
  return [...targets].sort()
}

// 문서 집합의 화면 링크 관계를 한 번에 만든다. 판정·선택·정산 단위가 모두 이 색인을 공유한다.
export function buildScreenIndex(relPaths, readContent, extensions) {
  const linksByDoc = new Map()
  const ownerByScreen = new Map()
  const unreadable = new Set()
  const isScreen = (rel) => extensions.some((ext) => rel.toLowerCase().endsWith(ext.toLowerCase()))

  for (const rel of relPaths) {
    if (!rel.toLowerCase().endsWith('.md')) continue
    const content = readContent(rel)
    if (typeof content !== 'string') {
      // 본문을 못 읽으면 그 문서가 무엇을 링크하는지 알 수 없다. "링크가 없다"로 단정하면
      // 아직 수화되지 않은 상태에서 멀쩡한 화면이 "떠도는 파일"로 잡힌다(실측).
      unreadable.add(rel)
      continue
    }
    const links = extractScreenLinks(rel, content, extensions)
    if (links.length === 0) continue
    linksByDoc.set(rel, links)
    for (const screen of links) {
      if (!ownerByScreen.has(screen)) ownerByScreen.set(screen, rel)
    }
  }

  return {
    linksByDoc,
    ownerByScreen,
    unreadable,
    isScreen,
    // 한 문서를 정산·판정할 때 함께 다뤄야 하는 경로 전부.
    unitFor(rel) {
      const owner = linksByDoc.has(rel) ? rel : ownerByScreen.get(rel)
      if (!owner) return null
      return { id: owner, primary: owner, screens: linksByDoc.get(owner) ?? [], files: [owner, ...(linksByDoc.get(owner) ?? [])] }
    },
  }
}

// 무결성: 문서가 링크한 화면이 실제로 있어야 하고, 어떤 문서도 참조하지 않는 화면 파일은 없어야 한다.
// 순수 함수라 fetch·최신 확인·정산·상태·push 게이트·기획 저장소 CI가 같은 판정을 공유한다.
export function findScreenLinkIssues(relPaths, index, screenCandidates = null) {
  const present = new Set(relPaths)
  const issues = []
  for (const [doc, links] of index.linksByDoc) {
    for (const screen of links) {
      if (!present.has(screen)) issues.push({ kind: 'missing-screen', doc, screen })
    }
  }
  // 읽지 못한 문서가 하나라도 있으면 "아무도 참조하지 않는다"를 증명할 수 없다 — 판정하지 않는다.
  if ((index.unreadable?.size ?? 0) === 0) {
    // 후보는 저장소 전체의 화면 파일이다. 선택된 집합만 보면 링크되지 않은 화면이 아예 안 보인다.
    for (const rel of (screenCandidates ?? relPaths.filter((item) => index.isScreen(item)))) {
      if (!index.ownerByScreen.has(rel)) issues.push({ kind: 'orphan-screen', screen: rel })
    }
  }
  return issues.sort((a, b) => `${a.screen}`.localeCompare(`${b.screen}`))
}

export function formatScreenLinkIssues(issues) {
  return issues.map((issue) => (
    issue.kind === 'missing-screen'
      ? `${issue.doc} 이(가) 링크한 화면 ${issue.screen} 이(가) 저장소에 없습니다.`
      : `${issue.screen} 을(를) 참조하는 기획 문서가 없습니다 (떠도는 화면 파일).`
  ))
}

export function normalizeSelector(source) {
  const include = Array.isArray(source?.include) && source.include.length > 0 ? [...source.include] : ['**/*.md']
  const exclude = Array.isArray(source?.exclude) ? [...source.exclude] : []
  return { include: [...new Set(include)].sort(), exclude: exclude.sort() }
}

export function selectorsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

const SHA256_RE = /^[0-9a-f]{64}$/
const COMMIT_RE = /^[0-9a-f]{7,64}$/

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// lock schema 검증. **JSON으로 읽힌다는 것과 기준으로 쓸 수 있다는 것은 다르다.**
//
// normalizeLock은 형태가 어긋난 문서 항목을 조용히 버린다. 그 관용이 게이트 우회가 됐다 —
// `"features/로그인.md": { "sha": 123 }` 처럼 값 하나만 망가뜨리면 파싱은 성공하고, 선언↔lock
// 정합도 통과하며, 그 문서가 기준에서 사라져 push 게이트의 drift 검사가 통째로 건너뛰어졌다
// (0.2.103 3차 리뷰 P1-1). 그래서 **항목 하나라도 어긋나면 lock 전체를 invalid**로 본다.
//
// 부재(null)는 손상이 아니다 — 아직 연동하지 않은 프로젝트다.
export function validateLockSchema(rawLock) {
  const errors = []
  if (rawLock === null || rawLock === undefined) return errors
  if (!isPlainObject(rawLock)) return ['spec-lock.json이 객체가 아닙니다.']
  if (rawLock.version !== undefined && rawLock.version !== 1 && rawLock.version !== 2) {
    errors.push(`spec-lock.json의 version이 유효하지 않습니다: ${JSON.stringify(rawLock.version)} (1 또는 2)`)
  }
  if (!isPlainObject(rawLock.sources)) return [...errors, 'spec-lock.json의 sources가 객체가 아닙니다.']

  for (const [id, recorded] of Object.entries(rawLock.sources)) {
    const where = `spec-lock.json source '${id}'`
    if (!isSafeSourceId(id)) errors.push(`${where} — id가 안전하지 않습니다(영문/숫자/._- 만 허용).`)
    if (!isPlainObject(recorded)) {
      errors.push(`${where} — 객체가 아닙니다.`)
      continue
    }
    if (recorded.repo !== undefined && recorded.repo !== null && (typeof recorded.repo !== 'string' || !recorded.repo.trim())) {
      errors.push(`${where} — repo가 비어 있지 않은 문자열이 아닙니다.`)
    }
    if (recorded.ref !== undefined && recorded.ref !== null && typeof recorded.ref !== 'string') {
      errors.push(`${where} — ref가 문자열이 아닙니다.`)
    }
    if (recorded.fetchedAt !== undefined && recorded.fetchedAt !== null && typeof recorded.fetchedAt !== 'string') {
      errors.push(`${where} — fetchedAt이 문자열이 아닙니다.`)
    }
    if (recorded.commit !== undefined && recorded.commit !== null && !COMMIT_RE.test(String(recorded.commit))) {
      errors.push(`${where} — commit 형식이 올바르지 않습니다: ${JSON.stringify(recorded.commit)}`)
    }
    if (recorded.selector !== undefined && recorded.selector !== null) {
      const selector = recorded.selector
      const valid = isPlainObject(selector)
        && Array.isArray(selector.include) && selector.include.every((item) => typeof item === 'string')
        && Array.isArray(selector.exclude) && selector.exclude.every((item) => typeof item === 'string')
      if (!valid) errors.push(`${where} — selector 형식이 올바르지 않습니다(include/exclude 문자열 배열).`)
    }
    if (recorded.screenLinks !== undefined && recorded.screenLinks !== null && normalizeScreenLinks(recorded) === null) {
      errors.push(`${where} — screenLinks 기록 형식이 올바르지 않습니다.`)
    }
    if (!isPlainObject(recorded.files)) {
      errors.push(`${where} — files가 객체가 아닙니다.`)
      continue
    }

    for (const [rel, value] of Object.entries(recorded.files)) {
      const doc = `${where} 문서 '${rel}'`
      try {
        assertSafeRelPath(rel)
      } catch {
        errors.push(`${doc} — 문서 경로가 안전하지 않습니다.`)
        continue
      }
      if (typeof value === 'string') {
        if (!SHA256_RE.test(value)) errors.push(`${doc} — v1 sha 형식이 올바르지 않습니다(sha256 64자리).`)
        else if (!recorded.commit) errors.push(`${doc} — v1 항목인데 소스의 기준 commit이 없습니다.`)
        continue
      }
      if (!isPlainObject(value)) {
        errors.push(`${doc} — 항목이 sha 문자열도 {sha, commit} 객체도 아닙니다.`)
        continue
      }
      if (typeof value.sha !== 'string' || !SHA256_RE.test(value.sha)) {
        errors.push(`${doc} — sha 형식이 올바르지 않습니다(sha256 64자리): ${JSON.stringify(value.sha)}`)
      }
      const commit = value.commit ?? recorded.commit
      if (commit === undefined || commit === null || !COMMIT_RE.test(String(commit))) {
        errors.push(`${doc} — 기준 commit이 없거나 형식이 올바르지 않습니다.`)
      }
    }
  }

  return errors
}

// lock v1(문서별 sha 문자열) → v2(문서별 {sha, commit}) 메모리 정규화.
// v1 문서의 commit은 소스의 기준 commit으로 본다(부분 정산 이전의 유일한 기준).
// 이 함수는 절대 파일을 쓰지 않는다 — 읽기 경로가 그대로 써도 안전하다.
// **전제: validateLockSchema를 통과한 입력.** 검증 없이 부르면 어긋난 항목이 조용히 사라진다.
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
      screenLinks: recorded?.screenLinks ?? null,
      files,
    }
  }
  return { exists: true, version: rawLock.version ?? 1, sources, hadV1 }
}

// 선언↔기준(lock) 정합 판정. 순수 함수라 작업 트리(doc-link)와 push tip snapshot(게이트)이
// 같은 규칙을 공유한다(0.2.102 재리뷰 P1-5) — 한쪽만 검사하면 정상인 작업 트리로 검사를 통과시키고
// 불일치 상태를 push할 수 있다.
export function findDeclarationLockIssues(sources, lockNorm) {
  const issues = []

  for (const source of sources) {
    const recorded = lockNorm?.sources?.[source.id]
    if (!recorded) {
      issues.push(`source '${source.id}' — 선언은 있지만 기준 시점(spec-lock)이 없습니다.`)
      continue
    }
    if (recorded.repo && recorded.repo !== source.repo) {
      issues.push(`source '${source.id}' — 선언 repo와 기준 기록이 다릅니다 (기준: ${recorded.repo}).`)
    }
    if ((recorded.ref ?? null) !== (source.ref ?? null)) {
      issues.push(`source '${source.id}' — 선언 ref(${source.ref ?? '기본'})와 기준 기록(${recorded.ref ?? '기본'})이 다릅니다.`)
    }
    if (recorded.selector && !selectorsEqual(recorded.selector, normalizeSelector(source))) {
      issues.push(`source '${source.id}' — include/exclude 선언이 기준 기록과 다릅니다.`)
    }
    if (recorded.screenLinks && !screenLinksEqual(recorded.screenLinks, normalizeScreenLinks(source))) {
      issues.push(`source '${source.id}' — 화면 링크(screenLinks) 선언이 기준 기록과 다릅니다.`)
    }
  }

  for (const lockId of Object.keys(lockNorm?.sources ?? {})) {
    if (!sources.some((source) => source.id === lockId)) {
      issues.push(`spec-lock의 source '${lockId}' — 선언(spec-sources.json)에서 사라졌습니다.`)
    }
  }

  return issues
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
// 특정 commit의 트리에서 selector에 걸리는 문서를 고른다(작업 트리와 무관).
// 0.2.103부터 캐시 작업 트리는 기준 본문 전용이라, "어느 commit의 목록인가"를 명시해야 한다.
// selector 적용. 기획 문서가 링크한 화면 파일은 include에 없어도 선택된다 — 링크한 화면이
// 선택되지 않으면 "연동은 됐는데 와이어프레임만 없는" 상태가 되고, 그건 무결성 검사가 매번 실패하는
// 상태다. exclude는 그대로 적용한다(README·견본·archive는 링크 대상이어도 제외).
function applySelector(names, selector, { readContent = null, extensions = [] } = {}) {
  const included = new Set(names.filter((rel) => matchesAny(rel, selector.include)))
  if (readContent && extensions.length > 0) {
    const present = new Set(names)
    const index = buildScreenIndex([...included], readContent, extensions)
    for (const links of index.linksByDoc.values()) {
      for (const screen of links) {
        if (present.has(screen)) included.add(screen)
      }
    }
  }
  return [...included].filter((rel) => !matchesAny(rel, selector.exclude)).sort()
}

// 실패를 빈 배열로 바꾸면 "모든 문서가 삭제됨"으로 보여 기준을 통째로 비울 수 있다 —
// 목록을 못 읽는 것과 목록이 비어 있는 것은 다르다(0.2.103 자체 검토 P3-8).
function listNamesAtCommit(dir, commit, options = {}) {
  return runGit(['ls-tree', '-r', '--name-only', commit], dir, { ...options, maxBuffer: 64 * 1024 * 1024 })
    .split('\n').map((line) => decodeGitPath(line.trim())).filter(Boolean)
}

// 저장소 안의 화면 파일 후보 전체(exclude 적용). 어떤 문서도 링크하지 않은 화면을 찾으려면
// **선택된 집합이 아니라 저장소 전체**를 봐야 한다 — include가 `**/*.md`뿐이면 링크되지 않은
// 화면은 선택 자체가 안 되어 "링크 깜빡함"이 영영 드러나지 않는다(4차 리뷰 P2-1).
export function screenCandidatesAtCommit(dir, commit, selector, extensions, options = {}) {
  if (!extensions || extensions.length === 0) return []
  return listNamesAtCommit(dir, commit, options)
    .filter((rel) => extensions.some((ext) => rel.toLowerCase().endsWith(ext.toLowerCase())))
    .filter((rel) => !matchesAny(rel, selector.exclude))
    .sort()
}

export function selectSpecFilesAtCommit(dir, commit, selector, options = {}) {
  const names = listNamesAtCommit(dir, commit, options)
  return applySelector(names, selector, {
    readContent: (rel) => gitShowText(dir, commit, rel),
    extensions: options.screenLinks ?? [],
  })
}

export function selectSpecFilesBySelector(sourceDir, selector, extensions = []) {
  return applySelector(walkFiles(sourceDir), selector, {
    readContent: (rel) => {
      try {
        return readSafeFile(sourceDir, rel)
      } catch {
        return null
      }
    },
    extensions,
  })
}

// 어떤 commit의 문서 집합에 대한 화면 링크 색인(판정·정산 단위 공유).
export function screenIndexAtCommit(dir, commit, files, extensions) {
  return buildScreenIndex(files, (rel) => gitShowText(dir, commit, rel), extensions)
}

function runGit(argsToRun, cwd, options = {}) {
  return execFileSync('git', argsToRun, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // 큰 기획 저장소의 ls-tree가 기본 1MiB 상한에 걸려 "빈 트리"로 오인되지 않게 넉넉히 잡는다.
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
  }).trim()
}

// git show 결과에 우리 해시 함수를 그대로 적용한다. git blob object id(sha1/sha256 + 헤더)와
// content sha256은 다른 값이므로 절대 직접 비교하지 않는다.
export function gitShowText(dir, commit, rel) {
  try {
    // maxBuffer: 큰 화면 프로토타입 HTML이 기본 1MiB 상한에 걸리면 "문서 없음"으로 오인된다
    // (실전: 기획팀의 3.5MB 화면 파일이 기준에서 조용히 빠졌다 — ls-tree에만 넣고 여기를 빠뜨린 0.2.103의 반쪽 수정).
    return execFileSync('git', ['show', `${commit}:${rel}`], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    // "그 시점에 문서가 없다"만 null이다. 그 외(버퍼 초과, spawn 실패 등)를 null로 뭉개면
    // 실패가 삭제·부재로 둔갑한다 — 부재와 실패의 구분은 이 모듈의 반복 교훈이다.
    const message = String(error?.stderr ?? error?.message ?? '')
    if (/does not exist|exists on disk, but not in|invalid object name|bad revision|bad object/i.test(message)) {
      return null
    }
    throw new Error(`git show ${String(commit).slice(0, 10)}:${rel} 실패: ${message.split('\n')[0] || error?.code || '알 수 없음'}`)
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

function isShallowRepo(dir) {
  try {
    return runGit(['rev-parse', '--is-shallow-repository'], dir) === 'true'
  } catch {
    return true // 판정 못 하면 얕다고 본다(관대한 쪽이 아니라 "모른다" 쪽).
  }
}

// 기준 전진 방향 판정. **정산은 앞으로만 간다.**
//
// baseSha compare-and-swap은 "읽은 뒤 기준이 움직였는가"만 본다. 목표 commit이 현재 기준보다
// **과거**인지는 보지 않으므로, 실제로 존재하는 옛 commit(A)의 본문·sha로 스냅샷을 갈아끼우면
// provenance도 CAS도 통과하며 기준이 B→A로 후퇴한다(0.2.103 3차 리뷰 P1-2).
//
// 캐시가 전체 이력을 갖기 때문에(ensureCacheRepo) 조상 관계로 확정할 수 있다.
// 증명할 수 없으면('unknown') **허용하지 않는다** — 얕은 캐시에서 관대하게 넘기면 이 검사 자체가
// 무의미해진다(실측: 옛 `--depth 1` 캐시에서는 후퇴가 그대로 통과했다).
export function commitDirection(dir, current, target) {
  if (!current || current === target) return 'same'
  if (!commitAvailable(dir, target)) return 'unknown-target'
  if (!commitAvailable(dir, current)) return 'unknown-base'

  const isAncestor = (ancestor, descendant) => {
    try {
      runGit(['merge-base', '--is-ancestor', ancestor, descendant], dir)
      return true
    } catch {
      return false
    }
  }
  if (isAncestor(target, current)) return 'behind'
  if (isAncestor(current, target)) return 'ahead'
  return isShallowRepo(dir) ? 'unknown' : 'diverged'
}

// 보호 루트를 "실제 디렉터리"로 확정한다.
//
// path.resolve는 심볼릭 링크를 해소하지 않는다. 따라서 보호 루트 자체(generated, spec-cache/<id>,
// spec-latest/<id>)가 외부를 가리키는 링크면, 그 아래 자식 검사는 전부 무의미해진다 —
// 정상 자식처럼 통과하고 쓰기는 링크가 가리키는 곳으로 나간다(0.2.103 재리뷰 P1-2).
// 그래서 루트부터 leaf까지 같은 규칙(lstat 기반 링크 거부)을 적용한다.
function realDirectory(abs, label, { create = true } = {}) {
  let stat = null
  try {
    stat = fs.lstatSync(abs)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (stat?.isSymbolicLink()) throw new Error(`${label}이(가) 심볼릭 링크입니다(허용하지 않음): ${abs}`)
  if (stat && !stat.isDirectory()) throw new Error(`${label}이(가) 디렉터리가 아닙니다: ${abs}`)
  if (!stat) {
    if (!create) return null
    fs.mkdirSync(abs, { recursive: true })
  }
  return abs
}

let generatedRealRootCache = null
function generatedRealRoot() {
  if (generatedRealRootCache) return generatedRealRootCache
  realDirectory(generatedRoot, '.harness/generated')
  // 링크가 아님을 확인한 뒤에만 realpath를 취한다(부모 쪽 /var→/private/var 같은 정상 링크는 흡수).
  generatedRealRootCache = fs.realpathSync(generatedRoot)
  return generatedRealRootCache
}

// '+'는 source id 허용 문자가 아니라 어떤 소스와도 이름이 겹치지 않는다(교체용 임시 공간).
const STAGING_DIR_NAME = '+staging'

function storageDirFor(kind, sourceId, { create = false } = {}) {
  if (!isSafeSourceId(sourceId)) {
    throw new Error(`source id가 안전하지 않습니다: ${sourceId}`)
  }
  const kindRoot = realDirectory(path.join(generatedRealRoot(), kind), `${kind} 루트`)
  const dir = path.join(kindRoot, sourceId)
  return realDirectory(dir, `${kind}/${sourceId}`, { create }) ?? dir
}

const stagingSwept = new Set()
function stagingDirFor(kind, name) {
  const kindRoot = realDirectory(path.join(generatedRealRoot(), kind), `${kind} 루트`)
  const stagingRoot = realDirectory(path.join(kindRoot, STAGING_DIR_NAME), `${kind}/${STAGING_DIR_NAME}`)
  // 교체 도중 죽으면 잔재가 남는다. 이번 실행의 첫 호출에서 남의 잔재만 한 번 쓸어낸다
  // (내 것을 지우면 방금 만든 staging이 사라진다 — 매 호출 정리는 하면 안 된다).
  if (!stagingSwept.has(kind)) {
    stagingSwept.add(kind)
    for (const entry of fs.readdirSync(stagingRoot)) {
      if (entry.includes(`-${process.pid}-`)) continue
      fs.rmSync(path.join(stagingRoot, entry), { recursive: true, force: true })
    }
  }
  return path.join(stagingRoot, name)
}

// 삭제·교체는 반드시 해당 보호 루트 내부만. source id 검증과 별개의 마지막 방어선.
function assertInsideRealRoot(kind, abs) {
  const root = path.join(generatedRealRoot(), kind)
  const resolved = path.resolve(abs)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`경로가 ${kind} 밖을 가리킵니다: ${abs}`)
  }
}

function assertInsideCacheRoot(dir) {
  assertInsideRealRoot('spec-cache', dir)
}

// 기획 저장소가 주는 경로(lock의 files 키, selector 결과)는 신뢰할 수 없는 입력이다.
// 어휘적 join만으로는 심볼릭 링크를 통해 루트 밖으로 쓰거나 읽을 수 있다 — 기획 저장소에
// `features/x.md -> ../../../../spec-lock.json` 링크 하나면 커밋된 기준 파일이 파괴된다(0.2.103 리뷰 실증).
//
// 방어 순서: ① 경로 문자열 자체 거부 ② resolve 경계 확인 ③ 루트~부모의 각 구성요소 lstat로
// 심볼릭 링크 거부. 존재하지 않는 대상은 realpath를 쓸 수 없으므로 구성요소를 하나씩 본다.
export function assertSafeRelPath(rel) {
  const value = String(rel ?? '')
  if (!value) throw new Error('빈 경로는 허용하지 않습니다.')
  if (value.includes('\0')) throw new Error(`경로에 NUL이 있습니다: ${JSON.stringify(value)}`)
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) throw new Error(`절대 경로는 허용하지 않습니다: ${value}`)
  const segments = value.split(/[\\/]/)
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`허용되지 않는 경로 구성요소가 있습니다: ${value}`)
    }
  }
  return segments
}

// root 아래의 안전한 절대 경로를 만든다. 보호 루트 자신과 모든 중간 디렉터리가 실제 디렉터리여야 한다.
// allowLeafSymlink: 쓰기 경로 전용 — 마지막 요소가 링크면 따라가지 않고 그 자리를 교체한다.
export function safeJoinUnderRoot(root, rel, { allowLeafSymlink = false } = {}) {
  const segments = assertSafeRelPath(rel)
  const resolvedRoot = path.resolve(root)
  realDirectory(resolvedRoot, '보호 루트', { create: false })
  let current = resolvedRoot

  for (let i = 0; i < segments.length; i += 1) {
    current = path.join(current, segments[i])
    const isLeaf = i === segments.length - 1
    let stat
    try {
      stat = fs.lstatSync(current)
    } catch {
      continue // 아직 없는 경로는 이후 생성 시점에 다시 검사된다.
    }
    if (stat.isSymbolicLink()) {
      if (isLeaf && allowLeafSymlink) continue
      throw new Error(`${isLeaf ? '대상' : '중간 디렉터리'}가 심볼릭 링크입니다(허용하지 않음): ${rel}`)
    }
    if (!isLeaf && !stat.isDirectory()) {
      throw new Error(`경로 중간이 디렉터리가 아닙니다: ${rel}`)
    }
  }

  if (current !== resolvedRoot && !current.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`경로가 허용 범위를 벗어납니다: ${rel}`)
  }
  return current
}

// 링크를 따라가지 않고 일반 파일만 읽는다.
export function readRegularFile(abs) {
  const stat = fs.lstatSync(abs)
  if (stat.isSymbolicLink()) throw new Error(`심볼릭 링크는 읽지 않습니다: ${abs}`)
  if (!stat.isFile()) throw new Error(`일반 파일이 아닙니다: ${abs}`)
  return fs.readFileSync(abs, 'utf8')
}

// 읽기도 쓰기와 같은 API를 쓴다. root부터 leaf까지 한 번에 검사해야 "쓰기는 막고 읽기는 뚫리는"
// 비대칭이 생기지 않는다(재리뷰 P1-2 — build-context가 path.join+readFileSync로 링크를 따라가던 문제).
export function readSafeFile(root, rel) {
  return readRegularFile(safeJoinUnderRoot(root, rel))
}

// 임시 파일에 쓴 뒤 rename으로 교체한다.
// - rename은 대상이 링크여도 링크를 따라가지 않고 그 자리를 교체한다(검사~쓰기 사이 교체 방어).
// - 부분 기록 상태가 남지 않는다.
export function writeRegularFile(root, rel, content) {
  const abs = safeJoinUnderRoot(root, rel, { allowLeafSymlink: true })
  const dir = path.dirname(abs)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.tmp-write-${process.pid}-${nextTempId()}`)
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx' })
    fs.renameSync(tmp, abs)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
  return abs
}

// 링크를 따라가지 않고 지운다(대상이 링크면 링크만 사라진다).
function removeSafeFile(root, rel) {
  fs.rmSync(safeJoinUnderRoot(root, rel, { allowLeafSymlink: true }), { force: true })
}

function cacheDirFor(sourceId, options) {
  return storageDirFor('spec-cache', sourceId, options)
}

// 다른 하네스 스크립트(build-context 등)가 기준 본문을 읽는 유일한 경로.
// 경로 계산을 바깥에 두면 containment 규칙이 곧 갈라진다.
export function specCacheDirPath(sourceId) {
  try {
    return cacheDirFor(sourceId)
  } catch {
    return null
  }
}

export function readSpecCacheDoc(sourceId, rel) {
  try {
    return readSafeFile(cacheDirFor(sourceId), rel)
  } catch {
    return null
  }
}

// 캐시 저장소를 보장한다. 선언 repo와 캐시 origin이 다르면(저장소 이전) 옛 origin을 계속
// fetch해서 불일치를 숨기지 않도록, containment 검증 후 지우고 새 repo로 다시 clone한다.
function ensureCacheRepo(source, options = {}) {
  // create: 루트가 실제 디렉터리임을 확인하며 만든다(링크면 여기서 거부된다).
  const dir = cacheDirFor(source.id, { create: true })
  assertInsideCacheRoot(dir)

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
  // --no-checkout: clone은 기본적으로 ref tip을 작업 트리에 펼친다. 기준 본문 전용 디렉터리에
  // 최신 내용이 깔리면 "기준 본문 전용" 계약이 깨진다(0.2.103 자체 검토 P1-3). 본문은 수화가 채운다.
  //
  // 얕게(--depth 1) 받지 않는다: 기준 commit과 목표 commit의 **조상 관계를 증명할 수 없으면**
  // 정산이 과거로 되돌아가는 것을 막을 수 없다(3차 리뷰 P1-2). 기획 저장소는 markdown뿐이라
  // 전체 이력을 받아도 작고, 그 대가로 "정산은 앞으로만 간다"가 추측이 아니라 보장이 된다.
  runGit(['clone', '--quiet', '--no-checkout', ...(source.ref ? ['--branch', source.ref] : []), source.repo, dir], repoRoot, options)
  return dir
}

// 옛 버전이 얕게 받아둔 캐시를 만나면 이력을 채운다. 실패는 무해하다 — 판정 단계가 거부한다.
function ensureFullHistory(dir, source, options = {}) {
  if (!isShallowRepo(dir)) return
  try {
    runGit(['fetch', '--quiet', '--unshallow', 'origin', source.ref || 'HEAD'], dir, options)
  } catch {
    // 오프라인이거나 서버가 거부 — commitDirection이 'unknown'으로 판정해 정산을 막는다.
  }
}

// 특정 commit의 객체를 캐시 저장소에 확보한다(수화·마이그레이션용). 네트워크를 쓸 수 있다.
function ensureCommitAvailable(dir, source, commit, options = {}) {
  if (commitAvailable(dir, commit)) return
  const ref = source.ref || 'HEAD'
  try {
    runGit(['fetch', '--quiet', '--depth', '1', 'origin', commit], dir, options)
  } catch {
    try {
      runGit(['fetch', '--quiet', '--unshallow', 'origin', ref], dir, options)
    } catch {
      runGit(['fetch', '--quiet', 'origin', ref], dir, options)
    }
  }
  if (!commitAvailable(dir, commit)) {
    throw new Error(`기획 저장소에서 commit ${commit.slice(0, 10)}을 찾을 수 없습니다 (${source.id})`)
  }
}

// 최신 ref를 git 객체로만 받는다. **작업 트리는 건드리지 않는다**(0.2.103 캐시 역할 분리).
//
// 종전에는 여기서 checkout까지 해서, `--cache-only`(최신 보기)와 자동 수화(기준 복원)가
// 같은 작업 트리를 반대 방향으로 덮어썼다. 나중에 실행된 쪽이 이겨 settle이 "변경 없음"으로
// 끝나는 치명적 결함이 있었다(실증). 이제 spec-cache 작업 트리는 기준 전용이다.
export function fetchLatestCommit(source, options = {}) {
  const dir = ensureCacheRepo(source, options)
  const ref = source.ref || 'HEAD'
  ensureFullHistory(dir, source, options)
  runGit(['fetch', '--quiet', 'origin', ref], dir, options)
  return { dir, commit: runGit(['rev-parse', 'FETCH_HEAD'], dir, options) }
}

// 사람이 읽을 최신 본문을 spec-latest에 꺼낸다. 어느 commit의 어떤 내용을 읽었는지 manifest에 남겨,
// settle이 "실행 시점의 원격 최신"이 아니라 "실제로 검토한 스냅샷"만 정산하도록 만든다(리뷰 P1-1).
export function materializeLatest(source, commit, relPaths, dir, { deletedPaths = [], lockedFiles = null } = {}) {
  const entries = {}
  const staged = []

  for (const rel of relPaths) {
    const content = gitShowText(dir, commit, rel)
    if (content === null) continue
    staged.push({ rel, content, sha: sha256Text(content) })
  }

  // 삭제도 "확인한 사실"이다 — 본문은 없지만 그 시점을 스냅샷으로 남겨야 settle이 기준에서 정리할 수 있다.
  for (const rel of deletedPaths) {
    entries[rel] = { deleted: true, commit, baseSha: lockedFiles?.[rel]?.sha ?? null }
  }

  // 최신 사본 디렉터리는 manifest와 **정확히 같은 집합**이어야 한다.
  // 이전 확인의 본문을 남겨두면 도구는 "삭제됨/정산됨"이라 판정하는데, 안내받은 폴더를 연 사람은
  // 그 옛 본문을 현행 사양으로 읽는다 — 도구와 디렉터리가 서로 다른 사실을 말한다(재리뷰 P1-4).
  // 새 디렉터리를 완성한 뒤 통째로 바꿔치기해, 중간 실패가 반쪽 상태로 남지 않게 한다.
  const sourceRoot = latestDirFor(source.id)
  const staging = stagingDirFor('spec-latest', `new-${source.id}-${process.pid}-${nextTempId()}`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  try {
    for (const item of staged) {
      writeRegularFile(staging, item.rel, item.content)
      // baseSha: 이 스냅샷을 만들 때의 기준 값. settle이 "그 사이 기준이 안 바뀌었는가"를 확인하는 근거다
      // (compare-and-swap). 기준이 다른 경로로 움직였으면 이 스냅샷은 낡은 것이므로 적용하면 안 된다.
      entries[item.rel] = { sha: item.sha, commit, baseSha: lockedFiles?.[item.rel]?.sha ?? null }
    }
    // 기록을 **디렉터리 안에** 넣어 rename 한 번으로 본문과 기록을 함께 확정한다.
    // 밖에 두고 따로 쓰면 그 사이에 죽었을 때 "새 디렉터리 + 옛 기록"이 남아
    // "기록과 정확히 같은 집합" 계약이 정상 완료 경로에서만 참이 된다(4차 리뷰 P2-3).
    writeSourceManifest(staging, {
      repo: source.repo,
      ref: source.ref ?? null,
      commit,
      materializedAt: new Date().toISOString(),
      files: entries,
    })
    swapDirectory(staging, sourceRoot)
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }

  return { root: sourceRoot, files: entries }
}

// 완성된 디렉터리로 교체한다. 디렉터리 교체는 단일 원자 연산이 없으므로 rename 두 번으로 하되,
// 중간에 죽어도 다음 실행이 정리할 수 있게 잔재를 staging 아래에만 남긴다.
function swapDirectory(staging, target) {
  assertInsideRealRoot('spec-latest', target)
  const trash = stagingDirFor('spec-latest', `old-${path.basename(target)}-${process.pid}-${nextTempId()}`)
  fs.rmSync(trash, { recursive: true, force: true })

  let hadTarget = false
  try {
    fs.renameSync(target, trash)
    hadTarget = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    fs.renameSync(staging, target)
  } catch (error) {
    if (hadTarget) fs.renameSync(trash, target) // 되돌린다 — 옛 사본이라도 남는 편이 빈 디렉터리보다 낫다.
    throw error
  }
  fs.rmSync(trash, { recursive: true, force: true })
}

// 소스별 기록은 그 소스의 최신 사본 디렉터리 안에 둔다 — 본문과 기록이 한 번의 rename으로 확정된다.
const SOURCE_MANIFEST_NAME = '.manifest.json'

function writeSourceManifest(rootDir, entry) {
  fs.writeFileSync(path.join(rootDir, SOURCE_MANIFEST_NAME), `${JSON.stringify(entry, null, 2)}\n`)
}

function readSourceManifest(sourceId) {
  const root = specLatestDirPath(sourceId)
  if (!root) return null
  const read = readJsonStrict(path.join(root, SOURCE_MANIFEST_NAME))
  if (!read.exists) return null
  if (!read.valid || !isPlainObject(read.value)) {
    throw new Error(`최신 확인 기록(${toPosix(path.relative(repoRoot, path.join(root, SOURCE_MANIFEST_NAME)))})이 손상되었습니다 — ${read.error ?? '객체가 아닙니다'}`)
  }
  return read.value
}

function listLatestSourceIds() {
  let root
  try {
    root = realDirectory(path.join(generatedRealRoot(), 'spec-latest'), 'spec-latest 루트')
  } catch {
    return []
  }
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== STAGING_DIR_NAME && isSafeSourceId(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

// 소비되었거나 무효가 된 스냅샷을 제거한다. 남은 집합으로 디렉터리를 다시 만들어 통째로 교체하므로
// 본문과 기록이 어긋난 중간 상태가 없다(4차 리뷰 P2-3).
function dropLatestSnapshots(manifest, rels) {
  const target = new Set(rels)
  if (target.size === 0) return
  for (const [sourceId, entry] of Object.entries(manifest.sources ?? {})) {
    const hit = Object.keys(entry.files ?? {}).filter((rel) => target.has(rel))
    if (hit.length === 0) continue
    for (const rel of hit) delete entry.files[rel]

    const sourceRoot = specLatestDirPath(sourceId)
    if (!sourceRoot) continue
    const staging = stagingDirFor('spec-latest', `prune-${sourceId}-${process.pid}-${nextTempId()}`)
    fs.rmSync(staging, { recursive: true, force: true })
    fs.mkdirSync(staging, { recursive: true })
    try {
      for (const [rel, snapshot] of Object.entries(entry.files ?? {})) {
        if (snapshot?.deleted) continue
        let content = null
        try {
          content = readSafeFile(sourceRoot, rel)
        } catch {
          content = null
        }
        if (content === null) {
          // 본문을 못 읽으면 기록에서도 뺀다. 건너뛰기만 하면 "기록에는 있는데 파일은 없는" 상태가
          // 되어 방금 고친 exact-set 계약이 다시 깨진다(자체 검토).
          delete entry.files[rel]
          continue
        }
        writeRegularFile(staging, rel, content)
      }
      writeSourceManifest(staging, entry)
      swapDirectory(staging, sourceRoot)
    } catch {
      fs.rmSync(staging, { recursive: true, force: true })
      // 교체 실패 시 옛 상태가 그대로 남는다 — 다음 최신 확인이 통째로 다시 만든다.
    }
  }
}


function latestDirFor(sourceId, options) {
  return storageDirFor('spec-latest', sourceId, options)
}

export function specLatestDirPath(sourceId) {
  try {
    return latestDirFor(sourceId)
  } catch {
    return null
  }
}

// manifest는 "무엇을 읽었는가"의 유일한 기록이자 settle의 근거다. 손상을 빈 객체로 바꾸면
// 미정산 기록이 조용히 사라지고 정산 대상이 없는 것처럼 보인다 — 명시적 오류로 올린다(재리뷰 P1-3).
// allowReset: 이번 실행이 모든 소스를 다시 기록하는 경로(--cache-only)에서만 손상 파일을 새로 만든다.
export function readLatestManifest({ allowReset = false } = {}) {
  const sources = {}
  let reset = false
  for (const sourceId of listLatestSourceIds()) {
    try {
      const entry = readSourceManifest(sourceId)
      if (entry) sources[sourceId] = entry
    } catch (error) {
      // 소스 하나의 기록이 깨졌다고 나머지를 못 읽는 것은 아니다. 다만 조용히 넘기면
      // 미정산이 사라지므로, 재작성 경로가 아니면 명시적 실패로 올린다(재리뷰 P1-3).
      if (!allowReset) throw error
      reset = true
    }
  }
  return { version: 2, sources, ...(reset ? { reset: true } : {}) }
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

// 매핑 표에는 대표 문서 한 줄만 적는다(`features/로그인.md`). 개발자가 MD와 HTML을 각각
// 매핑하게 만들지 않는다 — 같은 단위의 짝은 하네스가 자동으로 포함한다(기획자 합의 계약).
export function expandMappedSpecs(specs, screenIndex) {
  const out = []
  for (const spec of specs) {
    for (const file of (screenIndex?.unitFor(spec)?.files ?? [spec])) {
      if (!out.includes(file)) out.push(file)
    }
  }
  return out
}

// "판정 완료" 표기: 사람이 검토한 결과 짝이 필요 없다고 결론 낸 상태를 1급으로 기록한다.
// - 기획 문서 칸이 (사양 없음)  → 그 코드 경로는 기획 문서 대상이 아님(유틸/인프라 등)
// - 구현 경로 칸이 (코드 없음)  → 그 기획 문서는 구현 대상이 아님(운영 안내 등)
// 미판정("아직 아무도 안 봤다")과 구분하기 위한 장치다. 괄호는 반각/전각 모두 허용한다.
const EXEMPT_TOKEN = /^[(（]\s*(사양\s*없음|코드\s*없음|해당\s*없음|없음)\s*[)）]$/

export function isExemptCell(value) {
  return EXEMPT_TOKEN.test(String(value ?? '').trim())
}

// spec-map 표 파싱. 텍스트 기반이라 push 게이트가 tip snapshot 내용에도 같은 파서를 쓴다.
// 판정 행(exempt)은 매핑이 아니라 "검토 완료" 선언이므로 entries가 아니라 exemptions로 분리한다.
export function parseSpecMapExemptions(text) {
  if (typeof text !== 'string') return { specs: [], codePaths: [] }
  const specs = []
  const codePaths = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|') || line.includes('---') || /기획 문서/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 2) continue
    const spec = cells[0].replaceAll('`', '').trim()
    const code = cells[1].replaceAll('`', '').trim()
    if (isExemptCell(spec) && code && !isExemptCell(code)) {
      // (사양 없음) | src/utils/** → 이 코드 경로는 기획 문서가 필요 없다고 판정됨
      codePaths.push(...code.split(',').map((item) => item.replaceAll('`', '').trim()).filter(Boolean))
    } else if (isExemptCell(code) && spec && !isExemptCell(spec)) {
      // features/운영안내.md | (코드 없음) → 이 문서는 구현 대상이 아니라고 판정됨
      specs.push(spec)
    }
  }
  return { specs, codePaths }
}

export function parseSpecMapText(text) {
  if (typeof text !== 'string') return []
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !/기획 문서/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2)
    .filter((cells) => !isExemptCell(cells[0]) && !isExemptCell(cells[1]))
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
  try {
    return parseSpecMapText(fs.readFileSync(abs, 'utf8'))
  } catch {
    return [] // 읽을 수 없는 매핑 표는 정합 검사가 별도로 잡는다. 여기서 죽이지 않는다.
  }
}

export function readSpecMapExemptions() {
  const abs = path.join(repoRoot, specMapRel)
  if (!fs.existsSync(abs)) return { specs: [], codePaths: [] }
  try {
    return parseSpecMapExemptions(fs.readFileSync(abs, 'utf8'))
  } catch {
    return { specs: [], codePaths: [] }
  }
}

// 매핑 커버리지: "이미 매핑된 영역에 새로 생긴 파일인데 매핑도 판정도 없는 것"을 찾는다.
//
// 전체 코드에서 미매핑을 세면 스캐폴드·유틸·설정까지 걸려 신호가 잡음에 묻힌다(score-print 교훈).
// 그래서 판정 범위를 **이미 매핑이 있는 디렉터리(와 그 하위)**로 좁힌다. 그 영역은 개발팀이
// "여기 있는 것은 기획 문서와 짝을 이룬다"고 이미 선언한 곳이므로, 새 파일에 매핑이 없으면
// 십중팔구 기록 누락이다. 판정 행((사양 없음))이 있으면 그것도 '검토됨'으로 본다.
// 매핑된 코드 경로에서 "관리 영역"을 뽑는다.
// - 매핑 자신의 기준 디렉터리(파일이면 그 디렉터리, 글롭이면 * 앞 접두)
// - 그 부모 디렉터리 — 기능별 폴더의 형제(src/views/login 옆의 src/views/payment)를 잡기 위함
// 두 경우 모두 깊이 2 이상만 채택한다. 'src' 같은 최상위를 영역으로 잡으면 유틸·설정까지 걸려
// 신호가 잡음에 묻힌다(score-print P4 교훈).
export function collectManagedAreas(entries) {
  const areas = new Set()
  const depth = (value) => value.split('/').filter(Boolean).length
  for (const entry of entries) {
    for (const mapPath of entry.codePaths) {
      const starIndex = mapPath.indexOf('*')
      const rawBase = starIndex === -1 ? mapPath : mapPath.slice(0, starIndex)
      const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : path.posix.dirname(rawBase)
      if (!base || base === '.' || base === '/') continue
      if (depth(base) >= 2) areas.add(base)
      const parent = path.posix.dirname(base)
      if (parent && parent !== '.' && parent !== '/' && depth(parent) >= 2) areas.add(parent)
    }
  }
  return areas
}

// 검사 대상은 "이번에 추가되거나 수정된 파일" 전부다(0.2.102 리뷰 P1-4).
// 신규 파일만 보면, 매핑이 없는 기존 파일을 계속 고치는 동안 아무 안내도 없이 사각지대가 유지된다
// (기존 파일 수정은 매핑 advisory가 처리한다고 봤지만, 그 파일이 미매핑이면 advisory도 안 걸린다).
export function analyzeMappingCoverage(addedFiles, entries, exemptions) {
  if (addedFiles.length === 0 || entries.length === 0) return []

  const managedDirs = collectManagedAreas(entries)
  if (managedDirs.size === 0) return []

  const inManagedArea = (filePath) => [...managedDirs].some((dir) => filePath === dir || filePath.startsWith(`${dir}/`))
  const isExempt = (filePath) => exemptions.codePaths.some((mapPath) => codePathMatches(filePath, mapPath))
  const isMapped = (filePath) => entries.some((entry) => entry.codePaths.some((mapPath) => codePathMatches(filePath, mapPath)))

  return addedFiles
    .filter((filePath) => inManagedArea(filePath))
    .filter((filePath) => !isMapped(filePath))
    .filter((filePath) => !isExempt(filePath))
    .sort()
}

// gate 전용 강한 커버리지(0.2.105): 이번 push의 **구현 파일 전부**가 매핑 또는 판정을 가져야 한다.
//
// 위의 관리영역 축소판은 advisory용 잡음 방지다(score-print P4 — 전체를 세면 유틸·설정이 신호를
// 묻는다). 그런데 그 축소가 gate에서는 우회가 됐다: 매핑이 0건이거나 **기존 매핑 영역 밖**에
// 새 코드를 만들면 검사 자체가 없었다(5차 리뷰 P1-1 — "시작을 알려주는 것"까지만 있고
// "시작 매핑을 반드시 남기게 하는 것"이 없었다). gate는 팀이 준비됐다고 선언한 모드이므로
// 전수 판정을 요구하고, `(사양 없음)` 디렉터리 판정이 잡음 밸브가 된다(한 번 판정하면 끝).
const NON_IMPLEMENTATION_PREFIXES = ['.harness/', '.githooks/', '.github/', '.claude/', '.codex/', '.vscode/', '.idea/', 'node_modules/', 'dist/', 'build/', 'coverage/']

export function analyzeMappingCoverageStrict(changedFiles, entries, exemptions) {
  const isMeta = (filePath) => (
    NON_IMPLEMENTATION_PREFIXES.some((prefix) => filePath.startsWith(prefix))
    || filePath.toLowerCase().endsWith('.md')
    || !filePath.includes('/') // 루트 단일 파일(package.json, vite.config.* 등)은 구현 파일이 아니다
  )
  const isExempt = (filePath) => exemptions.codePaths.some((mapPath) => codePathMatches(filePath, mapPath))
  const isMapped = (filePath) => entries.some((entry) => entry.codePaths.some((mapPath) => codePathMatches(filePath, mapPath)))

  return changedFiles
    .filter((filePath) => !isMeta(filePath))
    .filter((filePath) => !isMapped(filePath))
    .filter((filePath) => !isExempt(filePath))
    .sort()
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

// 기준(lock)에 있는 문서들의 화면 링크 색인. 기준 본문(캐시)에서 만든다.
// 본문을 아직 못 받았으면 그 소스는 건너뛴다 — 못 읽은 것을 "링크 없음"으로 단정하지 않는다.
export function screenIndexesFromCache(state) {
  const out = {}
  for (const source of state.sources ?? []) {
    const recorded = state.lock?.sources?.[source.id]
    if (!recorded) continue
    let dir
    try {
      dir = cacheDirFor(source.id)
    } catch {
      continue
    }
    out[source.id] = buildScreenIndex(Object.keys(recorded.files ?? {}), (rel) => {
      try {
        return readSafeFile(dir, rel)
      } catch {
        return null
      }
    }, screenLinksFor(recorded, source))
  }
  return out
}

// "매핑되지 않은 기획" — 기준에는 있는데 매핑도 판정도 없는 문서.
// 구현 여부는 하네스가 판정하지 않는다 — 스텁 폴더에 미리 매핑한 문서는 이 목록에서 빠지지만
// 구현이 끝난 것이 아니다. 목록의 의미는 정확히 "알림 배선이 안 된 문서"다(0.2.108 라벨 정정).
//
// 도입 직후에는 이게 곧 할 일 목록이다. 매핑 커버리지 검사는 **이미 매핑이 있는 영역**을 기준으로
// 도는 구조라 매핑이 0건이면 아무 말도 하지 않는다 — 정확히 시작 지점이 사각지대였다(0.2.104).
// 링크된 화면은 대표 문서로 매핑되므로 별도 매핑 대상이 아니다.
export function findUnmappedSpecs(lockNorm, entries, exemptions, screenIndexBySource = {}) {
  const mapped = new Set((entries ?? []).map((entry) => entry.spec))
  const exempt = new Set(exemptions?.specs ?? [])
  const out = []

  for (const [sourceId, recorded] of Object.entries(lockNorm?.sources ?? {})) {
    const index = screenIndexBySource[sourceId] ?? null
    for (const rel of Object.keys(recorded.files ?? {})) {
      if (mapped.has(rel) || exempt.has(rel)) continue
      const unit = index?.unitFor(rel)
      if (unit && unit.primary !== rel) continue // 링크된 화면 — 대표 문서가 매핑 단위다
      if (unit && (mapped.has(unit.primary) || exempt.has(unit.primary))) continue
      out.push({ source: sourceId, file: rel })
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

// 기준에 기록된 문서가 링크한 화면이 기준에 함께 있고, 같은 시점인가.
// 매핑된 문서는 push 게이트가 보지만, 매핑되지 않은 문서는 아무도 보지 않았다(0.2.103 백로그).
// 어긋난 채로 두면 컨텍스트가 문서와 화면을 다른 시점으로 제시하게 된다.
export function findLockScreenIssues(lockNorm, screenIndexBySource = {}) {
  const issues = []
  for (const [sourceId, recorded] of Object.entries(lockNorm?.sources ?? {})) {
    const index = screenIndexBySource[sourceId]
    if (!index) continue
    for (const [rel, value] of Object.entries(recorded.files ?? {})) {
      const unit = index.unitFor(rel)
      if (!unit || unit.primary !== rel) continue
      for (const screen of unit.screens) {
        const locked = recorded.files[screen]
        if (!locked) {
          issues.push({ source: sourceId, doc: rel, screen, kind: 'missing' })
          continue
        }
        const docCommit = value.commit ?? recorded.commit ?? null
        const screenCommit = locked.commit ?? recorded.commit ?? null
        if (docCommit !== screenCommit) {
          issues.push({ source: sourceId, doc: rel, screen, kind: 'commit-mismatch', docCommit, screenCommit })
        }
      }
    }
  }
  return issues
}

export function formatLockScreenIssues(issues) {
  return issues.map((issue) => (
    issue.kind === 'missing'
      ? `${issue.doc} 이(가) 링크한 화면 ${issue.screen} 이(가) 기준에 없습니다 — 함께 정산되지 않았습니다.`
      : `${issue.doc}(${String(issue.docCommit).slice(0, 10)})와 ${issue.screen}(${String(issue.screenCommit).slice(0, 10)})의 기준 시점이 다릅니다.`
  ))
}

// 읽었지만 아직 정산하지 않은 문서(spec-latest manifest 기준). 0.2.103부터 "미정산"의 단일 출처다.
//
// 종전에는 캐시 작업 트리와 lock을 비교해 미정산을 셌지만, 이제 캐시는 기준을 그대로 따라가므로
// 그 비교로는 아무것도 안 나온다. "사람이 읽은 스냅샷 중 lock에 반영되지 않은 것"이 미정산이다.
export function pendingSettlements(lockNorm) {
  const manifest = readLatestManifest()
  const pending = []
  for (const [sourceId, entry] of Object.entries(manifest.sources ?? {})) {
    const recorded = lockNorm?.sources?.[sourceId]
    for (const [rel, snapshot] of Object.entries(entry.files ?? {})) {
      const locked = recorded?.files?.[rel]
      if (isStaleSnapshot(snapshot, locked)) continue
      if (snapshot.deleted) {
        if (locked) pending.push({ source: sourceId, file: rel, kind: '삭제' })
        continue
      }
      if (!locked) {
        pending.push({ source: sourceId, file: rel, kind: '추가' })
      } else if (locked.sha !== snapshot.sha) {
        pending.push({ source: sourceId, file: rel, kind: '변경' })
      }
    }
  }
  return pending
}

// 스냅샷을 읽은 뒤 기준이 다른 경로로 움직였으면(동료의 lock을 pull, --move-baseline 등)
// 그 스냅샷은 낡은 것이다. 적용하면 기준이 **뒤로 돌아가** 팀 공유 기록이 손상된다(0.2.103 실증).
// baseSha(스냅샷을 만들 때의 기준 값)와 현재 기준을 비교하는 compare-and-swap이다.
export function isStaleSnapshot(snapshot, locked) {
  if (!snapshot) return true
  const currentSha = locked?.sha ?? null
  const baseSha = snapshot.baseSha ?? null
  if (currentSha === baseSha) return false
  // 기준이 이미 이 스냅샷과 같은 내용이면 정산이 끝난 것이다.
  if (!snapshot.deleted && currentSha === snapshot.sha) return true
  return true
}

// lock에 기록된 기준과 현재 캐시를 비교한다(캐시 무결성 확인용). 네트워크를 쓰지 않는다.
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
    const files = selectSpecFilesBySelector(dir, selector, screenLinksFor(recorded, source))
    const previous = recorded?.files ?? {}

    const changed = files.filter((rel) => {
      if (!previous[rel]) return false
      try {
        return previous[rel].sha !== sha256Text(readSafeFile(dir, rel))
      } catch {
        return true // 링크·비정규 파일·읽기 불가 = 기준과 다름
      }
    })
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
  console.log(`- 수동 설정: ${toPosix(path.relative(repoRoot, sourcesPath))}에 기획 저장소를 선언한 뒤 .harness/bin/harness spec:fetch 를 실행합니다.`)
}

function printConfigErrors(errors) {
  console.error('기획 문서 연동 상태가 유효하지 않습니다:')
  for (const message of errors) {
    console.error(`  - ${message}`)
  }
  console.error('.harness/spec-sources.json / .harness/spec-lock.json을 고친 뒤 다시 실행하세요.')
  console.error('둘 다 커밋되는 파일입니다 — 손상됐다면 git 이력에서 복원하는 것이 가장 안전합니다.')
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
      failures.push({ id: source.id, rel: '(전체)', reason: '로컬 캐시가 없습니다 — .harness/bin/harness spec:fetch 로 캐시를 먼저 받으세요' })
      continue
    }

    if (!commitAvailable(dir, recorded.commit)) {
      if (allowNetwork) {
        ensureCommitAvailable(dir, source, recorded.commit)
      } else {
        failures.push({ id: source.id, rel: '(전체)', reason: `기준 commit ${recorded.commit.slice(0, 10)}이 로컬 캐시에 없습니다 — .harness/bin/harness spec:fetch 로 먼저 받으세요` })
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
  console.error('.harness/bin/harness spec:fetch --move-baseline [--source <id>] 로 기준을 재생성하세요.')
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
      screenLinks: recorded.screenLinks ?? null,
      files,
    }
  }
  return { version: 2, sources }
}

// 다른 하네스 스크립트(build-context, policy-harness, doc-link)가 쓰는 조회 API.
// 파일을 수정하지 않고 네트워크를 쓰지 않는다.
export function readSpecState() {
  const sourcesRead = readJsonStrict(sourcesPath)
  const lockRead = readJsonStrict(lockPath)

  // 손상된 핵심 파일은 "없음"으로 강등하지 않는다. 선언이 깨지면 미연동으로,
  // 기준이 깨지면 기준 없음으로 보여 검사·게이트·컨텍스트가 통째로 무력화된다(재리뷰 P1-3).
  // valid=false로 올리면 모든 명령이 공유하는 기존 중단 경로를 그대로 탄다.
  const fileErrors = []
  if (sourcesRead.exists && !sourcesRead.valid) {
    fileErrors.push(`spec-sources.json을 해석할 수 없습니다 — ${sourcesRead.error}`)
  }
  if (lockRead.exists && !lockRead.valid) {
    fileErrors.push(`spec-lock.json을 해석할 수 없습니다 — ${lockRead.error}`)
  } else if (lockRead.exists) {
    // JSON으로 읽히는 것과 기준으로 쓸 수 있는 것은 다르다(3차 리뷰 P1-1).
    fileErrors.push(...validateLockSchema(lockRead.value))
  }

  const { declared, sources, errors } = validateSourcesConfig(sourcesRead.valid ? sourcesRead.value : null)
  const lock = normalizeLock(lockRead.valid ? lockRead.value : null)
  const entries = readSpecMapEntries()
  const collisions = findPathCollisions(lock)
  const allErrors = [...fileErrors, ...errors]
  const valid = allErrors.length === 0

  return {
    // 손상 파일이 있으면 "선언되어 있다"고 봐야 소비자가 조용히 건너뛰지 않는다.
    configured: (declared || fileErrors.length > 0) && (valid ? sources.length > 0 : true),
    declared: declared || fileErrors.length > 0,
    valid,
    errors: allErrors,
    lockCorrupted: lockRead.exists && !lockRead.valid,
    sources,
    lock,
    entries,
    collisions,
    cacheRoot,
    diff: declared && valid && sources.length > 0 ? diffAgainstLock(lock, sources) : null,
  }
}

// 한 소스의 새 기준을 최신 기획으로 만든다(전체 fetch). files 해시는 작업 트리 파일이 아니라
// 대상 commit의 git 객체(git show)에 sha256을 적용해 기록한다. 작업 트리는 읽지 않는다 —
// checkout이 없어졌으므로 작업 트리에서 열거하면 옛 목록이 잡힌다(0.2.103 실측).
function buildBaselineForSource(source) {
  const { dir, commit } = fetchLatestCommit(source)
  const selector = normalizeSelector(source)
  const screenLinks = normalizeScreenLinks(source) ?? []
  const selected = selectSpecFilesAtCommit(dir, commit, selector, { screenLinks })

  // 링크가 깨진 상태를 기준으로 삼으면, 그 불완전한 상태가 팀 전체의 "확인된 사양"이 된다.
  const linkIssues = findScreenLinkIssues(
    selected,
    screenIndexAtCommit(dir, commit, selected, screenLinks),
    screenCandidatesAtCommit(dir, commit, selector, screenLinks),
  )
  if (linkIssues.length > 0) {
    throw new Error(`기획 문서의 화면 링크가 맞지 않습니다:\n${formatScreenLinkIssues(linkIssues).map((line) => `  - ${line}`).join('\n')}`)
  }

  const files = {}
  for (const rel of selected) {
    const shown = gitShowText(dir, commit, rel)
    if (shown === null) {
      // 같은 commit의 트리에서 고른 파일이 안 읽히는 것은 부재가 아니라 이상 상태다.
      // 조용히 건너뛰면 그 문서가 기준에서 빠진 채 "동기화 완료"가 된다(실전 3.5MB 화면 파일).
      throw new Error(`선택된 문서를 commit ${String(commit).slice(0, 10)}에서 읽지 못했습니다: ${rel}`)
    }
    files[rel] = { sha: sha256Text(shown), commit }
  }
  return {
    repo: source.repo,
    ref: source.ref ?? null,
    commit,
    fetchedAt: new Date().toISOString(),
    selector,
    screenLinks,
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
        // 여러 줄 원인(예: 쌍 누락 목록)을 첫 줄로 잘라내면 정작 고쳐야 할 파일명이 사라진다.
        for (const line of String(error.message ?? error).split('\n')) console.error(`원인: ${line}`)
        console.error('확인: 저장소 주소, 브랜치 이름, 그리고 이 저장소에 대한 git 읽기 권한.')
        process.exitCode = 1
        return
      }
      lockNorm.sources[source.id] = { ...baseline, files: Object.fromEntries(Object.entries(baseline.files)) }
      summaries.push({ id: source.id, commit: baseline.commit, total: Object.keys(baseline.files).length })

      // 최초 연동도 하나의 "최신 확인"이다 — 방금 원격 HEAD를 기준으로 삼았으므로 차이 0건의
      // 확인 기록을 소스별로 남긴다. 이 기록이 없으면 broadcast가 "확인한 적 없음"(안내 필요)과
      // "확인했고 변경 없음"(정당한 무음)을 구분할 수 없다(0.2.121). 기록 실패가 연동을 막지는 않는다.
      try {
        materializeLatest(source, baseline.commit, [], ensureCacheRepo(source))
      } catch {
        // 다음 fetch --cache-only가 기록을 새로 만든다.
      }
    }

    writeJson(lockPath, serializeLock(lockNorm))

    console.log('기획 문서 동기화 완료')
    for (const summary of summaries) {
      console.log('')
      console.log(`- ${summary.id}: 문서 ${summary.total}건, commit ${summary.commit.slice(0, 10)}`)
      console.log('  최초 연동입니다. 매핑은 .harness/project/spec-map.md에 기록합니다.')
    }
    console.log('')
    // 기준이 생겼으니 캐시 본문을 그 기준으로 맞춘다(실패하면 아래 보고가 복구 경로를 안내한다).
    reportHydrationAfterLockChange(hydrateSpecCacheIfStale({ timeoutMs: 30000 }))
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
  const failures = []
  // 손상된 기록은 이 명령이 모든 소스를 다시 확인해 통째로 재작성하므로 안전하게 초기화할 수 있다.
  if (readLatestManifest({ allowReset: true }).reset) {
    console.log('최신 확인 기록이 손상되어 이번 확인 결과로 새로 만듭니다.')
  }

  for (const source of state.sources) {
    let fetched
    try {
      fetched = fetchLatestCommit(source)
    } catch (error) {
      // 한 소스의 장애로 나머지 소스의 확인 결과까지 버리지 않는다(재리뷰 P2-2).
      failures.push({ id: source.id, repo: source.repo, reason: String(error.message ?? error).split('\n')[0] })
      continue
    }
    const recorded = state.lock.sources[source.id]
    const selector = recorded?.selector ?? normalizeSelector(source)
    // 최신 목록은 git 객체(ls-tree)로만 읽는다 — 캐시 작업 트리는 기준 전용이라 건드리지 않는다.
    const screenLinks = screenLinksFor(recorded, source)
    let selected
    let screenIndex
    let screenCandidates = []
    try {
      selected = selectSpecFilesAtCommit(fetched.dir, fetched.commit, selector, { screenLinks })
      screenIndex = screenIndexAtCommit(fetched.dir, fetched.commit, selected, screenLinks)
      screenCandidates = screenCandidatesAtCommit(fetched.dir, fetched.commit, selector, screenLinks)
    } catch (error) {
      failures.push({ id: source.id, repo: source.repo, reason: `문서 목록을 읽지 못했습니다 — ${String(error.message ?? error).split('\n')[0]}` })
      continue
    }

    // 링크가 깨진 상태는 "확인했다"고 기록할 수 없다 — 정산 근거가 되는 스냅샷을 만들지 않는다.
    const linkIssues = findScreenLinkIssues(selected, screenIndex, screenCandidates)
    if (linkIssues.length > 0) {
      failures.push({ id: source.id, repo: source.repo, reason: `화면 링크 불일치 — ${formatScreenLinkIssues(linkIssues).join(' / ')}` })
      continue
    }

    const latest = {}
    for (const rel of selected) {
      const shown = gitShowText(fetched.dir, fetched.commit, rel)
      if (shown !== null) latest[rel] = { sha: sha256Text(shown), commit: fetched.commit }
    }

    const change = summarizeBaselineChange(recorded?.files, latest)
    // 달라진 문서만 사람이 읽을 수 있게 꺼낸다(spec-latest). 이 manifest가 settle의 근거가 된다.
    //
    // 화면 기획은 한쪽만 바뀌어도 **단위 전체가 바뀐 것**으로 본다(기획자 합의 계약).
    // 짝을 함께 꺼내야 정산이 둘을 같은 시점으로 기록할 수 있고, 그래야 "정책은 B, 화면은 A" 같은
    // 혼합 기준이 생기지 않는다.
    const toMaterialize = [...new Set(
      [...change.changed, ...change.added].flatMap((rel) => (screenIndex.unitFor(rel)?.files ?? [rel]).filter((file) => latest[file])),
    )]
    let materialized = { files: {} }
    {
      // 변화가 없어도 항상 호출한다 — manifest를 "이번 확인 결과"로 교체해 낡은 스냅샷을 정리한다.
      try {
        materialized = materializeLatest(source, fetched.commit, toMaterialize, fetched.dir, {
          deletedPaths: change.removed,
          lockedFiles: recorded?.files ?? {},
        })
      } catch (error) {
        failures.push({ id: source.id, repo: source.repo, reason: `최신 본문을 꺼내지 못했습니다 — ${String(error.message ?? error).split('\n')[0]}` })
        continue
      }
    }

    summaries.push({
      id: source.id,
      commit: fetched.commit,
      hasBaseline: Boolean(recorded),
      materialized: Object.keys(materialized.files),
      ...change,
    })
  }

  if (failures.length > 0) {
    console.error('')
    console.error('일부 기획 저장소를 확인하지 못했습니다:')
    for (const failure of failures) {
      console.error(`  - ${failure.id} (${failure.repo}): ${failure.reason}`)
    }
    console.error('확인: 저장소 주소, 브랜치 이름, 그리고 이 저장소에 대한 git 읽기 권한.')
    console.error('아래 결과는 확인에 성공한 소스만 반영합니다.')
    console.error('')
    process.exitCode = 1
  }

  if (summaries.length === 0) return

  console.log('최신 기획 확인 완료 (기준 이동 없음, 기준 본문 그대로)')
  for (const summary of summaries) {
    console.log('')
    console.log(`- ${summary.id}: 문서 ${summary.total}건, 원격 commit ${summary.commit.slice(0, 10)}`)
    if (!summary.hasBaseline) {
      console.log(`  아직 기준에 편입되지 않은 소스입니다. 편입: .harness/bin/harness spec:fetch --move-baseline --source ${summary.id}`)
      continue
    }
    const pending = summary.changed.length + summary.added.length + summary.removed.length
    if (pending === 0) {
      console.log('  기준 시점과 차이가 없습니다.')
      continue
    }
    console.log(`  기준 대비 미정산: 변경 ${summary.changed.length} / 기준에 없음 ${summary.added.length} / 삭제 ${summary.removed.length}`)
    for (const rel of [...summary.changed, ...summary.added].slice(0, 10)) {
      console.log(`    - ${rel}`)
    }
    if (summary.materialized.length > 0) {
      console.log(`  최신 본문을 꺼내 두었습니다(읽기용): .harness/generated/spec-latest/${summary.id}/`)
    }
  }
  console.log('')
  console.log('팀 기준(lock)과 기준 본문은 그대로입니다. 위 최신 본문을 읽고 확인했으면 .harness/bin/harness spec:settle 로 정산합니다.')
  console.log('정산은 방금 읽은 그 시점만 기록합니다 — 그 사이 기획이 더 나가면 다음 확인에서 다시 알려줍니다.')
  if (!explicitFlag) {
    console.log('전체 기준 이동이 필요하면: .harness/bin/harness spec:fetch --move-baseline [--source <id>]')
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
      for (const line of String(error.message ?? error).split('\n')) console.error(`원인: ${line}`)
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
    console.log(`  변경 ${summary.changed.length} / 기준에 없음 ${summary.added.length} / 삭제 ${summary.removed.length}`)
    for (const rel of [...summary.changed, ...summary.added].slice(0, 10)) {
      console.log(`    - ${rel}`)
    }
  }
  console.log('')
  // 기준이 움직였으니 캐시 본문도 새 기준으로 맞춘다.
  reportHydrationAfterLockChange(hydrateSpecCacheIfStale({ timeoutMs: 30000 }))
  console.log(`기준 시점을 ${toPosix(path.relative(repoRoot, lockPath))}에 기록했습니다. 이 파일은 커밋해서 팀과 공유합니다.`)
  console.log('기준 이동은 "그 사이 기획 변경을 살펴봤다"는 선언입니다. 검토 결과를 decision-log에 남기세요.')
}

// --at-lock: lock이 기록한 정확한 파일 집합을 캐시에 복원한다(기준 이동 없음).
// base commit checkout 후, selector에 걸리지만 lock에 없는 파일(삭제 정산분, 이전 수화 잔재)을
// 제거하고, 모든 lock 문서를 기록된 commit에서 개별 수화한 뒤 sha까지 검증한다.
function runRehydrateAtLock(state) {
  if (!state.lock.exists) {
    console.error('기준 시점이 없어 --at-lock 수화를 할 수 없습니다.')
    console.error('먼저 .harness/bin/harness spec:fetch 로 최초 기준을 만듭니다.')
    process.exitCode = 1
    return
  }

  const mismatches = []
  const summaries = []

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded?.commit) {
      console.error(`기준 시점이 없어 --at-lock 수화를 할 수 없습니다: ${source.id}`)
      console.error(`편입: .harness/bin/harness spec:fetch --move-baseline --source ${source.id}`)
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
      for (const line of String(error.message ?? error).split('\n')) console.error(`원인: ${line}`)
      process.exitCode = 1
      return
    }

    const selector = recorded.selector ?? normalizeSelector(source)

    // 1) lock에 없는 selector 대상 파일 제거 — 삭제 정산된 문서와 이전 수화의 잔재가 되살아나지 않게.
    for (const rel of selectSpecFilesBySelector(dir, selector, screenLinksFor(recorded, source))) {
      if (!recorded.files[rel]) removeSafeFile(dir, rel)
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
      writeRegularFile(dir, rel, shown)
    }

    summaries.push({ id: source.id, commit: recorded.commit, total: Object.keys(recorded.files).length })
  }

  if (mismatches.length > 0) {
    console.error('기준 수화를 완료할 수 없습니다 (기준 기록과 기획 이력이 어긋남):')
    for (const item of mismatches) {
      console.error(`  - [${item.id}] ${item.rel}: ${item.reason}`)
    }
    console.error('변경 내용을 검토한 뒤 .harness/bin/harness spec:fetch --move-baseline [--source <id>] 로 기준을 재생성하세요.')
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

// 본문 자동 수화(0.2.102): 로컬에 기획 본문이 없거나 팀 기준(lock)과 어긋나면 조용히 맞춘다.
//
// 왜 필요한가: 기획 본문은 git 추적 대상이 아니라(사본 이중화 금지) pull만으로는 내려오지 않는다.
// 동료가 pull 후 아무것도 모른 채 작업하면 "기획서가 없는 게 아니라 아직 안 받은 것"인데도
// 없는 것처럼 보인다. post-merge 훅이 평소 경로를 담당하고, 컨텍스트 생성·커밋 검증이 백스톱이다.
//
// 원칙: 기준(lock)은 절대 건드리지 않는다(--at-lock과 같은 의미). 실패는 무해하게 넘긴다 —
// 오프라인이나 기획 저장소 장애가 pull/커밋/작업을 막아서는 안 된다.
// 캐시가 lock과 정확히 일치하는지 판정한다.
//
// 소스 HEAD(recorded.commit) 비교로는 부족하다: lock v2는 문서별 commit을 갖기 때문에,
// 동료가 문서 A만 정산(settle)해 lock을 커밋하면 소스 HEAD는 그대로인데 문서 A의 기준만 앞선다.
// HEAD만 보면 그 pull에서 수화가 스킵되고 옛 본문을 계속 읽게 된다(0.2.102 리뷰 지적, 실증).
// 그래서 lock에 적힌 모든 문서의 내용 해시를 직접 대조한다.
export function specCacheMatchesLock(dir, recorded, source) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    return { matches: false, reason: 'cache-missing' }
  }

  const selector = recorded.selector ?? normalizeSelector(source)

  // lock의 모든 문서가 정확한 내용으로 존재해야 한다(부재·변조 모두 불일치).
  for (const [rel, value] of Object.entries(recorded.files)) {
    let content
    try {
      content = readSafeFile(dir, rel)
    } catch (error) {
      return { matches: false, reason: `${error?.code === 'ENOENT' ? 'missing' : 'unreadable'}:${rel}` }
    }
    if (sha256Text(content) !== value.sha) {
      return { matches: false, reason: `changed:${rel}` }
    }
  }

  // selector에 걸리는데 lock에 없는 파일 = 이전 수화 잔재 또는 삭제 정산분.
  for (const rel of selectSpecFilesBySelector(dir, selector, screenLinksFor(recorded, source))) {
    if (!recorded.files[rel]) {
      return { matches: false, reason: `stale:${rel}` }
    }
  }

  return { matches: true }
}

// lock을 바꾼 뒤의 수화 실패를 조용히 넘기면 "기준과 캐시가 일치한다"는 불변식이 깨진 채로
// 성공 메시지만 남는다(0.2.103 자체 검토 P3-7). 종료 코드는 바꾸지 않되 반드시 알린다.
function reportHydrationAfterLockChange(result) {
  for (const failure of result?.failures ?? []) {
    console.log(`[harness] 기준 본문을 맞추지 못했습니다 (${failure.id}): ${failure.reason}`)
  }
  if ((result?.failures ?? []).length > 0) {
    console.log('  기준 기록은 갱신됐지만 로컬 본문은 아직 그 기준이 아닙니다. 복구: .harness/bin/harness spec:fetch --at-lock')
  }
  return result
}

export function hydrateSpecCacheIfStale({ timeoutMs = 15000, onlyWhenMissing = false } = {}) {
  const result = { attempted: false, hydrated: [], failures: [], skipped: [] }

  let state
  try {
    state = readSpecState()
  } catch (error) {
    result.failures.push({ id: '(전체)', reason: `연동 상태를 읽지 못했습니다: ${String(error.message ?? error).split('\n')[0]}` })
    return result
  }
  // 설정·기준 손상 판정이 먼저다. lock이 깨지면 lock.exists가 false라, 순서를 바꾸면
  // "연동 안 함"으로 조용히 빠져나가 실패가 보이지 않는다(재리뷰 P1-3).
  if (!state.valid) {
    result.failures.push({ id: '(전체)', reason: state.errors[0] ?? '연동 설정을 읽을 수 없습니다.' })
    return result
  }
  if (!state.declared || !state.lock.exists) return result

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded?.commit) {
      result.skipped.push({ id: source.id, reason: '기준 시점이 아직 없습니다(--move-baseline --source 로 편입).' })
      continue
    }

    let dir
    try {
      dir = cacheDirFor(source.id)
    } catch (error) {
      result.failures.push({ id: source.id, reason: String(error.message ?? error).split('\n')[0] })
      continue
    }

    const state1 = specCacheMatchesLock(dir, recorded, source)
    if (state1.matches) continue
    // --only-when-missing은 "디렉터리 유무"가 아니라 "필수 문서 누락" 기준이다.
    // 내용만 어긋난 경우(부분 settle 반영 등)는 컨텍스트 경로에서도 맞춰야 한다.
    if (onlyWhenMissing && !state1.reason.startsWith('cache-missing') && !state1.reason.startsWith('missing:')) {
      continue
    }

    result.attempted = true
    try {
      hydrateSourceAtLock(source, recorded, { timeoutMs })
      const verified = specCacheMatchesLock(dir, recorded, source)
      if (verified.matches) {
        result.hydrated.push(source.id)
      } else {
        result.failures.push({ id: source.id, reason: `수화 후에도 기준과 일치하지 않습니다(${verified.reason}). 기준 재생성이 필요할 수 있습니다.` })
      }
    } catch (error) {
      result.failures.push({ id: source.id, reason: String(error.message ?? error).split('\n')[0] })
    }
  }

  return result
}

// 한 소스를 lock 기준으로 수화한다. runRehydrateAtLock의 코어를 타임아웃과 함께 재사용한다.
function hydrateSourceAtLock(source, recorded, { timeoutMs }) {
  const dir = ensureCacheRepo(source, { timeoutMs })
  ensureCommitAvailable(dir, source, recorded.commit, { timeoutMs })
  runGit(['checkout', '--quiet', '--force', recorded.commit], dir)

  const selector = recorded.selector ?? normalizeSelector(source)
  for (const rel of selectSpecFilesBySelector(dir, selector, screenLinksFor(recorded, source))) {
    if (!recorded.files[rel]) removeSafeFile(dir, rel)
  }
  const missing = []
  for (const [rel, value] of Object.entries(recorded.files)) {
    const docCommit = value.commit ?? recorded.commit
    ensureCommitAvailable(dir, source, docCommit, { timeoutMs })
    const shown = gitShowText(dir, docCommit, rel)
    if (shown === null) {
      // 조용히 건너뛰면 "본문이 준비됐다"는 잘못된 인상을 준다 — 실패로 올린다.
      missing.push(`${rel}@${String(docCommit).slice(0, 10)}`)
      continue
    }
    // 쓰기도 traversal·symlink를 방어한다(삭제 경로만 막으면 링크 write-through로 뚫린다).
    writeRegularFile(dir, rel, shown)
  }

  if (missing.length > 0) {
    throw new Error(`기준에 기록된 문서를 기획 이력에서 찾지 못했습니다: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` 외 ${missing.length - 3}건` : ''}`)
  }
}

// 수화·최신 확인 상태 기록(0.2.102). "언제 성공/실패했는가"를 남겨 다음 컨텍스트 생성이
// 미해결 실패를 다시 표면화한다. generated 산출물이라 git 추적 대상이 아니다.
const hydrationStatusPath = path.join(harnessRoot, 'generated', 'spec-hydration-status.json')

export function readHydrationStatus() {
  return readJsonSoft(hydrationStatusPath, null)
}

export function writeHydrationStatus(status) {
  try {
    writeJson(hydrationStatusPath, status)
  } catch {
    // 상태 기록 실패가 본 작업을 막지는 않는다.
  }
}

// 작업 시작 시 최신 기획을 짧게 확인한다(비파괴: 기준도 캐시 파일도 건드리지 않는다).
//
// lock 기준 본문만 보고 구현하면, 기획자가 그 사이 고친 내용을 모른 채 만들고 push에서야 알게 된다.
// 재작업을 막으려면 "작업 전"에 알아야 한다. 다만 매 작업마다 네트워크를 길게 잡으면 안 되므로
// TTL(기본 10분) 안에서는 직전 결과를 재사용하고, 예산을 넘기면 즉시 포기하고 진행한다.
// TTL 재사용의 유효 조건: 선언(repo/ref/selector) + 기준(lock의 문서별 sha/commit) + 소스 집합 +
// 스키마 버전이 모두 같을 때. 하나라도 바뀌면 이전 확인 결과는 다른 상태의 것이라 재사용하면 안 된다.
const FRESHNESS_SCHEMA_VERSION = 2

// 관련성 판정용 발췌(제목 + 앞부분). 상태 파일이 비대해지지 않게 상한을 둔다.
function excerptForSearch(content) {
  return String(content ?? '').slice(0, 800).toLowerCase()
}

function freshnessFingerprint(state) {
  const parts = [`v${FRESHNESS_SCHEMA_VERSION}`]
  for (const source of [...state.sources].sort((a, b) => a.id.localeCompare(b.id))) {
    const recorded = state.lock.sources[source.id]
    const selector = normalizeSelector(source)
    parts.push([
      source.id,
      source.repo,
      source.ref ?? '',
      selector.include.join('|'),
      selector.exclude.join('|'),
      recorded?.commit ?? '',
      Object.entries(recorded?.files ?? {}).sort(([a], [b]) => a.localeCompare(b))
        .map(([rel, value]) => `${rel}:${value.sha}:${value.commit ?? ''}`).join(','),
    ].join('#'))
  }
  return sha256Text(parts.join('\n'))
}

export function checkSpecFreshness({ timeoutMs = 6000, ttlMinutes = 10 } = {}) {
  const result = { checked: false, reason: null, changed: [], added: [], removed: [] }

  let state
  try {
    state = readSpecState()
  } catch {
    return { ...result, reason: 'state-error' }
  }
  // 손상은 미연동과 다르다 — 'not-configured'로 뭉개면 컨텍스트가 조용히 넘어간다(재리뷰 P1-3).
  if (!state.valid) return { ...result, reason: `config-error: ${state.errors[0] ?? '알 수 없음'}` }
  if (!state.declared || !state.lock.exists) return { ...result, reason: 'not-configured' }

  // TTL 재사용은 "같은 상태"일 때만 유효하다. lock/선언이 바뀌면 이전 결과는 무의미하므로 지문으로 막는다.
  const fingerprint = freshnessFingerprint(state)
  const previous = readHydrationStatus()
  const lastCheck = previous?.freshness?.checkedAt ? Date.parse(previous.freshness.checkedAt) : NaN
  if (Number.isFinite(lastCheck)
    && Date.now() - lastCheck < ttlMinutes * 60 * 1000
    && previous?.freshness?.fingerprint === fingerprint
    && previous.freshness.checked === true) {
    // checked를 덮어쓰지 않는다 — 실패한 확인을 캐시에서 꺼내며 성공으로 바꾸면 안 된다(자체 검토 P2-6).
    // 실패 결과는 애초에 재사용하지 않고 다시 시도한다.
    return { ...previous.freshness, reason: 'cached', fromCache: true }
  }

  const changed = []
  const added = []
  const removed = []
  const sourceStates = []

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded?.commit) continue

    let dir
    let latestCommit
    try {
      dir = ensureCacheRepo(source, { timeoutMs })
      const ref = source.ref || 'HEAD'
      ensureFullHistory(dir, source, { timeoutMs })
      runGit(['fetch', '--quiet', 'origin', ref], dir, { timeoutMs })
      latestCommit = runGit(['rev-parse', 'FETCH_HEAD'], dir, { timeoutMs })
    } catch (error) {
      // 소스 하나의 장애가 다른 소스의 결과를 폐기하면 안 된다(0.2.103 리뷰 P1-4).
      sourceStates.push({ id: source.id, checked: false, reason: `fetch-failed: ${String(error.message ?? error).split('\n')[0]}` })
      continue
    }

    // 작업 트리를 바꾸지 않고 최신 트리만 읽는다(캐시 본문은 lock 기준 그대로 유지).
    const selector = recorded.selector ?? normalizeSelector(source)
    const screenLinks = screenLinksFor(recorded, source)
    const selected = selectSpecFilesAtCommit(dir, latestCommit, selector, { timeoutMs, screenLinks })

    const linkIssues = findScreenLinkIssues(
      selected,
      screenIndexAtCommit(dir, latestCommit, selected, screenLinks),
      screenCandidatesAtCommit(dir, latestCommit, selector, screenLinks, { timeoutMs }),
    )
    if (linkIssues.length > 0) {
      sourceStates.push({ id: source.id, checked: false, reason: `screen-link-broken: ${formatScreenLinkIssues(linkIssues).join(' / ')}` })
      continue
    }

    for (const rel of selected) {
      const shown = gitShowText(dir, latestCommit, rel)
      if (shown === null) continue
      const latestSha = sha256Text(shown)
      const locked = recorded.files[rel]
      if (!locked) {
        // 신규 문서는 아직 lock에도 캐시에도 없다. 관련성을 파일명으로만 판단하면
        // REQ-142.md처럼 이름에 업무어가 없는 문서를 놓치므로, 검색용 발췌를 함께 남긴다.
        added.push({ source: source.id, file: rel, commit: latestCommit, excerpt: excerptForSearch(shown) })
      } else if (locked.sha !== latestSha) {
        changed.push({ source: source.id, file: rel, commit: latestCommit, excerpt: excerptForSearch(shown) })
      }
    }
    for (const rel of Object.keys(recorded.files)) {
      if (!selected.includes(rel)) removed.push({ source: source.id, file: rel })
    }
    sourceStates.push({ id: source.id, checked: true, reason: null, commit: latestCommit })
  }

  // 소스별 상태를 보관한다 — 전체 checked 한 값으로 뭉개면 정상 소스 결과가 실패에 묻힌다.
  const failedSources = sourceStates.filter((item) => !item.checked)
  const freshness = {
    checked: failedSources.length < state.sources.length,
    reason: failedSources.length > 0 ? `일부 소스 확인 실패: ${failedSources.map((item) => item.id).join(', ')}` : null,
    checkedAt: new Date().toISOString(),
    fingerprint,
    fromCache: false,
    sources: sourceStates,
    changed,
    added,
    removed,
  }
  writeHydrationStatus({ ...previous, freshness })
  return freshness
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

// 정산: 살펴본 기획 문서의 lock 기준을 **읽은 스냅샷**의 commit으로 전진시킨다(그 문서만).
// "정산 = 그 변경을 우리가 확인했다"는 선언이므로, 범위 밖 문서(남의 몫)는 절대 건드리지 않는다.
//
// 기록 전 provenance 검증의 최종 근거는 **기획 저장소의 git 객체**다(0.2.103 재리뷰 P1-1).
// manifest도 꺼내둔 본문도 로컬 파일이라 손으로 고칠 수 있어, 파일끼리만 대조하면 "둘 다 같이 고치면 통과"다.
// 그래서 ① 소스 정체성(repo/ref) ② 스냅샷 commit 실재 ③ 본문 sha == 그 commit의 내용
// ④ 삭제 표시는 그 commit에 정말 없음 — 네 가지를 모두 확인하고, 전부 통과한 뒤에만 lock을 건드린다.
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
    console.error('기준 시점이 없습니다. 먼저 .harness/bin/harness spec:fetch 로 최초 연동을 만듭니다.')
    process.exitCode = 1
    return
  }

  // 선언↔기준이 이미 어긋난 상태에서 정산하면, 기록은 새 ref의 commit인데 소스 메타데이터는
  // 옛 ref로 남는 혼합 lock이 만들어지고 push에서야 막힌다(3차 리뷰 P2-1). 먼저 막는다.
  const declarationIssues = findDeclarationLockIssues(state.sources, state.lock)
  if (declarationIssues.length > 0) {
    console.error('연동 선언과 기준 기록이 어긋난 상태에서는 정산할 수 없습니다 (lock을 건드리지 않았습니다):')
    for (const message of declarationIssues) console.error(`  - ${message}`)
    console.error('선언을 되돌리거나, 변경 내용을 검토한 뒤 .harness/bin/harness spec:fetch --move-baseline --source <id> 로 기준을 재생성하세요.')
    process.exitCode = 1
    return
  }

  // settle은 오프라인 명령이다 — v1 승격도 로컬 git 객체로만 검증하고, 부족하면 중단·안내한다.
  // 승격 결과는 **적용 단계에서 함께** 저장한다. 여기서 즉시 쓰면 이후 검증이 실패해도 lock이
  // 이미 바뀌어 "한 건이라도 거부되면 lock은 불변"이라는 계약이 깨진다(3차 리뷰 P3).
  const failures = promoteV1Sources(state.lock, state.sources, { allowNetwork: false })
  if (failures.length > 0) {
    printPromotionFailures(failures)
    process.exitCode = 1
    return
  }

  // 충돌 판정은 lock만 보면 부족하다 — 아직 어느 lock에도 없는 신규 문서가 두 소스에 동시에
  // 나타나면 그대로 양쪽에 정산되어 "도구가 금지한 상태"를 도구가 만든다(0.2.103 자체 검토 P2-4).
  // 읽은 스냅샷(manifest)까지 합쳐서 본다.
  let latestManifest
  try {
    latestManifest = readLatestManifest()
  } catch (error) {
    console.error(String(error.message ?? error))
    console.error('.harness/bin/harness spec:fetch --cache-only 로 최신 확인을 다시 수행해 기록을 재생성하세요.')
    process.exitCode = 1
    return
  }

  const collisionRels = new Set(state.collisions.map((item) => item.rel))
  {
    const seenIn = new Map()
    for (const [sourceId, entry] of Object.entries(latestManifest.sources ?? {})) {
      for (const rel of Object.keys(entry.files ?? {})) {
        if (!seenIn.has(rel)) seenIn.set(rel, new Set())
        seenIn.get(rel).add(sourceId)
      }
    }
    for (const [rel, recorded] of Object.entries(state.lock.sources ?? {})) {
      for (const file of Object.keys(recorded.files ?? {})) {
        if (!seenIn.has(file)) seenIn.set(file, new Set())
        seenIn.get(file).add(rel)
      }
    }
    for (const [rel, ids] of seenIn) {
      if (ids.size > 1) collisionRels.add(rel)
    }
  }

  let scopeDocs = docs
  if (scopeDocs.length === 0) {
    const outgoing = collectOutgoingFiles()
    scopeDocs = mappedDocsForFiles(outgoing, state.entries).map((entry) => entry.spec)
  }

  // 기획 문서가 링크한 화면은 그 문서의 일부다. 대표 문서 하나만 지정해도 링크된 화면을 함께
  // 범위에 넣는다 — 따로 정산하면 "정책은 B, 화면은 A" 같은 혼합 기준이 만들어진다.
  //
  // 색인은 **읽은 스냅샷의 commit**에서 만든다. 그 시점의 문서가 무엇을 링크했는지가 정산 단위다.
  const screenIndexCache = new Map()
  const screenIndexForSource = (source) => {
    const recorded = state.lock.sources[source.id]
    const reviewed = latestManifest.sources?.[source.id]
    const commit = reviewed?.commit ?? recorded?.commit ?? null
    if (!commit) return null
    const key = `${source.id}@${commit}`
    if (!screenIndexCache.has(key)) {
      try {
        const dir = cacheDirFor(source.id)
        const selector = recorded?.selector ?? normalizeSelector(source)
        const links = screenLinksFor(recorded, source)
        const files = selectSpecFilesAtCommit(dir, commit, selector, { screenLinks: links })
        screenIndexCache.set(key, screenIndexAtCommit(dir, commit, files, links))
      } catch {
        screenIndexCache.set(key, null)
      }
    }
    return screenIndexCache.get(key)
  }

  {
    const expanded = new Set()
    for (const rel of scopeDocs) {
      expanded.add(rel)
      for (const source of state.sources) {
        const unit = screenIndexForSource(source)?.unitFor(rel)
        if (!unit) continue
        for (const file of unit.files) expanded.add(file)
        break
      }
    }
    scopeDocs = [...expanded]
  }

  // v1 승격은 정산이 아니라 형식 이전이다(내용 불변, 이미 git 객체로 검증됨).
  // **거부 경로에서는 절대 쓰지 않고**, 정산 검증이 끝난 뒤에만 기록한다(3차 리뷰 P3).
  let promotionWritten = false
  const applyPendingPromotion = () => {
    if (!state.lock.hadV1 || promotionWritten) return
    promotionWritten = true
    writeJson(lockPath, serializeLock(state.lock))
    console.log('기준 형식을 v2로 승격했습니다 (내용 변화 없음 — 문서별 기준 commit 기록).')
  }

  if (scopeDocs.length === 0) {
    // 정산할 것이 없으므로 실패할 검증도 없다 — 여기서 승격을 확정해도 계약을 어기지 않는다.
    applyPendingPromotion()
    console.log('정산 범위가 비어 있습니다: push 대기 변경에 매핑된 기획 문서가 없습니다.')
    console.log('특정 문서를 명시하려면: .harness/bin/harness spec:settle --doc <기획 문서 경로>')
    return
  }

  const settled = []
  const removed = []
  const unchanged = []
  const missing = []
  const refusedCollision = []
  const provenanceFailures = []

  // 정산의 근거는 "사람이 실제로 읽은 스냅샷"이다(spec-latest manifest).
  //
  // 실행 시점의 원격 최신을 다시 조회하면, 검토가 끝난 뒤 기획자가 push한 커밋까지 "확인 완료"로
  // 기록된다 — 아무도 읽지 않은 사양이 기준이 되는 치명적 오정산이다(0.2.103 리뷰 P1-1).
  // 그래서 settle은 네트워크를 쓰지 않고 ref를 재조회하지도 않는다.
  const notReviewed = []
  const staleSnapshots = []
  // 검증을 모두 통과한 것만 모았다가 마지막에 한 번에 적용한다 — 중간에 한 건이라도 거부되면
  // lock은 단 1바이트도 바뀌지 않는다(재리뷰 P1-1 5항).
  const plan = []

  // manifest가 말하는 소스 정체성이 현재 선언·기준과 어긋나면, 그 스냅샷은 다른 저장소의 것이다.
  const identityIssues = []
  for (const source of state.sources) {
    const reviewed = latestManifest.sources?.[source.id]
    if (!reviewed || Object.keys(reviewed.files ?? {}).length === 0) continue
    const recorded = state.lock.sources[source.id]
    if ((reviewed.repo ?? null) !== source.repo) {
      identityIssues.push(`[${source.id}] 최신 확인 기록의 저장소(${reviewed.repo ?? '없음'})가 현재 선언(${source.repo})과 다릅니다.`)
    } else if (recorded?.repo && recorded.repo !== reviewed.repo) {
      identityIssues.push(`[${source.id}] 최신 확인 기록의 저장소가 기준 기록(${recorded.repo})과 다릅니다.`)
    }
    if ((reviewed.ref ?? null) !== (source.ref ?? null)) {
      identityIssues.push(`[${source.id}] 최신 확인 기록의 ref(${reviewed.ref ?? '기본'})가 현재 선언(${source.ref ?? '기본'})과 다릅니다.`)
    }
    if (recorded && (recorded.ref ?? null) !== (reviewed.ref ?? null)) {
      identityIssues.push(`[${source.id}] 최신 확인 기록의 ref가 기준 기록(${recorded.ref ?? '기본'})과 다릅니다.`)
    }

    // 캐시 저장소의 실제 origin까지 확인한다. 선언만 보면, 캐시 디렉터리를 통째로 다른
    // 저장소로 바꿔치기해 "실재하는 commit"을 공급할 수 있다(3차 리뷰 P1-2).
    let origin = null
    try {
      origin = runGit(['remote', 'get-url', 'origin'], cacheDirFor(source.id))
    } catch {
      origin = null
    }
    if (origin !== null && origin !== source.repo) {
      identityIssues.push(`[${source.id}] 로컬 캐시 저장소의 origin(${origin})이 선언(${source.repo})과 다릅니다.`)
    }

    // 한 번의 확인에서 나온 스냅샷은 모두 같은 commit이어야 한다. 문서별 commit만 갈아끼워
    // 과거로 되돌리는 조작을 여기서 잡는다.
    for (const [rel, snapshot] of Object.entries(reviewed.files ?? {})) {
      if (snapshot?.commit !== reviewed.commit) {
        identityIssues.push(`[${source.id}] '${rel}'의 스냅샷 commit이 그 확인의 commit과 다릅니다 — 기록이 조작되었을 수 있습니다.`)
      }
    }
  }
  if (identityIssues.length > 0) {
    console.error('최신 확인 기록이 지금 연동된 기획 저장소의 것이 아니어서 정산할 수 없습니다:')
    for (const message of identityIssues) console.error(`  - ${message}`)
    console.error('.harness/bin/harness spec:fetch --cache-only 로 현재 선언 기준의 최신 확인을 다시 수행하세요.')
    process.exitCode = 1
    return
  }

  const treeCache = new Map()
  // 어떤 commit의 selector 결과. 삭제 스냅샷이 "정말 그 시점에 없었는가"를 판정하는 근거다.
  const filesAtCommit = (dir, commit, selector, cacheKey) => {
    if (!treeCache.has(cacheKey)) {
      treeCache.set(cacheKey, new Set(selectSpecFilesAtCommit(dir, commit, selector)))
    }
    return treeCache.get(cacheKey)
  }

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded) continue
    const reviewed = latestManifest.sources?.[source.id]
    const selector = recorded.selector ?? normalizeSelector(source)
    let cacheDir = null
    try {
      cacheDir = cacheDirFor(source.id)
    } catch {
      cacheDir = null
    }
    const latestSourceRoot = specLatestDirPath(source.id)

    for (const rel of scopeDocs) {
      if (collisionRels.has(rel)) {
        if (!refusedCollision.includes(rel)) refusedCollision.push(rel)
        continue
      }

      const snapshot = reviewed?.files?.[rel]
      const inLock = rel in recorded.files

      // 기준이 그 사이 움직였으면 이 스냅샷은 낡았다 — 적용하면 기준이 뒤로 간다.
      if (snapshot && isStaleSnapshot(snapshot, recorded.files[rel])) {
        if (!staleSnapshots.includes(rel)) staleSnapshots.push(rel)
        continue
      }

      if (!snapshot) {
        // 검토 스냅샷이 없으면 정산할 수 없다. 삭제 정산도 "삭제되었음을 확인한 스냅샷"이 있어야 한다.
        if (inLock && recorded.files[rel]) {
          if (!notReviewed.includes(rel)) notReviewed.push(rel)
        } else if (!missing.includes(rel)) {
          missing.push(rel)
        }
        continue
      }

      // ② 스냅샷 commit이 실재하는가. 형식부터 확인해야 임의 문자열이 git 인자로 흘러가지 않는다.
      const commit = String(snapshot.commit ?? '')
      if (!/^[0-9a-f]{7,64}$/.test(commit)) {
        provenanceFailures.push({ rel, reason: '스냅샷에 기록된 commit 형식이 올바르지 않습니다' })
        continue
      }
      if (!cacheDir || !commitAvailable(cacheDir, commit)) {
        provenanceFailures.push({ rel, reason: `스냅샷 commit ${commit.slice(0, 10)}이 로컬 기획 이력에 없습니다` })
        continue
      }

      // ②-b 정산은 **앞으로만** 간다. baseSha CAS는 "읽은 뒤 기준이 움직였는가"만 보므로,
      //     실재하는 옛 commit으로 스냅샷을 갈아끼우면 기준이 조용히 후퇴한다(3차 리뷰 P1-2).
      //
      //     lock에 없는 문서도 검사한다. null로 두면 commitDirection이 'same'을 돌려줘 검사가
      //     통째로 건너뛰어지고, **과거에 있다가 지워진 문서를 옛 commit에서 "신규"로 되살릴 수**
      //     있었다(4차 리뷰 P1-4). 기준이 없으면 소스의 기준 commit과 비교한다.
      const lockedCommit = inLock
        ? (recorded.files[rel].commit ?? recorded.commit ?? null)
        : (recorded.commit ?? null)
      const direction = commitDirection(cacheDir, lockedCommit, commit)
      if (direction === 'behind') {
        provenanceFailures.push({ rel, reason: `commit ${commit.slice(0, 10)}은 현재 기준(${String(lockedCommit).slice(0, 10)})보다 과거입니다 — 정산으로 기준을 되돌릴 수 없습니다` })
        continue
      }
      if (direction === 'diverged') {
        provenanceFailures.push({ rel, reason: `commit ${commit.slice(0, 10)}과 현재 기준(${String(lockedCommit).slice(0, 10)})이 같은 이력에 없습니다 — 기준 재생성(--move-baseline)이 필요합니다` })
        continue
      }
      if (direction === 'unknown-base' || direction === 'unknown') {
        provenanceFailures.push({ rel, reason: `현재 기준(${String(lockedCommit).slice(0, 10)}) 대비 전진인지 확인할 수 없습니다(로컬 기획 이력이 부족) — .harness/bin/harness spec:fetch --cache-only 로 이력을 채운 뒤 다시 정산하세요` })
        continue
      }

      if (snapshot.deleted) {
        // ④ 삭제는 "그 시점 기획에 없음"을 git 트리로 확인한다. manifest의 deleted 표시만 믿으면
        //    표시 한 줄로 살아 있는 문서를 기준에서 지울 수 있다(재리뷰 P1-1).
        let tree
        try {
          tree = filesAtCommit(cacheDir, commit, selector, `${source.id}@${commit}`)
        } catch (error) {
          provenanceFailures.push({ rel, reason: `그 시점 문서 목록을 읽지 못했습니다: ${String(error.message ?? error).split('\n')[0]}` })
          continue
        }
        if (tree.has(rel)) {
          provenanceFailures.push({ rel, reason: `삭제로 기록됐지만 commit ${commit.slice(0, 10)}에는 문서가 살아 있습니다` })
          continue
        }
        if (inLock) plan.push({ sourceId: source.id, rel, kind: 'remove' })
        continue
      }

      // ③ 본문 sha가 그 commit의 git 객체와 같은가(= 기획 이력에 실재하는 내용인가).
      const fromGit = gitShowText(cacheDir, commit, rel)
      if (fromGit === null) {
        provenanceFailures.push({ rel, reason: `commit ${commit.slice(0, 10)}에 이 문서가 없습니다` })
        continue
      }
      if (sha256Text(fromGit) !== snapshot.sha) {
        provenanceFailures.push({ rel, reason: '기록된 해시가 기획 이력의 내용과 다릅니다' })
        continue
      }

      // 꺼내둔 본문이 손으로 바뀌었으면 정산하지 않는다(사람이 읽은 것과 기록이 어긋난 상태).
      let onDisk = null
      try {
        onDisk = latestSourceRoot ? readSafeFile(latestSourceRoot, rel) : null
      } catch {
        onDisk = null
      }
      if (onDisk === null || sha256Text(onDisk) !== snapshot.sha) {
        provenanceFailures.push({ rel, reason: '읽어본 본문이 기록과 다릅니다(임의 수정)' })
        continue
      }

      if (inLock && recorded.files[rel].sha === snapshot.sha && recorded.files[rel].commit === commit) {
        unchanged.push(rel)
        continue
      }

      plan.push({ sourceId: source.id, rel, kind: 'settle', sha: snapshot.sha, commit })
    }
  }

  if (staleSnapshots.length > 0) {
    // 낡은 스냅샷은 조용히 버리지 않고 알린다 — 사용자는 "정산했다"고 믿을 수 있다.
    dropLatestSnapshots(latestManifest, staleSnapshots)

    console.error('읽은 시점 이후 기준이 이미 바뀌어 정산하지 않았습니다 (기준을 뒤로 돌리지 않습니다):')
    for (const rel of staleSnapshots) {
      console.error(`  - ${rel}`)
    }
    console.error('.harness/bin/harness spec:fetch --cache-only 로 최신을 다시 확인한 뒤 정산하세요.')
    process.exitCode = 1
    return
  }

  if (notReviewed.length > 0) {
    console.error('아직 읽지 않은 문서는 정산할 수 없습니다 (정산 = "이 내용을 확인했다"는 선언입니다):')
    for (const rel of notReviewed) {
      console.error(`  - ${rel}`)
    }
    console.error('먼저 .harness/bin/harness spec:fetch --cache-only 로 최신을 확인하고, 꺼내진 본문을 읽은 뒤 다시 정산하세요.')
    process.exitCode = 1
    return
  }

  if (provenanceFailures.length > 0) {
    console.error('기획 이력으로 확인되지 않는 내용이라 정산을 중단합니다 (lock은 그대로 두었습니다):')
    for (const failure of provenanceFailures) {
      console.error(`  - ${failure.rel}: ${failure.reason}`)
    }
    console.error('기준(lock)에는 기획 저장소에 실제로 있는 내용만 들어갑니다.')
    console.error('.harness/bin/harness spec:fetch --cache-only 로 최신을 다시 확인한 뒤 정산하세요.')
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

  // 화면 기획의 원자성: 한 단위(MD+HTML)는 **같은 commit 기준으로 함께** 반영되거나 전부 보류된다.
  // 한쪽만 계획에 남으면 lock에 "정책은 B, 화면은 A" 혼합 상태가 만들어진다(기획자 합의 계약).
  {
    const partialUnits = []
    const plannedByRel = new Map(plan.map((item) => [item.rel, item]))
    const seenUnits = new Set()
    for (const item of plan) {
      const source = state.sources.find((candidate) => candidate.id === item.sourceId)
      const unit = source ? screenIndexForSource(source)?.unitFor(item.rel) : null
      if (!unit || seenUnits.has(unit.id)) continue
      seenUnits.add(unit.id)

      const members = unit.files.map((file) => plannedByRel.get(file))
      const settledMembers = members.filter((member) => member?.kind === 'settle')
      const removedMembers = members.filter((member) => member?.kind === 'remove')

      // 이미 기준과 같아 계획에 없는 쪽(unchanged)은 정상이다 — 그 경우 짝의 commit이 같아야 한다.
      const unchangedMembers = unit.files.filter((file) => !plannedByRel.has(file) && unchanged.includes(file))
      if (removedMembers.length > 0 && removedMembers.length !== unit.files.length) {
        partialUnits.push({ unit: unit.id, reason: '한쪽만 삭제로 정산되려 합니다' })
        continue
      }
      if (removedMembers.length === unit.files.length) continue
      if (settledMembers.length + unchangedMembers.length !== unit.files.length) {
        partialUnits.push({ unit: unit.id, reason: '짝 문서 중 일부만 정산할 수 있는 상태입니다' })
        continue
      }
      const commits = new Set(settledMembers.map((member) => member.commit))
      for (const file of unchangedMembers) {
        commits.add(state.lock.sources[item.sourceId].files[file].commit)
      }
      if (commits.size > 1) {
        partialUnits.push({ unit: unit.id, reason: 'MD와 HTML이 서로 다른 시점이 됩니다(혼합 기준 금지)' })
      }
    }

    if (partialUnits.length > 0) {
      console.error('화면 기획은 MD와 HTML을 함께 정산합니다 (한쪽만 반영하지 않습니다):')
      for (const item of partialUnits) {
        console.error(`  - ${item.unit}: ${item.reason}`)
      }
      console.error('.harness/bin/harness spec:fetch --cache-only 로 두 파일을 함께 확인한 뒤 다시 정산하세요.')
      process.exitCode = 1
      return
    }
  }

  // 같은 경로가 다른 소스에서 정산·일치로 처리됐다면 "없음"이 아니다.
  const plannedRels = new Set(plan.map((item) => item.rel))
  const realMissing = missing.filter((rel) => !plannedRels.has(rel) && !unchanged.includes(rel))

  // ── 여기부터 적용 단계. 위 검증을 전부 통과했을 때만 도달한다. ──
  applyPendingPromotion()

  if (plan.length === 0) {
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

  for (const item of plan) {
    const files = state.lock.sources[item.sourceId].files
    if (item.kind === 'remove') {
      delete files[item.rel]
      removed.push(item.rel)
    } else {
      files[item.rel] = { sha: item.sha, commit: item.commit }
      settled.push(item.rel)
    }
  }

  writeJson(lockPath, serializeLock(state.lock))

  // 기준이 움직였으니 기준 본문(spec-cache)도 새 기준으로 맞춘다.
  // 성공하면 캐시 == lock. 실패하면 lock이 정본이고 캐시는 어긋난 채 남으며, 그 소스는
  // 컨텍스트 주입에서 제외된다(reportHydrationAfterLockChange가 복구 경로를 안내한다).
  reportHydrationAfterLockChange(hydrateSpecCacheIfStale({ timeoutMs: 30000 }))

  // 정산된 스냅샷은 소비됐다. manifest 항목과 최신 사본 파일을 함께 지워
  // "아직 안 읽은 변경"만 남긴다(남겨두면 이미 기준이 된 내용이 계속 최신 변경처럼 보인다).
  dropLatestSnapshots(latestManifest, plan.map((item) => item.rel))

  console.log('기획 문서 정산 완료 (읽고 확인한 문서만 기준 전진)')
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
  console.log('정산은 "이 기획 변경을 살펴봤다"는 선언입니다. 영향 없음이 자명하지 않으면 근거를 decision-log에 남기고(자명하면 커밋 메시지로 충분),')
  console.log(`${toPosix(path.relative(repoRoot, lockPath))} 변경을 커밋에 포함해 다시 push 하세요.`)
  if (realMissing.length > 0) process.exitCode = 1
}

// 혼성 채널(기획자+개발자)용 알림 본문 — CI 백스톱이 웹훅으로 보내는 메시지의 정본.
//
// 문구가 셸(yaml)이 아니라 여기 있는 이유: 셸에서 오려 붙이면 검증할 수 없고, 실제로 status 문구가
// 바뀌면서 grep 마커가 11개 릴리스 동안 조용히 죽어 있었다(2026-08-12 발견). 도구가 완성문을 내면
// 회귀로 잠글 수 있다.
//
// 언어 규칙(결정 77): 알림은 수신자의 언어로 말한다. 이 채널에는 기획자가 있으므로 정산·매핑·lock
// 같은 개발 용어를 쓰지 않는다(회귀가 금지어로 단언). 말하는 사실은 도구가 아는 것까지만 —
// "확인 기록이 없다". 채근·경과일·사람 지목은 하지 않는다(결정 75, 길라잡이 원칙).
// 화면(.html)을 대표 문서 단위로 접는다 — 문서+화면은 확인도 원자(한 도장)고 담당도 문서의 매핑을
// 따르는데, 따로 세면 한 건이 두 줄로 부풀고 화면 줄이 "담당 없음"처럼 보인다(첫 실전 알림에서 실증).
// 알림(broadcast)과 status의 감지 건수가 이 접기를 공유해야 같은 변경이 채널에서는 1건,
// 터미널에서는 2건으로 갈라지지 않는다(결정 79: 알림 표시 단위 = 확인 단위).
export function foldToScreenUnits(items, screenIndexes) {
  const units = new Map()
  for (const item of items) {
    const unit = screenIndexes[item.source]?.unitFor(item.file)
    const primary = unit?.primary ?? item.file
    const key = `${item.source}\u0000${primary}`
    const entry = units.get(key) ?? { source: item.source, file: primary, kinds: new Set(), hasScreen: false }
    if (item.kind) entry.kinds.add(item.kind)
    if (unit && item.file !== unit.primary) entry.hasScreen = true
    units.set(key, entry)
  }
  return [...units.values()]
}

function buildBroadcastMessage() {
  const state = readSpecState()
  if (!state.declared) return null
  if (!state.valid) {
    // 비차단이지만 무음도 아니다(0.2.102 P2-6): 상태가 깨졌을 때 조용하면 "변경 없음"과 구분이 안 된다.
    return '[기획-개발 동기화] 연동 상태를 읽을 수 없어 확인이 필요합니다 (개발리더 확인)'
  }
  let pending = []
  let latestSourceCount = 0
  try {
    latestSourceCount = Object.keys(readLatestManifest().sources ?? {}).length
    pending = pendingSettlements(state.lock)
  } catch {
    return '[기획-개발 동기화] 최신 확인 기록을 읽을 수 없어 확인이 필요합니다 (개발리더 확인)'
  }
  if (pending.length === 0) {
    // 무음의 두 가지 뜻을 구분한다(0.2.121): "변경이 없어서 조용"과 "최신 확인을 안 해서 몰라서 조용"은
    // 다른 상태다. 최신 확인 기록이 하나도 없으면 이 명령 혼자서는 변경 여부를 알 수 없는데, 조용히
    // 끝나면 "미확인 변경 0건"으로 오판된다(멀티사이트 실증). fetch --cache-only는 변화가 없어도
    // 소스별 기록을 항상 남기므로, 정상 CI 순서(fetch --cache-only → broadcast)는 이 분기에 오지 않는다.
    if (state.lock.exists && latestSourceCount === 0) {
      return '[기획-개발 동기화] 최신 확인 기록이 없어 기획 변경 여부를 알 수 없습니다 — 먼저 .harness/bin/harness spec:fetch --cache-only 를 실행하세요 (개발리더 확인)'
    }
    return null
  }

  // 화면(.html)은 대표 문서로 접는다 — 문서+화면은 확인도 원자(한 도장)고 담당도 문서의 매핑을
  // 따르는데, 따로 세면 한 건이 두 줄로 부풀고 화면 줄이 "담당 없음"처럼 보인다(첫 실전 알림에서 실증).
  const screenIndexes = screenIndexesFromCache(state)
  const folded = foldToScreenUnits(pending, screenIndexes)

  const KIND = { '변경': '수정', '추가': '신규', '삭제': '삭제' }
  const MAX_DOCS = 15
  const lines = []
  lines.push(`[기획-개발 동기화] 개발팀이 아직 확인하지 않은 기획 변경이 있습니다 (${folded.length}건)`)
  lines.push('')
  // "주소를 깜빡한 문서"와 "구현 대상이 아니라고 판정을 끝낸 문서"는 다른 상태다 — 라벨도 구분한다.
  // 후자를 "아직 없음"으로 말하면 매핑 누락처럼 읽힌다(2026-08-12 지적). 라우팅은 둘 다 리더:
  // 판정 문서가 움직였으면 그 판정을 유지할지 재판단하는 것도 판정을 내린 쪽의 몫이다.
  const judgedSpecs = new Set(readSpecMapExemptions().specs)
  for (const entry of folded.slice(0, MAX_DOCS)) {
    // 글롭 꼬리(/**)는 표시에서 뗀다 — Mattermost가 **를 굵게 마커로 먹어 별표가 사라지고(실증),
    // 혼성 채널에서 /**는 개발 표기다. 매핑 자체는 불변, 표시만 정리한다.
    const linked = linkedCodePaths(entry.file, state.entries).map((p) => p.replace(/\/\*+$/, ''))
    const owner = linked.length > 0
      ? `담당 코드: ${linked.join(', ')}`
      : judgedSpecs.has(entry.file)
        ? '구현 대상 아님으로 판정된 문서 — 개발리더 확인'
        : '담당 코드 아직 없음 (개발리더 확인)'
    const kind = entry.kinds.has('변경') ? '수정' : entry.kinds.has('추가') ? '신규' : (KIND[[...entry.kinds][0]] ?? [...entry.kinds][0])
    const screenSuffix = entry.hasScreen ? ' (화면 포함)' : ''
    lines.push(`  - (${kind}) ${entry.file.replace(/\.md$/i, '')}${screenSuffix} — ${owner}`)
  }
  if (folded.length > MAX_DOCS) lines.push(`  … 외 ${folded.length - MAX_DOCS}건`)
  lines.push('')
  lines.push('기획팀: 따로 하실 일 없습니다. 개발팀이 확인하면 이 알림은 멈춥니다.')
  lines.push('개발팀: 담당 코드가 내 영역이면, 그 프로젝트에서 /기획확인 을 입력하세요.')
  lines.push('       (확인 기록은 커밋·푸시까지 되어야 알림이 멈춥니다)')
  return lines.join('\n')
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

  console.log('기획 문서 연동 상태')
  console.log('')

  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    console.log(`- ${source.id}: ${source.repo}${source.ref ? ` (${source.ref})` : ''}`)
    if (!recorded) {
      console.log(`  기준 시점 없음 — .harness/bin/harness spec:fetch${state.lock.exists ? ` --move-baseline --source ${source.id}` : ''} 로 먼저 편입합니다.`)
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

  // 화면 기획 쌍 무결성 — 기준 기록 자체가 반쪽인 상태를 상태 화면에서 바로 보여준다.
  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded) continue
    const files = Object.keys(recorded.files ?? {})
    const links = screenLinksFor(recorded, source)
    let dir
    try {
      dir = cacheDirFor(source.id)
    } catch {
      continue
    }
    // 기준 본문(캐시)에서 판정한다 — 본문이 아직 없으면 위의 "본문 준비 안 됨"이 먼저 안내한다.
    const index = buildScreenIndex(files, (rel) => {
      try {
        return readSafeFile(dir, rel)
      } catch {
        return null
      }
    }, links)
    const issues = findScreenLinkIssues(files, index)
    if (issues.length === 0) continue
    console.log('')
    console.log(`화면 링크 불일치 (${source.id}):`)
    for (const line of formatScreenLinkIssues(issues)) console.log(`  - ${line}`)
    console.log('  기획 문서가 링크한 화면은 기준에 함께 들어와야 합니다. 기획팀에 확인하세요.')
    process.exitCode = 1
  }

  if (state.collisions.length > 0) {
    console.log('')
    console.log('경로 충돌: 같은 문서 경로가 여러 소스에 있습니다 (매핑이 모호해집니다):')
    for (const item of state.collisions) {
      console.log(`  - ${item.rel} (${item.sourceIds.join(', ')})`)
    }
  }

  // 기준 본문 준비 상태(캐시가 lock과 일치하는가). 미정산과는 다른 축이다.
  const notReady = []
  for (const source of state.sources) {
    const recorded = state.lock.sources[source.id]
    if (!recorded?.commit) continue
    let dir
    try {
      dir = cacheDirFor(source.id)
    } catch {
      continue
    }
    const match = specCacheMatchesLock(dir, recorded, source)
    if (!match.matches) notReady.push({ id: source.id, reason: match.reason })
  }

  if (notReady.length > 0) {
    console.log('')
    console.log('기준 본문이 아직 준비되지 않았습니다(읽을 수 없는 상태):')
    for (const item of notReady) {
      console.log(`  - ${item.id} (${item.reason})`)
    }
    console.log('- 준비: .harness/bin/harness spec:fetch --at-lock  (팀 기준 시점 그대로, 기준은 옮기지 않습니다)')
  }

  console.log('')
  console.log(`매핑: ${state.entries.length}건 (${specMapRel})`)

  // 도입 직후에는 "매핑되지 않은 기획"이 곧 할 일 목록이다.
  const screenIndexes = screenIndexesFromCache(state)
  const exemptions = readSpecMapExemptions()
  const unmapped = findUnmappedSpecs(state.lock, state.entries, exemptions, screenIndexes)

  if (state.entries.length === 0 && unmapped.length > 0) {
    console.log('')
    console.log(`기획 ${unmapped.length}건이 연동됐고 매핑은 아직 0건입니다. 정상적인 시작 상태입니다.`)
    console.log('기능을 만들면서 한 줄씩 채우면, 그때부터 그 기획이 바뀔 때 이 코드로 연결됩니다.')
  }

  if (unmapped.length > 0) {
    console.log('')
    console.log(`매핑되지 않은 기획: ${unmapped.length}건 — 기획 변경 알림이 코드로 연결되지 않은 문서입니다`)
    for (const item of unmapped.slice(0, 15)) {
      console.log(`  - ${item.file}`)
    }
    if (unmapped.length > 15) console.log(`  - 외 ${unmapped.length - 15}건`)
    console.log('  구현할 때 에이전트에게 "매핑 추가해줘"라고 하면 근거와 함께 한 줄 넣습니다.')
    console.log('  구현 대상이 아닌 문서는 판정으로 남깁니다: | <문서> | (코드 없음) | 사유 |')
  }

  // 문서와 그 문서가 링크한 화면이 기준에서 어긋나 있으면, 컨텍스트가 서로 다른 시점을 제시하게 된다.
  const lockScreenIssues = findLockScreenIssues(state.lock, screenIndexes)
  if (lockScreenIssues.length > 0) {
    console.log('')
    console.log('문서와 화면의 기준이 어긋나 있습니다:')
    for (const line of formatLockScreenIssues(lockScreenIssues)) {
      console.log(`  - ${line}`)
    }
    console.log('  .harness/bin/harness spec:fetch --cache-only 로 확인한 뒤 다시 정산하면 같은 시점으로 맞춰집니다.')
    process.exitCode = 1
  }

  // 미정산 = 읽었지만 아직 기준에 반영하지 않은 문서(spec-latest manifest 기준).
  let pending = []
  try {
    pending = pendingSettlements(state.lock)
  } catch (error) {
    console.log('')
    console.log(`⚠ ${String(error.message ?? error)}`)
    console.log('  .harness/bin/harness spec:fetch --cache-only 로 최신 확인을 다시 수행하면 기록이 재생성됩니다.')
    process.exitCode = 1
  }
  if (pending.length > 0) {
    console.log('')
    console.log('읽었지만 아직 정산하지 않은 기획 변경:')
    for (const item of pending) {
      const linked = linkedCodePaths(item.file, state.entries)
      const suffix = item.kind === '추가'
        ? ' (매핑 검토 대상)'
        : linked.length > 0 ? ` → 연결 코드: ${linked.join(', ')}` : ' (매핑 없음)'
      console.log(`  - [${item.kind}] ${item.file}${suffix}`)
    }
    console.log('')
    console.log('판단: 구현에 영향을 주면 코드/테스트를 반영합니다. 영향 없음이 자명하면 커밋 메시지 한 줄, 자명하지 않은 판단만 decision-log에 남깁니다.')
    console.log('확인이 끝났으면 .harness/bin/harness spec:settle 로 정산합니다.')
  } else if (state.lock.exists && notReady.length === 0) {
    // "읽고"를 명시한다 — 아래 "마지막 최신 확인"의 원격 감지와는 다른 축이라, 축을 안 밝히면
    // 두 줄이 모순처럼 읽힌다(멀티사이트 실증: "정산 대기 없음" + "감지 2건"을 버그로 의심).
    console.log('읽고 아직 정산하지 않은 기획 변경이 없습니다.')
  }

  // 마지막 최신 확인 결과(있으면). 이 명령 자체는 네트워크를 쓰지 않는다.
  // 감지 건수는 broadcast와 같은 화면 접기 단위로 센다(결정 79) — 같은 변경이
  // 채널에서는 1건, 여기서는 2건으로 갈라지면 안 된다.
  const lastFreshness = readHydrationStatus()?.freshness
  if (lastFreshness?.checkedAt) {
    const detectedItems = [
      ...(lastFreshness.changed ?? []),
      ...(lastFreshness.added ?? []),
      ...(lastFreshness.removed ?? []),
    ]
    const detected = foldToScreenUnits(detectedItems, screenIndexes).length
    console.log('')
    console.log(`마지막 최신 확인: ${lastFreshness.checkedAt} — 기준 이후 원격 변경 ${detected}건`)
    if (detected > 0) {
      console.log('  위의 정산 대기와는 다른 축입니다(원격 확인 결과 — 아직 본문을 받지 않았을 수 있습니다).')
      console.log('  본문 받기·검토: .harness/bin/harness spec:fetch --cache-only (기준은 옮기지 않습니다)')
    }
  }

  console.log('')
  console.log('원격 최신 여부는 이 명령이 확인하지 않습니다(네트워크 미사용). 최신 확인은 .harness/bin/harness spec:fetch --cache-only 입니다.')
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

  // freshness: 작업 시작 시 최신 확인(비파괴). 기준도 캐시 본문도 건드리지 않는다.
  if (mode === 'freshness') {
    const freshness = checkSpecFreshness({
      timeoutMs: Number(args.find((value, index) => args[index - 1] === '--timeout-ms')) || 6000,
    })
    if (args.includes('--json')) {
      console.log(JSON.stringify(freshness, null, 2))
      return
    }
    if (!freshness.checked) {
      console.log(`최신 기획 확인 실패(${freshness.reason ?? '알 수 없음'}) — 팀 기준(lock) 문서로 진행합니다.`)
      return
    }
    console.log(`최신 기획 확인 완료: 변경 ${freshness.changed.length} / 기준에 없음 ${freshness.added.length} / 삭제 ${freshness.removed.length}`)
    for (const item of [...freshness.changed, ...freshness.added].slice(0, 10)) {
      console.log(`  - ${item.file}`)
    }
    return
  }

  // hydrate: 훅과 백스톱이 쓰는 조용한 수화. 기준은 옮기지 않고, 실패해도 종료 코드는 0이다.
  if (mode === 'hydrate') {
    const quiet = args.includes('--quiet')
    const result = hydrateSpecCacheIfStale({
      onlyWhenMissing: args.includes('--only-when-missing'),
      timeoutMs: Number(args.find((value, index) => args[index - 1] === '--timeout-ms')) || 15000,
    })

    // 비차단과 무음은 다르다(0.2.102 리뷰 P2-6): 종료 코드는 0을 유지하되 실패는 반드시 보이게 하고,
    // 상태 파일에 남겨 다음 컨텍스트 생성이 미해결 실패를 다시 표면화한다.
    const previous = readHydrationStatus() ?? {}
    writeHydrationStatus({
      ...previous,
      hydration: {
        at: new Date().toISOString(),
        hydrated: result.hydrated,
        failures: result.failures,
        skipped: result.skipped,
      },
    })

    if (jsonOutput) {
      // 호출자(build-context)가 "이번 실행의" 실패 소스를 알아야 그 본문을 사양으로 쓰지 않는다.
      console.log(JSON.stringify(result, null, 2))
      return
    }

    if (!quiet && result.hydrated.length > 0) {
      console.log(`[harness] 기획 문서 본문을 팀 기준 시점으로 받았습니다: ${result.hydrated.join(', ')}`)
    }
    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        console.log(`[harness] 기획 본문 준비 실패 (${failure.id}): ${failure.reason}`)
      }
      console.log('  pull은 완료됐지만 에이전트가 기획 본문을 읽을 수 없습니다. 개발 작업 전에 다시 받아야 합니다.')
      console.log('  재시도: .harness/bin/harness spec:fetch --at-lock')
    }
    return
  }

  if (mode === 'broadcast') {
    const message = buildBroadcastMessage()
    // null = 알릴 것 없음(또는 미연동) → 완전 무음. yaml은 출력이 비었는지로 전송 여부를 판정한다.
    if (message !== null) {
      // --json은 웹훅에 그대로 POST 가능한 payload를 낸다. 셸에서 손으로 이스케이프하다
      // 개행에 깨지는 부류의 버그를 원천 차단한다(JSON 제어문자 이스케이프는 여기서 끝).
      console.log(jsonOutput ? JSON.stringify({ text: message }) : message)
    }
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

  // 기획 저장소 자체 CI에서도 같은 판정을 돌릴 수 있게 독립 명령으로 제공한다.
  // 개발 저장소 연동과 무관하게, 대상 디렉터리의 화면 링크 무결성만 검사한다.
  if (mode === 'screen-check') {
    const targetIndex = args.indexOf('--dir')
    const root = path.resolve(targetIndex >= 0 && args[targetIndex + 1] ? args[targetIndex + 1] : process.cwd())
    const state = readSpecState()
    const declared = state.valid && state.sources.length > 0 ? state.sources[0] : null
    const links = normalizeScreenLinks(declared ?? {}) ?? []
    const selector = normalizeSelector(declared ?? {})
    const files = selectSpecFilesBySelector(root, selector, links)
    const index = buildScreenIndex(files, (rel) => {
      try {
        return readSafeFile(root, rel)
      } catch {
        return null
      }
    }, links)
    const issues = findScreenLinkIssues(files, index)

    if (jsonOutput) {
      console.log(JSON.stringify({ root, screenLinks: links, checked: files.length, screens: index.ownerByScreen.size, issues }, null, 2))
      if (issues.length > 0) process.exitCode = 1
      return
    }
    if (issues.length === 0) {
      console.log(`화면 링크 검사 통과 (문서 ${files.length}건, 화면 ${index.ownerByScreen.size}건)`)
      return
    }
    console.error('기획 문서의 화면 링크가 맞지 않습니다:')
    for (const line of formatScreenLinkIssues(issues)) console.error(`  - ${line}`)
    console.error('')
    console.error('기획 문서가 화면을 링크하면 그 파일이 저장소에 있어야 합니다 (예: [화면](./로그인.html)).')
    console.error('화면이 없는 정책 문서는 링크 없이 그대로 두면 됩니다.')
    process.exitCode = 1
    return
  }

  console.error(`Unknown mode: ${mode}`)
  console.error('사용법: node .harness/bin/spec-sync.mjs [fetch|status|settle|hydrate|freshness|screen-check] [--cache-only|--at-lock|--move-baseline] [--source <id>] [--doc <경로>] [--dir <경로>] [--json]')
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
