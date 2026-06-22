import { execFileSync, spawnSync } from 'node:child_process'
import { isSupportedNode, parseNodeSpec, readNvmrc, resolveInstalledForSpec } from './node-env.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const forwardedArgs = process.argv.slice(2)
const briefMode = forwardedArgs.includes('--brief')
const fastMode = forwardedArgs.includes('--fast')
const noCache = forwardedArgs.includes('--no-cache')
const harnessRoot = fs.existsSync(path.join(repoRoot, '.harness'))
  ? path.join(repoRoot, '.harness')
  : path.join(repoRoot, '.github')
const markerPath = path.join(harnessRoot, '.stack-applied.json')
const lockPath = path.join(harnessRoot, 'harness-lock.json')
const checkCachePath = path.join(harnessRoot, 'generated/check-cache.json')
const impactSummaryPath = path.join(harnessRoot, 'generated/policy-impact-summary.json')
const profilePath = path.join(harnessRoot, harnessRoot.endsWith('.harness') ? 'policy/profile.json' : 'policy-harness/profile.json')
const strictMode = forwardedArgs.includes('--strict') || (() => {
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'))?.harnessMode === 'strict'
  } catch {
    return false
  }
})()

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

function runGit(argsToRun) {
  try {
    return execFileSync('git', argsToRun, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function getChangedFiles() {
  const changed = []
  const output = runGit(['status', '--porcelain=v1'])
  if (output) {
    changed.push(...output
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .map((filePath) => filePath.includes(' -> ') ? filePath.split(' -> ').at(-1) : filePath))
  }

  const untracked = runGit(['ls-files', '--others', '--exclude-standard'])
  if (untracked) {
    changed.push(...untracked.split(/\r?\n/).filter(Boolean))
  }

  return [...new Set(changed)]
}

function hashFileIfExists(filePath) {
  const absPath = path.join(repoRoot, filePath)
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return 'missing'
  }

  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')
}

function validationCacheKey(scriptNames) {
  const hash = crypto.createHash('sha256')
  // strict/default는 검사 강도가 달라(strict는 SYNC GAP을 실패 처리) 키로 분리한다.
  // fast/full은 키에 넣지 않고 캐시 레코드의 mode로 구분한다 — full 통과는 fast를 포함(full ⊇ fast)하므로
  // commit(full) 직후 push(fast)가 같은 tree면 full 캐시를 재사용할 수 있다(아래 히트 판정 참고).
  hash.update(`mode:${strictMode ? 'strict' : 'default'}\n`)
  hash.update(`head:${runGit(['rev-parse', 'HEAD']) || 'no-head'}\n`)

  for (const filePath of getChangedFiles().sort()) {
    hash.update(`${filePath}:${hashFileIfExists(filePath)}\n`)
  }

  for (const filePath of ['package.json', 'package-lock.json', '.harness/harness-lock.json', '.harness/policy/profile.json']) {
    hash.update(`${filePath}:${hashFileIfExists(filePath)}\n`)
  }

  const stackState = resolveStackState()
  if (stackState.manifestRelPath) {
    hash.update(`${stackState.manifestRelPath}:${hashFileIfExists(stackState.manifestRelPath)}\n`)
  }
  if (stackState.marker?.manifestPath) {
    hash.update(`${stackState.marker.manifestPath}:${hashFileIfExists(stackState.marker.manifestPath)}\n`)
  }

  hash.update(`scripts:${scriptNames.join(',')}\n`)
  return hash.digest('hex')
}

function readCheckCache() {
  if (!fs.existsSync(checkCachePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(checkCachePath, 'utf8'))
  } catch {
    return null
  }
}

function writeCheckCache(key, scriptNames) {
  if (noCache) {
    return
  }

  fs.mkdirSync(path.dirname(checkCachePath), { recursive: true })
  fs.writeFileSync(checkCachePath, JSON.stringify({
    key,
    mode: fastMode ? 'fast' : 'full',
    scripts: scriptNames,
    passedAt: new Date().toISOString(),
  }, null, 2))
}

function findExisting(paths) {
  return paths.find((rel) => fs.existsSync(path.join(repoRoot, rel))) ?? null
}

function hasNodeHarnessScripts() {
  const binDir = path.join(repoRoot, '.harness/bin')
  if (!fs.existsSync(binDir)) {
    return false
  }

  return fs.readdirSync(binDir).some((name) => name.endsWith('.mjs'))
}

function readTextIfExists(rel) {
  const abs = path.join(repoRoot, rel)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
}

function eslintConfigLikelyMissesNodeScriptsOverride() {
  const configPath = findExisting(['eslint.config.js', 'eslint.config.mjs', '.eslintrc', '.eslintrc.js'])
  if (!configPath || !hasNodeHarnessScripts()) {
    return false
  }

  const content = readTextIfExists(configPath)
  const mentionsScripts = /\.harness\/bin\/\*\*|\.harness\/bin\//.test(content)
  const mentionsNodeGlobals = /globals\.node|nodeBuiltin|env\s*:\s*{[^}]*node\s*:\s*true|sourceType\s*:\s*['"]script['"]/.test(content)
  return !mentionsScripts || !mentionsNodeGlobals
}

function eslintConfigLikelyMissesHarnessBackupIgnore() {
  const configPath = findExisting(['eslint.config.js', 'eslint.config.mjs'])
  if (!configPath || !fs.existsSync(path.join(repoRoot, '.harness-backup'))) {
    return false
  }

  return !readTextIfExists(configPath).includes('.harness-backup')
}

function printEslintHarnessHint(output = '') {
  const backupIssue = output.includes('.harness-backup') || eslintConfigLikelyMissesHarnessBackupIgnore()
  if (backupIssue) {
    console.error('')
    console.error('설치 후 검증 실패: ESLint 백업 폴더 검사 대상 포함')
    console.error('')
    console.error('원인 후보:')
    console.error('- 하네스 업데이트 과정에서 .harness-backup/<timestamp>/ 복구용 백업이 생성되었습니다.')
    console.error('- 현재 ESLint 설정이 .harness-backup/**을 ignore하지 않아 백업된 과거 하네스 스크립트까지 검사했습니다.')
    console.error('')
    console.error('권장 조치:')
    console.error("- eslint.config.js 또는 eslint.config.mjs의 globalIgnores에 '**/.harness-backup/**'을 추가하세요.")
    console.error('- 다음 하네스 init부터는 이 ignore가 자동 보정됩니다.')
    console.error('')
    console.error('하네스 설치 자체가 실패한 것은 아니며, 백업 폴더가 검증 대상에 들어간 상태입니다.')
    return
  }

  const likelyNodeGlobalIssue = /'process' is not defined|process is not defined|no-undef/.test(output) || eslintConfigLikelyMissesNodeScriptsOverride()
  if (!likelyNodeGlobalIssue) {
    return
  }

  console.error('')
  console.error('설치 후 검증 실패: ESLint 환경 충돌 후보')
  console.error('')
  console.error('원인 후보:')
  console.error('- 하네스가 추가한 .harness/bin/*.mjs는 Node 환경 파일입니다.')
  console.error('- 현재 ESLint 설정이 .harness/bin/*.mjs에 Node globals를 적용하지 않을 수 있습니다.')
  console.error('')
  console.error('권장 조치:')
  console.error('- eslint.config.js 또는 eslint.config.mjs에 .harness/bin/**/*.mjs용 Node globals override를 추가하세요.')
  console.error('- 예: files: [".harness/bin/**/*.mjs"], languageOptions.globals에 Node globals 적용')
  console.error('')
  console.error('하네스 설치 자체가 실패한 것은 아니며, 설치 후 프로젝트 lint 환경 조정이 필요한 상태일 수 있습니다.')
}

// dual-runtime(0.2.63): 프로젝트 검증(lint/test/build, stack verify)은 하네스 실행 Node가 아니라
// 프로젝트 Node(.nvmrc)로 실행한다. hook/런처(dual-node.sh)가 전환했으면 HARNESS_PROJECT_NODE_BIN을
// 물려받고, guard가 직접 실행된 경우에는 .nvmrc를 같은 규칙으로 해석한다.
// fromHook bin의 실제 node 버전이 .nvmrc spec을 만족하는지 확인한다.
// hook의 nvm use가 (미설치 .nvmrc 등으로) 조용히 실패하면 dual-node.sh가 displaced 기본 노드의
// bin을 넘길 수 있으므로, .nvmrc가 있으면 맹신하지 않고 교차검증한다.
function fromHookMatchesNvmrc(fromHook, nvmrcParsed) {
  if (!nvmrcParsed) return true // 비교할 핀이 없으면(또는 .nvmrc 없음) hook 값을 신뢰한다.
  let version
  try {
    version = execFileSync(path.join(fromHook, 'node'), ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return false
  }
  const parsed = parseNodeSpec(version)
  if (!parsed) return false
  return parsed.major === nvmrcParsed.major &&
    (nvmrcParsed.minor === null || parsed.minor === nvmrcParsed.minor) &&
    (nvmrcParsed.patch === null || parsed.patch === nvmrcParsed.patch)
}

let projectRuntimeCache
function resolveProjectRuntime() {
  if (projectRuntimeCache !== undefined) return projectRuntimeCache

  // .nvmrc가 프로젝트 Node 계약의 진실 출처다. fromHook은 .nvmrc와 일치할 때만 신뢰한다.
  const nvmrc = readNvmrc(repoRoot)

  const fromHook = process.env.HARNESS_PROJECT_NODE_BIN
  if (fromHook && fs.existsSync(path.join(fromHook, 'node')) && fromHookMatchesNvmrc(fromHook, nvmrc?.parsed)) {
    projectRuntimeCache = { binDir: fromHook, label: fromHook }
    console.log(`프로젝트 검증 Node: ${fromHook} (하네스 실행 Node: ${process.version})`)
    return projectRuntimeCache
  }

  if (!nvmrc) {
    projectRuntimeCache = null
    return projectRuntimeCache
  }

  if (!nvmrc.parsed) {
    // 별칭(lts/* 등)은 nvm.sh 없이 해석할 수 없다. 현재 Node로 실행하고 알림만 남긴다.
    console.warn(`WARNING: .nvmrc '${nvmrc.raw}'를 버전으로 해석하지 못해 프로젝트 검증을 현재 Node(${process.version})로 실행합니다.`)
    projectRuntimeCache = null
    return projectRuntimeCache
  }

  const installed = resolveInstalledForSpec(nvmrc.parsed)
  if (installed) {
    projectRuntimeCache = { binDir: installed.binDir, label: installed.name }
    if (installed.name !== process.version) {
      console.log(`프로젝트 검증 Node: ${installed.name} (.nvmrc ${nvmrc.raw}, 하네스 실행 Node: ${process.version})`)
    }
    return projectRuntimeCache
  }

  if (!isSupportedNode(nvmrc.parsed)) {
    // 저버전 프로젝트 검증을 하네스 Node로 돌리면 결과를 신뢰할 수 없으므로 실패시킨다.
    console.error('')
    console.error(`프로젝트 검증 실패: .nvmrc ${nvmrc.raw} Node가 nvm에 설치되어 있지 않습니다.`)
    console.error(`하네스 실행 Node(${process.version})로 프로젝트 lint/test/build를 대신 실행하면 결과를 신뢰할 수 없습니다.`)
    console.error(`해결: nvm install ${nvmrc.raw}`)
    process.exit(1)
  }

  // .nvmrc가 하네스 최소 버전 이상인데 설치본이 없으면 기존 거동대로 현재 Node로 실행한다.
  projectRuntimeCache = null
  return projectRuntimeCache
}

function projectSpawnEnv() {
  const runtime = resolveProjectRuntime()
  if (!runtime) return process.env
  return { ...process.env, PATH: `${runtime.binDir}${path.delimiter}${process.env.PATH ?? ''}` }
}

function runNpmScript(scriptName) {
  const result = spawnSync('npm', ['run', scriptName], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: projectSpawnEnv(),
  })

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    if (scriptName === 'lint') {
      printEslintHarnessHint(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    } else {
      console.error('')
      console.error(`설치 후 검증 실패: npm run ${scriptName}`)
      console.error('하네스 설치 파일과 별개로, 적용 프로젝트의 검증 명령이 실패했습니다.')
    }

    process.exit(result.status ?? 1)
  }

  if (briefMode) {
    console.log(`OK: npm run ${scriptName} 통과`)
    return { scriptName, status: 'passed' }
  }

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return { scriptName, status: 'passed' }
}

// P4(2026-06-09): 스택 manifest의 verify 섹션이 선언한 raw shell 명령을 실행한다.
// 비-Node 스택(PHP/Java 등)이 lint/test/build를 npm script 없이
// `./gradlew test`, `composer test` 같은 명령으로 선언할 수 있게 한다.
function runStackVerifyCommand(stage, command) {
  console.log(`Stack verify (${stage}): ${command}`)
  const result = spawnSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: projectSpawnEnv(),
  })

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    console.error('')
    console.error(`설치 후 검증 실패: stack verify ${stage} (${command})`)
    console.error('하네스 설치 파일과 별개로, 적용 스택이 선언한 검증 명령이 실패했습니다.')
    process.exit(result.status ?? 1)
  }

  if (briefMode) {
    console.log(`OK: stack verify ${stage} 통과`)
    return { scriptName: `verify:${stage}`, status: 'passed' }
  }

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return { scriptName: `verify:${stage}`, status: 'passed' }
}

