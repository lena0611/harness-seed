#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 기획 본문 읽기는 spec-sync의 안전 경로만 쓴다. 여기서 path.join + readFileSync로 직접 읽으면
// 루트·중간·leaf 심볼릭 링크를 그대로 따라가, 쓰기는 막고 읽기는 뚫리는 비대칭이 생긴다(재리뷰 P1-2).
import { buildScreenIndex, normalizeScreenLinks, readSpecCacheDoc, specCacheDirPath } from './spec-sync.mjs'

function sha256Text(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRoot = path.join(repoRoot, '.harness')
const registryPath = path.join(harnessRoot, 'documentation', 'document-registry.json')
// 프로젝트 소유 등록 지점(0.2.131). 프로젝트가 만든 문서도 컨텍스트 후보에 들어가야 한다 —
// orphan 경고만 없애는 우회(면제 glob)를 기각한 이유가 이것이다.
const localRegistryPath = path.join(harnessRoot, 'documentation', 'document-registry.local.json')
const contextRegistryPath = path.join(harnessRoot, 'documentation', 'context-registry.json')
const skillRegistryPath = path.join(harnessRoot, 'skills', 'registry.json')
const outputPath = path.join(harnessRoot, 'session', 'task-context.md')

const args = process.argv.slice(2)
const stdoutOnly = args.includes('--stdout')
const syncFirst = args.includes('--sync')
const limitIndex = args.indexOf('--limit')
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1] ?? 12) : 12
const task = args
  .filter((arg, index) => (
    arg !== '--stdout' &&
    arg !== '--sync' &&
    arg !== '--limit' &&
    !(limitIndex >= 0 && index === limitIndex + 1)
  ))
  .join(' ')
  .trim()

const alwaysRead = [
  'CLAUDE.md',
  '.harness/policy/ai-standard-guiding-policy.md',
  '.harness/session/session-start-alert.md',
  '.harness/session/active-context.md',
]

const generatedFiles = [
  '.harness/generated/project-map.md',
  '.harness/generated/import-map.md',
  '.harness/generated/detected-patterns.md',
]

const taskTypeRules = [
  { type: 'bugfix', keywords: ['버그', '오류', '에러', '실패', '깨짐', '안됨', '수정', '고쳐', 'fix', 'bug'] },
  // '개발'은 한국어에서 가장 흔한 표현인데 빠져 있었다 — "003 페이지 개발해줘"가 unknown/low로 떨어져
  // 유형 가점이 죽고 엉뚱한 스킬(운영 업무 접수)이 올라왔다(2026-08-11 multisite 실측).
  { type: 'feature', keywords: ['추가', '생성', '구현', '기능', '신규', '만들', '개발', 'feature', 'add'] },
  { type: 'verification', keywords: ['커밋', '검증', '마무리', '완료', '메시지', 'commit', 'check', 'lint', 'build', 'test'] },
  { type: 'refactor', keywords: ['리팩터', '리팩토', '정리', '구조 개선', '개선', '분리', 'refactor'] },
  { type: 'docs', keywords: ['문서', 'readme', '가이드', '설명', 'docs'] },
  { type: 'review', keywords: ['검토', '리뷰', '살펴', '비교', '확인', 'review'] },
  { type: 'maintenance', keywords: ['업데이트', '배포', '버전', '태그', '릴리스', '갱신', 'update', 'deploy'] },
  { type: 'ui', keywords: ['ui', '화면', '디자인', '컴포넌트', '버튼', '레이아웃', 'safe area', 'theme', '테마', '모바일'] },
  { type: 'supabase', keywords: ['supabase', 'edge function', 'edge', 'rls', 'secret', 'api key'] },
  { type: 'native', keywords: ['ios', 'android', 'native', '네이티브', 'capability', '권한'] },
  { type: 'domain-logic', keywords: ['도메인', '알고리즘', '추론', '분류', '계산', '규칙', 'rule', 'policy'] },
]

const conflictOrder = [
  '회사 공통 필수 차단 기준',
  '사용자의 명시 지시',
  '프로젝트 기준',
  '템플릿 사용 계약',
  '스택 기준',
  '회사 공통 기본 운영 기준',
  '개인 기준',
  '에이전트 기본값',
]

const requiredOutputs = [
  '영향 범위 분석',
  '구현 또는 수정 계획',
  '코드/문서 변경',
  '검증 결과',
  '로컬룰 승격 후보',
]

function toPosix(p) {
  return p.split(path.sep).join('/')
}

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel))
}

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8')
}

function readProfileSources() {
  if (!exists('.harness/policy/profile.json')) {
    return []
  }

  try {
    const profile = JSON.parse(read('.harness/policy/profile.json'))
    return Array.isArray(profile.sources) ? profile.sources : []
  } catch {
    return []
  }
}

