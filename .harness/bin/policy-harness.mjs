import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRootRel = fs.existsSync(path.join(repoRoot, '.harness')) ? '.harness' : '.github'
const harnessRoot = path.join(repoRoot, harnessRootRel)
const registryPath = path.join(harnessRoot, harnessRootRel === '.harness' ? 'policy' : 'policy-harness', 'policy-registry.json')
const profilePath = path.join(harnessRoot, harnessRootRel === '.harness' ? 'policy' : 'policy-harness', 'profile.json')
const impactSummaryPath = path.join(harnessRoot, 'generated', 'policy-impact-summary.json')
const stacksRoot = path.join(harnessRoot, 'stacks')

const args = process.argv.slice(2)
const mode = args[0] ?? 'guard'
const strictMode = args.includes('--strict') || (() => {
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'))?.harnessMode === 'strict'
  } catch {
    return false
  }
})()
const briefMode = args.includes('--brief')
const verboseMode = args.includes('--verbose') || args.includes('--all-files')
const showBaseline = args.includes('--show-baseline') || verboseMode
// P4(score-print 2026-08-04): guard 경로(harness:check, git hook)의 기본 출력은 요약이다.
// 커밋마다 152줄에서 조치 항목 2줄을 찾게 만들면 결국 출력을 읽지 않게 된다.
// 상세 전개는 --verbose 또는 상세 진입점인 harness:impact로 옮긴다.
// 단, '차단/확인 필수' 동기화 후보와 실패 원인은 요약 모드에서도 상세를 편다.
const summaryMode = !verboseMode && (briefMode || mode === 'guard')

function readProfile() {
  if (!fs.existsSync(profilePath)) {
    return { activeStack: 'none' }
  }

  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  } catch {
    return { activeStack: 'none' }
  }
}

function resolvePresetManifestPath(stackId, profile) {
  if (profile.stackManifest) {
    return path.resolve(repoRoot, profile.stackManifest)
  }

  return path.join(stacksRoot, stackId, 'manifest.json')
}

function resolveManifestRelative(manifestRoot, relPath) {
  if (!relPath) {
    return null
  }

  if (path.isAbsolute(relPath)) {
    return relPath
  }

  if (relPath.startsWith('.harness/') || relPath.startsWith('.github/') || relPath.startsWith('scripts/')) {
    return path.join(repoRoot, relPath)
  }

  return path.join(manifestRoot, relPath)
}

function readActiveStack() {
  const profile = readProfile()
  const stackId = profile.activeStack ?? 'none'

  if (stackId === 'none') {
    return { id: 'none', manifest: null, policies: [], checksKey: null }
  }

  const manifestPath = resolvePresetManifestPath(stackId, profile)

  if (!fs.existsSync(manifestPath)) {
    console.warn(`activeStack='${stackId}' 의 manifest를 찾을 수 없습니다: ${manifestPath}`)
    return { id: stackId, manifest: null, policies: [], checksKey: null }
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const manifestRoot = path.dirname(manifestPath)
  const policiesFile = manifest.policiesFile
    ? resolveManifestRelative(manifestRoot, manifest.policiesFile)
    : path.join(manifestRoot, 'policies.json')

  let policies = []

  if (fs.existsSync(policiesFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(policiesFile, 'utf8'))
      policies = parsed.policies ?? []
    } catch {
      console.warn(`스택 정책 파일 파싱 실패: ${policiesFile}`)
    }
  }

  return {
    id: stackId,
    manifest,
    policies,
    checksKey: manifest.checksKey ?? null,
  }
}

function getArgValue(flag) {
  const index = args.indexOf(flag)

  if (index === -1 || index === args.length - 1) {
    return undefined
  }

  return args[index + 1]
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

function sha256(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')
}

function readJsonFile(absPath, fallback = null) {
  if (!fs.existsSync(absPath)) {
    return fallback
  }

  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(glob) {
  const escaped = glob
    .split('**')
    .map((segment) => segment.split('*').map(escapeRegExp).join('[^/]*'))
    .join('::DOUBLE_STAR::')

  return new RegExp(
    `^${escaped.replaceAll('::DOUBLE_STAR::', '.*')}$`,
  )
}

function matchesGlob(filePath, glob) {
  return globToRegExp(glob).test(filePath)
}

function matchesAnyGlob(filePath, globs) {
  return globs.some((glob) => matchesGlob(filePath, glob))
}

function matchingGlobs(filePath, globs) {
  return globs.filter((glob) => matchesGlob(filePath, glob))
}

function matchedFiles(files, globs) {
  return files.filter((filePath) => matchesAnyGlob(filePath, globs))
}

function matchedRules(files, globs) {
  return unique(files.flatMap((filePath) => matchingGlobs(filePath, globs)))
}

function walkDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return []
  }

  const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...walkDirectory(entryPath))
      continue
    }

    files.push(toPosixPath(path.relative(repoRoot, entryPath)))
  }

  return files
}

function readRegistry() {
  const base = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  const stack = readActiveStack()

  return {
    ...base,
    policies: [
      ...(base.policies ?? []).map((policy) => ({ ...policy, __origin: 'base' })),
      ...stack.policies.map((policy) => ({ ...policy, __origin: 'stack' })),
    ],
  }
}

