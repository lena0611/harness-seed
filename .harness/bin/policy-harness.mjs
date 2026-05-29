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

  if (briefMode && !verboseMode && !showBaseline) {
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

  console.log('Harness baseline update notice:')
  console.log('- install manifest 기준으로 본체가 관리하는 baseline/generated 파일 변경입니다.')
  console.log('- 소비자 프로젝트가 직접 고친 로컬룰이 아니므로 정책 sync gap 계산에서는 제외합니다.')
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

function policyActionLevel(policy, informational) {
  if (informational || policy.severity === 'info' || policy.enforcement === 'inform') {
    return 'info'
  }

  if (strictMode || policy.severity === 'blocker' || policy.enforcement === 'block') {
    return 'blocking'
  }

  if (policy.severity === 'error' || policy.enforcement === 'hook') {
    return 'action required'
  }

  return 'review suggested'
}

function actionMessage(level, side) {
  if (level === 'blocking') {
    return '반대편 변경을 함께 반영하거나, 허용된 경우 waiver/decision-log에 예외 근거를 남겨야 합니다.'
  }

  if (level === 'action required') {
    return '관련 기준 또는 구현 변경을 확인하고, 누락이면 함께 수정하세요.'
  }

  if (level === 'review suggested') {
    return side === 'document-only'
      ? '문서 기준만 바뀐 의도적 변경인지 확인하세요. 구현이 필요 없으면 decision-log에 이유를 남기면 됩니다.'
      : '구현만 바뀐 의도적 변경인지 확인하세요. 반복 규칙이면 project rule 또는 decision-log에 남기면 됩니다.'
  }

  return '초기 설치, rules-only 스택 적용, 생성 파일 갱신처럼 기준만 추가되는 상황이면 참고용입니다.'
}

function ignoreMessage(policy, side) {
  if (side === 'document-only') {
    return '새 기준을 기록했지만 이번 커밋에서 구현 변경이 필요 없고, 그 이유가 decision-log 또는 문서 본문에 남아 있을 때'
  }

  if (policy.waiverAllowed) {
    return '단발성 구현 변경이거나 별도 검증으로 대체했고 waiver/decision-log에 근거를 남겼을 때'
  }

  return '이 정책은 waiver를 허용하지 않습니다. 매칭이 잘못되었다면 정책의 triggerPaths/documents를 좁혀야 합니다.'
}

function printProjectRuleCandidateReminder(changedGroups) {
  const sourceChangeCount = changedGroups.feature.length + changedGroups.harnessScripts.length + changedGroups.config.length + changedGroups.other.length
  const localHarnessChangeCount = changedGroups.localHarness.length

  if (briefMode && changedGroups.feature.length === 0 && changedGroups.harnessScripts.length === 0 && changedGroups.other.length === 0) {
    return
  }

  if (sourceChangeCount === 0 && localHarnessChangeCount === 0) {
    return
  }

  console.log('Project rule candidate check:')
  console.log('- 이번 변경에서 반복되는 도메인 규칙, 구조 결정, 검증/리뷰 절차가 생겼는지 확인하세요.')
  console.log('- 확정 가능한 내용은 .harness/project/domain-rules.md, architecture-rules.md, workflow-rules.md에 기록합니다.')
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
        severity: policy.severity ?? 'warning',
        enforcement: policy.enforcement ?? 'trigger',
        waiverAllowed: Boolean(policy.waiverAllowed),
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
    if (briefMode && !verboseMode) {
      console.log(`Policy document changes require source review: ${policyTriggered.length}개 기준 영향`)
      console.log('')
    } else {
      console.log('Policy document changes require source review:')

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
    if (briefMode && !verboseMode) {
      console.log(`Source changes require policy review: ${codeTriggered.length}개 기준 영향`)
      console.log('')
    } else {
      console.log('Source changes require policy review:')

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

  const informational = !strictMode && isInformationalSyncGap(changedGroups, harnessMode)
  for (const gap of syncGaps) {
    syncGapLevels[policyActionLevel(gap, informational)]++
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
  })

  if (syncGaps.length > 0) {
    console.log('')
    console.log(informational
      ? 'SYNC GAP info (초기 설치/스택 적용 직후라면 정상일 수 있음):'
      : strictMode
        ? 'SYNC GAP blocking summary (strict 모드에서는 기준-코드 불일치를 실패로 봅니다):'
        : 'SYNC GAP review summary (조치 필요와 참고용을 구분해 확인하세요):')

    if (briefMode && !verboseMode) {
      console.log(`- ${syncGaps.length}개 기준에서 한쪽 변경이 감지되었습니다.`)
      console.log('- 상세 기준과 파일 목록은 npm run harness:impact 또는 npm run harness:check -- --verbose 로 확인하세요.')
    } else {
      console.log('  severity summary:')
      for (const level of ['blocking', 'action required', 'review suggested', 'info']) {
        if (syncGapLevels[level]) {
          console.log(`  - ${level}: ${syncGapLevels[level]}`)
        }
      }

      for (const gap of syncGaps) {
        const sideLabel = gap.side === 'document-only' ? '문서만 변경됨' : '소스만 변경됨'
        const level = policyActionLevel(gap, informational)
        console.log(`- [${level}] [${gap.id}] ${gap.title} — ${sideLabel}`)
        console.log(`  policy: severity=${gap.severity}, enforcement=${gap.enforcement}, waiverAllowed=${gap.waiverAllowed}`)
        console.log('  trigger files:')
        console.log(formatFileList(gap.triggeredFiles))
        console.log('  matched rules:')
        console.log(formatFileList(gap.matchedRules))
        console.log('  related documents:')
        console.log(informational && !showBaseline ? formatFileSummary(gap.documents) : formatFileList(gap.documents))
        console.log('  review scope:')
        console.log(informational && !showBaseline ? formatFileSummary(gap.ownedAreas) : formatFileList(gap.ownedAreas))
        console.log(`  needed action: ${actionMessage(level, gap.side)}`)
        console.log(`  can ignore when: ${ignoreMessage(gap, gap.side)}`)
      }
    }

    console.log('')
    if (informational) {
      console.log('안내: 설치 baseline 또는 rules-only 스택 기준이 처음 추가된 상황이면 정상입니다.')
      console.log('업무 기능 변경 중이라면 관련 코드, decision-log, waiver 반영 여부를 확인하세요.')
    } else {
      console.log('해결: 반대편을 함께 갱신하거나, 의도적이라면 waiver/decision-log에 기록하세요.')
    }

    if (strictMode) {
      process.exitCode = 1
    }
  }
}

function runCheck() {
  const violations = collectViolations()

  if (violations.length === 0) {
    console.log('Policy check passed')
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
