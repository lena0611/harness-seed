#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRoot = path.join(repoRoot, '.harness')
const lockPath = path.join(harnessRoot, 'harness-lock.json')
const markerPath = path.join(harnessRoot, '.template-applied.json')
const reportPath = path.join(harnessRoot, 'session', 'template-gap-report.md')
const summaryPath = path.join(harnessRoot, 'generated', 'template-gap-summary.json')
const args = process.argv.slice(2)
const writeReport = args.includes('--write')
const briefMode = args.includes('--brief')

function readJson(absPath, fallback = null) {
  if (!fs.existsSync(absPath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeSummary(value) {
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
  fs.writeFileSync(summaryPath, `${JSON.stringify(value, null, 2)}\n`)
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function patternToRegExp(pattern) {
  const normalized = toPosix(pattern)
  const source = escapeRegExp(normalized)
    .replaceAll('\\*\\*', '.*')
    .replaceAll('\\*', '[^/]*')
  return new RegExp(`^${source}$`)
}

function listProjectFiles() {
  const out = []
  const excluded = new Set(['.git', '.harness', 'node_modules', 'dist', '.idea'])

  function walk(absDir, relDir = '') {
    if (!fs.existsSync(absDir)) return
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (relDir === '' && excluded.has(entry.name)) continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      const abs = path.join(absDir, entry.name)
      if (entry.isDirectory()) walk(abs, rel)
      else out.push(toPosix(rel))
    }
  }

  walk(repoRoot)
  return out
}

function matchesPattern(files, pattern) {
  if (!pattern.includes('*')) return fs.existsSync(path.join(repoRoot, pattern))
  const regex = patternToRegExp(pattern)
  return files.some((file) => regex.test(file))
}

function unique(values) {
  return [...new Set(values)]
}

function templateDocs(manifest) {
  return unique([
    manifest.template?.guideRoot ?? manifest.guideRoot,
    ...(manifest.template?.docs ?? manifest.docs ?? []),
  ].filter(Boolean))
}

function safeSnapshotPath(snapshotRoot, rel) {
  const resolvedRoot = path.resolve(snapshotRoot)
  const resolved = path.resolve(snapshotRoot, rel)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null
  return resolved
}

function evaluateCheck(check, context) {
  const docs = Array.isArray(check.docs) ? check.docs : []
  const undeclaredDocs = docs.filter((doc) => !context.declaredDocs.has(doc))
  const missingDocs = docs.filter((doc) => {
    const abs = safeSnapshotPath(context.snapshotRoot, doc)
    return !abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()
  })
  const missingPaths = (check.pathsAll ?? []).filter((pattern) => !matchesPattern(context.files, pattern))
  const anyPathMatched = (check.pathsAny ?? []).length === 0
    || check.pathsAny.some((pattern) => matchesPattern(context.files, pattern))
  const missingDependencies = (check.dependenciesAll ?? []).filter((name) => !context.dependencies.has(name))
  const missingScripts = (check.scriptsAll ?? []).filter((name) => !context.scripts.has(name))
  const hasExpectation = [
    check.pathsAll,
    check.pathsAny,
    check.dependenciesAll,
    check.scriptsAll,
  ].some((items) => Array.isArray(items) && items.length > 0)
  const invalidReasons = []

  if (docs.length === 0) invalidReasons.push('근거 문서가 선언되지 않았습니다.')
  if (undeclaredDocs.length > 0) invalidReasons.push(`template.docs 미등록: ${undeclaredDocs.join(', ')}`)
  if (missingDocs.length > 0) invalidReasons.push(`스냅샷 문서 누락: ${missingDocs.join(', ')}`)
  if (!hasExpectation) invalidReasons.push('프로젝트에서 확인할 구조화된 기대값이 없습니다.')

  const gapReasons = [
    ...missingPaths.map((value) => `필수 경로 없음: ${value}`),
    ...(!anyPathMatched ? [`대체 경로 중 일치 없음: ${(check.pathsAny ?? []).join(', ')}`] : []),
    ...missingDependencies.map((value) => `의존성 없음: ${value}`),
    ...missingScripts.map((value) => `npm script 없음: ${value}`),
  ]

  return {
    ...check,
    severity: check.severity === 'recommended' ? 'recommended' : 'required',
    docs,
    status: invalidReasons.length > 0 ? 'invalid' : gapReasons.length > 0 ? 'gap' : 'matched',
    invalidReasons,
    gapReasons,
  }
}

function renderReport(template, mode, results, manifestRel) {
  const matched = results.filter((item) => item.status === 'matched').length
  const gaps = results.filter((item) => item.status === 'gap').length
  const invalid = results.filter((item) => item.status === 'invalid').length
  const lines = [
    '# 템플릿 계약 갭 리포트',
    '',
    `- template: \`${template.id}\``,
    `- mode: \`${mode}\``,
    `- manifest: \`${manifestRel}\``,
    `- result: matched ${matched}, gap ${gaps}, invalid ${invalid}`,
    '',
    '이 리포트는 선택한 템플릿의 구조화된 계약과 현재 프로젝트를 비교합니다. 자연어 문서의 의미를 임의로 추론하지 않고, 템플릿 manifest가 선언한 경로, 의존성, npm script와 근거 문서 연결만 확인합니다.',
    '',
  ]

  if (results.length === 0) {
    lines.push('## 구조화된 계약 미선언', '')
    lines.push('- template manifest에 `contractChecks`가 없습니다.')
    lines.push('- 기존 템플릿과의 호환을 위해 현재 프로젝트 갭 검사는 건너뜁니다.')
    lines.push('- 템플릿 소유자는 근거 문서와 프로젝트 기대값을 `contractChecks`로 선언해 검사를 활성화할 수 있습니다.')
    return `${lines.join('\n')}\n`
  }

  for (const result of results) {
    const status = result.status === 'matched' ? '충족' : result.status === 'gap' ? '갭' : '계약 오류'
    lines.push(`## ${status}: ${result.title ?? result.id}`)
    lines.push('')
    lines.push(`- id: \`${result.id}\``)
    lines.push(`- severity: \`${result.severity}\``)
    for (const doc of result.docs) {
      lines.push(`- 근거 문서: \`${path.posix.join(path.posix.dirname(manifestRel), doc)}\``)
    }
    for (const reason of [...result.invalidReasons, ...result.gapReasons]) {
      lines.push(`- 확인 사항: ${reason}`)
    }
    if (result.remediation && result.status !== 'matched') {
      lines.push(`- 대응: ${result.remediation}`)
    }
    lines.push('')
  }

  lines.push('## 예외 기록', '')
  lines.push('템플릿 계약을 의도적으로 따르지 않는 항목은 `.harness/session/decision-log.md`에 이유를 남기고, 반복되는 프로젝트 기준이면 `.harness/project/*-rules.md`로 승격합니다.')
  return `${lines.join('\n')}\n`
}

const lock = readJson(lockPath, {})
const marker = readJson(markerPath, {})
const template = lock.scaffoldTemplate ?? marker.scaffoldTemplate

console.log('Template contract gap check')

if (!template?.manifestPath) {
  console.log('  selected: none')
  console.log('  result: skipped')
  writeSummary({ selected: false, contractChecks: 0, matched: 0, gaps: 0, requiredGaps: 0, recommendedGaps: 0, invalid: 0 })
  process.exit(0)
}

const manifestPath = path.resolve(repoRoot, template.manifestPath)
const manifest = readJson(manifestPath)
if (!manifest) {
  console.error(`템플릿 manifest를 읽을 수 없습니다: ${template.manifestPath}`)
  process.exit(1)
}

const pkg = readJson(path.join(repoRoot, 'package.json'), {})
const dependencies = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
])
const scripts = new Set(Object.keys(pkg.scripts ?? {}))
const files = listProjectFiles()
const snapshotRoot = path.dirname(manifestPath)
const declaredDocs = new Set(templateDocs(manifest))
const declaredChecks = Array.isArray(manifest.contractChecks) ? manifest.contractChecks : []
const results = declaredChecks.length > 0
  ? declaredChecks.map((check) => evaluateCheck(check, {
    files,
    dependencies,
    scripts,
    snapshotRoot,
    declaredDocs,
  }))
  : []
const mode = template.applicationMode ?? marker.applicationMode ?? 'scaffold'
const manifestRel = toPosix(path.relative(repoRoot, manifestPath))
const report = renderReport(template, mode, results, manifestRel)
const matched = results.filter((item) => item.status === 'matched').length
const gaps = results.filter((item) => item.status === 'gap').length
const invalid = results.filter((item) => item.status === 'invalid').length
const requiredGaps = results.filter((item) => item.status === 'gap' && item.severity === 'required').length
const recommendedGaps = results.filter((item) => item.status === 'gap' && item.severity === 'recommended').length

writeSummary({
  selected: true,
  templateId: template.id,
  mode,
  contractChecks: declaredChecks.length,
  matched,
  gaps,
  requiredGaps,
  recommendedGaps,
  invalid,
  report: toPosix(path.relative(repoRoot, reportPath)),
})

console.log(`  template: ${template.id}`)
console.log(`  mode: ${mode}`)
if (declaredChecks.length === 0) {
  console.log('  contract checks: not declared')
  console.log('  result: skipped')
} else {
  console.log(`  matched: ${matched}`)
  console.log(`  gaps: ${gaps}${requiredGaps > 0 ? ` (required ${requiredGaps})` : ''}`)
  console.log(`  contract errors: ${invalid}`)
}

for (const result of results.filter((item) => item.status !== 'matched')) {
  console.log(`  - [${result.status === 'gap' ? result.severity : 'invalid'}] ${result.title ?? result.id}`)
  if (!briefMode) {
    for (const reason of [...result.invalidReasons, ...result.gapReasons]) console.log(`    ${reason}`)
  }
}

if (writeReport) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, report)
  console.log(`  report: ${toPosix(path.relative(repoRoot, reportPath))}`)
}

if (invalid > 0) {
  process.exit(1)
}
