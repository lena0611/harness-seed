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

// 기획 연동 런타임은 `.harness` 배치에만 있다(.github 어댑터에는 없음). 있으면 그 판정을 그대로 쓴다 —
// 같은 사실을 두 곳에서 따로 계산하면 반드시 갈라진다(0.2.103 재리뷰 P2-3).
const specRuntime = fs.existsSync(path.join(__dirname, 'spec-sync.mjs'))
  ? await import('./spec-sync.mjs')
  : null

// harnessMode 값 검증(0.2.102): 종전에는 'strict'와의 문자열 비교뿐이라 오타('strct')를 내면
// 조용히 비-strict로 동작했다 — "차단을 켰다고 믿는데 실제로는 꺼져 있는" 상태다.
// 알 수 없는 값은 필수 조치로 표면화하고, strict가 의도였을 수 있으므로 완화 쪽으로 해석하지 않는다.
const HARNESS_MODES = ['bootstrap', 'active', 'maintenance', 'strict']

// 파일 부재 / JSON 깨짐 / 값 오류를 구분한다(0.2.102 리뷰 P1-10).
// 앞의 둘을 하나로 뭉치면 malformed profile이 "설정 없음"으로 통과해버린다.
function readHarnessModeState() {
  if (!fs.existsSync(profilePath)) {
    return { value: 'bootstrap', valid: true, missingProfile: true }
  }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  } catch (error) {
    return { value: 'bootstrap', valid: false, kind: 'malformed', reason: String(error.message ?? error).split('\n')[0] }
  }

  const raw = parsed?.harnessMode
  if (raw === undefined || raw === null) {
    return { value: 'bootstrap', valid: true }
  }
  if (typeof raw === 'string' && HARNESS_MODES.includes(raw)) {
    return { value: raw, valid: true }
  }
  return { value: 'bootstrap', valid: false, kind: 'invalid-value', raw }
}

