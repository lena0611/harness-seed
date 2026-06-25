#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..', '..')
const harnessRoot = fs.existsSync(path.join(repoRoot, '.harness'))
  ? path.join(repoRoot, '.harness')
  : path.join(repoRoot, '.github')
const lockPath = path.join(harnessRoot, 'harness-lock.json')
const installManifestPath = path.join(harnessRoot, 'install-manifest.json')

function printUsageAndExit(code = 0) {
  console.log(`Usage:
  npm run harness:outdated [-- options]

Options:
  --json                  JSON으로 출력합니다.
  --fail-on-outdated      업데이트 후보가 있으면 exit code 1로 종료합니다.
  --base-only             공통 하네스만 검사합니다.
  --stack-only            스택 하네스만 검사합니다.
  --range <semver-range>  검사할 SemVer range를 직접 지정합니다. 예: ^1.0.0
  -h, --help              도움말을 출력합니다.

기본 동작은 lock에 기록된 공통 하네스와 스택 하네스를 모두 검사합니다.
프로젝트 파일은 수정하지 않습니다. 실제 반영은 npm run harness:update로 수행합니다.
`)
  process.exit(code)
}

function parseArgs(argv) {
  const opts = {
    json: false,
    failOnOutdated: false,
    baseOnly: false,
    stackOnly: false,
    range: null,
  }

  const args = argv.slice(2)
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (arg) {
      case '-h':
      case '--help':
        printUsageAndExit(0)
        break
      case '--json':
        opts.json = true
        break
      case '--fail-on-outdated':
        opts.failOnOutdated = true
        break
      case '--base-only':
        opts.baseOnly = true
        break
      case '--stack-only':
        opts.stackOnly = true
        break
      case '--range':
        opts.range = requireValue(args, i, arg)
        i += 1
        break
      default:
        console.error(`알 수 없는 옵션: ${arg}`)
        printUsageAndExit(1)
    }
  }

  if (opts.baseOnly && opts.stackOnly) {
    console.error('--base-only와 --stack-only는 함께 사용할 수 없습니다.')
    process.exit(1)
  }

  return opts
}

function requireValue(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    console.error(`${flag}에는 값이 필요합니다.`)
    process.exit(1)
  }
  return value
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

function stripGitPrefix(repo) {
  return repo?.startsWith('git+') ? repo.slice(4) : repo
}

function ensureGitPackageSpec(repo) {
  if (repo.startsWith('git+') || repo.startsWith('github:')) {
    return repo
  }

  return `git+${repo}`
}

function parseSourceSpec(spec) {
  if (!spec || spec === 'bundled') {
    return {}
  }

  const [repo, ref] = String(spec).split('#')
  return {
    repo: repo || null,
    ref: ref || null,
  }
}

function parseSemver(value) {
  const match = String(value ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) {
    return null
  }

  return {
    raw: match[0],
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function compareSemver(a, b) {
  const left = typeof a === 'string' ? parseSemver(a) : a
  const right = typeof b === 'string' ? parseSemver(b) : b
  if (!left || !right) {
    return null
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] > right[key]) return 1
    if (left[key] < right[key]) return -1
  }

  return 0
}

function cleanVersion(value) {
  return parseSemver(value)?.version ?? null
}

function compatibleRange(harness) {
  const version = cleanVersion(harness?.version ?? harness?.source?.packageVersion ?? harness?.ref)
  return version ? `^${version}` : null
}

function caretUpperBound(base) {
  if (base.major > 0) {
    return { major: base.major + 1, minor: 0, patch: 0 }
  }

  if (base.minor > 0) {
    return { major: 0, minor: base.minor + 1, patch: 0 }
  }

  return { major: 0, minor: 0, patch: base.patch + 1 }
}

function satisfiesCaret(version, range) {
  const base = parseSemver(range.slice(1))
  if (!base) {
    return false
  }

  const upper = caretUpperBound(base)
  return compareSemver(version, base) >= 0 && compareSemver(version, upper) < 0
}

function satisfiesRange(version, range) {
  if (!range || range === '*') {
    return true
  }

  if (range.startsWith('^')) {
    return satisfiesCaret(version, range)
  }

  const exact = parseSemver(range)
  return exact ? compareSemver(version, exact) === 0 : false
}

