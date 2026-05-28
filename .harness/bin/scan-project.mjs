#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..', '..')
const args = process.argv.slice(2)
const writeReport = args.includes('--write')
const outputArgIndex = args.indexOf('--output')
const outputPath = outputArgIndex >= 0 && args[outputArgIndex + 1]
  ? args[outputArgIndex + 1]
  : '.harness/session/project-scan-report.md'

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.harness-backup',
  '.venv',
  'vendor',
  'target',
])

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel))
}

function readJson(rel, fallback = null) {
  const abs = path.join(repoRoot, rel)
  if (!fs.existsSync(abs)) return fallback
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return fallback
  }
}

function readText(rel) {
  const abs = path.join(repoRoot, rel)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
}

function runGit(gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function walk(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth || !fs.existsSync(dir)) return []

  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue

    const abs = path.join(dir, entry.name)
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/')
    out.push({ rel, entry, abs, depth })

    if (entry.isDirectory()) {
      out.push(...walk(abs, depth + 1, maxDepth))
    }
  }

  return out
}

function listExisting(candidates) {
  return candidates.filter((rel) => exists(rel))
}

function listByPrefix(prefixes) {
  return walk(repoRoot)
    .filter(({ rel, entry }) => entry.isFile() && prefixes.some((prefix) => rel.startsWith(prefix)))
    .map(({ rel }) => rel)
    .slice(0, 30)
}

function detectSourceRoots() {
  return ['src', 'app', 'lib', 'packages', 'apps', 'pkg', 'internal']
    .filter((rel) => exists(rel) && fs.statSync(path.join(repoRoot, rel)).isDirectory())
}

function detectTestRoots() {
  return ['test', 'tests', '__tests__', 'spec', 'cypress', 'playwright']
    .filter((rel) => exists(rel) && fs.statSync(path.join(repoRoot, rel)).isDirectory())
}

function detectManifestFiles() {
  return listExisting([
    'package.json',
    'pnpm-workspace.yaml',
    'pyproject.toml',
    'requirements.txt',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'composer.json',
    'Gemfile',
  ])
}

function detectBuildFiles() {
  return listExisting([
    'Makefile',
    'Justfile',
    'Taskfile.yml',
    'Dockerfile',
    'docker-compose.yml',
    'turbo.json',
    'nx.json',
    'tsconfig.json',
  ])
}

function detectDocs() {
  const rootDocs = walk(repoRoot, 0, 1)
    .filter(({ rel, entry }) => entry.isFile() && /^README|^CONTRIBUTING|^ARCHITECTURE/i.test(path.basename(rel)))
    .map(({ rel }) => rel)

  return [...rootDocs, ...listByPrefix(['docs/', 'ADR/', 'adr/'])].slice(0, 30)
}

function detectCi() {
  return [
    ...listByPrefix(['.github/workflows/']),
    ...listExisting(['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile']),
  ]
}

function detectQualityFiles() {
  return listExisting([
    '.editorconfig',
    '.eslintrc',
    '.eslintrc.js',
    'eslint.config.js',
    'eslint.config.mjs',
    '.prettierrc',
    'prettier.config.js',
    'biome.json',
    'ruff.toml',
    'pytest.ini',
    'jest.config.js',
    'playwright.config.ts',
  ])
}

function hasNodeHarnessScripts() {
  const binDir = path.join(repoRoot, '.harness/bin')
  if (!fs.existsSync(binDir)) return false
  return fs.readdirSync(binDir).some((name) => name.endsWith('.mjs'))
}

