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

function printUsageAndExit(code = 0) {
  console.log(`Usage:
  npm run harness:outdated [-- options]

Options:
  --json                  JSON으로 출력합니다.
  --fail-on-outdated      업데이트 후보가 있으면 exit code 1로 종료합니다.
  --base-only             스택 하네스 대신 공통 하네스를 검사합니다.
  --range <semver-range>  검사할 SemVer range를 직접 지정합니다. 예: ^1.0.0
  -h, --help              도움말을 출력합니다.

기본 동작은 lock에 기록된 스택 하네스의 현재 버전을 기준으로 같은 SemVer caret 범위의 최신 tag를 조회합니다.
프로젝트 파일은 수정하지 않습니다. 실제 반영은 npm run harness:update로 수행합니다.
`)
  process.exit(code)
}

function parseArgs(argv) {
  const opts = {
    json: false,
    failOnOutdated: false,
    baseOnly: false,
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
      case '--range':
        opts.range = requireValue(args, i, arg)
        i += 1
        break
      default:
        console.error(`알 수 없는 옵션: ${arg}`)
        printUsageAndExit(1)
    }
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

function selectTarget(lock, opts) {
  if (opts.baseOnly || !lock.stackHarness) {
    return {
      label: 'baseHarness',
      harness: lock.baseHarness,
    }
  }

  return {
    label: 'stackHarness',
    harness: lock.stackHarness,
  }
}

function buildStatus(lock, opts) {
  const target = selectTarget(lock, opts)
  const harness = target.harness
  const repo = harness?.repo ?? harness?.source?.repo
  const currentVersion = cleanVersion(harness?.version ?? harness?.source?.packageVersion ?? harness?.ref)
  const range = opts.range ?? harness?.range ?? harness?.source?.range ?? compatibleRange(harness)

  if (!repo) {
    throw new Error(`${target.label} 저장소 정보가 lock에 없습니다.`)
  }
  if (!currentVersion) {
    throw new Error(`${target.label} 현재 버전을 SemVer로 해석할 수 없습니다.`)
  }
  if (!range) {
    throw new Error(`${target.label} 검사 range를 만들 수 없습니다.`)
  }

  const candidates = listRemoteTags(repo)
    .filter(({ semver }) => satisfiesRange(semver, range))
    .sort((a, b) => compareSemver(a.semver, b.semver))

  const latest = candidates.at(-1) ?? null
  const current = parseSemver(currentVersion)
  const outdated = latest ? compareSemver(latest.semver, current) > 0 : false

  return {
    target: target.label,
    id: harness?.id ?? null,
    repo,
    currentVersion,
    currentRef: harness?.ref ?? harness?.source?.ref ?? null,
    range,
    latestVersion: latest?.semver.version ?? null,
    latestRef: latest?.tag ?? null,
    outdated,
    updateCommand: 'npm run harness:update',
  }
}

function printText(status) {
  console.log('Harness outdated check')
  console.log(`  target: ${status.target}`)
  console.log(`  id: ${status.id ?? 'unknown'}`)
  console.log(`  repo: ${status.repo}`)
  console.log(`  current: ${status.currentVersion}${status.currentRef ? ` (${status.currentRef})` : ''}`)
  console.log(`  range: ${status.range}`)
  console.log(`  latest: ${status.latestVersion ? `${status.latestVersion} (${status.latestRef})` : 'not found'}`)
  console.log(`  status: ${status.outdated ? 'outdated' : 'up-to-date'}`)

  if (status.outdated) {
    console.log('')
    console.log('업데이트 적용:')
    console.log(`  ${status.updateCommand}`)
  }
}

function main() {
  const opts = parseArgs(process.argv)
  const lock = readJson(lockPath)

  if (!lock) {
    console.error(`harness lock을 찾을 수 없습니다: ${path.relative(repoRoot, lockPath)}`)
    process.exit(1)
  }

  const status = buildStatus(lock, opts)

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