function listRemoteTags(repo) {
  const result = spawnSync('git', ['ls-remote', '--tags', stripGitPrefix(repo)], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    throw new Error(`git tag 조회 실패: ${repo}\n${result.stderr.trim()}`)
  }

  const tags = []
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/refs\/tags\/(.+)$/)
    if (!match || match[1].endsWith('^{}')) {
      continue
    }

    const tag = match[1]
    const semver = parseSemver(tag)
    if (semver) {
      tags.push({ tag, semver })
    }
  }

  return tags
}

function selectTargets(lock, opts) {
  if (opts.baseOnly) {
    return [{ label: 'baseHarness', harness: lock.baseHarness }]
  }

  if (opts.stackOnly) {
    return [{ label: 'stackHarness', harness: lock.stackHarness }]
  }

  return [
    { label: 'baseHarness', harness: lock.baseHarness },
    ...(lock.stackHarness ? [{ label: 'stackHarness', harness: lock.stackHarness }] : []),
  ]
}

function sourceForTarget(target, installManifest) {
  if (target.label === 'baseHarness') {
    return installManifest?.source ?? {}
  }

  return target.harness?.source ?? {}
}

function fallbackTagFromVersion(version) {
  return version ? `v${version}` : null
}

function resolveHarnessMetadata(target, installManifest, lock) {
  const harness = target.harness
  const source = sourceForTarget(target, installManifest)
  const spec = parseSourceSpec(harness?.source?.spec ?? source?.spec)
  const currentVersion = cleanVersion(harness?.version ?? harness?.source?.packageVersion ?? source?.packageVersion ?? harness?.ref ?? source?.ref ?? spec.ref)
  const requiredBase = target.label === 'baseHarness'
    ? lock?.stackHarness?.requiredBaseHarness ?? {}
    : {}
  const directRepo = harness?.repo ?? harness?.source?.repo ?? source?.repo ?? spec.repo ?? null
  const repo = directRepo ?? requiredBase.repo ?? null
  const ref = harness?.ref
    ?? harness?.source?.ref
    ?? source?.ref
    ?? spec.ref
    ?? (repo ? fallbackTagFromVersion(currentVersion) : null)

  return {
    repo,
    ref,
    currentVersion,
    range: harness?.range ?? harness?.source?.range ?? source?.range ?? null,
    updateViaStackInit: target.label === 'baseHarness' && !directRepo && Boolean(requiredBase.repo),
  }
}

function updateCommandForTarget(label) {
  return label === 'baseHarness'
    ? 'npm run harness:update -- --base-only'
    : 'npm run harness:update'
}

function stackInitCommand(lock) {
  const stack = lock?.stackHarness
  const repo = stack?.repo ?? stack?.source?.repo ?? parseSourceSpec(stack?.source?.spec).repo
  if (!repo) {
    return null
  }

  const range = stack?.range ?? stack?.source?.range ?? compatibleRange(stack)
  const ref = range ? `semver:${range}` : stack?.ref ?? stack?.source?.ref ?? parseSourceSpec(stack?.source?.spec).ref ?? null
  const packageSpec = ref
    ? `${ensureGitPackageSpec(repo)}#${ref}`
    : ensureGitPackageSpec(repo)

  return `npx -y ${packageSpec} init`
}

function updateInstructionForTarget(target, metadata, lock, outdated) {
  if (!outdated) {
    return {
      updateCommand: null,
      updateNote: null,
    }
  }

  if (metadata.updateViaStackInit) {
    return {
      updateCommand: stackInitCommand(lock),
      updateNote: '이 공통 하네스는 repo를 스택 requirement에서만 복구했기 때문에 --base-only로 갱신할 수 없습니다. 최신 스택 하네스 init을 다시 실행하세요.',
    }
  }

  return {
    updateCommand: updateCommandForTarget(target.label),
    updateNote: null,
  }
}

function unavailableTargetStatus(target, harness, message) {
  return {
    target: target.label,
    id: harness?.id ?? null,
    repo: null,
    currentVersion: null,
    currentRef: null,
    range: null,
    latestVersion: null,
    latestRef: null,
    outdated: false,
    status: 'unavailable',
    updateCommand: null,
    updateNote: null,
    message,
    recovery: target.label === 'baseHarness'
      ? '공통 하네스 repo/ref/version을 복구하려면 공통 하네스를 git source로 다시 init/update 하거나 install-manifest source metadata를 확인하세요.'
      : '스택 하네스 repo/ref/version을 복구하려면 스택 하네스 init을 다시 실행해 lock metadata를 갱신하세요.',
  }
}