function detectEslintNodeScriptsAdvice() {
  const configRel = listExisting(['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.js'])[0]
  if (!configRel || !hasNodeHarnessScripts()) {
    return []
  }

  const content = readText(configRel) ?? ''
  const mentionsScripts = /\.harness\/bin\/\*\*|\.harness\/bin\//.test(content)
  const mentionsNodeGlobals = /globals\.node|env\s*:\s*{[^}]*node\s*:\s*true|sourceType\s*:\s*['"]script['"]/.test(content)

  if (mentionsScripts && mentionsNodeGlobals) {
    return [`${configRel}: .harness/bin/**/*.mjs Node 환경 override 후보가 감지되었습니다.`]
  }

  return [
    `${configRel}: .harness/bin/**/*.mjs용 Node 환경 override를 확인하세요.`,
    '하네스가 추가한 .harness/bin/*.mjs는 Node 환경 파일입니다. lint가 `process is not defined` 또는 `no-undef`로 실패하면 Node globals override가 필요할 수 있습니다.',
  ]
}

function detectStyleGuideFiles() {
  return listExisting([
    '.editorconfig',
    '.prettierrc',
    'prettier.config.js',
    'prettier.config.mjs',
    'biome.json',
    '.eslintrc',
    '.eslintrc.js',
    'eslint.config.js',
    'eslint.config.mjs',
    'STYLEGUIDE.md',
    'styleguide.md',
    'CONTRIBUTING.md',
  ])
}

function parseEditorConfig() {
  const content = readText('.editorconfig')
  if (!content) return []

  const rules = []
  let currentSection = 'global'

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const section = line.match(/^\[(.+)]$/)
    if (section) {
      currentSection = section[1]
      continue
    }

    const pair = line.match(/^([^=]+?)\s*=\s*(.+)$/)
    if (!pair) continue

    const key = pair[1].trim()
    const value = pair[2].trim()
    if (['indent_style', 'indent_size', 'tab_width', 'end_of_line', 'charset', 'trim_trailing_whitespace', 'insert_final_newline'].includes(key)) {
      rules.push(`.editorconfig ${currentSection}: ${key} = ${value}`)
    }
  }

  return rules
}

function readPrettierConfig() {
  const jsonConfig = readJson('.prettierrc')
  if (jsonConfig) return { source: '.prettierrc', config: jsonConfig }

  for (const rel of ['prettier.config.js', 'prettier.config.mjs']) {
    const content = readText(rel)
    if (content) return { source: rel, content }
  }

  return null
}

function parseObjectLikeConfig(source, config) {
  const rules = []

  const map = [
    ['singleQuote', 'quote'],
    ['semi', 'semicolon'],
    ['trailingComma', 'trailing comma'],
    ['printWidth', 'print width'],
    ['tabWidth', 'tab width'],
    ['useTabs', 'use tabs'],
    ['bracketSpacing', 'bracket spacing'],
    ['arrowParens', 'arrow parens'],
  ]

  for (const [key, label] of map) {
    if (Object.hasOwn(config, key)) {
      rules.push(`${source}: ${label} = ${String(config[key])}`)
    }
  }

  return rules
}

