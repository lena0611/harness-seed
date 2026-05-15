import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const forwardedArgs = process.argv.slice(2)
const briefMode = forwardedArgs.includes('--brief')
const harnessRoot = fs.existsSync(path.join(repoRoot, '.harness'))
  ? path.join(repoRoot, '.harness')
  : path.join(repoRoot, '.github')
const markerPath = path.join(harnessRoot, '.stack-applied.json')
const lockPath = path.join(harnessRoot, 'harness-lock.json')
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
    return
  }

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
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

  if (requiredBase.ref && installedBase.ref && requiredBase.ref !== installedBase.ref) {
    const message = `공통 하네스 ref가 스택 요구사항과 다릅니다. required ${requiredBase.ref}, installed ${installedBase.ref}.`
    if (strictMode) {
      throw new Error(message)
    }
    console.warn(`WARNING: ${message}`)
  }

  console.log(`Harness versions OK: base=${installedBase.version}${installedBase.ref ? ` (${installedBase.ref})` : ''}, stack=${lock.stackHarness?.version ?? profile.activeStack}`)
}

run('node', ['.harness/bin/policy-harness.mjs', 'guard', ...forwardedArgs])
run('node', ['.harness/bin/doc-link-check.mjs', ...forwardedArgs])
checkHarnessVersionLock()

if (fs.existsSync(path.join(repoRoot, '.harness-seed-mode')) && fs.existsSync(path.join(repoRoot, 'scripts/test-init.mjs'))) {
  run('node', ['scripts/test-init.mjs'])
}

if (!stackApplied) {
  console.log('')
  console.log(`Stack not applied (${path.relative(repoRoot, markerPath)} 없음). lint/test/build 단계는 건너뜁니다.`)
  console.log('스택 기준을 적용하려면: npm run stack:apply')
  process.exit(0)
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const scripts = pkg.scripts || {}

if (scripts.lint) {
  runNpmScript('lint')
}

if (scripts.test) {
  runNpmScript('test')
}

if (scripts.build) {
  runNpmScript('build')
}