function buildTargetStatus(target, opts, installManifest, lock) {
  const harness = target.harness
  const metadata = resolveHarnessMetadata(target, installManifest, lock)
  const repo = metadata.repo
  const currentVersion = metadata.currentVersion
  const range = opts.range ?? metadata.range ?? compatibleRange({
    ...harness,
    version: currentVersion ?? harness?.version,
  })

  if (!repo) {
    return unavailableTargetStatus(target, harness, `${target.label} 저장소 정보가 lock/install-manifest에 없습니다.`)
  }
  if (!currentVersion) {
    return unavailableTargetStatus(target, harness, `${target.label} 현재 버전을 SemVer로 해석할 수 없습니다.`)
  }
  if (!range) {
    return unavailableTargetStatus(target, harness, `${target.label} 검사 range를 만들 수 없습니다.`)
  }

  let candidates
  try {
    candidates = listRemoteTags(repo)
    .filter(({ semver }) => satisfiesRange(semver, range))
    .sort((a, b) => compareSemver(a.semver, b.semver))
  } catch (error) {
    return unavailableTargetStatus(target, harness, error.message)
  }

  const latest = candidates.at(-1) ?? null
  const current = parseSemver(currentVersion)
  const outdated = latest ? compareSemver(latest.semver, current) > 0 : false
  const updateInstruction = updateInstructionForTarget(target, metadata, lock, outdated)

  return {
    target: target.label,
    id: harness?.id ?? null,
    repo,
    currentVersion,
    currentRef: metadata.ref,
    range,
    latestVersion: latest?.semver.version ?? null,
    latestRef: latest?.tag ?? null,
    outdated,
    status: outdated ? 'outdated' : 'up-to-date',
    updateCommand: updateInstruction.updateCommand,
    updateNote: updateInstruction.updateNote,
  }
}

function buildStatus(lock, opts, installManifest) {
  const targets = selectTargets(lock, opts)
  if (targets.length === 0 || targets.some((target) => !target.harness)) {
    const targetName = opts.stackOnly ? 'stackHarness' : 'baseHarness'
    throw new Error(`${targetName} 정보가 lock에 없습니다.`)
  }

  const results = targets.map((target) => buildTargetStatus(target, opts, installManifest, lock))
  const targetMap = Object.fromEntries(results.map((status) => [status.target, status]))
  const outdated = results.some((status) => status.outdated)
  const unavailable = results.some((status) => status.status === 'unavailable')

  return {
    overall: outdated ? 'outdated' : unavailable ? 'unavailable' : 'up-to-date',
    outdated,
    checkedTargets: results.map((status) => status.target),
    targets: targetMap,
  }
}

function printTarget(status) {
  console.log('')
  console.log(status.target)
  console.log(`  id: ${status.id ?? 'unknown'}`)
  console.log(`  status: ${status.status}`)
  if (status.status === 'unavailable') {
    console.log(`  reason: ${status.message}`)
    console.log(`  recovery: ${status.recovery}`)
    return
  }

  console.log(`  repo: ${status.repo}`)
  console.log(`  current: ${status.currentVersion}${status.currentRef ? ` (${status.currentRef})` : ''}`)
  console.log(`  range: ${status.range}`)
  console.log(`  latest: ${status.latestVersion ? `${status.latestVersion} (${status.latestRef})` : 'not found'}`)
  console.log(`  update: ${status.updateCommand ?? (status.outdated ? 'manual stack init required' : 'not needed')}`)
  if (status.updateNote) {
    console.log(`  note: ${status.updateNote}`)
  }
}

function printText(status) {
  console.log('Harness outdated check')
  console.log(`  overall: ${status.overall}`)

  for (const target of status.checkedTargets) {
    printTarget(status.targets[target])
  }
}

function main() {
  const opts = parseArgs(process.argv)
  const lock = readJson(lockPath)
  const installManifest = readJson(installManifestPath, {})

  if (!lock) {
    console.error(`harness lock을 찾을 수 없습니다: ${path.relative(repoRoot, lockPath)}`)
    process.exit(1)
  }

  const status = buildStatus(lock, opts, installManifest)

  if (opts.json) {
    console.log(JSON.stringify(status, null, 2))
  } else {
    printText(status)
  }

  if (opts.failOnOutdated && status.outdated) {
    process.exit(1)
  }
}

main()