function commandExists(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], {
    stdio: 'ignore',
  })
  return result.status === 0
}

function runProjectVerifier(scriptName) {
  console.log(`Supabase Edge Function verifier: npm run ${scriptName}`)
  return runNpmScript(scriptName)
}

function runSupabaseEdgeFunctionChecks(scripts) {
  const changed = getChangedFiles()
  const edgeFiles = changed.filter((filePath) => /^supabase\/functions\/.+\.(ts|tsx|js|mjs)$/.test(filePath))

  if (edgeFiles.length === 0) {
    return { changed: false, files: [], status: 'not-applicable', recommendation: null }
  }

  console.log('')
  console.log('Supabase Edge Function changes detected')
  for (const filePath of edgeFiles) {
    console.log(`  - ${filePath}`)
  }

  const verifier = [
    'supabase:functions:check',
    'edge:functions:check',
    'functions:check',
  ].find((scriptName) => scripts[scriptName])

  if (verifier) {
    const result = runProjectVerifier(verifier)
    return { changed: true, files: edgeFiles, status: 'passed', verifier, result }
  }

  const denoCheckTargets = edgeFiles.filter((filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx'))
  if (denoCheckTargets.length > 0 && commandExists('deno')) {
    console.log('Supabase Edge Function verifier: deno check')
    const result = spawnSync('deno', ['check', ...denoCheckTargets], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'inherit',
    })

    if (result.status !== 0) {
      process.exit(result.status ?? 1)
    }

    return { changed: true, files: edgeFiles, status: 'passed', verifier: 'deno check' }
  }

  const message = 'Supabase Edge Function 변경이 감지되었지만 deno 또는 프로젝트 지정 검증 명령을 찾지 못했습니다.'
  if (strictMode) {
    throw new Error(message)
  }

  console.warn(`WARNING: ${message}`)
  console.warn('권장: package.json에 supabase:functions:check, edge:functions:check, functions:check 중 하나를 추가하세요.')
  return {
    changed: true,
    files: edgeFiles,
    status: 'warning',
    recommendation: 'package.json에 supabase:functions:check, edge:functions:check, functions:check 중 하나를 추가하세요.',
  }
}

function readCriticalPaths() {
  const rel = '.harness/project/critical-paths.md'
  const abs = path.join(repoRoot, rel)
  if (!fs.existsSync(abs)) {
    return []
  }

  const content = fs.readFileSync(abs, 'utf8')
  const tableRows = content
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !line.includes('path |'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3)
    .map(([rawPath, why, verification]) => ({
      glob: rawPath.replaceAll('`', '').trim(),
      why,
      verification,
    }))
    .filter((entry) => entry.glob)

  if (tableRows.length > 0) {
    return tableRows
  }

  return [...content.matchAll(/`([^`\n]+)`/g)]
    .map((match) => ({ glob: match[1], why: '', verification: defaultCriticalPathRecommendation(match[1]) }))
    .filter((entry) => /[*?/]|\/$|^[\w.-]+\//.test(entry.glob))
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replaceAll('**', '::DOUBLE_STAR::')
    .replaceAll('*', '[^/]*')
    .replaceAll('::DOUBLE_STAR::', '.*')
  return new RegExp(`^${escaped}$`)
}

function printCriticalPathReview() {
  const paths = readCriticalPaths()
  if (paths.length === 0) {
    return { matches: [], recommendations: [] }
  }

  const changed = getChangedFiles()
  const matches = []
  for (const filePath of changed) {
    for (const entry of paths) {
      if (globToRegExp(entry.glob).test(filePath)) {
        matches.push({ filePath, ...entry })
      }
    }
  }

  if (matches.length === 0) {
    return { matches: [], recommendations: [] }
  }

  console.log('')
  console.log('Critical path review suggested')
  console.log('프로젝트가 중요 경로로 선언한 파일이 변경되었습니다.')
  for (const match of matches) {
    console.log(`  - ${match.filePath}`)
    if (match.verification) {
      console.log(`    recommended verification: ${match.verification}`)
    }
  }
  console.log('필요한 조치: 검증 결과와 수동 조치 여부를 decision-log, 업무 히스토리, manual-actions 중 알맞은 곳에 남기세요.')

  return {
    matches,
    recommendations: [...new Set(matches.map((match) => match.verification || defaultCriticalPathRecommendation(match.glob)).filter(Boolean))],
  }
}

function defaultCriticalPathRecommendation(glob) {
  if (glob.startsWith('supabase/functions/')) return 'Edge Function check, secret 노출 점검'
  if (glob.startsWith('src/shared/ui/')) return '라이트/다크, 모바일 viewport, 공통 컴포넌트 회귀 확인'
  if (glob.includes('domain') || glob.includes('algorithm')) return '도메인 회귀 테스트'
  if (glob.startsWith('ios/')) return 'Xcode 수동 빌드, capability/manual action 확인'
  if (glob.startsWith('android/')) return 'Android 로컬 빌드, 권한/manual action 확인'
  return '변경 이유와 검증 결과를 decision-log 또는 업무 히스토리에 기록'
}

function countOpenManualActions() {
  const abs = path.join(harnessRoot, 'session/manual-actions.md')
  if (!fs.existsSync(abs)) {
    return 0
  }

  const content = fs.readFileSync(abs, 'utf8')
  return content
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !line.includes('상태 | 항목'))
    .filter((line) => !/\|\s*TBD\s*\|\s*예:/i.test(line))
    .filter((line) => !/\|\s*(done|closed|resolved)\s*\|/i.test(line))
    .length
}

function readImpactSummary() {
  return readJson(impactSummaryPath, {
    syncGaps: 0,
    syncGapLevels: {},
    policyTriggered: 0,
    codeTriggered: 0,
  })
}

function printConsumerSummary({ validationResults, edgeResult, criticalResult, cacheHit = false, stackSkipped = false, failedReason = null }) {
  const impact = readImpactSummary()
  const levels = impact.syncGapLevels ?? {}
  const requiredCount = (levels.blocking ?? 0) + (levels['action required'] ?? 0) + (failedReason ? 1 : 0)
  const suggestedCount = levels['review suggested'] ?? 0
  const infoCount = levels.info ?? 0
  const openManualActions = countOpenManualActions()
  const passedValidations = validationResults.filter((item) => item.status === 'passed').map((item) => item.scriptName)
  const recommendedActions = []

  if (suggestedCount > 0) {
    recommendedActions.push(`SYNC GAP review suggested ${suggestedCount}건 검토`)
  }
  if (criticalResult.recommendations.length > 0) {
    recommendedActions.push(`중요 경로 추천 검증 ${criticalResult.recommendations.length}건 확인`)
  }
  if (edgeResult.status === 'warning') {
    recommendedActions.push('Supabase Edge Function 검증 명령 추가')
  }
  if (infoCount > 0) {
    recommendedActions.push(`정보성 기준 갭 ${infoCount}건 참고`)
  }

  console.log('')
  console.log('Harness check summary')
  console.log(`결과: ${failedReason ? '실패' : requiredCount === 0 ? '통과' : '조치 필요'}`)
  console.log(`필수 조치: ${requiredCount === 0 ? '없음' : `${requiredCount}건`}`)
  console.log(`주의: ${suggestedCount === 0 ? '없음' : `SYNC GAP review suggested ${suggestedCount}건`}`)
  console.log(`수동 조치: ${openManualActions === 0 ? '없음' : `${openManualActions}건 (.harness/session/manual-actions.md 확인)`}`)
  console.log(`추천 조치: ${recommendedActions.length === 0 ? '없음' : recommendedActions.join(', ')}`)
  console.log(`검증: ${cacheHit ? '캐시 재사용' : passedValidations.length > 0 ? `${passedValidations.join(', ')} 통과` : stackSkipped ? '스택 미적용으로 lint/test/build 스킵' : '실행된 프로젝트 검증 없음'}`)
  if (failedReason) {
    console.log(`실패 사유: ${failedReason}`)
  }
  if (criticalResult.recommendations.length > 0) {
    console.log('중요 경로 추천 검증:')
    for (const recommendation of criticalResult.recommendations) {
      console.log(`  - ${recommendation}`)
    }
  }
}

function readJson(absPath, fallback = null) {
  if (!fs.existsSync(absPath)) {
    return fallback
  }

  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function toRepoRelative(absPath) {
  return path.relative(repoRoot, absPath).replaceAll(path.sep, '/')
}

function resolveStackState() {
  const profile = readJson(profilePath, { activeStack: 'none' })
  const marker = readJson(markerPath)
  const lock = readJson(lockPath, { version: 1 })
  const activeStack = profile.activeStack && profile.activeStack !== 'none'
    ? profile.activeStack
    : marker?.stackId ?? 'none'

  if (!activeStack || activeStack === 'none') {
    return {
      applied: false,
      activeStack: 'none',
      marker,
      reason: 'no-active-stack',
    }
  }

  const manifestCandidates = [
    profile.stackManifest,
    lock.stackHarness?.manifestPath,
    marker?.manifestPath,
    `.harness/stacks/.applied/${activeStack}/manifest.json`,
  ].filter(Boolean)

  for (const candidate of manifestCandidates) {
    const absPath = path.resolve(repoRoot, candidate)
    if (fs.existsSync(absPath)) {
      return {
        applied: true,
        activeStack,
        marker,
        manifestPath: absPath,
        manifestRelPath: toRepoRelative(absPath),
        derivedFrom: fs.existsSync(markerPath) && marker?.manifestPath === candidate
          ? 'marker'
          : 'tracked snapshot',
        markerMissing: !fs.existsSync(markerPath),
      }
    }
  }

  return {
    applied: false,
    activeStack,
    marker,
    reason: 'missing-stack-snapshot',
    expectedManifest: manifestCandidates[0] ?? `.harness/stacks/.applied/${activeStack}/manifest.json`,
  }
}

function parseSemver(value) {
  const match = String(value ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareSemver(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) {
    return null
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] > right[key]) return 1
    if (left[key] < right[key]) return -1
  }

  return 0
}

function checkHarnessVersionLock() {
  const profile = readJson(profilePath, { activeStack: 'none' })
  if (!profile.activeStack || profile.activeStack === 'none') {
    return
  }

  const lock = readJson(lockPath)
  const marker = readJson(markerPath)
  const stackManifestPath = profile.stackManifest
    ? path.resolve(repoRoot, profile.stackManifest)
    : marker?.manifestPath
      ? path.resolve(repoRoot, marker.manifestPath)
      : null

  if (!lock) {
    const message = 'harness lock이 없습니다. 스택 하네스 init을 다시 실행해 버전 상태를 기록하세요.'
    if (strictMode) {
      throw new Error(message)
    }
    console.warn(`WARNING: ${message}`)
    return
  }

  const stackManifest = stackManifestPath ? readJson(stackManifestPath) : null
  const requiredBase = stackManifest?.baseHarness ?? lock.stackHarness?.requiredBaseHarness
  if (!requiredBase) {
    return
  }

  const installedBase = lock.baseHarness
  if (!installedBase?.version) {
    throw new Error('harness lock에 설치된 공통 하네스 버전이 없습니다. 스택 하네스 init을 다시 실행하세요.')
  }

  const minVersion = requiredBase.minVersion ?? requiredBase.ref
  const minCompare = compareSemver(installedBase.version, minVersion)
  if (minCompare !== null && minCompare < 0) {
    throw new Error(`공통 하네스 버전이 낮습니다. required >= ${minVersion}, installed ${installedBase.version}. 스택 하네스 init을 다시 실행하세요.`)
  }

  if (requiredBase.exactRefRequired && requiredBase.ref && installedBase.ref && requiredBase.ref !== installedBase.ref) {
    const message = `공통 하네스 ref가 스택 요구사항과 다릅니다. required ${requiredBase.ref}, installed ${installedBase.ref}.`
    if (strictMode) {
      throw new Error(message)
    }
    console.warn(`WARNING: ${message}`)
  }

  console.log(`Harness versions OK: base=${installedBase.version}${installedBase.ref ? ` (${installedBase.ref})` : ''}, stack=${lock.stackHarness?.version ?? profile.activeStack}`)
}

// P1(2026-06-09): 비-Node 프로젝트(package.json 없음)에서도 `node .harness/bin/guard.mjs`가
// 동작해야 한다. 없으면 빈 객체로 보고 lint/test/build/edge 스크립트가 없는 것으로 처리한다.
// package.json이 있는 기존 소비자는 거동이 동일하다.
const pkgPath = path.join(repoRoot, 'package.json')
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {}
const scripts = pkg.scripts || {}
const validationResults = []

// 0.2.70: 전체 검증(정책/문서/test-init/스택 verify)을 git tree 지문 캐시 게이트 뒤로 둔다.
// policy-harness guard, doc-link-check, test-init, stack verify는 모두 git tree의 결정론적 함수이므로
// "같은 tree면 직전 통과 결과를 신뢰"해도 검증 신뢰성이 떨어지지 않는다. (외부 비결정 요소 없음.)
// 효과: commit 직후 첫 push는 새 HEAD라 미스→전체 검증; 둘째 원격 push와 태그 push는 같은 tree라 히트→스킵.
// 강제 재검증은 --no-cache. cache key는 mode + HEAD + 변경/핵심 파일 해시 + 스택 상태(validationCacheKey).
const stackState = resolveStackState()

// 스택 verify 단계 계획(캐시 키 구성에 필요). 미적용 스택은 빈 계획.
const stackVerify = (stackState.applied && readJson(stackState.manifestPath)?.verify) || {}
const stagePlan = [
  { stage: 'lint', raw: stackVerify.lint, npm: scripts.lint, skipInFast: false },
  { stage: 'test', raw: stackVerify.test, npm: scripts.test, skipInFast: true },
  { stage: 'build', raw: stackVerify.build, npm: scripts.build, skipInFast: true },
].map((entry) => ({
  ...entry,
  declared: Boolean(entry.raw || entry.npm),
  planned: Boolean(entry.raw || entry.npm) && !(fastMode && entry.skipInFast),
}))
const scriptPlan = stagePlan.filter((entry) => entry.planned).map((entry) => (entry.raw ? `${entry.stage}:raw` : entry.stage))
const cacheKey = validationCacheKey(scriptPlan)
const cache = readCheckCache()

// 캐시 재사용 조건: 같은 tree 키 + (같은 mode이거나, fast 요청인데 캐시가 full이면 full ⊇ fast로 재사용).
// full 요청이 fast 캐시를 재사용하면 test/build를 빠뜨리므로 허용하지 않는다.
const requestMode = fastMode ? 'fast' : 'full'
const cacheUsable = !noCache && cache?.key === cacheKey
  && (cache.mode === requestMode || (fastMode && cache.mode === 'full'))

if (cacheUsable) {
  console.log(`Validation cache hit: 이 git tree는 이미 ${cache.mode === 'fast' ? 'fast' : 'full'} 검증(정책/문서/테스트${scriptPlan.length > 0 ? '/스택' : ''})을 통과했습니다.`)
  console.log(`passedAt: ${cache.passedAt}`)
  console.log('강제 재검증: --no-cache')
  printConsumerSummary({
    validationResults,
    edgeResult: { status: 'ok' },
    criticalResult: { recommendations: [] },
    cacheHit: true,
    stackSkipped: !stackState.applied,
  })
  process.exit(0)
}

run('node', ['.harness/bin/policy-harness.mjs', 'guard', ...forwardedArgs])
const edgeResult = runSupabaseEdgeFunctionChecks(scripts)
const criticalResult = printCriticalPathReview()
run('node', ['.harness/bin/doc-link-check.mjs', ...forwardedArgs])
checkHarnessVersionLock()

if (fs.existsSync(path.join(repoRoot, '.harness-seed-mode')) && fs.existsSync(path.join(repoRoot, 'scripts/test-init.mjs'))) {
  run('node', ['scripts/test-init.mjs'])
}

if (!stackState.applied) {
  console.log('')
  if (stackState.reason === 'missing-stack-snapshot') {
    console.error(`Stack state is incomplete: activeStack=${stackState.activeStack} 이지만 추적 가능한 스택 스냅샷을 찾지 못했습니다.`)
    console.error(`expected: ${stackState.expectedManifest}`)
    console.error('fresh worktree/clone/CI에서도 검증되도록 스택 하네스 init 또는 npm run stack:apply를 다시 실행하고 .harness/stacks/.applied/<stack>/ 을 커밋하세요.')
    printConsumerSummary({
      validationResults,
      edgeResult,
      criticalResult,
      stackSkipped: true,
      failedReason: 'activeStack은 설정됐지만 추적 가능한 스택 스냅샷이 없어 프로젝트 검증을 신뢰할 수 없습니다.',
    })
    process.exit(1)
  }

  console.log('Stack not applied: activeStack=none. lint/test/build 단계는 건너뜁니다.')
  console.log('스택 기준을 적용하려면: npm run standards:list 후 해당 스택 하네스 init을 실행하세요.')
  // 전체 검증 통과(정책/문서/test-init)를 캐시에 기록해 같은 tree 재검증을 스킵한다.
  writeCheckCache(cacheKey, scriptPlan)
  printConsumerSummary({ validationResults, edgeResult, criticalResult, stackSkipped: true })
  process.exit(0)
}

if (stackState.markerMissing) {
  console.log('')
  console.log(`Stack applied state derived from tracked snapshot: ${stackState.manifestRelPath}`)
  console.log(`${path.relative(repoRoot, markerPath)} 마커는 없지만 추적된 스택 스냅샷이 있어 lint/test/build를 계속 실행합니다.`)
}

if (fastMode && stagePlan.some((entry) => entry.declared && entry.skipInFast)) {
  console.log('')
  console.log('Fast check mode: test/build 단계는 건너뜁니다. 전체 검증은 harness check 또는 npm run harness:check 로 실행하세요.')
}

for (const entry of stagePlan) {
  if (!entry.planned) continue
  validationResults.push(entry.raw ? runStackVerifyCommand(entry.stage, entry.raw) : runNpmScript(entry.stage))
}

// 전체 검증 통과를 캐시에 기록(스택 적용/미적용 무관). 같은 tree 재검증(둘째 원격·태그 push)을 스킵.
writeCheckCache(cacheKey, scriptPlan)

printConsumerSummary({ validationResults, edgeResult, criticalResult })