function runGit(argsToRun) {
  return execFileSync('git', argsToRun, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function getAllTrackedFiles() {
  return walkDirectory(path.join(repoRoot, 'src')).concat(
    walkDirectory(path.join(repoRoot, 'app')),
    walkDirectory(path.join(repoRoot, 'lib')),
    walkDirectory(path.join(repoRoot, 'supabase')),
    walkDirectory(path.join(repoRoot, 'ios')),
    walkDirectory(path.join(repoRoot, 'android')),
    walkDirectory(path.join(repoRoot, '.github')),
    walkDirectory(path.join(repoRoot, '.harness/bin')),
    walkDirectory(path.join(repoRoot, 'scripts')),
    ['package.json', 'README.md'].filter((filePath) => fs.existsSync(path.join(repoRoot, filePath))),
  )
}

function getChangedFiles() {
  const base = getArgValue('--base')
  const head = getArgValue('--head')

  if (base && head && !/^0+$/.test(base)) {
    try {
      const output = runGit(['diff', '--name-only', base, head])
      return output ? output.split('\n').filter(Boolean) : []
    } catch {
      return getChangedFilesFromHead()
    }
  }

  return getChangedFilesFromHead()
}

function unique(values) {
  return [...new Set(values)]
}

function getWorkingTreeChangedFiles() {
  const changed = []

  try {
    const trackedChanges = runGit(['diff', '--name-only', 'HEAD'])
    changed.push(...(trackedChanges ? trackedChanges.split('\n').filter(Boolean) : []))
  } catch {
    // noop
  }

  try {
    const untrackedChanges = runGit(['ls-files', '--others', '--exclude-standard'])
    changed.push(...(untrackedChanges ? untrackedChanges.split('\n').filter(Boolean) : []))
  } catch {
    // noop
  }

  return unique(changed).filter((filePath) => !isIgnoredPolicyChange(filePath))
}

function getChangedFilesFromHead() {
  const workingTreeChangedFiles = getWorkingTreeChangedFiles()

  if (workingTreeChangedFiles.length > 0) {
    return workingTreeChangedFiles
  }

  try {
    const output = runGit(['diff', '--name-only', 'HEAD~1', 'HEAD'])
    return output ? output.split('\n').filter(Boolean) : []
  } catch {
    try {
      const output = runGit(['status', '--short'])
      return output
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3))
        .filter((filePath) => !isIgnoredPolicyChange(filePath))
    } catch {
      return []
    }
  }
}

function isIgnoredPolicyChange(filePath) {
  return (
    filePath.startsWith('node_modules/') ||
    filePath.startsWith('dist/') ||
    filePath.startsWith('.git/') ||
    filePath.startsWith('.idea/') ||
    filePath === '.package-json.hash' ||
    filePath === '.node-version.cache'
  )
}

function runGitSafe(argsToRun) {
  try {
    return runGit(argsToRun)
  } catch {
    return ''
  }
}

// P2/P1(0.2.91, score-print): 현행 decision-log의 이번 변경 diff에서 추가된 라인만 스캔한다.
// 아카이브(decision-log-*.md)로의 항목 이동이 배너 "추가"로 오인되지 않도록 현행 파일 한 개만 본다.
// diff 범위는 getChangedFiles와 같은 우선순위: --base/--head → 작업 트리(diff HEAD) → 직전 커밋(HEAD~1..HEAD).
function decisionLogAddedLines() {
  const logRel = `${harnessRootRel}/session/decision-log.md`
  const base = getArgValue('--base')
  const head = getArgValue('--head')

  let diff = ''
  if (base && head && !/^0+$/.test(base)) {
    diff = runGitSafe(['diff', base, head, '--', logRel])
  } else {
    diff = runGitSafe(['diff', 'HEAD', '--', logRel])
    if (!diff.trim() && getWorkingTreeChangedFiles().length === 0) {
      // 커밋 직후 검사(작업 트리 clean)면 마지막 커밋 범위를 본다.
      diff = runGitSafe(['diff', 'HEAD~1', 'HEAD', '--', logRel])
    }
  }

  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
}

// 배너 감지 계약(.harness/session/README.md "결정 로그 작성 관례"):
// - ⛔ 이모지 + 폐기/번복이 판별자다. 본문 서술("폐기했다")은 감지하지 않아 과다 승격을 막는다.
// - [권고 뒤집기] 항목이 추가되면 같은 diff에 `근거 반박:` 필드가 있어야 한다.
function analyzeDecisionLogChanges() {
  const added = decisionLogAddedLines()
  const reversalLines = added.filter((line) => /⛔\s*(폐기|번복)/.test(line))
  const overrideLines = added.filter((line) => line.includes('[권고 뒤집기]'))
  const hasRebuttal = added.some((line) => line.includes('근거 반박:'))

  return {
    reversalDetected: reversalLines.length > 0,
    overrideEntries: overrideLines.length,
    overrideMissingRebuttal: overrideLines.length > 0 && !hasRebuttal,
  }
}