function parseJsConfigByPattern(source, content) {
  const rules = []
  const patterns = [
    ['singleQuote', /singleQuote\s*:\s*(true|false)/],
    ['semicolon', /(?:^|[,{]\s*)semi\s*:\s*(true|false)/m],
    ['trailing comma', /trailingComma\s*:\s*['"]([^'"]+)['"]/],
    ['print width', /printWidth\s*:\s*(\d+)/],
    ['tab width', /tabWidth\s*:\s*(\d+)/],
    ['use tabs', /useTabs\s*:\s*(true|false)/],
    ['quote', /quotes\s*:\s*\[[^\]]*['"](?:error|warn|off)['"]\s*,\s*['"]([^'"]+)['"]/],
    ['semicolon', /semi\s*:\s*\[[^\]]*['"](?:error|warn|off)['"]\s*,\s*['"]([^'"]+)['"]/],
  ]

  for (const [label, pattern] of patterns) {
    const match = content.match(pattern)
    if (match) {
      rules.push(`${source}: ${label} = ${match[1]}`)
    }
  }

  return rules
}

function parsePrettierRules() {
  const found = readPrettierConfig()
  if (!found) return []

  if (found.config) {
    return parseObjectLikeConfig(found.source, found.config)
  }

  return parseJsConfigByPattern(found.source, found.content)
}

function parseEslintRules() {
  const legacy = readJson('.eslintrc')
  if (legacy?.rules) {
    const rules = []
    const quoteRule = legacy.rules.quotes
    const semiRule = legacy.rules.semi

    if (Array.isArray(quoteRule) && quoteRule[1]) {
      rules.push(`.eslintrc: quote = ${quoteRule[1]}`)
    }
    if (Array.isArray(semiRule) && semiRule[1]) {
      rules.push(`.eslintrc: semicolon = ${semiRule[1]}`)
    }
    if (legacy.rules['sort-imports']) {
      rules.push('.eslintrc: import sorting rule is configured')
    }
    if (legacy.rules['import/order']) {
      rules.push('.eslintrc: import grouping/order rule is configured')
    }

    return rules
  }

  for (const rel of ['.eslintrc.js', 'eslint.config.js', 'eslint.config.mjs']) {
    const content = readText(rel)
    if (content) return parseJsConfigByPattern(rel, content)
  }

  return []
}

function parseBiomeRules() {
  const config = readJson('biome.json')
  if (!config) return []

  const rules = []
  const formatter = config.formatter ?? {}
  const javascriptFormatter = config.javascript?.formatter ?? {}

  if (Object.hasOwn(formatter, 'indentStyle')) rules.push(`biome.json formatter: indent style = ${formatter.indentStyle}`)
  if (Object.hasOwn(formatter, 'indentWidth')) rules.push(`biome.json formatter: indent width = ${formatter.indentWidth}`)
  if (Object.hasOwn(formatter, 'lineWidth')) rules.push(`biome.json formatter: line width = ${formatter.lineWidth}`)
  if (Object.hasOwn(javascriptFormatter, 'quoteStyle')) rules.push(`biome.json javascript formatter: quote = ${javascriptFormatter.quoteStyle}`)
  if (Object.hasOwn(javascriptFormatter, 'semicolons')) rules.push(`biome.json javascript formatter: semicolon = ${javascriptFormatter.semicolons}`)
  if (Object.hasOwn(javascriptFormatter, 'trailingCommas')) rules.push(`biome.json javascript formatter: trailing comma = ${javascriptFormatter.trailingCommas}`)

  return rules
}

function buildStyleRuleDraft(styleGuideFiles) {
  if (styleGuideFiles.length === 0) {
    return [
      '로컬 스타일 출처가 없습니다. 아래 Style Preset Candidates 중 하나를 선택한 뒤 실제 formatter/linter 설정과 로컬 방법론에 반영하세요.',
    ]
  }

  const rules = [
    ...parseEditorConfig(),
    ...parsePrettierRules(),
    ...parseEslintRules(),
    ...parseBiomeRules(),
  ]

  if (rules.length === 0) {
    return [
      '스타일 출처는 발견했지만 자동 초안으로 추출할 수 있는 formatter/linter 값은 없습니다.',
      '`STYLEGUIDE.md`, `CONTRIBUTING.md`, 또는 JS 기반 설정 파일을 사람이 확인해 로컬 방법론에 승격하세요.',
    ]
  }

  return [
    ...rules,
    '',
    '위 항목은 설정 파일에서 추출한 초안입니다. `.harness/project/workflow-rules.md` 또는 `.harness/project/local-methodology.md`에 승격하기 전에 개발자가 확인합니다.',
  ]
}

function renderStylePresetCandidates(styleGuideFiles) {
  if (styleGuideFiles.length > 0) {
    return ''
  }

  return `## Style Preset Candidates
로컬 스타일 출처가 없을 때만 아래 후보 중 하나를 선택합니다. 자동 적용하지 않습니다.

- \`standard-js\`: single quote, no semicolon, sorted imports
- \`explicit-ts\`: semicolon yes, multiline trailing comma, sorted imports
- \`formatter-owned\`: formatter/linter 설정을 단일 진실 출처로 사용

선택한 후보는 \`.harness/project/workflow-rules.md\`, \`.harness/project/local-methodology.md\`, 실제 formatter/linter 설정에 함께 반영합니다.
`
}

function detectLocalMethodologyFiles() {
  return listExisting([
    '.harness/project/standards-layers.md',
    '.harness/project/local-methodology.md',
    '.harness/project/stack-preset-rules.md',
    '.harness/project/domain-rules.md',
    '.harness/project/architecture-rules.md',
    '.harness/project/workflow-rules.md',
  ])
}

function detectPersonalStandardFiles() {
  return listExisting([
    'CLAUDE.local.md',
    '.claude/settings.local.json',
    '.harness/project/personal-methodology.local.md',
  ])
}

function detectCompanyStandardFiles() {
  return listExisting([
    '.harness/policy/ai-standard-guiding-policy.md',
    'CLAUDE.md',
    'AGENTS.md',
    '.harness/session/README.md',
    '.harness/policy/README.md',
  ])
}

function detectStackStandardFiles(profile) {
  const files = listExisting([
    '.harness/project/stack-preset-rules.md',
    '.harness/policy/profile.json',
  ])

  if (profile.stackManifest) {
    files.push(`stackManifest: ${profile.stackManifest}`)
  }

  return files
}

function parseSemver(value) {
  const match = String(value ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareSemver(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) return null

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] > right[key]) return 1
    if (left[key] < right[key]) return -1
  }

  return 0
}

function resolveStackManifest(profile) {
  if (!profile.activeStack || profile.activeStack === 'none') {
    return null
  }

  const rel = profile.stackManifest || `.harness/stacks/${profile.activeStack}/manifest.json`
  const abs = path.resolve(repoRoot, rel)
  const manifest = readJson(path.relative(repoRoot, abs))

  return manifest ? { rel: path.relative(repoRoot, abs).split(path.sep).join('/'), manifest } : null
}

function buildHarnessVersionStatus(profile) {
  const lock = readJson('.harness/harness-lock.json')
  const installManifest = readJson('.harness/install-manifest.json')
  const stack = resolveStackManifest(profile)
  const requiredBase = stack?.manifest?.baseHarness ?? lock?.stackHarness?.requiredBaseHarness
  const lines = []
  const conflicts = []

  if (!lock) {
    lines.push('harness lock: 없음')
    if (profile.activeStack && profile.activeStack !== 'none') {
      conflicts.push('harness lock이 없습니다. 스택 하네스 init을 다시 실행해 공통/스택 하네스 버전을 기록하세요.')
    }
  } else {
    const base = lock.baseHarness
    const stackHarness = lock.stackHarness
    lines.push(`installed base harness: ${base?.id ?? 'harness-seed'} ${base?.version ?? installManifest?.version ?? 'unknown'}${base?.ref ? ` (${base.ref})` : ''}`)
    lines.push(`active stack harness: ${stackHarness?.id ?? profile.activeStack ?? 'none'} ${stackHarness?.version ?? 'unknown'}${stackHarness?.ref ? ` (${stackHarness.ref})` : ''}`)
  }

  if (requiredBase) {
    const installedVersion = lock?.baseHarness?.version ?? installManifest?.version
    const installedRef = lock?.baseHarness?.ref ?? installManifest?.source?.ref
    const minVersion = requiredBase.minVersion ?? requiredBase.ref
    lines.push(`required base by stack: ${requiredBase.repo ?? 'harness-seed'} ${requiredBase.ref ?? '(ref unspecified)'} / min ${minVersion ?? '(none)'}`)

    const compare = compareSemver(installedVersion, minVersion)
    if (compare !== null && compare < 0) {
      conflicts.push(`공통 하네스 버전이 낮습니다. required >= ${minVersion}, installed ${installedVersion}. 스택 하네스 init을 다시 실행하세요.`)
    }

    if (requiredBase.ref && installedRef && requiredBase.ref !== installedRef) {
      conflicts.push(`공통 하네스 ref가 스택 요구사항과 다릅니다. required ${requiredBase.ref}, installed ${installedRef}. 스택 하네스 init으로 업데이트하세요.`)
    }
  }

  if (stack?.rel) {
    lines.push(`stack manifest: ${stack.rel}`)
  }

  if (conflicts.length === 0) {
    lines.push('version status: OK')
  }

  return { lines, conflicts }
}

function detectBridgeCandidates() {
  return listExisting(['CLAUDE.md', 'AGENTS.md'])
    .filter((rel) => {
      const content = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
      const readsLocalMethodology = content.includes('.harness/project/local-methodology.md')
      const delegatesToHarnessEntrypoint = content.includes('CLAUDE.md') && content.includes('.harness/')
      return !readsLocalMethodology && !delegatesToHarnessEntrypoint
    })
}

function readPackageSummary() {
  const pkg = readJson('package.json')
  if (!pkg) return null

  return {
    name: pkg.name ?? '(unnamed)',
    type: pkg.type ?? '(unspecified)',
    scripts: Object.keys(pkg.scripts ?? {}),
    dependencies: Object.keys(pkg.dependencies ?? {}),
    devDependencies: Object.keys(pkg.devDependencies ?? {}),
  }
}

function formatList(values, fallback = '- 없음') {
  if (!values || values.length === 0) return fallback
  return values.map((value) => `- ${value}`).join('\n')
}

function normalizeRuleValue(value) {
  const normalized = String(value).trim().toLowerCase()
  if (['true', 'yes', 'always'].includes(normalized)) return 'yes'
  if (['false', 'no', 'never'].includes(normalized)) return 'no'
  if (['single', 'double'].includes(normalized)) return normalized
  return normalized
}

function detectStyleConflicts(styleRuleDraft) {
  const valuesByRule = new Map()

  for (const item of styleRuleDraft) {
    const match = item.match(/(?:^|: )([^:=]+?)\s*=\s*(.+)$/)
    if (!match) continue

    const label = match[1].trim().toLowerCase()
    const value = normalizeRuleValue(match[2])
    if (!['semicolon', 'quote', 'indent style', 'tab width', 'trailing comma'].includes(label)) {
      continue
    }

    if (!valuesByRule.has(label)) valuesByRule.set(label, new Set())
    valuesByRule.get(label).add(value)
  }

  const conflicts = []
  for (const [label, values] of valuesByRule.entries()) {
    if (values.size > 1) {
      conflicts.push(`style:${label} 값이 여러 출처에서 다릅니다 (${[...values].join(', ')}). 프로젝트 기준으로 하나를 선택하세요.`)
    }
  }

  return conflicts
}

function buildStandardsLayerSummary(profile, companyFiles, stackFiles, projectFiles, personalFiles) {
  const activeStack = profile.activeStack || 'none'
  const stackSummary = activeStack === 'none'
    ? '스택 기준 없음 (`none`). 공통 기준 단독 운영 또는 스택 선택 전 상태입니다.'
    : `활성 스택 기준: ${activeStack}`

  return [
    `회사 공통 기준: ${companyFiles.length ? companyFiles.join(', ') : '감지 없음'}`,
    `스택 기준: ${stackSummary}${stackFiles.length ? ` / ${stackFiles.join(', ')}` : ''}`,
    `프로젝트 기준: ${projectFiles.length ? projectFiles.join(', ') : '감지 없음'}`,
    `개인 기준: ${personalFiles.length ? personalFiles.join(', ') : '감지 없음'}`,
  ]
}

function buildConflictCandidates({ profile, pkg, testRoots, styleGuideFiles, styleRuleDraft, bridgeCandidates, personalFiles, projectFiles, harnessVersionConflicts }) {
  const conflicts = []
  const activeStack = profile.activeStack || 'none'

  if (activeStack === 'none') {
    conflicts.push('스택 기준 없음: 맞는 스택 하네스가 있으면 적용하고, 없거나 스택 독립 프로젝트라면 공통 기준 단독 운영 사유를 decision-log에 기록하세요.')
  }

  if (profile.stackManifest && !path.isAbsolute(profile.stackManifest) && !exists(profile.stackManifest)) {
    conflicts.push(`stackManifest 경로를 현재 프로젝트에서 찾지 못했습니다: ${profile.stackManifest}`)
  }

  if (personalFiles.length > 0) {
    conflicts.push('개인 기준 파일이 감지되었습니다. 팀 공유가 필요한 내용은 프로젝트 기준으로 승격하고, 개인 선호는 로컬 파일에만 유지하세요.')
  }

  if (projectFiles.length === 0) {
    conflicts.push('프로젝트 기준 문서가 감지되지 않았습니다. 회사/스택 기준이 프로젝트 맥락 없이 적용될 수 있습니다.')
  }

  if (styleGuideFiles.length === 0) {
    conflicts.push('스타일 출처가 없습니다. 스택 기준, 프로젝트 기준, 개인 기준이 서로 다른 스타일을 암묵적으로 적용할 수 있습니다.')
  }

  conflicts.push(...detectStyleConflicts(styleRuleDraft))
  conflicts.push(...harnessVersionConflicts)

  if (testRoots.length === 0 && (!pkg || !pkg.scripts.some((name) => name.includes('test')))) {
    conflicts.push('회사 공통 기준은 검증 흐름을 요구하지만 테스트 루트나 test script가 없습니다. 검증 전략을 선택하세요.')
  }

  const eslintAdvice = detectEslintNodeScriptsAdvice()
  if (eslintAdvice.length > 1) {
    conflicts.push('ESLint 설정이 하네스 Node 스크립트(.harness/bin/*.mjs)에 Node globals를 적용하지 않을 수 있습니다.')
  }

  if (bridgeCandidates.length > 0) {
    conflicts.push('기존 에이전트 진입점이 하네스 기준 계층을 읽지 않습니다. Bridge Section Candidates를 적용할지 선택하세요.')
  }

  return conflicts
}

function renderTestStrategyOptions(pkg, testRoots) {
  if (testRoots.length > 0 || (pkg && pkg.scripts.some((name) => name.includes('test')))) {
    return '- 테스트 루트 또는 test script가 감지되었습니다. 현재 검증 전략을 `workflow-rules.md`에 맞게 유지하세요.'
  }

  return `테스트 전략이 없습니다. 다음 중 하나를 선택해 \`.harness/project/workflow-rules.md\` 또는 \`.harness/session/decision-log.md\`에 기록하세요.

1. 초기 단계: lint + build + 수동 확인
2. 단위 테스트: 프로젝트 스택에 맞는 unit test 도구 도입
3. 통합 테스트: API, 저장소, 외부 연동 경계 검증
4. E2E 테스트: 주요 사용자/운영 흐름 검증
5. 테스트 보류: 사유와 재검토 조건을 decision-log에 기록`
}

function buildReport() {
  const profile = readJson('.harness/policy/profile.json', { activeStack: 'none' })
  const pkg = readPackageSummary()
  const branch = runGit(['branch', '--show-current']) || '(unknown)'
  const dirty = runGit(['status', '--short'])
  const generatedAt = new Date().toISOString()
  const sourceRoots = detectSourceRoots()
  const testRoots = detectTestRoots()
  const manifests = detectManifestFiles()
  const buildFiles = detectBuildFiles()
  const ciFiles = detectCi()
  const qualityFiles = detectQualityFiles()
  const eslintNodeScriptsAdvice = detectEslintNodeScriptsAdvice()
  const styleGuideFiles = detectStyleGuideFiles()
  const styleRuleDraft = buildStyleRuleDraft(styleGuideFiles)
  const stylePresetCandidates = renderStylePresetCandidates(styleGuideFiles)
  const docs = detectDocs()
  const localMethodologyFiles = detectLocalMethodologyFiles()
  const personalStandardFiles = detectPersonalStandardFiles()
  const companyStandardFiles = detectCompanyStandardFiles()
  const stackStandardFiles = detectStackStandardFiles(profile)
  const harnessVersionStatus = buildHarnessVersionStatus(profile)
  const bridgeCandidates = detectBridgeCandidates()
  const standardsLayerSummary = buildStandardsLayerSummary(
    profile,
    companyStandardFiles,
    stackStandardFiles,
    localMethodologyFiles,
    personalStandardFiles,
  )
  const conflictCandidates = buildConflictCandidates({
    profile,
    pkg,
    testRoots,
    styleGuideFiles,
    styleRuleDraft,
    bridgeCandidates,
    personalFiles: personalStandardFiles,
    projectFiles: localMethodologyFiles,
    harnessVersionConflicts: harnessVersionStatus.conflicts,
  })

  const suggestedCommands = pkg
    ? pkg.scripts.filter((name) => /^(dev|build|test|lint|typecheck|format|guard|docs:check|policy:guard|stack:status)$/.test(name))
    : []

  const questions = []
  if (!exists('.harness/project/project-charter.md')) {
    questions.push('프로젝트 charter가 없습니다. `.harness/project/bootstrap.md` 인터뷰가 필요합니다.')
  }
  if (localMethodologyFiles.length === 0) {
    questions.push('로컬 개발방법론 문서가 없습니다. `.harness/project/local-methodology.md` 계층을 확인해야 합니다.')
  }
  if (sourceRoots.length === 0) {
    questions.push('소스 루트를 찾지 못했습니다. 실제 업무 코드 위치를 확인해야 합니다.')
  }
  if (testRoots.length === 0 && (!pkg || !pkg.scripts.some((name) => name.includes('test')))) {
    questions.push('테스트 루트나 test script를 찾지 못했습니다. 검증 전략 확인이 필요합니다.')
  }
  if (!profile.activeStack) {
    questions.push('activeStack 값이 비어 있습니다. `none` 또는 스택 프리셋을 선택해야 합니다.')
  }
  if (bridgeCandidates.length > 0) {
    questions.push('기존 엔트리포인트가 로컬 방법론을 읽지 않습니다. Bridge Section Candidates를 검토하세요.')
  }
  if (styleGuideFiles.length === 0) {
    questions.push('로컬 스타일 출처를 찾지 못했습니다. Style Preset Candidates 중 하나를 선택하거나 기존 팀 표준을 연결하세요.')
  }

  return `# Project Scan Report

- generatedAt: ${generatedAt}
- branch: ${branch}
- workingTree: ${dirty ? 'dirty' : 'clean'}
- activeStack: ${profile.activeStack ?? 'none'}
- harnessMode: ${profile.harnessMode ?? 'bootstrap'}

## Package
${pkg ? `- name: ${pkg.name}
- type: ${pkg.type}
- scripts: ${pkg.scripts.length}
- dependencies: ${pkg.dependencies.length}
- devDependencies: ${pkg.devDependencies.length}` : '- package.json 없음'}

## Inventory

### Manifest Files
${formatList(manifests)}

### Build And Runtime Files
${formatList(buildFiles)}

### CI Files
${formatList(ciFiles)}

### Quality Files
${formatList(qualityFiles)}

### ESLint Node Scripts Advice
${formatList(eslintNodeScriptsAdvice, '- ESLint Node scripts 충돌 후보 없음')}

### Style Sources
${formatList(styleGuideFiles)}

### Documentation
${formatList(docs)}

### Local Methodology Files
${formatList(localMethodologyFiles)}

### Personal Standard Files
${formatList(personalStandardFiles)}

### Source Roots
${formatList(sourceRoots)}

### Test Roots
${formatList(testRoots)}

## Standards Layers
${formatList(standardsLayerSummary)}

## Harness Versions
${formatList(harnessVersionStatus.lines)}

## Conflict Candidates
${formatList(conflictCandidates, '- 자동 감지 기준의 충돌 후보 없음')}

## Style Rule Draft
${formatList(styleRuleDraft)}

## Suggested Verification Commands
${formatList(suggestedCommands.map((name) => `npm run ${name}`))}

## Test Strategy Options
${renderTestStrategyOptions(pkg, testRoots)}

${stylePresetCandidates}

## Bridge Section Candidates
${formatList(bridgeCandidates)}

기존 개인/전용 룰 파일을 보존하는 경우, 필요한 파일에 아래 섹션을 추가할지 검토합니다.

\`\`\`markdown
## Project Harness Bridge

이 프로젝트에서는 기존 개인/전용 룰과 함께 공통 하네스 기준을 읽습니다.

1. \`.harness/project/local-methodology.md\`
2. \`.harness/project/standards-layers.md\`
3. \`.harness/project/stack-preset-rules.md\`
4. \`.harness/project/domain-rules.md\`
5. \`.harness/project/architecture-rules.md\`
6. \`.harness/project/workflow-rules.md\`
7. \`.harness/project/commit-push-rules.md\`
8. \`.harness/policy/ai-standard-guiding-policy.md\`
9. \`.harness/policy/README.md\`
10. \`.harness/session/active-context.md\`
\`\`\`

## Harness Update Targets
- .harness/project/project-charter.md
- .harness/project/scope-contract.md
- .harness/project/local-methodology.md
- .harness/project/standards-layers.md
- .harness/project/stack-preset-rules.md
- .harness/project/domain-rules.md
- .harness/project/architecture-rules.md
- .harness/project/workflow-rules.md
- .harness/project/commit-push-rules.md
- .harness/policy/profile.json
- .harness/session/active-context.md
- .harness/session/decision-log.md
- .harness/session/developer-input-queue.md

## Open Questions
${formatList(questions, '- 현재 자동 감지 기준의 필수 질문 없음')}
`
}

const report = buildReport()

if (writeReport) {
  const absOutput = path.resolve(repoRoot, outputPath)
  fs.mkdirSync(path.dirname(absOutput), { recursive: true })
  fs.writeFileSync(absOutput, report)
  console.log(`Project scan report written: ${path.relative(repoRoot, absOutput).split(path.sep).join('/')}`)
} else {
  process.stdout.write(report)
}