const harnessModeState = readHarnessModeState()
const strictMode = args.includes('--strict') || harnessModeState.value === 'strict'
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
      return output ? output.split('\n').filter(Boolean).map(decodeSpecGitPath) : []
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

  // git은 비ASCII 경로를 "..." octal로 인용해 출력한다(core.quotePath 기본값). 디코딩하지 않으면
  // 한글 파일명(예: .claude/commands/기획문서연동.md)이 매니페스트 키와 안 맞아 본체 파일인데도
  // "내 프로젝트 변경"으로 오분류된다(0.2.102에서 실측·수정).
  try {
    const trackedChanges = runGit(['diff', '--name-only', 'HEAD'])
    changed.push(...(trackedChanges ? trackedChanges.split('\n').filter(Boolean).map(decodeSpecGitPath) : []))
  } catch {
    // noop
  }

  try {
    const untrackedChanges = runGit(['ls-files', '--others', '--exclude-standard'])
    changed.push(...(untrackedChanges ? untrackedChanges.split('\n').filter(Boolean).map(decodeSpecGitPath) : []))
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
    return output ? output.split('\n').filter(Boolean).map(decodeSpecGitPath) : []
  } catch {
    try {
      const output = runGit(['status', '--short'])
      return output
        .split('\n')
        .filter(Boolean)
        .map((line) => decodeSpecGitPath(line.slice(3)))
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

// 기획 문서 연동(0.2.99): 커밋 검증에서 기획-코드 관계를 advisory로 보여준다.
// 네트워크를 쓰지 않는다 — spec-lock에 기록된 기준 시점과 로컬 캐시만 비교한다(오프라인에서 커밋이 막히면 안 됨).
// 원격 최신 여부는 여기서 판정하지 않으며, 최신화는 명시적 harness:spec:fetch의 몫이다.
// 판정 완료 표기((사양 없음)/(코드 없음))는 매핑이 아니라 "검토됨" 선언이므로 entries에서 뺀다.
// 파서 관례는 spec-sync.parseSpecMapText와 동일하게 유지한다(같은 표를 두 곳이 읽는다).
const SPEC_MAP_EXEMPT_TOKEN = /^[(（]\s*(사양\s*없음|코드\s*없음|해당\s*없음|없음)\s*[)）]$/

// git이 비ASCII 경로를 "..." octal로 감싸 출력하는 것을 되돌린다(spec-sync.decodeGitPath와 동일 규칙).
function decodeSpecGitPath(filePath) {
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
    } else if (next) {
      for (const byte of Buffer.from(next, 'utf8')) bytes.push(byte)
      i += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function specMapRows() {
  const abs = path.join(repoRoot, '.harness/project/spec-map.md')
  if (!fs.existsSync(abs)) return []
  return fs.readFileSync(abs, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !/기획 문서/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2)
    .map(([spec, code]) => ({
      spec: spec.replaceAll('`', '').trim(),
      codePaths: code.split(',').map((item) => item.replaceAll('`', '').trim()).filter(Boolean),
      specExempt: SPEC_MAP_EXEMPT_TOKEN.test(spec.replaceAll('`', '').trim()),
      codeExempt: SPEC_MAP_EXEMPT_TOKEN.test(code.replaceAll('`', '').trim()),
    }))
}

function readSpecMapEntries() {
  return specMapRows()
    .filter((row) => !row.specExempt && !row.codeExempt)
    .map(({ spec, codePaths }) => ({ spec, codePaths }))
    .filter((entry) => entry.spec && entry.spec !== 'TBD')
}

// (사양 없음) 행이 선언한 "기획 문서 대상 아님" 코드 경로들.
function readSpecMapExemptCodePaths() {
  return specMapRows()
    .filter((row) => row.specExempt && !row.codeExempt)
    .flatMap((row) => row.codePaths)
}

// 커밋 시점 매핑 커버리지 안내(advisory): 매핑된 영역에 새로 생긴 파일인데 매핑도 판정도 없으면
// 커밋 단계에서 미리 알려준다. gate 프로젝트에서는 같은 판정이 push에서 차단으로 작동한다.
function analyzeMappingCoverageLocal(changedFiles, entries) {
  if (entries.length === 0 || changedFiles.length === 0) return []

  // 추가·수정된 파일이 대상이다(0.2.102 리뷰 P1-4). 미매핑 기존 파일을 계속 고치는 동안
  // 아무 안내도 없으면 그 코드는 영원히 기획 게이트에 걸리지 않는다.
  // 단, 삭제된 파일은 제외한다 — 지운 파일의 매핑을 추가하라고 요구하면 안 되고,
  // push 게이트(--diff-filter=AM)와 판정 집합도 어긋난다(0.2.103 자체 리뷰 S5).
  const added = changedFiles.filter((filePath) => fs.existsSync(path.join(repoRoot, filePath)))
  if (added.length === 0) return []

  // 관리 영역 규칙은 spec-sync.collectManagedAreas와 동일하다: 매핑 기준 디렉터리 + 그 부모(형제 기능 폴더),
  // 단 깊이 2 이상만. 'src' 같은 최상위를 영역으로 잡으면 유틸·설정까지 걸려 잡음이 된다.
  const depth = (value) => value.split('/').filter(Boolean).length
  const managedDirs = new Set()
  for (const entry of entries) {
    for (const mapPath of entry.codePaths) {
      const starIndex = mapPath.indexOf('*')
      const rawBase = starIndex === -1 ? mapPath : mapPath.slice(0, starIndex)
      const base = rawBase.endsWith('/') ? rawBase.slice(0, -1) : path.posix.dirname(rawBase)
      if (!base || base === '.' || base === '/') continue
      if (depth(base) >= 2) managedDirs.add(base)
      const parent = path.posix.dirname(base)
      if (parent && parent !== '.' && parent !== '/' && depth(parent) >= 2) managedDirs.add(parent)
    }
  }
  if (managedDirs.size === 0) return []

  const exemptPaths = readSpecMapExemptCodePaths()
  const matchesMapPath = (filePath, mapPath) => matchesGlob(filePath, mapPath)
    || filePath === mapPath
    || filePath.startsWith(`${mapPath.replace(/\/?\*\*$/, '')}/`)

  return added
    .filter((filePath) => [...managedDirs].some((dir) => filePath.startsWith(`${dir}/`)))
    .filter((filePath) => !entries.some((entry) => entry.codePaths.some((mapPath) => matchesMapPath(filePath, mapPath))))
    .filter((filePath) => !exemptPaths.some((mapPath) => matchesMapPath(filePath, mapPath)))
    .sort()
}

function analyzeSpecLink(changedFiles) {
  const lockAbs = path.join(harnessRoot, 'spec-lock.json')
  if (!fs.existsSync(lockAbs)) {
    return { configured: false }
  }

  // 손상된 lock을 "미연동"으로 강등하면 연동 프로젝트에서 기획 안내가 통째로 사라진다(재리뷰 P1-3).
  let lock
  try {
    lock = JSON.parse(fs.readFileSync(lockAbs, 'utf8'))
  } catch (error) {
    return { configured: true, stateError: `spec-lock.json을 해석할 수 없습니다 — ${String(error.message ?? error).split('\n')[0]}`, changedSpecs: [], touchedMappings: [], missingCaches: [], uncoveredNewFiles: [] }
  }
  if (!lock?.sources) {
    return { configured: false }
  }

  const entries = readSpecMapEntries()
  const touchedMappings = []
  const missingCaches = []

  for (const sourceId of Object.keys(lock.sources)) {
    const cacheDir = specRuntime?.specCacheDirPath
      ? specRuntime.specCacheDirPath(sourceId)
      : path.join(harnessRoot, 'generated', 'spec-cache', sourceId)
    if (!cacheDir || !fs.existsSync(cacheDir)) missingCaches.push(sourceId)
  }

  // "미정산 기획 변경"의 판정은 spec-sync의 pendingSettlements 하나만 쓴다(재리뷰 P2-3).
  // 여기서 따로 세면 baseSha compare-and-swap이 빠져, spec-sync가 폐기한 낡은 스냅샷을
  // 관리 경고로 다시 띄우게 된다 — 같은 사실에 두 판정이 생긴다.
  let changedSpecs = []
  let stateError = null
  if (specRuntime?.pendingSettlements && specRuntime?.normalizeLock) {
    try {
      changedSpecs = specRuntime.pendingSettlements(specRuntime.normalizeLock(lock))
        .map((item) => ({ rel: item.file, kind: item.kind }))
    } catch (error) {
      stateError = String(error.message ?? error).split('\n')[0]
    }
  }

  // 이번 변경 코드가 매핑된 구현 경로에 걸리면, 그 코드의 상위 기준(기획 문서)을 알려준다.
  for (const entry of entries) {
    const hit = changedFiles.some((filePath) => entry.codePaths.some((glob) => matchesGlob(filePath, glob) || filePath === glob || filePath.startsWith(`${glob.replace(/\/?\*\*$/, '')}/`)))
    if (hit) {
      touchedMappings.push(entry)
    }
  }

  return {
    configured: true,
    mappings: entries.length,
    changedSpecs,
    touchedMappings,
    missingCaches,
    stateError,
    uncoveredNewFiles: analyzeMappingCoverageLocal(changedFiles, entries),
  }
}

function printSpecLinkNotice(specLink) {
  if (!specLink.configured) return
  const uncovered = specLink.uncoveredNewFiles ?? []
  const missingCaches = specLink.missingCaches ?? []
  if (!specLink.stateError
    && specLink.changedSpecs.length === 0 && specLink.touchedMappings.length === 0
    && uncovered.length === 0 && missingCaches.length === 0) return

  console.log('')
  console.log('기획 문서 연동 참고 (advisory):')
  if (specLink.stateError) {
    console.log(`- ⚠ 기획 연동 상태를 읽을 수 없습니다: ${specLink.stateError}`)
    console.log('  이 상태에서는 기획 변경 안내가 나오지 않습니다. 복구 전에는 "변경 없음"으로 보지 마세요.')
    console.log('  복구: 손상 파일을 git 이력에서 되돌리거나, npm run harness:spec:fetch -- --cache-only')
  }
  if (missingCaches.length > 0) {
    // 캐시 없음은 잘못이 아니라 "아직 안 받은 상태"다. 차단하지 않고 받는 방법만 알린다.
    console.log(`- 기획 문서 본문이 이 환경에 없습니다(${missingCaches.join(', ')}). 기획서가 없는 것이 아니라 로컬에 내려받지 않은 상태입니다.`)
    console.log('  받기: npm run harness:spec:fetch -- --at-lock  (팀 기준 시점 그대로, 기준은 옮기지 않습니다)')
  }
  if (specLink.touchedMappings.length > 0) {
    console.log('- 이번 변경이 기획 문서와 매핑된 구현 경로에 걸립니다. 해당 사양과 어긋나지 않는지 확인하세요.')
    for (const entry of specLink.touchedMappings.slice(0, 5)) {
      console.log(`  - ${entry.spec} ← ${entry.codePaths.join(', ')}`)
    }
  }
  if (specLink.changedSpecs.length > 0) {
    console.log(`- 읽었지만 아직 정산하지 않은 기획 변경이 ${specLink.changedSpecs.length}건 있습니다. 상세: npm run harness:spec:status`)
  }
  if (uncovered.length > 0) {
    console.log('- 매핑된 영역에 새 파일이 있는데 spec-map 기록이 없습니다. 지금 한 줄 추가하면 이후 사양 변경이 이 코드로 연결됩니다.')
    for (const filePath of uncovered.slice(0, 5)) {
      console.log(`  - ${filePath}`)
    }
    if (uncovered.length > 5) {
      console.log(`  - 외 ${uncovered.length - 5}건`)
    }
    console.log('  기획 문서가 필요 없는 코드면 판정으로 기록합니다: | (사양 없음) | <경로 또는 디렉터리/**> | 사유 |')
    console.log('  specEnforcement가 gate면 이 항목은 push에서 차단됩니다.')
  }
}

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

// 훅 설치 여부는 **clone으로 공유되지 않는다**(core.hooksPath는 로컬 git config).
// 그래서 "설치했으니 팀 전체가 검사받는다"가 성립하지 않는다 — 사람마다 설치해야 한다.
// 검사에서 감지해 안내하지 않으면, 훅 없는 개발자는 자기가 검사 밖에 있다는 사실조차 모른다(4차 리뷰 P1-2).
function printHookInstallNotice() {
  if (harnessRootRel !== '.harness') return
  if (!fs.existsSync(path.join(repoRoot, '.githooks'))) return

  let hooksPath = ''
  try {
    hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    hooksPath = ''
  }
  if (hooksPath === '.githooks') return

  console.log('')
  console.log('git hook 미설치 (이 clone 기준):')
  console.log(hooksPath
    ? `- core.hooksPath가 '${hooksPath}'로 설정되어 있어 하네스 훅이 실행되지 않습니다.`
    : '- core.hooksPath가 설정되어 있지 않아 커밋·push 검사가 실행되지 않습니다.')
  console.log('- 훅 설정은 clone으로 공유되지 않습니다. 저장소를 새로 받은 사람은 각자 한 번 실행해야 합니다:')
  console.log('    npm run harness:hooks:install')
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

  // P4 잔여 압축(0.2.94, score-print 검수 후속): 요약 모드의 변경 파일 분류는 14줄 두 블록 대신
  // 0이 아닌 그룹만 담은 한 줄로 줄인다. 상세는 --verbose 또는 harness:impact.
  if (summaryMode && !showBaseline) {
    const breakdownParts = [
      ['feature', groups.feature.length],
      ['local harness', groups.localHarness.length],
      ['scripts', groups.harnessScripts.length],
      ['config', groups.config.length],
      ['other', groups.other.length],
    ].filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}`)
    const breakdown = breakdownParts.length > 0 ? ` (${breakdownParts.join(', ')})` : ''
    console.log(`Changed files: user ${userChangeCount}${breakdown}, baseline/generated ${baselineCount} — 상세: npm run harness:impact 또는 --verbose`)
    console.log('')
    return groups
  }

  console.log('Changed files summary:')
  console.log(`  user project changes: ${userChangeCount}`)
  console.log(`  harness baseline/generated changes: ${baselineCount}`)
  console.log('')

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
  const harnessMode = harnessModeState.value

  console.log('Policy impact analysis')
  if (harnessModeState.valid) {
    console.log(`Harness mode: ${harnessMode}${strictMode ? ' (strict)' : ''}`)
  } else {
    // fail-closed: 설정 오류는 조용히 완화하지도, strict로 추측하지도 않고 검사를 실패시킨다.
    // specEnforcement 오값이 push를 막는 것과 같은 기준이다 — 더 넓은 harnessMode만 통과시킬 이유가 없다.
    console.log(`Harness mode: 판정 불가 (설정 오류)`)
    console.log('')
    if (harnessModeState.kind === 'malformed') {
      console.error(`설정 오류: .harness/policy/profile.json을 JSON으로 읽지 못했습니다 (${harnessModeState.reason}).`)
      console.error('- 파일을 고쳐 커밋한 뒤 다시 검사하세요. 이 상태에서는 어떤 집행 등급도 신뢰할 수 없습니다.')
    } else {
      console.error(`설정 오류: harnessMode 값이 유효하지 않습니다: ${JSON.stringify(harnessModeState.raw)}`)
      console.error(`- 허용 값: ${HARNESS_MODES.join(', ')} (필드가 없으면 bootstrap)`)
      console.error('- strict를 의도했다면 차단이 켜지지 않은 상태입니다. 값을 고쳐 커밋한 뒤 다시 검사하세요.')
    }
    process.exit(1)
  }
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
    harnessModeInvalid: harnessModeState.valid ? null : String(harnessModeState.raw),
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

  printSpecLinkNotice(analyzeSpecLink(changedFiles))
  printHookInstallNotice()

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