// P5(0.2.92, score-print): 로그가 선형 증가하는데 압축 메커니즘이 없으면 세션 읽기 비용이 계속 커진다.
// 임계를 넘긴 decision-log를 "이번에 만진" 커밋에서만 아카이브 분리를 안내한다(매 커밋 반복 안내는
// P3식 노이즈가 되므로 금지). 분리 관례는 .harness/session/README.md "결정 로그 작성 관례".
const DECISION_LOG_LINE_THRESHOLD = 400

function analyzeDecisionLogSize(changedFiles) {
  const logRel = `${harnessRootRel}/session/decision-log.md`
  const abs = path.join(repoRoot, logRel)
  if (!fs.existsSync(abs)) {
    return { oversized: false }
  }

  const lines = fs.readFileSync(abs, 'utf8').split('\n').length
  return {
    oversized: lines > DECISION_LOG_LINE_THRESHOLD && changedFiles.includes(logRel),
    lines,
  }
}

function collectViolations() {
  const registry = readRegistry()
  const stack = readActiveStack()
  const violations = validatePolicyRegistry(registry)
  const checksKey = stack.checksKey

  if (!checksKey) {
    return violations
  }

  console.warn(`checksKey='${checksKey}' 는 본체에서 실행하지 않습니다. 프리셋 전용 검사는 해당 스택 기준 또는 템플릿 저장소의 guard에 연결하세요.`)

  return violations
}

function validatePolicyRegistry(registry) {
  const violations = []
  const ids = new Set()
  const validLayers = new Set(['common', 'stack', 'template', 'project', 'personal'])
  const validStatuses = new Set(['draft', 'active', 'deprecated', 'superseded', 'experimental'])
  const validSeverities = new Set(['info', 'warning', 'error', 'blocker'])
  const validEnforcement = new Set(['inform', 'trigger', 'hook', 'block'])
  const validSyncEnforcement = new Set(['review', 'hook', 'block'])

  for (const policy of registry.policies ?? []) {
    const requiredBasicFields = ['id', 'title', 'documents', 'ownedAreas']

    for (const field of requiredBasicFields) {
      if (policy[field] === undefined || policy[field] === null || policy[field] === '') {
        violations.push({
          rule: 'policy-registry-schema',
          file: `${harnessRootRel}/policy/policy-registry.json`,
          message: `policy '${policy.id ?? '(unknown)'}' missing required field '${field}'`,
        })
      }
    }

    if (policy.id) {
      if (ids.has(policy.id)) {
        violations.push({
          rule: 'policy-registry-schema',
          file: `${harnessRootRel}/policy/policy-registry.json`,
          message: `duplicate policy id '${policy.id}'`,
        })
      }

      ids.add(policy.id)
    }

    if (!Array.isArray(policy.documents) || policy.documents.length === 0) {
      violations.push({
        rule: 'policy-registry-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id ?? '(unknown)'}' documents must be a non-empty array`,
      })
    }

    if (!Array.isArray(policy.ownedAreas) || policy.ownedAreas.length === 0) {
      violations.push({
        rule: 'policy-registry-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id ?? '(unknown)'}' ownedAreas must be a non-empty array`,
      })
    }

    if (policy.triggerPaths !== undefined && (!Array.isArray(policy.triggerPaths) || policy.triggerPaths.length === 0)) {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id ?? '(unknown)'}' triggerPaths must be a non-empty array when provided`,
      })
    }

    if (policy.syncEnforcement !== undefined && !validSyncEnforcement.has(policy.syncEnforcement)) {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id ?? '(unknown)'}' has invalid syncEnforcement '${policy.syncEnforcement}'`,
      })
    }

    if (registry.version < 3 || policy.__origin !== 'base') {
      continue
    }

    const requiredV3Fields = ['layer', 'category', 'status', 'severity', 'enforcement', 'waiverAllowed', 'owner', 'source', 'checks']

    for (const field of requiredV3Fields) {
      if (policy[field] === undefined || policy[field] === null || policy[field] === '') {
        violations.push({
          rule: 'policy-registry-v3-schema',
          file: `${harnessRootRel}/policy/policy-registry.json`,
          message: `policy '${policy.id}' missing v3 field '${field}'`,
        })
      }
    }

    if (policy.layer && !validLayers.has(policy.layer)) {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id}' has invalid layer '${policy.layer}'`,
      })
    }

    if (policy.status && !validStatuses.has(policy.status)) {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id}' has invalid status '${policy.status}'`,
      })
    }

    if (policy.severity && !validSeverities.has(policy.severity)) {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id}' has invalid severity '${policy.severity}'`,
      })
    }

    if (policy.enforcement && !validEnforcement.has(policy.enforcement)) {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id}' has invalid enforcement '${policy.enforcement}'`,
      })
    }

    if (typeof policy.waiverAllowed !== 'boolean') {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id}' waiverAllowed must be boolean`,
      })
    }

    if (!Array.isArray(policy.checks)) {
      violations.push({
        rule: 'policy-registry-v3-schema',
        file: `${harnessRootRel}/policy/policy-registry.json`,
        message: `policy '${policy.id}' checks must be an array`,
      })
    }
  }

  return violations
}

