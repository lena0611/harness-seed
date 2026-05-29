import { execFileSync, spawnSync } from 'node:child_process'
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
const stackApplied = fs.existsSync(markerPath)
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
  hash.update(`mode:${strictMode ? 'strict' : 'default'}:${fastMode ? 'fast' : 'full'}\n`)
  hash.update(`head:${runGit(['rev-parse', 'HEAD']) || 'no-head'}\n`)

  for (const filePath of getChangedFiles().sort()) {
    hash.update(`${filePath}:${hashFileIfExists(filePath)}\n`)
  }

  for (const filePath of ['package.json', 'package-lock.json', '.harness/harness-lock.json', '.harness/.stack-applied.json']) {
    hash.update(`${filePath}:${hashFileIfExists(filePath)}\n`)
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

function runNpmScript(scriptName) {
  const result = spawnSync('npm', ['run', scriptName], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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

function printConsumerSummary({ validationResults, edgeResult, criticalResult, cacheHit = false, stackSkipped = false }) {
  const impact = readImpactSummary()
  const levels = impact.syncGapLevels ?? {}
  const requiredCount = (levels.blocking ?? 0) + (levels['action required'] ?? 0)
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
  console.log(`결과: ${requiredCount === 0 ? '통과' : '조치 필요'}`)
  console.log(`필수 조치: ${requiredCount === 0 ? '없음' : `${requiredCount}건`}`)
  console.log(`주의: ${suggestedCount === 0 ? '없음' : `SYNC GAP review suggested ${suggestedCount}건`}`)
  console.log(`수동 조치: ${openManualActions === 0 ? '없음' : `${openManualActions}건 (.harness/session/manual-actions.md 확인)`}`)
  console.log(`추천 조치: ${recommendedActions.length === 0 ? '없음' : recommendedActions.join(', ')}`)
  console.log(`검증: ${cacheHit ? '캐시 재사용' : passedValidations.length > 0 ? `${passedValidations.join(', ')} 통과` : stackSkipped ? '스택 미적용으로 lint/test/build 스킵' : '실행된 프로젝트 검증 없음'}`)
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

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const scripts = pkg.scripts || {}
const validationResults = []

run('node', ['.harness/bin/policy-harness.mjs', 'guard', ...forwardedArgs])
const edgeResult = runSupabaseEdgeFunctionChecks(scripts)
const criticalResult = printCriticalPathReview()
run('node', ['.harness/bin/doc-link-check.mjs', ...forwardedArgs])
checkHarnessVersionLock()

if (fs.existsSync(path.join(repoRoot, '.harness-seed-mode')) && fs.existsSync(path.join(repoRoot, 'scripts/test-init.mjs'))) {
  run('node', ['scripts/test-init.mjs'])
}

if (!stackApplied) {
  console.log('')
  console.log(`Stack not applied (${path.relative(repoRoot, markerPath)} 없음). lint/test/build 단계는 건너뜁니다.`)
  console.log('스택 기준을 적용하려면: npm run stack:apply')
  printConsumerSummary({ validationResults, edgeResult, criticalResult, stackSkipped: true })
  process.exit(0)
}

const scriptPlan = [
  scripts.lint ? 'lint' : null,
  !fastMode && scripts.test ? 'test' : null,
  !fastMode && scripts.build ? 'build' : null,
].filter(Boolean)
const cacheKey = validationCacheKey(scriptPlan)
const cache = readCheckCache()

if (!noCache && cache?.key === cacheKey && scriptPlan.length > 0) {
  console.log('')
  console.log(`Validation cache hit: ${fastMode ? 'fast' : 'full'} check already passed for this git tree.`)
  console.log(`passedAt: ${cache.passedAt}`)
  printConsumerSummary({ validationResults, edgeResult, criticalResult, cacheHit: true })
  process.exit(0)
}

if (scripts.lint) {
  validationResults.push(runNpmScript('lint'))
}

if (fastMode && (scripts.test || scripts.build)) {
  console.log('')
  console.log('Fast check mode: test/build 단계는 건너뜁니다. 전체 검증은 npm run harness:check 로 실행하세요.')
}

if (!fastMode && scripts.test) {
  validationResults.push(runNpmScript('test'))
}

if (!fastMode && scripts.build) {
  validationResults.push(runNpmScript('build'))
}

if (scriptPlan.length > 0) {
  writeCheckCache(cacheKey, scriptPlan)
}

printConsumerSummary({ validationResults, edgeResult, criticalResult })