// 기획 문서 연동(0.2.99): 캐시에 받아둔 외부 기획 문서 중 이번 작업과 관련된 것만 후보로 올린다.
// 네트워크를 쓰지 않는다(캐시가 없으면 조용히 건너뛴다). 본문은 캐시에만 있고 저장소에 복사하지 않는다.
//
// 대상 문서 목록은 캐시를 훑지 않고 spec-lock.json의 files에서 읽는다. 캐시는 clone 산출물이라
// include/exclude로 걸러지지 않은 파일(README, archive 등)까지 들어 있고, 필터는 fetch 시점에만
// 적용되기 때문이다. lock을 단일 출처로 삼아야 "무엇이 현재 사양인가"가 한 곳에서 정해진다.
// lock에 소스가 있는데 로컬 캐시가 없는 소스 id 목록. "매칭 없음"과 "본문 없음"을 구분하는 근거다.
// 파일 경로가 작업 토큰과 관련 있는지. 본문을 아직 못 읽는 신규·변경 문서는 경로로만 판단한다.
function matchesTokens(filePath, tokens) {
  if (tokens.length === 0) return false
  const haystack = filePath.toLowerCase()
  return tokens.some((token) => haystack.includes(token))
}

function missingSpecCaches() {
  if (!exists('.harness/spec-lock.json')) return []
  let lock
  try {
    lock = JSON.parse(read('.harness/spec-lock.json'))
  } catch {
    return []
  }
  return Object.keys(lock?.sources ?? {})
    .filter((sourceId) => {
      const dir = specCacheDirPath(sourceId)
      return !dir || !fs.existsSync(dir)
    })
}

// 작업 시작 시 본문 준비 + 최신 확인. 둘 다 짧은 예산 안에서만 시도하고, 넘기면 즉시 진행한다.
// 개발자 체감(에이전트가 멈춘 것처럼 보임)을 위해 네트워크 대기 상한을 작게 잡는다(0.2.102 리뷰).
// 출력은 캡처해서 Agent Decision Context 본문을 오염시키지 않는다.
const SPEC_CONTEXT_BUDGET_MS = 8000

// 두 단계(본문 준비 + 최신 확인)가 공유하는 단일 예산. 순차 실행이라 각각 상한을 두면
// 실제 대기가 두 배가 된다(0.2.102 재리뷰 P2-1). 남은 시간을 계산해 넘겨준다.
//
// 남은 시간이 없으면 0을 돌려주고 호출자는 그 단계를 아예 건너뛴다. 최소 1초를 다시 주면
// "합계 8초"라는 문서상의 상한이 실제로는 지켜지지 않는다(0.2.103 재리뷰 P2-1).
const SPEC_MIN_STEP_MS = 1000
function specBudgetLeft(startedAt) {
  const left = SPEC_CONTEXT_BUDGET_MS - (Date.now() - startedAt)
  return left >= SPEC_MIN_STEP_MS ? left : 0
}

// 현재 실행의 stdout을 그대로 돌려준다. 과거 상태 파일로 대체하지 않는다 —
// 이번 실행이 실패했는데 예전 성공 결과를 쓰면 "최신 확인 못함" 경고가 사라진다(재리뷰 P1-1).
function runSpecSyncJson(cliArgs, budgetMs) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(harnessRoot, 'bin', 'spec-sync.mjs'), ...cliArgs], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: budgetMs,
    })
    return { ok: true, json: JSON.parse(stdout) }
  } catch (error) {
    return { ok: false, reason: String(error.message ?? error).split('\n')[0] }
  }
}

// 본문 준비. 실패한 소스는 "lock과 일치하지 않는 상태"이므로 그 본문을 사양으로 쓰지 않는다(재리뷰 P1-2).
function hydrateSpecCacheForContext(startedAt) {
  if (!exists('.harness/spec-lock.json')) return { failedSources: [], failures: [] }
  const budget = specBudgetLeft(startedAt)
  if (budget === 0) {
    return { failedSources: lockSourceIds(), failures: [{ id: '(전체)', reason: '시간 예산 소진 — 본문 준비를 건너뛰었습니다.' }] }
  }
  const run = runSpecSyncJson(['hydrate', '--json', '--timeout-ms', String(budget)], budget)
  if (!run.ok) {
    return { failedSources: lockSourceIds(), failures: [{ id: '(전체)', reason: run.reason }] }
  }
  const failures = run.json?.failures ?? []
  // '(전체)'는 소스 id가 아니라 전역 상태 오류다. 그대로 두면 후보 제외 비교(실제 source id)에
  // 걸리지 않아, 상태를 못 읽는 상황인데도 캐시 본문이 사양으로 주입된다(3차 리뷰 P2-3).
  const globalFailure = failures.some((item) => item.id === '(전체)')
  const failedSources = globalFailure
    ? [...new Set([...lockSourceIds(), ...failures.map((item) => item.id)])]
    : failures.map((item) => item.id)
  return { failedSources, failures }
}