function formatFileList(files) {
  if (files.length === 0) {
    return '  - 없음'
  }

  return files.map((filePath) => `  - ${filePath}`).join('\n')
}

function formatFileSummary(files) {
  if (files.length === 0) {
    return '  - 없음'
  }

  if (showBaseline) {
    return formatFileList(files)
  }

  const groups = new Map()

  for (const filePath of files) {
    const key = filePath.includes('/')
      ? `${filePath.split('/')[0]}/**`
      : filePath
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }

  return [...groups.entries()]
    .map(([key, count]) => `  - ${key} (${count} files)`)
    .join('\n')
}

function readInstallManifest() {
  return readJsonFile(path.join(harnessRoot, 'install-manifest.json'), {})
}

function readStackMarker() {
  return readJsonFile(path.join(harnessRoot, '.stack-applied.json'), {})
}

function isUnmodifiedManagedHarnessFile(filePath, manifest) {
  const managed = manifest?.managedFiles?.[filePath]
  const absPath = path.join(repoRoot, filePath)
  if (!managed?.sha256 || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return false
  }

  try {
    return sha256(absPath) === managed.sha256
  } catch {
    return false
  }
}

function isGeneratedHarnessFile(filePath) {
  return (
    filePath === `${harnessRootRel}/install-manifest.json` ||
    filePath === `${harnessRootRel}/harness-lock.json` ||
    filePath === `${harnessRootRel}/.stack-applied.json` ||
    filePath === `${harnessRootRel}/session/project-scan-report.md` ||
    filePath === `${harnessRootRel}/session/handoff.md` ||
    filePath.startsWith(`${harnessRootRel}/stacks/.applied/`)
  )
}

function isTrackedInGit(filePath) {
  try {
    runGit(['ls-files', '--error-unmatch', filePath])
    return true
  } catch {
    return false
  }
}

function isInitialInstallConfigFile(filePath, manifest) {
  return Boolean(
    manifest?.installedAt &&
    ['package.json', 'package-lock.json', '.gitignore'].includes(filePath) &&
    !isTrackedInGit(filePath),
  )
}

function isHarnessBaselineFile(filePath, manifest, marker) {
  if (isUnmodifiedManagedHarnessFile(filePath, manifest)) {
    return true
  }

  if (isInitialInstallConfigFile(filePath, manifest)) {
    return true
  }

  const copiedStackFiles = new Set(marker?.copiedFiles ?? [])
  if (copiedStackFiles.has(filePath)) {
    return true
  }

  return false
}

function isLocalHarnessFile(filePath) {
  return (
    filePath === `${harnessRootRel}/README.md` ||
    filePath.startsWith(`${harnessRootRel}/project/`) ||
    filePath.startsWith(`${harnessRootRel}/session/`) ||
    filePath.startsWith(`${harnessRootRel}/policy/`) ||
    filePath.startsWith(`${harnessRootRel}/documentation/`) ||
    filePath.startsWith(`${harnessRootRel}/style/`) ||
    filePath.startsWith(`${harnessRootRel}/stacks/`)
  )
}

function isConfigFile(filePath) {
  return (
    filePath === 'package.json' ||
    filePath === 'package-lock.json' ||
    filePath.endsWith('.config.js') ||
    filePath.endsWith('.config.mjs') ||
    filePath.endsWith('.config.ts') ||
    ['.gitignore', '.editorconfig', '.env.example', 'tsconfig.json', 'jsconfig.json', 'eslint.config.js', 'eslint.config.mjs'].includes(filePath)
  )
}

function isFeatureSourceFile(filePath) {
  return /^(src|app|lib|packages|apps|pkg|internal|test|tests|spec|__tests__|supabase\/functions|ios|android)\//.test(filePath)
}

function isHarnessScriptFile(filePath) {
  return (
    filePath.startsWith('.harness/bin/') ||
    filePath.startsWith('scripts/') ||
    filePath === 'CLAUDE.md' ||
    filePath === 'AGENTS.md'
  )
}

function groupChangedFiles(changedFiles) {
  const manifest = readInstallManifest()
  const marker = readStackMarker()
  const groups = {
    feature: [],
    localHarness: [],
    harnessScripts: [],
    config: [],
    generated: [],
    baseline: [],
    other: [],
  }

  for (const filePath of changedFiles) {
    if (isGeneratedHarnessFile(filePath)) {
      groups.generated.push(filePath)
    } else if (isHarnessBaselineFile(filePath, manifest, marker)) {
      groups.baseline.push(filePath)
    } else if (isFeatureSourceFile(filePath)) {
      groups.feature.push(filePath)
    } else if (isLocalHarnessFile(filePath)) {
      groups.localHarness.push(filePath)
    } else if (isHarnessScriptFile(filePath)) {
      groups.harnessScripts.push(filePath)
    } else if (isConfigFile(filePath)) {
      groups.config.push(filePath)
    } else {
      groups.other.push(filePath)
    }
  }

  return groups
}

