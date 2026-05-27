#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRoot = path.join(repoRoot, '.harness')
const registryPath = path.join(harnessRoot, 'documentation', 'document-registry.json')
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
  { type: 'feature', keywords: ['추가', '생성', '구현', '기능', '신규', '만들', 'feature', 'add'] },
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

function readRegistryFiles() {
  if (!exists('.harness/documentation/document-registry.json')) {
    return []
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  const files = new Set()

  for (const group of registry.groups ?? []) {
    if (group.index) files.add(group.index)
    for (const child of group.children ?? []) files.add(child)
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
  const always = alwaysRead.filter(exists)
  const contextEntries = selectContextEntries(tokens, taskType)
  const skillEntries = selectSkillEntries(tokens, taskType)
  const keywordCandidates = registryFiles
    .filter((file) => !always.includes(file))
    .map((file) => ({ file, ...scoreFile(file, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  const candidates = uniqueByFile([...contextEntries, ...keywordCandidates])
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 12)
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
  for (const file of always) lines.push(`- ${file}`)
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

  lines.push('')
  lines.push('## Decision Rules')
  lines.push('')
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
    lines.push('- 작업 설명 기준으로 영향 후보를 특정하지 못했습니다. 실제 diff와 `harness:impact`로 확인하세요.')
  } else {
    const areas = new Set()
    for (const item of candidates) {
      for (const area of item.appliesTo ?? []) areas.add(area)
    }
    if (areas.size === 0) {
      lines.push('- 관련 문서 후보는 있으나 appliesTo 메타데이터가 없습니다. 실제 diff와 `harness:impact`로 확인하세요.')
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
    lines.push('- `.harness/generated/*` 파일이 없습니다. 필요하면 `npm run harness:sync`를 먼저 실행하세요.')
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