// 최신 확인(비파괴). 결과는 반드시 이번 실행의 것이다.
function readSpecFreshness(startedAt) {
  if (!exists('.harness/spec-lock.json')) return null
  const budget = specBudgetLeft(startedAt)
  if (budget === 0) {
    return { checked: false, reason: '시간 예산 소진 — 최신 확인을 건너뛰었습니다.', changed: [], added: [], removed: [] }
  }
  const run = runSpecSyncJson(['freshness', '--json', '--timeout-ms', String(budget)], budget)
  if (!run.ok) {
    return { checked: false, reason: run.reason, changed: [], added: [], removed: [] }
  }
  return run.json ?? { checked: false, reason: 'no-output', changed: [], added: [], removed: [] }
}

function lockSourceIds() {
  try {
    return Object.keys(JSON.parse(read('.harness/spec-lock.json'))?.sources ?? {})
  } catch {
    return []
  }
}

function selectSpecCandidates(tokens, limitCount, unreliableSources = []) {
  if (tokens.length === 0 || !exists('.harness/spec-lock.json')) return []

  let lock
  try {
    lock = JSON.parse(read('.harness/spec-lock.json'))
  } catch {
    return []
  }
  if (!lock?.sources) return []

  const specMap = readSpecMapEntries()
  const candidates = []

  for (const [sourceId, recorded] of Object.entries(lock.sources)) {
    const cacheDir = specCacheDirPath(sourceId)
    if (!cacheDir || !fs.existsSync(cacheDir)) continue
    // 본문 준비에 실패한 소스는 캐시가 lock과 일치한다고 보장할 수 없다 —
    // 옛/변조 본문을 "현재 사양"으로 주입하지 않는다(0.2.102 재리뷰 P1-2).
    if (unreliableSources.includes(sourceId)) continue

    // 기준 본문에서 화면 링크 색인을 만든다 — 문서가 링크한 화면을 함께 제시하기 위함이다.
    const screenLinks = recorded?.screenLinks ?? normalizeScreenLinks({}) ?? []
    const screenIndex = buildScreenIndex(Object.keys(recorded?.files ?? {}), (rel) => readSpecCacheDoc(sourceId, rel), screenLinks)

    for (const rel of Object.keys(recorded?.files ?? {})) {
      // 링크를 따라가지 않고 일반 파일만 읽는다(없거나 안전하지 않으면 null).
      const content = readSpecCacheDoc(sourceId, rel)
      if (content === null) continue

      // lock 해시와 실제 내용이 다르면 그 문서도 신뢰할 수 없다.
      const lockedValue = recorded.files[rel]
      const lockedSha = typeof lockedValue === 'string' ? lockedValue : lockedValue?.sha
      if (lockedSha && sha256Text(content) !== lockedSha) continue

      const haystack = `${rel}\n${content}`.toLowerCase()
      const matched = tokens.filter((token) => haystack.includes(token))
      if (matched.length === 0) continue

      const relText = rel.toLowerCase()
      const score = matched.reduce((sum, token) => sum + (relText.includes(token) ? 6 : 2), 0)
      // 매핑 표에는 대표 문서만 적히므로, 링크된 화면의 연결 구현은 대표 문서에서 가져온다.
      const unit = screenIndex?.unitFor(rel) ?? null
      const mappingKey = unit ? unit.primary : rel
      const linked = specMap.filter((entry) => entry.spec === mappingKey).flatMap((entry) => entry.codePaths)
      candidates.push({
        source: sourceId,
        file: rel,
        score,
        matched: [...new Set(matched)],
        linked,
        // 화면 기획이면 짝과 검토 시점을 함께 제시한다 — 에이전트가 MD만 읽고 와이어프레임을
        // 놓치거나, HTML만 보고 정책을 놓치는 흐름을 막는다(기획자 합의 계약).
        // 문서가 링크한 화면이 있으면 함께 제시한다 — 에이전트가 정책만 읽고 화면을 놓치거나,
        // 화면만 보고 정책을 놓치는 흐름을 막는다(기획자 합의 계약).
        unit: unit ? { id: unit.id, primary: unit.primary, screens: unit.screens ?? [] } : null,
        // 화면별 기준 commit. 문서와 다르면 "같은 시점의 검토본"이라고 말하면 안 된다.
        screenCommits: Object.fromEntries((unit?.screens ?? []).map((screen) => {
          const locked = recorded?.files?.[screen]
          return [screen, typeof locked === 'object' ? locked?.commit ?? null : (locked ? recorded?.commit ?? null : undefined)]
        })),
        commit: typeof lockedValue === 'object' ? lockedValue?.commit ?? null : recorded?.commit ?? null,
      })
    }
  }

  // 같은 화면 기획의 MD/HTML이 각각 후보로 올라가면 자리만 차지한다 — 대표 문서로 합친다.
  const byUnit = new Map()
  const merged = []
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))) {
    const key = candidate.unit ? `${candidate.source}:${candidate.unit.id}` : null
    if (!key) {
      merged.push(candidate)
      continue
    }
    if (byUnit.has(key)) {
      const kept = byUnit.get(key)
      kept.matched = [...new Set([...kept.matched, ...candidate.matched])]
      continue
    }
    // 대표(MD)를 우선 표시하되 점수는 단위 최고점을 쓴다.
    const normalized = { ...candidate, file: candidate.unit.primary }
    byUnit.set(key, normalized)
    merged.push(normalized)
  }

  return merged.slice(0, limitCount)
}