function printChangedFileGroups(changedFiles) {
  const groups = groupChangedFiles(changedFiles)
  const userChangeCount = groups.feature.length + groups.localHarness.length + groups.harnessScripts.length + groups.config.length + groups.other.length
  const baselineCount = groups.baseline.length + groups.generated.length

  console.log('Changed files summary:')
  console.log(`  user project changes: ${userChangeCount}`)
  console.log(`  harness baseline/generated changes: ${baselineCount}`)
  console.log('')

  if (summaryMode && !showBaseline) {
    console.log('Changed files brief:')
    console.log(`  feature source changes: ${groups.feature.length}`)
    console.log(`  local harness updates: ${groups.localHarness.length}`)
    console.log(`  harness script/entrypoint changes: ${groups.harnessScripts.length}`)
    console.log(`  config changes: ${groups.config.length}`)
    console.log(`  other project changes: ${groups.other.length}`)
    console.log(`  harness baseline/generated changes: ${baselineCount}`)
    console.log('')
    console.log('상세 파일 목록은 npm run harness:impact 또는 npm run harness:check -- --verbose 로 확인하세요.')
    console.log('')
    return groups
  }

  console.log('Feature source changes')
  console.log(formatFileList(groups.feature))
  console.log('')

  console.log('Local harness updates')
  console.log(formatFileList(groups.localHarness))
  console.log('')

  console.log('Harness script/entrypoint changes')
  console.log(formatFileList(groups.harnessScripts))
  console.log('')

  console.log('Config changes')
  console.log(formatFileList(groups.config))
  console.log('')

  if (groups.other.length > 0) {
    console.log('Other project changes')
    console.log(formatFileList(groups.other))
    console.log('')
  }

  console.log('Harness baseline changes')
  console.log(formatFileSummary(groups.baseline))
  console.log('')

  if (groups.generated.length > 0) {
    console.log('Harness generated/lock files')
    console.log(formatFileSummary(groups.generated))
    console.log('')
  }

  if (!showBaseline && baselineCount > 0) {
    console.log('전체 하네스 baseline 파일을 보려면 --show-baseline 또는 --verbose 옵션을 사용하세요.')
    console.log('')
  }

  return groups
}

function policyRelevantChangedFiles(changedFiles, changedGroups) {
  const baselineFiles = new Set([
    ...changedGroups.baseline,
    ...changedGroups.generated,
  ])

  return changedFiles.filter((filePath) => !baselineFiles.has(filePath))
}

function printHarnessBaselineNotice(changedGroups) {
  const baselineCount = changedGroups.baseline.length + changedGroups.generated.length
  if (baselineCount === 0) {
    return
  }

  if (summaryMode && !showBaseline) {
    console.log(`Harness baseline update notice: 본체 관리 baseline/generated 변경 ${baselineCount}건은 기준 동기화 후보 계산에서 제외했습니다.`)
    console.log('')
    return
  }

  console.log('Harness baseline update notice:')
  console.log('- install manifest 기준으로 본체가 관리하는 baseline/generated 파일 변경입니다.')
  console.log('- 소비자 프로젝트가 직접 고친 로컬룰이 아니므로 기준 동기화 후보 계산에서는 제외합니다.')
  console.log('- 같은 파일을 의도적으로 프로젝트 규칙으로 수정했다면 manifest 해시와 달라져 Local harness updates로 분류됩니다.')

  if (showBaseline || verboseMode) {
    console.log('  baseline/generated files:')
    console.log(formatFileList([...changedGroups.baseline, ...changedGroups.generated]))
  }

  console.log('')
}

function isInformationalSyncGap(changedGroups, harnessMode) {
  const sourceChangeCount = changedGroups.feature.length + changedGroups.harnessScripts.length + changedGroups.other.length
  return sourceChangeCount === 0 && (
    harnessMode === 'bootstrap' ||
    changedGroups.baseline.length > 0 ||
    changedGroups.generated.length > 0
  )
}

function writeImpactSummary(summary) {
  try {
    fs.mkdirSync(path.dirname(impactSummaryPath), { recursive: true })
    fs.writeFileSync(impactSummaryPath, JSON.stringify({
      ...summary,
      generatedAt: new Date().toISOString(),
    }, null, 2))
  } catch {
    // Summary output must never make the main policy check fail.
  }
}

function syncReviewLevel(policy, informational, reversalEscalated = false) {
  // 정책 번복 커밋(P2)은 informational 완화보다 우선한다. 폐기/번복 시점이야말로
  // 연결 계약 문서에 반대 서술이 남기 가장 쉬운 지점이라 이 커밋에서만 확인을 강제한다.
  // 번복이 아닐 때의 등급 순서(informational이 block/hook보다 우선)는 0.2.86 거동을 그대로 유지한다.
  if (reversalEscalated) {
    return policy.syncEnforcement === 'block' ? 'blocking' : 'action required'
  }

  if (informational) {
    return 'info'
  }

  if (policy.syncEnforcement === 'block') {
    return 'blocking'
  }

  if (policy.syncEnforcement === 'hook') {
    return 'action required'
  }

  return 'review suggested'
}

