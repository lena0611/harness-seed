#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRoot = path.join(repoRoot, '.harness')
const registryPath = path.join(harnessRoot, 'documentation', 'document-registry.json')
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
  '.harness/policy/context-protocol.md',
  '.harness/session/session-start-alert.md',
  '.harness/session/active-context.md',
  '.harness/session/decision-log.md',
  '.harness/session/developer-input-queue.md',
  '.harness/project/local-methodology.md',
  '.harness/project/stack-preset-rules.md',
]

const generatedFiles = [
  '.harness/generated/project-map.md',
  '.harness/generated/import-map.md',
  '.harness/generated/detected-patterns.md',
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

function renderContext() {
  const tokens = tokenize(task)
  const registryFiles = readRegistryFiles()
  const always = alwaysRead.filter(exists)
  const candidates = registryFiles
    .filter((file) => !always.includes(file))
    .map((file) => ({ file, ...scoreFile(file, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 12)
  const generated = generatedFiles.filter(exists)

  const lines = []
  lines.push('# Task Context')
  lines.push('')
  lines.push('> 이 파일은 `npm run harness:context`가 생성한 작업별 읽을거리 후보입니다. 진실 출처는 원본 문서와 실제 코드입니다.')
  lines.push('')
  lines.push(`- generatedAt: ${new Date().toISOString()}`)
  lines.push(`- task: ${task || '(미지정)'}`)
  lines.push('')
  lines.push('## Always Read')
  lines.push('')
  for (const file of always) lines.push(`- ${file}`)
  lines.push('')
  lines.push('## Task-Relevant Documents')
  lines.push('')

  if (tokens.length === 0) {
    lines.push('- 작업 설명이 없어 추가 후보를 계산하지 않았습니다.')
  } else if (candidates.length === 0) {
    lines.push('- 작업 설명과 직접 매칭되는 문서를 찾지 못했습니다. Always Read 문서와 프로젝트 구조를 먼저 확인하세요.')
  } else {
    for (const item of candidates) {
      const reason = item.matched.length > 0 ? `matched: ${item.matched.join(', ')}` : `score: ${item.score}`
      lines.push(`- ${item.file} (${reason})`)
    }
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
  lines.push('## Operating Notes')
  lines.push('')
  lines.push('- 생성 컨텍스트는 원본 문서와 코드를 대신하지 않습니다.')
  lines.push('- 개인 기준은 회사/스택/프로젝트 기준을 덮어쓰지 않습니다.')
  lines.push('- 코드 변경 후 로컬룰 승격 후보와 `npm run harness:check` 실행 여부를 확인합니다.')

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
