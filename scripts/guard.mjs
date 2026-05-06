import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const forwardedArgs = process.argv.slice(2)
const harnessRoot = fs.existsSync(path.join(repoRoot, '.harness'))
  ? path.join(repoRoot, '.harness')
  : path.join(repoRoot, '.github')
const markerPath = path.join(harnessRoot, '.stack-applied.json')
const lockPath = path.join(harnessRoot, 'harness-lock.json')
const profilePath = path.join(harnessRoot, harnessRoot.endsWith('.harness') ? 'policy/profile.json' : 'policy-harness/profile.json')
const stackApplied = fs.existsSync(markerPath)
const strictMode = forwardedArgs.includes('--strict')

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
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

run('node', ['scripts/policy-harness.mjs', 'guard', ...forwardedArgs])
run('node', ['scripts/doc-link-check.mjs', ...forwardedArgs])
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
  run('npm', ['run', 'lint'])
}

if (scripts.test) {
  run('npm', ['run', 'test'])
}

if (scripts.build) {
  run('npm', ['run', 'build'])
}