function syncReviewLevelLabel(level) {
  return {
    blocking: '차단',
    'action required': '확인 필수',
    'review suggested': '가볍게 확인',
    info: '참고',
  }[level] ?? level
}

function actionMessage(level, side) {
  if (level === 'blocking') {
    return '이 기준은 동기화를 명시적으로 강제합니다. 연결 문서/구현을 반영하거나 잘못된 매핑을 좁히세요.'
  }

  if (level === 'action required') {
    return '이 기준은 동기화 확인을 필수로 지정했습니다. 구조·계약 변경 여부를 확인하고 필요한 쪽만 반영하세요.'
  }

  if (level === 'review suggested') {
    return side === 'document-only'
      ? '문서가 실제 구현 변경을 요구하는 기준 변경인지 확인하세요. 설명 보강이면 구현 수정이 필요 없습니다.'
      : '코드가 구조·계약·팀 기준을 바꾼 변경인지 확인하세요. 일반 구현 변경이면 문서 수정이 필요 없습니다.'
  }

  return '초기 설치, rules-only 스택 적용, 생성 파일 갱신에서 생긴 참고용 연결 신호입니다.'
}

function ignoreMessage(side) {
  if (side === 'document-only') {
    return '설명 보강, 예시 수정, 문구 정리처럼 구현 계약을 바꾸지 않은 문서 변경일 때'
  }

  return '일반 구현, 버그 수정, 리팩터링 내부 정리, 주석/문구 변경처럼 팀 기준을 바꾸지 않았을 때'
}

function printProjectRuleCandidateReminder(changedGroups) {
  const sourceChangeCount = changedGroups.feature.length + changedGroups.harnessScripts.length + changedGroups.config.length + changedGroups.other.length
  const localHarnessChangeCount = changedGroups.localHarness.length

  if (summaryMode && changedGroups.feature.length === 0 && changedGroups.harnessScripts.length === 0 && changedGroups.other.length === 0) {
    return
  }

  if (sourceChangeCount === 0 && localHarnessChangeCount === 0) {
    return
  }

  if (summaryMode) {
    console.log('Project rule candidate check: 반복 규칙/구조 결정/검증 절차가 생겼으면 .harness/project/* 로컬룰 승격을 검토하고, 런타임 불변식은 문서 대신 테스트/CI 가드로 만드세요. (안내 상세: --verbose)')
    console.log('')
    return
  }

  console.log('Project rule candidate check:')
  console.log('- 이번 변경에서 반복되는 도메인 규칙, 구조 결정, 검증/리뷰 절차가 생겼는지 확인하세요.')
  console.log('- 승격 전에 먼저 물으세요: 이 규칙은 문서로 남길 것인가, 실행 가능한 검증으로 만들 것인가?')
  console.log('- 사람이 매번 기억해야 지켜지는 런타임 불변식(예: 동적 클래스 safelist 등록)은 문서 규칙으로는 못 막습니다. 테스트/CI/lint 가드로 표현해 누락을 빌드 실패로 만드세요.')
  console.log('- 확정 가능한 문서 규칙은 .harness/project/domain-rules.md, architecture-rules.md, workflow-rules.md에 기록합니다.')
  console.log('- 확신이 없거나 팀 선택이 필요하면 .harness/session/developer-input-queue.md에 질문으로 남기고, 선택 이유는 decision-log.md에 남깁니다.')
  console.log('')
}

