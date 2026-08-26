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
const templateGapSummaryPath = path.join(harnessRoot, 'generated/template-gap-summary.json')
const profilePath = path.join(harnessRoot, harnessRoot.endsWith('.harness') ? 'policy/profile.json' : 'policy-harness/profile.json')
// harnessMode는 유효 값일 때만 해석한다(0.2.102). 오타는 policy-harness가 필수 조치로 표면화하며,
// 여기서도 'strict'와 정확히 일치할 때만 차단 모드로 올린다(완화 쪽 오해석을 만들지 않기 위함).
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
      .map((line) => decodeGitPath(line.slice(3).trim()))
      .filter(Boolean)
      .map((filePath) => filePath.includes(' -> ') ? decodeGitPath(filePath.split(' -> ').at(-1).trim()) : filePath))
  }

  const untracked = runGit(['ls-files', '--others', '--exclude-standard'])
  if (untracked) {
    changed.push(...untracked.split(/\r?\n/).filter(Boolean))
  }

  return [...new Set(changed)]
}

function decodeGitPath(filePath) {
  if (!filePath) return filePath
  if (!(filePath.startsWith('"') && filePath.endsWith('"'))) return filePath

  try {
    return JSON.parse(filePath)
  } catch {
    return filePath.slice(1, -1)
      .replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

function hashFileIfExists(filePath) {
  const absPath = path.join(repoRoot, filePath)
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return 'missing'
  }

  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')
}

function validationCacheKey() {
  const hash = crypto.createHash('sha256')
  // strict/default는 명시적 syncEnforcement와 다른 엄격 검사의 강도가 달라 키로 분리한다.
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

  // 캐시 스키마 버전: 키 구성 축이 바뀌면 올린다. 2 = verify(lint/test/build) 계획 축 제거(0.2.131).
  hash.update('cache-schema:2\n')
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

function writeCheckCache(key) {
  if (noCache) {
    return
  }

  fs.mkdirSync(path.dirname(checkCachePath), { recursive: true })
  fs.writeFileSync(checkCachePath, JSON.stringify({
    key,
    mode: fastMode ? 'fast' : 'full',
    passedAt: new Date().toISOString(),
  }, null, 2))
}

// verify 제거(0.2.131) 흔적:
// - 프로젝트 lint/test/build와 스택 raw verify를 하네스가 실행하던 러너(runNpmScript,
//   runStackVerifyCommand)와, 그 실패를 해설하던 ESLint 힌트 출력이 여기 있었다.
// - dual-runtime(0.2.63)은 그 프로젝트 검증을 프로젝트 Node로 돌리기 위한 것이었고,
//   verify 제거(0.2.131)로 소비처가 사라져 함께 걷어냈다(resolveProjectRuntime,
//   fromHookMatchesNvmrc, projectSpawnEnv, HARNESS_PROJECT_NODE_BIN 소비).
//   훅의 nvm 전환(.githooks의 dual-node.sh)은 하네스 자신이 저버전 Node에서 죽지 않게 하는
//   별개 장치라 그대로 둔다.

function commandExists(command) {
  const result = spawnSync('sh', ['-c', `command -v ${command}`], {
    stdio: 'ignore',
  })
  return result.status === 0
}

// Supabase Edge Function 게이트 전용 실행기. 프로젝트가 선언한 edge 검증 script만 실행하며,
// 제거된 verify(lint/test/build) 개념과는 무관하다.
function runProjectVerifier(scriptName) {
  console.log(`Supabase Edge Function verifier: npm run ${scriptName}`)
  const result = spawnSync('npm', ['run', scriptName], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) {
    console.error(`Supabase Edge Function 검증 실행 실패: npm run ${scriptName}`)
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    console.error('')
    console.error(`Supabase Edge Function 검증 실패: npm run ${scriptName}`)
    console.error('하네스 설치 파일과 별개로, 프로젝트가 선언한 edge 검증 명령이 실패했습니다.')
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
    syncReviewCandidates: 0,
    syncReviewLevels: {},
    policyTriggered: 0,
    codeTriggered: 0,
    decisionLog: {},
  })
}

function printConsumerSummary({ edgeResult, criticalResult, cacheHit = false, failedReason = null }) {
  const impact = readImpactSummary()
  const levels = impact.syncReviewLevels && Object.keys(impact.syncReviewLevels).length > 0
    ? impact.syncReviewLevels
    : impact.syncGapLevels ?? {}
  const decisionLog = impact.decisionLog ?? {}
  const requiredCount = (levels.blocking ?? 0) + (levels['action required'] ?? 0)
    + (decisionLog.overrideMissingRebuttal ? 1 : 0) + (failedReason ? 1 : 0)
  const suggestedCount = levels['review suggested'] ?? 0
  const openManualActions = countOpenManualActions()
  const templateGap = readJson(templateGapSummaryPath, { selected: false, gaps: 0, invalid: 0 })
  const recommendedActions = []

  if (decisionLog.reversalDetected) {
    recommendedActions.push('정책 번복 커밋 — 연결 계약 문서에 반대 서술이 없는지 확인')
  }
  if (decisionLog.oversized) {
    recommendedActions.push(`decision-log ${decisionLog.lines}줄 — 폐기/오래된 항목을 아카이브로 분리`)
  }
  if (suggestedCount > 0) {
    recommendedActions.push(`기준 동기화 후보 ${suggestedCount}건 중 구조·계약 변경만 확인`)
  }
  if (criticalResult.recommendations.length > 0) {
    recommendedActions.push(`중요 경로 추천 검증 ${criticalResult.recommendations.length}건 확인`)
  }
  if (edgeResult.status === 'warning') {
    recommendedActions.push('Supabase Edge Function 검증 명령 추가')
  }
  if (templateGap.selected && templateGap.gaps > 0) {
    recommendedActions.push(`템플릿 계약 갭 ${templateGap.gaps}건 확인 (${templateGap.report})`)
  }

  console.log('')
  console.log('Harness check summary')
  console.log(`결과: ${failedReason ? '실패' : requiredCount === 0 ? '통과' : '조치 필요'}`)
  console.log(`필수 조치: ${requiredCount === 0 ? '없음' : `${requiredCount}건`}`)
  const warnings = []
  if (templateGap.selected && templateGap.gaps > 0) warnings.push(`템플릿 계약 갭 ${templateGap.gaps}건`)
  if (managedDrift.drifted.length > 0) warnings.push(`하네스 파일 ${managedDrift.drifted.length}건이 업데이트에서 제외됨`)
  console.log(`주의: ${warnings.length === 0 ? '없음' : warnings.join(', ')}`)
  console.log(`수동 조치: ${openManualActions === 0 ? '없음' : `${openManualActions}건 (.harness/session/manual-actions.md 확인)`}`)
  console.log(`추천 조치: ${recommendedActions.length === 0 ? '없음' : recommendedActions.join(', ')}`)
  console.log(`관문 검사: ${cacheHit ? '캐시 재사용' : '실행'}`)
  if (failedReason) {
    console.log(`실패 사유: ${failedReason}`)
  }
  // 차단 옵트인 표면화(0.2.94, score-print 검수 후속): 필수 조치가 경고에 머무는 기본 모드에서
  // 차단으로 승격하는 방법을 그 순간에만 안내한다(조치 없는 커밋에는 출력하지 않음).
  if (!strictMode && !failedReason && requiredCount > 0) {
    console.log('참고: 필수 조치는 strict 모드(.harness/policy/profile.json의 harnessMode: strict)에서 커밋 차단으로 승격됩니다.')
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

// 설치 무결성(0.2.109): managed 파일이 manifest에 기록된 sha와 다르면, 업데이터 안전망이 그 파일을
// "소비자가 수정했다"고 보고 **이후 모든 업데이트에서 조용히 건너뛴다**. 그 상태는 스스로 알리지 않는다.
//
// 실증(2026-08-11, multisite): 프로젝트 lint가 `.harness/`를 제외하지 않아 `eslint . --fix`가
// `.harness/bin/*.mjs`의 import 순서를 고쳤고, 10개 파일이 여러 버전 동안 동결됐다. 포맷 문제로 끝나지
// 않고 post-merge hook 지원이 통째로 빠진 채로 살아 있었다. 원인은 lint였지만 formatter·IDE 저장 시
// 자동정리·수기 편집도 같은 결과를 낸다. 그래서 원인이 아니라 **결과(sha 불일치)**를 검사한다.
function checkManagedFileDrift() {
  const manifest = readJson(path.join(harnessRoot, 'install-manifest.json'))
  const managedFiles = manifest?.managedFiles
  if (!managedFiles || typeof managedFiles !== 'object') {
    return { drifted: [], checked: 0 }
  }

  const drifted = []
  let checked = 0
  for (const [rel, record] of Object.entries(managedFiles)) {
    const recorded = record?.sha256
    if (typeof recorded !== 'string' || recorded.length === 0) continue
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue
    checked++
    // 마커 관리 파일(CLAUDE.md/AGENTS.md 등)은 소비자 영역이 있어 본체와 달라도 정상이다.
    // 업데이터도 이들은 보존이 아니라 머지로 처리하므로 동결 대상이 아니다.
    if (isMarkerManagedPath(rel)) continue
    if (sha256File(abs) !== recorded) {
      drifted.push(rel)
    }
  }

  return { drifted, checked }
}

function isMarkerManagedPath(rel) {
  const posix = rel.split(path.sep).join('/')
  return posix === 'CLAUDE.md' || posix === 'AGENTS.md' || posix === '.github/copilot-instructions.md'
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')
}

function printManagedDriftNotice(drift) {
  if (drift.drifted.length === 0) return
  console.log('')
  console.log(`⚠ 하네스 파일 ${drift.drifted.length}건이 설치 기록과 다릅니다 — 이 파일들은 업데이트에서 제외됩니다.`)
  for (const rel of drift.drifted.slice(0, 10)) {
    console.log(`  - ${rel}`)
  }
  if (drift.drifted.length > 10) {
    console.log(`  ... 외 ${drift.drifted.length - 10}건`)
  }
  console.log('  이 파일들은 프로젝트가 소유한 파일이 아니라 하네스 본체 코드입니다. 달라진 이유가 무엇이든')
  console.log('  업데이터는 "소비자가 수정했다"고 보고 건너뛰므로, 두면 계속 옛 버전에 머뭅니다.')
  console.log('  가장 흔한 원인은 lint/formatter가 .harness/를 대상에 포함하는 것입니다.')
  // 이 파일만은 "소비자가 편집할 이유가 정당하게 있는" managed 파일이라 오진이 잦다(score-print 보고).
  if (drift.drifted.some((rel) => rel.split(path.sep).join('/').endsWith('documentation/document-registry.json'))) {
    console.log('  document-registry.json은 프로젝트 문서를 등록하려다 달라졌을 수 있습니다 — 그 등록은')
    console.log('  document-registry.local.json(프로젝트 소유)으로 옮기면 업데이트에서 제외되지 않습니다.')
  }
  console.log('  1) lint·formatter 설정에서 .harness/**를 제외하세요(eslint globalIgnores, .oxlintrc.json ignorePatterns, .prettierignore).')
  console.log('  2) 그다음 원본으로 되돌리세요: .harness/bin/harness update --resync-managed')
  console.log('     (managed 파일만 되돌립니다. 프로젝트 소유 파일은 건드리지 않습니다.)')
}

// P1(2026-06-09): 비-Node 프로젝트(package.json 없음)에서도 `node .harness/bin/guard.mjs`가
// 동작해야 한다. 없으면 빈 객체로 보고 edge 검증 스크립트가 없는 것으로 처리한다.
// package.json이 있는 기존 소비자는 거동이 동일하다.
const pkgPath = path.join(repoRoot, 'package.json')
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {}
const scripts = pkg.scripts || {}

// 0.2.70: 전체 관문 검사(정책/문서/test-init)를 git tree 지문 캐시 게이트 뒤로 둔다.
// policy-harness guard, doc-link-check, test-init은 모두 git tree의 결정론적 함수이므로
// "같은 tree면 직전 통과 결과를 신뢰"해도 검사 신뢰성이 떨어지지 않는다. (외부 비결정 요소 없음.)
// 효과: commit 직후 첫 push는 새 HEAD라 미스→전체 검사; 둘째 원격 push와 태그 push는 같은 tree라 히트→스킵.
// 강제 재검사는 --no-cache. cache key는 mode + HEAD + 변경/핵심 파일 해시 + 스택 상태 + 캐시 스키마 버전(validationCacheKey).
const stackState = resolveStackState()

const cacheKey = validationCacheKey()
const cache = readCheckCache()
// 캐시 히트 경로에서도 알려야 한다. drift는 "이 tree가 검증을 통과했는가"와 무관하게 남아 있는 설치 상태이고,
// 캐시가 걸린 push 경로에서만 조용해지면 정확히 놓치기 쉬운 순간에 침묵한다.
const managedDrift = checkManagedFileDrift()

// 캐시 재사용 조건: 같은 tree 키 + (같은 mode이거나, fast 요청인데 캐시가 full이면 full ⊇ fast로 재사용).
// verify 제거(0.2.131) 후 fast와 full이 실행하는 관문 검사는 같지만, full ⊇ fast 방향만 재사용하는
// 보수적 규칙은 그대로 둔다(재사용 폭이 좁아질 뿐 신뢰성은 유지).
const requestMode = fastMode ? 'fast' : 'full'
const cacheUsable = !noCache && cache?.key === cacheKey
  && (cache.mode === requestMode || (fastMode && cache.mode === 'full'))

if (cacheUsable) {
  console.log(`Validation cache hit: 이 git tree는 이미 ${cache.mode === 'fast' ? 'fast' : 'full'} 검사(정책/문서/테스트)를 통과했습니다.`)
  console.log(`passedAt: ${cache.passedAt}`)
  console.log('강제 재검증: --no-cache')
  printManagedDriftNotice(managedDrift)
  printConsumerSummary({
    edgeResult: { status: 'ok' },
    criticalResult: { recommendations: [] },
    cacheHit: true,
  })
  process.exit(0)
}

run('node', ['.harness/bin/policy-harness.mjs', 'guard', ...forwardedArgs])
const edgeResult = runSupabaseEdgeFunctionChecks(scripts)
const criticalResult = printCriticalPathReview()
run('node', ['.harness/bin/doc-link-check.mjs', ...forwardedArgs])
run('node', ['.harness/bin/check-template-contract.mjs', ...(strictMode ? ['--strict'] : [])])
checkHarnessVersionLock()
printManagedDriftNotice(managedDrift)

if (fs.existsSync(path.join(repoRoot, '.harness-seed-mode')) && fs.existsSync(path.join(repoRoot, 'scripts/test-init.mjs'))) {
  run('node', ['scripts/test-init.mjs'])
}

if (!stackState.applied) {
  console.log('')
  if (stackState.reason === 'missing-stack-snapshot') {
    console.error(`Stack state is incomplete: activeStack=${stackState.activeStack} 이지만 추적 가능한 스택 스냅샷을 찾지 못했습니다.`)
    console.error(`expected: ${stackState.expectedManifest}`)
    console.error('fresh worktree/clone/CI에서도 검증되도록 스택 하네스 init 또는 .harness/bin/harness stack:apply를 다시 실행하고 .harness/stacks/.applied/<stack>/ 을 커밋하세요.')
    printConsumerSummary({
      edgeResult,
      criticalResult,
      failedReason: 'activeStack은 설정됐지만 추적 가능한 스택 스냅샷이 없어 스택 기준 적용 상태를 신뢰할 수 없습니다.',
    })
    process.exit(1)
  }

  console.log('Stack not applied: activeStack=none. 스택 기준은 적용되지 않았습니다.')
  console.log('스택 기준을 적용하려면: .harness/bin/harness standards:list 후 해당 스택 하네스 init을 실행하세요.')
  // 전체 관문 검사 통과(정책/문서/test-init)를 캐시에 기록해 같은 tree 재검사를 스킵한다.
  writeCheckCache(cacheKey)
  printConsumerSummary({ edgeResult, criticalResult })
  process.exit(0)
}

if (stackState.markerMissing) {
  console.log('')
  console.log(`Stack applied state derived from tracked snapshot: ${stackState.manifestRelPath}`)
  console.log(`${path.relative(repoRoot, markerPath)} 마커는 없지만 추적된 스택 스냅샷이 있어 적용 상태로 봅니다.`)
}

// 전체 관문 검사 통과를 캐시에 기록(스택 적용/미적용 무관). 같은 tree 재검사(둘째 원격·태그 push)를 스킵.
writeCheckCache(cacheKey)

printConsumerSummary({ edgeResult, criticalResult })