function readSpecMapEntries() {
  if (!exists('.harness/project/spec-map.md')) return []
  return read('.harness/project/spec-map.md')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !/기획 문서/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2)
    .map(([spec, code]) => ({
      spec: spec.replaceAll('`', '').trim(),
      codePaths: code.split(',').map((item) => item.replaceAll('`', '').trim()).filter(Boolean),
    }))
    .filter((entry) => entry.spec && entry.spec !== 'TBD')
}

function readRegistryFiles() {
  const files = new Set()

  if (exists('.harness/documentation/document-registry.json')) {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    for (const group of registry.groups ?? []) {
      if (group.index) files.add(group.index)
      for (const child of group.children ?? []) files.add(child)
    }
  }

  if (exists('.harness/documentation/document-registry.local.json')) {
    const local = JSON.parse(fs.readFileSync(localRegistryPath, 'utf8'))
    for (const child of Array.isArray(local.children) ? local.children : []) files.add(child)
  }

  return [...files].filter((file) => exists(file)).sort()
}

function readContextRegistry() {
  if (!exists('.harness/documentation/context-registry.json')) {
    return { contexts: [] }
  }

  return JSON.parse(fs.readFileSync(contextRegistryPath, 'utf8'))
}

function readSkillRegistry() {
  if (!exists('.harness/skills/registry.json')) {
    return { skills: [] }
  }

  return JSON.parse(fs.readFileSync(skillRegistryPath, 'utf8'))
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .split(/[^a-z0-9가-힣_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function scoreFile(rel, tokens) {
  const content = read(rel).toLowerCase()
  const relText = rel.toLowerCase()
  let score = 0
  const matched = []

  for (const token of tokens) {
    if (relText.includes(token)) {
      score += 5
      matched.push(token)
      continue
    }

    const count = content.split(token).length - 1
    if (count > 0) {
      score += Math.min(count, 5)
      matched.push(token)
    }
  }

  if (rel.startsWith('.harness/project/')) score += 2
  if (rel.startsWith('.harness/policy/')) score += 1
  if (rel.startsWith('.harness/session/')) score += 1

  return { score, matched: [...new Set(matched)] }
}

function detectTaskType(tokens) {
  const scores = taskTypeRules
    .map((rule) => {
      const matched = rule.keywords.filter((keyword) => tokens.some((token) => token.includes(keyword) || keyword.includes(token)))
      return { type: rule.type, score: matched.length, matched }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type))

  if (scores.length === 0) {
    return {
      type: 'unknown',
      confidence: 'low',
      reason: '작업 설명에서 작업 유형 키워드를 찾지 못했습니다.',
    }
  }

  const top = scores[0]
  return {
    type: top.type,
    confidence: top.score >= 2 ? 'medium' : 'low',
    reason: `${top.matched.join(', ')} 키워드 감지`,
  }
}

function scoreContextEntry(entry, tokens, taskType) {
  const relText = String(entry.file ?? '').toLowerCase()
  const text = [
    entry.id,
    entry.title,
    entry.category,
    ...(entry.appliesTo ?? []),
    ...(entry.keywords ?? []),
  ].join(' ').toLowerCase()
  let score = 0
  const matched = []

  if ((entry.taskTypes ?? []).includes(taskType.type)) {
    score += 8
    matched.push(`task:${taskType.type}`)
  }

  for (const token of tokens) {
    if (relText.includes(token) || text.includes(token)) {
      score += 4
      matched.push(token)
    }
  }

  if (matched.length === 0) {
    return { score: 0, matched: [] }
  }

  if (entry.priority === 'critical') score += 6
  else if (entry.priority === 'high') score += 4
  else if (entry.priority === 'medium') score += 2

  return { score, matched: [...new Set(matched)] }
}

function scoreSkillEntry(entry, tokens, taskType) {
  const text = [
    entry.id,
    entry.title,
    entry.purpose,
    ...(entry.audience ?? []),
    ...(entry.triggers ?? []),
    ...(entry.read ?? []),
    ...(entry.commands ?? []),
    ...(entry.outputs ?? []),
  ].join(' ').toLowerCase()
  let score = 0
  const matched = []

  if ((entry.taskTypes ?? []).includes(taskType.type)) {
    score += 10
    matched.push(`task:${taskType.type}`)
  }

  if ((entry.taskTypes ?? []).includes('unknown') && taskType.type === 'unknown') {
    score += 4
    matched.push('task:unknown')
  }

  for (const token of tokens) {
    if (text.includes(token)) {
      score += 3
      matched.push(token)
    }
  }

  if (entry.priority === 'critical') score += 6
  else if (entry.priority === 'high') score += 4
  else if (entry.priority === 'medium') score += 2

  if (matched.length === 0 && entry.priority !== 'critical') {
    return { score: 0, matched: [] }
  }

  return { score, matched: [...new Set(matched)] }
}

function selectContextEntries(tokens, taskType) {
  const registry = readContextRegistry()
  return (registry.contexts ?? [])
    .filter((entry) => entry.file && exists(entry.file))
    .map((entry) => ({ ...entry, ...scoreContextEntry(entry, tokens, taskType) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.file).localeCompare(String(b.file)))
}

function selectSkillEntries(tokens, taskType) {
  const registry = readSkillRegistry()
  return (registry.skills ?? [])
    .map((entry) => ({ ...entry, ...scoreSkillEntry(entry, tokens, taskType) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
    .slice(0, 4)
}

function uniqueByFile(items) {
  const seen = new Set()
  const out = []

  for (const item of items) {
    if (!item.file || seen.has(item.file)) continue
    seen.add(item.file)
    out.push(item)
  }

  return out
}

function renderContext() {
  const tokens = tokenize(task)
  const taskType = detectTaskType(tokens)
  const registryFiles = readRegistryFiles()
  const baseAlways = alwaysRead.filter(exists)
  const declaredAlways = [...new Set(
    readProfileSources()
      .filter((source) => source && source.inject === 'always' && typeof source.path === 'string')
      .map((source) => source.path)
      .filter((rel) => exists(rel) && !baseAlways.includes(rel)),
  )]
  const always = [...baseAlways, ...declaredAlways]
  const contextEntries = selectContextEntries(tokens, taskType)
  const skillEntries = selectSkillEntries(tokens, taskType)
  const keywordCandidates = registryFiles
    .filter((file) => !always.includes(file))
    .map((file) => ({ file, ...scoreFile(file, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  const candidates = uniqueByFile([...contextEntries, ...keywordCandidates])
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 12)
  // 백스톱 수화(0.2.102): post-merge 훅이 안 탄 경로(rebase pull, 클론 직후, 훅 미설치)에서도
  // 작업 시작 시점에 본문이 준비되게 한다. 캐시가 없을 때만 시도하고, 실패는 무해하다.
  const specStartedAt = Date.now()
  const specHydration = hydrateSpecCacheForContext(specStartedAt)
  const specFreshness = readSpecFreshness(specStartedAt)
  const specCandidates = selectSpecCandidates(tokens, 5, specHydration.failedSources)
  const specCacheMissing = missingSpecCaches()
  const generated = generatedFiles.filter(exists)

  const lines = []
  lines.push('# Agent Decision Context')
  lines.push('')
  lines.push('> 이 파일은 에이전트가 코딩 전에 읽을 판단 컨텍스트입니다. 개발자가 업무 지시 때마다 직접 실행할 필요는 없습니다.')
  lines.push('> 진실 출처는 원본 문서와 실제 코드이며, 이 파일은 재생성 가능한 보조 산출물입니다.')
  lines.push('')
  lines.push(`- generatedAt: ${new Date().toISOString()}`)
  lines.push(`- task: ${task || '(미지정)'}`)
  lines.push('')
  lines.push('## User Request')
  lines.push('')
  lines.push(task || '- 작업 설명이 지정되지 않았습니다.')
  lines.push('')
  lines.push('## Task Type')
  lines.push('')
  lines.push(`- detected: ${taskType.type}`)
  lines.push(`- confidence: ${taskType.confidence}`)
  lines.push(`- reason: ${taskType.reason}`)
  lines.push('')
  lines.push('## Always Read')
  lines.push('')
  for (const file of always) {
    const tag = declaredAlways.includes(file) ? ' (project source: profile.json sources[])' : ''
    lines.push(`- ${file}${tag}`)
  }
  lines.push('')
  lines.push('## Relevant Policies')
  lines.push('')

  if (tokens.length === 0) {
    lines.push('- 작업 설명이 없어 추가 후보를 계산하지 않았습니다.')
  } else if (candidates.length === 0) {
    lines.push('- 작업 설명과 직접 매칭되는 문서를 찾지 못했습니다. Always Read 문서와 프로젝트 구조를 먼저 확인하세요.')
  } else {
    for (const item of candidates) {
      const meta = [
        item.category ? `category: ${item.category}` : null,
        item.priority ? `priority: ${item.priority}` : null,
        item.matched?.length > 0 ? `matched: ${item.matched.join(', ')}` : null,
      ].filter(Boolean).join(', ')
      lines.push(`- ${item.file}${meta ? ` (${meta})` : ''}`)
    }
  }

  // 기획 문서 연동을 쓰지 않는 프로젝트에는 이 섹션 자체를 만들지 않는다(연동은 선택 사항이며 닦달하지 않는다).
  const specConfigured = exists('.harness/spec-lock.json')
  if (specConfigured) {
  lines.push('')
  lines.push('## Related Specs')
  lines.push('')
  // 최신 확인 결과를 세 상태로 구분해 보여준다(0.2.102):
  // ① 팀 기준(lock) 문서 ② 기준 이후 바뀐 문서 ③ 기준에 없는 문서.
  // 세 라벨을 모두 '기준' 축으로 맞춘다(0.2.113). '새로 올라온'은 기획팀의 행위를 주장하는데,
  // 하네스가 아는 것은 '우리 lock에 없다'뿐이다 — 몇 달 전부터 있던 문서가 편입에서 빠진 경우도 같은 상태다.
  // 구분하지 않으면 "기획자가 새 문서를 올렸는데 에이전트가 관련 기획이 없다고 판단"하는 경로가 열린다.
  if (specHydration.failures.length > 0) {
    // 본문을 팀 기준으로 맞추지 못한 소스는 그 본문을 사양으로 쓰지 않는다 — 그 사실을 반드시 알린다.
    lines.push('- ⚠ 기획 본문을 팀 기준으로 준비하지 못했습니다. 해당 소스의 문서는 신뢰할 수 없어 아래 후보에서 제외했습니다.')
    for (const failure of specHydration.failures.slice(0, 3)) {
      lines.push(`  - ${failure.id}: ${failure.reason}`)
    }
    lines.push('- 복구: `.harness/bin/harness spec:fetch --at-lock`. 복구 전에는 기획 기준 없이 구현하지 마세요.')
    lines.push('')
  }

  if (specFreshness && !specFreshness.checked) {
    lines.push(`- ⚠ 최신 기획 여부를 확인하지 못했습니다(${specFreshness.reason ?? '원인 불명'}). 아래는 팀 기준(lock) 시점 문서입니다 — 기획이 그 사이 바뀌었을 수 있습니다.`)
    lines.push('- 확인: `.harness/bin/harness spec:fetch --cache-only` (기준은 옮기지 않습니다)')
    lines.push('')
  } else if (specFreshness?.checked) {
    // 소스별 상태를 보여준다. 한 소스가 실패해도 나머지 결과는 유효하다.
    const failed = (specFreshness.sources ?? []).filter((item) => !item.checked)
    if (failed.length > 0) {
      lines.push(`- ⚠ 일부 기획 소스의 최신 여부를 확인하지 못했습니다: ${failed.map((item) => `${item.id}(${item.reason})`).join(', ')}`)
      lines.push('- 나머지 소스의 결과는 아래에 그대로 표시됩니다.')
      lines.push('')
    }
    if (specFreshness.fromCache) {
      lines.push(`- 참고: 최신 확인 결과는 직전 확인(${specFreshness.checkedAt})의 재사용입니다. 이번 실행에서 새로 조회하지 않았습니다.`)
      lines.push('')
    }
  }

  // 관련성 판정(0.2.102 재리뷰 P1-3):
  // - changed: 파일명이 안 맞아도 이미 본문 검색으로 후보가 된 문서면 무조건 포함한다.
  //   (그러지 않으면 "본문으로 후보가 된 문서의 최신 변경 경고"가 숨겨져 옛 본문으로 구현하게 된다)
  // - added: 본문을 아직 못 읽으므로 경로만으로는 놓친다. 판정이 불확실하면 숨기지 말고
  //   "관련성 미판정"으로 소수 노출한다 — 놓치는 것보다 몇 줄 더 보이는 편이 안전하다.
  const candidateFiles = new Set(specCandidates.map((item) => item.file))
  const matchesDoc = (item) => candidateFiles.has(item.file)
    || matchesTokens(item.file, tokens)
    || (item.excerpt ? tokens.some((token) => item.excerpt.includes(token)) : false)

  const relevantChanged = (specFreshness?.changed ?? []).filter(matchesDoc)
  const namedAdded = (specFreshness?.added ?? []).filter(matchesDoc)
  // 발췌로도 판단이 안 되는 신규 문서는 숨기지 않고 소수만 "미판정"으로 노출한다.
  const unjudgedAdded = (specFreshness?.added ?? [])
    .filter((item) => !namedAdded.includes(item))
    .slice(0, 3)
  const relevantAdded = namedAdded

  if (relevantChanged.length > 0) {
    lines.push('**기준 이후 바뀐 기획 문서 (이번 작업과 관련)** — 구현 전에 최신 내용을 반드시 확인하세요.')
    for (const item of relevantChanged) {
      // "미정산"이 아니라 "확인 전"이다 — 미정산은 "읽었지만 정산 안 함"(spec:status의 축)이고,
      // 여기는 원격 확인 결과라 아직 읽지 않았을 수 있다. 같은 단어를 두 축에 쓰면
      // status의 "정산 대기 없음"과 모순처럼 읽힌다(멀티사이트 실증, 0.2.121).
      lines.push(`- ${item.file} (기준 이후 원격에서 변경됨 — 확인 전)`)
    }
    lines.push('- 최신 본문 받기: `.harness/bin/harness spec:fetch --cache-only`. 확인 후 `.harness/bin/harness spec:settle`로 정산합니다.')
    lines.push('')
  }

  if (relevantAdded.length > 0) {
    lines.push('**기준에 없는 기획 문서 (이번 작업과 관련)** — 팀 기준에 편입되지 않아 아직 사양으로 쓰지 않습니다.')
    for (const item of relevantAdded) {
      lines.push(`- ${item.file} (신규 — 기준 미편입, 매핑 없음)`)
    }
    lines.push('- 이 문서로 구현한다면: 최신 본문을 받고(`--cache-only`), 구현 후 `spec-map.md`에 매핑을 남기고 `.harness/bin/harness spec:settle --doc <경로>`로 정산합니다.')
    lines.push('')
  }

  if (unjudgedAdded.length > 0) {
    // 파일명이 요청어와 다르면(예: REQ-142.md) 경로 매칭으로는 못 잡는다. 본문을 아직 읽을 수 없으므로
    // 관련 없다고 단정하지 않고, 확인 대상으로 소수만 노출한다.
    lines.push('**기준에 없는 기획 문서 (관련성 미판정)** — 파일명만으로는 이번 작업과의 관련을 판단할 수 없습니다. 제목을 확인하세요.')
    for (const item of unjudgedAdded) {
      lines.push(`- ${item.file} (신규 — 기준 미편입, 매핑 없음)`)
    }
    lines.push('- 본문 확인: `.harness/bin/harness spec:fetch --cache-only` 후 해당 파일을 엽니다.')
    lines.push('')
  }

  if (specCacheMissing.length > 0) {
    // "기획서가 없다"와 "아직 안 받았다"는 다른 상태다. 구분하지 않으면 에이전트가 사양 없이 작업을 시작한다.
    lines.push(`- 기획 문서 본문이 이 환경에 아직 없습니다(소스: ${specCacheMissing.join(', ')}). 기획서가 없는 것이 아니라 로컬에 내려받지 않은 상태입니다.`)
    lines.push('- 받는 방법: `.harness/bin/harness spec:fetch --at-lock` (팀 기준 시점 그대로 받습니다. 기준은 옮기지 않습니다.)')
    lines.push('- 본문을 받은 뒤 관련 기획 문서를 먼저 읽고 구현합니다.')
  } else if (specCandidates.length === 0 && relevantChanged.length === 0 && relevantAdded.length === 0) {
    lines.push('- 이번 작업과 매칭되는 기획 문서를 찾지 못했습니다. 연동 상태는 `.harness/bin/harness spec:status`로 확인합니다.')
  } else if (specCandidates.length === 0) {
    lines.push('- 팀 기준(lock)에는 이번 작업과 매칭되는 문서가 없습니다. 위의 변경·신규 문서를 확인하세요.')
  } else {
    lines.push('기획 문서는 코드보다 상위 기준입니다. 구현 전에 아래 문서를 먼저 읽습니다.')
    lines.push('')
    for (const item of specCandidates) {
      const cacheRoot = `.harness/generated/spec-cache/${item.source}`
      if (item.unit && item.unit.screens.length > 0) {
        // 문서가 링크한 화면은 그 문서의 일부다. 같은 검토 시점으로 함께 제시한다.
        lines.push(`- ${item.unit.primary} — 화면이 있는 기획 (matched: ${item.matched.join(', ')})`)
        lines.push(`  - 정책·동작 기준: ${cacheRoot}/${item.unit.primary}`)
        for (const screen of item.unit.screens) {
          lines.push(`  - 화면: ${cacheRoot}/${screen}${item.screenCommits?.[screen] === undefined ? ' ⚠ 기준에 없습니다(정산 누락)' : ''}`)
        }
        // 실제로 같은 commit일 때만 그렇게 말한다. 혼합 상태에서 "같은 시점"이라고 하면
        // 에이전트가 서로 안 맞는 두 문서를 한 시점의 사양으로 믿는다(4차 리뷰 P2-2).
        const commits = new Set([item.commit, ...item.unit.screens.map((screen) => item.screenCommits?.[screen])])
        if (commits.size === 1 && item.commit) {
          lines.push(`  - 검토 시점: commit ${String(item.commit).slice(0, 10)} (모두 같은 시점의 검토본입니다)`)
        } else {
          lines.push(`  - ⚠ 검토 시점이 서로 다릅니다: ${item.unit.primary}=${String(item.commit ?? '없음').slice(0, 10)}, ${item.unit.screens.map((screen) => `${screen}=${String(item.screenCommits?.[screen] ?? '없음').slice(0, 10)}`).join(', ')}`)
          lines.push('  - 문서와 화면이 다른 시점입니다. .harness/bin/harness spec:status 로 확인하고 정산을 맞춘 뒤 진행하세요.')
        }
        lines.push('  - 문서와 화면을 함께 읽습니다. 정책만 읽고 화면을 놓치거나, 화면만 보고 정책을 놓치지 않습니다.')
      } else {
        lines.push(`- ${item.file} (matched: ${item.matched.join(', ')})`)
        lines.push(`  - 본문: ${cacheRoot}/${item.file}`)
      }
      if (item.linked.length > 0) {
        lines.push(`  - 연결 구현: ${item.linked.join(', ')}`)
      } else {
        lines.push('  - 연결 구현: 미매핑 — 구현 후 `.harness/project/spec-map.md`에 기록합니다.')
      }
    }
  }
  }
  lines.push('')
  lines.push('## Decision Rules')
  lines.push('')
  if (specConfigured) {
    lines.push('- 기획 문서와 코드가 다르면 기본 판정은 코드 drift입니다. 기획 문서를 임의로 고치지 않습니다.')
  }
  lines.push('- 사용자 명시 지시와 회사 공통 필수 차단 기준을 먼저 확인합니다.')
  lines.push('- 프로젝트 기준이 스택/템플릿 기준보다 구체적이면 프로젝트 기준을 우선합니다.')
  lines.push('- 생성 컨텍스트는 기준이 아니며 원본 문서와 실제 코드가 우선합니다.')
  lines.push('- 불명확한 기준 충돌은 `decision-log.md`, `developer-input-queue.md`, `waivers.json` 중 맞는 곳에 기록합니다.')
  lines.push('')
  lines.push('## Selected Skills')
  lines.push('')
  if (skillEntries.length === 0) {
    lines.push('- 작업 설명과 직접 매칭되는 하네스 스킬을 찾지 못했습니다. `harness.request-triage` 관점으로 범위와 기준을 먼저 확인하세요.')
  } else {
    for (const skill of skillEntries) {
      const meta = [
        skill.audience?.length > 0 ? `audience: ${skill.audience.join('/')}` : null,
        skill.priority ? `priority: ${skill.priority}` : null,
        skill.matched?.length > 0 ? `matched: ${skill.matched.join(', ')}` : null,
      ].filter(Boolean).join(', ')
      lines.push(`### ${skill.title ?? skill.id} (${skill.id})${meta ? ` — ${meta}` : ''}`)
      lines.push(`- purpose: ${skill.purpose}`)
      if (skill.read?.length > 0) {
        lines.push('- read:')
        for (const item of skill.read) lines.push(`  - ${item}`)
      }
      if (skill.commands?.length > 0) {
        lines.push('- commands:')
        for (const item of skill.commands) lines.push(`  - ${item}`)
      }
      if (skill.outputs?.length > 0) {
        lines.push('- outputs:')
        for (const item of skill.outputs) lines.push(`  - ${item}`)
      }
      if (skill.records?.length > 0) {
        lines.push('- records:')
        for (const item of skill.records) lines.push(`  - ${item}`)
      }
    }
  }
  lines.push('')
  lines.push('## Impact Candidates')
  lines.push('')
  if (candidates.length === 0) {
    lines.push('- 작업 설명 기준으로 영향 후보를 특정하지 못했습니다. 실제 diff와 `.harness/bin/harness impact`로 확인하세요.')
  } else {
    const areas = new Set()
    for (const item of candidates) {
      for (const area of item.appliesTo ?? []) areas.add(area)
    }
    if (areas.size === 0) {
      lines.push('- 관련 문서 후보는 있으나 appliesTo 메타데이터가 없습니다. 실제 diff와 `.harness/bin/harness impact`로 확인하세요.')
    } else {
      for (const area of [...areas].sort()) lines.push(`- ${area}`)
    }
  }
  lines.push('')
  lines.push('## Conflict Check')
  lines.push('')
  lines.push('기준 충돌 시 아래 순서로 해석합니다.')
  for (const [index, item] of conflictOrder.entries()) {
    lines.push(`${index + 1}. ${item}`)
  }
  lines.push('')
  lines.push('## Generated Context')
  lines.push('')
  if (generated.length === 0) {
    lines.push('- `.harness/generated/*` 파일이 없습니다. 필요하면 `.harness/bin/harness sync`를 먼저 실행하세요.')
  } else {
    for (const file of generated) lines.push(`- ${file}`)
  }

  lines.push('')
  lines.push('## Required Output')
  lines.push('')
  for (const item of requiredOutputs) lines.push(`- ${item}`)

  return `${lines.join('\n')}\n`
}

if (syncFirst) {
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(process.execPath, [path.join(repoRoot, '.harness/bin/sync-context.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!fs.existsSync(harnessRoot)) {
  console.error('.harness directory not found. Run harness init first.')
  process.exit(1)
}

const content = renderContext()

if (stdoutOnly) {
  process.stdout.write(content)
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, content)
  console.log(`Task context written: ${toPosix(path.relative(repoRoot, outputPath))}`)
}