function runImpact() {
  const registry = readRegistry()
  const trackedFiles = getAllTrackedFiles()
  const changedFiles = getChangedFiles()
  const profile = readProfile()
  const harnessMode = profile.harnessMode ?? 'bootstrap'

  console.log('Policy impact analysis')
  console.log(`Harness mode: ${harnessMode}${strictMode ? ' (strict)' : ''}`)
  console.log('')

  if (changedFiles.length === 0) {
    console.log('변경 파일을 찾지 못했습니다. 정책 영향도는 현재 작업 트리 기준으로 수동 확인이 필요합니다.')
    return
  }

  const changedGroups = printChangedFileGroups(changedFiles)
  printProjectRuleCandidateReminder(changedGroups)
  printHarnessBaselineNotice(changedGroups)
  const changedFilesForPolicy = policyRelevantChangedFiles(changedFiles, changedGroups)
  const baselineOnly = changedGroups.feature.length + changedGroups.harnessScripts.length + changedGroups.other.length === 0 && (changedGroups.baseline.length > 0 || changedGroups.generated.length > 0)

  const policyTriggered = []
  const codeTriggered = []
  const syncGaps = []
  const syncGapLevels = {
    blocking: 0,
    'action required': 0,
    'review suggested': 0,
    info: 0,
  }

  for (const policy of registry.policies) {
    const documents = policy.documents ?? []
    const ownedAreas = policy.ownedAreas ?? []
    const triggerPaths = policy.triggerPaths ?? ownedAreas
    const changedDocuments = matchedFiles(changedFilesForPolicy, documents)
    const changedSources = matchedFiles(changedFilesForPolicy, triggerPaths)
    const documentChanged = changedDocuments.length > 0
    const sourceChanged = changedSources.length > 0
    const hasOwnedFiles = trackedFiles.some((filePath) => matchesAnyGlob(filePath, ownedAreas))

    if (documentChanged) {
      const impactedFiles = trackedFiles.filter((filePath) => matchesAnyGlob(filePath, ownedAreas))
      policyTriggered.push({
        id: policy.id,
        title: policy.title,
        files: impactedFiles,
        triggeredFiles: changedDocuments,
        matchedRules: matchedRules(changedDocuments, documents),
      })
    }

    if (sourceChanged) {
      codeTriggered.push({
        id: policy.id,
        title: policy.title,
        documents,
        triggeredFiles: changedSources,
        matchedRules: matchedRules(changedSources, triggerPaths),
      })
    }

    if (documentChanged !== sourceChanged && (sourceChanged || hasOwnedFiles)) {
      syncGaps.push({
        id: policy.id,
        title: policy.title,
        syncEnforcement: policy.syncEnforcement ?? 'review',
        side: documentChanged ? 'document-only' : 'source-only',
        documents,
        ownedAreas,
        triggerPaths,
        triggeredFiles: documentChanged ? changedDocuments : changedSources,
        matchedRules: documentChanged
          ? matchedRules(changedDocuments, documents)
          : matchedRules(changedSources, triggerPaths),
      })
    }
  }

  if (policyTriggered.length > 0) {
    if (summaryMode) {
      console.log(`변경 문서와 연결된 구현 기준: ${policyTriggered.length}개`)
      console.log('')
    } else {
      console.log('변경 문서와 연결된 구현 기준:')

      for (const item of policyTriggered) {
        console.log(`- [${item.id}] ${item.title}`)
        console.log('  trigger files:')
        console.log(formatFileList(item.triggeredFiles))
        console.log('  matched rules:')
        console.log(formatFileList(item.matchedRules))
        console.log('  review scope:')
        console.log(baselineOnly && !showBaseline ? formatFileSummary(item.files) : formatFileList(item.files))
      }

      console.log('')
    }
  }

  if (codeTriggered.length > 0) {
    if (summaryMode) {
      console.log(`변경 코드와 연결된 기준 문서: ${codeTriggered.length}개`)
      console.log('')
    } else {
      console.log('변경 코드와 연결된 기준 문서:')

      for (const item of codeTriggered) {
        console.log(`- [${item.id}] ${item.title}`)
        console.log('  trigger files:')
        console.log(formatFileList(item.triggeredFiles))
        console.log('  matched rules:')
        console.log(formatFileList(item.matchedRules))
        console.log('  related documents:')
        console.log(baselineOnly && !showBaseline ? formatFileSummary(item.documents) : formatFileList(item.documents))
      }

      console.log('')
    }
  }

  if (policyTriggered.length === 0 && codeTriggered.length === 0) {
    console.log('등록된 정책-코드 매핑에 걸리는 변경은 없습니다.')
  }

  const informational = isInformationalSyncGap(changedGroups, harnessMode)
  const logFindings = { ...analyzeDecisionLogChanges(), ...analyzeDecisionLogSize(changedFiles) }
  for (const gap of syncGaps) {
    syncGapLevels[syncReviewLevel(gap, informational, logFindings.reversalDetected)]++
  }

  writeImpactSummary({
    harnessMode,
    strictMode,
    changedFiles: changedFiles.length,
    policyRelevantChangedFiles: changedFilesForPolicy.length,
    changedGroups: Object.fromEntries(Object.entries(changedGroups).map(([key, value]) => [key, value.length])),
    policyTriggered: policyTriggered.length,
    codeTriggered: codeTriggered.length,
    syncGaps: syncGaps.length,
    syncGapLevels,
    syncReviewCandidates: syncGaps.length,
    syncReviewLevels: syncGapLevels,
    decisionLog: logFindings,
  })

  if (logFindings.reversalDetected) {
    console.log('')
    console.log('정책 번복 감지 (decision-log 배너 추가):')
    console.log('- 이번 변경의 decision-log에 폐기/번복 배너(⛔)가 추가되었습니다.')
    console.log('- 연결 계약/기준 문서에 반대 서술이 남아 있지 않은지 확인하세요. 폐기 결정은 문서-코드 불일치가 가장 잘 생기는 지점입니다.')
    if (syncGaps.length > 0) {
      console.log('- 이번 실행의 기준 동기화 검토 후보를 확인 필수로 승격합니다.')
    }
  }

  if (logFindings.overrideMissingRebuttal) {
    console.log('')
    console.log('권고 뒤집기 기록 검사:')
    console.log('- [확인 필수] decision-log에 [권고 뒤집기] 항목이 추가됐지만 같은 변경에 근거 반박: 필드가 없습니다.')
    console.log('- 뒤집은 권고의 근거를 무엇으로 반박했는지 해당 항목에 남기세요. 관례: .harness/session/README.md')
  }

  if (logFindings.oversized) {
    console.log('')
    console.log(`Decision log size notice: decision-log.md가 ${logFindings.lines}줄입니다(안내 임계 ${DECISION_LOG_LINE_THRESHOLD}줄).`)
    console.log('- 폐기/번복/종결된 항목과 오래된 이력을 decision-log-YYYYH1.md 같은 날짜 아카이브로 옮기고, 현행 파일에는 유효 결정만 남기세요.')
    console.log('- 분리 절차: .harness/session/README.md "결정 로그 작성 관례". 아카이브 파일은 orphan/코드 경로 검사에서 자동 제외됩니다.')
  }

  if (syncGaps.length > 0) {
    console.log('')
    console.log('기준 동기화 검토 후보 (의미 불일치 판정 아님):')
    console.log('- 연결된 문서와 코드 중 한쪽이 변경됐다는 파일 경로 신호입니다.')
    console.log('- 구조·계약·팀 기준이 실제로 바뀐 경우에만 반대쪽 갱신이 필요합니다.')

    const printGapDetail = (gap) => {
      const sideLabel = gap.side === 'document-only' ? '문서만 변경됨' : '소스만 변경됨'
      const level = syncReviewLevel(gap, informational, logFindings.reversalDetected)
      console.log(`- [${syncReviewLevelLabel(level)}] [${gap.id}] ${gap.title} — ${sideLabel}`)
      console.log(`  동기화 강제 설정: ${gap.syncEnforcement}`)
      console.log('  변경 파일:')
      console.log(formatFileList(gap.triggeredFiles))
      console.log('  매칭 경로:')
      console.log(formatFileList(gap.matchedRules))
      console.log('  연결 문서:')
      console.log(informational && !showBaseline ? formatFileSummary(gap.documents) : formatFileList(gap.documents))
      console.log('  연결 구현 범위:')
      console.log(informational && !showBaseline ? formatFileSummary(gap.ownedAreas) : formatFileList(gap.ownedAreas))
      console.log(`  판단 기준: ${actionMessage(level, gap.side)}`)
      console.log(`  조치 없음 조건: ${ignoreMessage(gap.side)}`)
    }

    // '차단/확인 필수'는 정책이 syncEnforcement로 명시 강제한 후보라 요약 모드에서도 상세를 편다.
    // 나머지는 개수와 상세 경로만 안내해 신호 대 잡음비를 지킨다.
    const mustActGaps = syncGaps.filter((gap) => ['blocking', 'action required'].includes(syncReviewLevel(gap, informational, logFindings.reversalDetected)))

    if (summaryMode) {
      const advisorySummary = ['review suggested', 'info']
        .filter((level) => syncGapLevels[level] > 0)
        .map((level) => `${syncReviewLevelLabel(level)} ${syncGapLevels[level]}건`)
        .join(', ')
      if (advisorySummary) {
        console.log(`- ${advisorySummary} — 상세 기준과 파일 목록은 npm run harness:impact 또는 npm run harness:check -- --verbose 로 확인하세요.`)
      }
      for (const gap of mustActGaps) {
        printGapDetail(gap)
      }
    } else {
      console.log('  후보 등급:')
      for (const level of ['blocking', 'action required', 'review suggested', 'info']) {
        if (syncGapLevels[level]) {
          console.log(`  - ${syncReviewLevelLabel(level)}: ${syncGapLevels[level]}`)
        }
      }

      for (const gap of syncGaps) {
        printGapDetail(gap)
      }
    }

    if (informational && !logFindings.reversalDetected) {
      console.log('')
      console.log('안내: 설치 baseline 또는 rules-only 스택 기준이 처음 추가된 상황이면 정상입니다.')
    } else if (!summaryMode || mustActGaps.length > 0) {
      // 요약 모드에서 '가볍게 확인'만 있으면 판단 안내를 반복하지 않는다(헤더가 이미 같은 내용을 담는다).
      console.log('')
      console.log('판단: 구조·계약·팀 기준 변경이면 연결 문서를 갱신하고, 일반 구현 변경이면 별도 조치 없이 진행합니다.')
      console.log('decision-log/waiver는 지속되는 구조 판단이나 명시적 강제 정책의 예외에만 사용합니다.')
    }

    if (strictMode && (syncGapLevels.blocking > 0 || syncGapLevels['action required'] > 0)) {
      process.exitCode = 1
    }
  }

  // 권고 뒤집기 기록 누락은 동기화 후보와 별개로 strict에서 실패한다(P1, 차단 승격).
  if (strictMode && logFindings.overrideMissingRebuttal) {
    process.exitCode = 1
  }
}

function runCheck() {
  const violations = collectViolations()

  if (violations.length === 0) {
    console.log('Policy registry/schema check passed')
    console.log('주의: 스택별 실제 자동 checks가 비어 있으면 업무 규칙 자체를 검증한 것은 아닙니다. 상세 기준은 harness:impact와 스택 policies.json을 확인하세요.')
    return
  }

  console.error('Policy check failed')
  console.error('')

  for (const violation of violations) {
    console.error(`[${violation.rule}] ${violation.file}: ${violation.message}`)
  }

  process.exitCode = 1
}

if (mode === 'impact') {
  runImpact()
} else if (mode === 'check') {
  runCheck()
} else if (mode === 'guard') {
  runImpact()
  console.log('')
  runCheck()
} else {
  console.error(`Unknown mode: ${mode}`)
  process.exit(1)
}
