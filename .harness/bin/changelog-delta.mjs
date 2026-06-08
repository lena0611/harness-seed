#!/usr/bin/env node

// 공통 하네스 CHANGELOG 델타 도구.
//
// 목적: 소비자가 "이번 하네스 업데이트로 무엇이 바뀌었는지"를 다시 확인할 수 있게 한다.
//
// 두 가지 모드:
//  1) 기본 모드 (인자 없음): `.harness/harness-lock.json`의 lastUpdate를 출력한다.
//     init/update가 업데이트 시점에 기록해 둔 from→to 구간의 CHANGELOG 항목이다.
//  2) 파일 모드 (--changelog <path>): CHANGELOG.md를 직접 파싱해 --from/--to 구간을 출력한다.
//     (하네스 본체 개발자나 CI에서 사용)

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
  npm run harness:changelog [-- options]

Options:
  --changelog <path>   CHANGELOG.md를 직접 파싱합니다. 생략하면 harness-lock.json의 lastUpdate를 봅니다.
  --from <version>     이 버전 초과(>)부터 출력합니다. 파일 모드에서만 사용합니다.
  --to <version>       이 버전 이하(<=)까지 출력합니다. 파일 모드에서만 사용합니다.
  --json               JSON으로 출력합니다.
  -h, --help           도움말을 출력합니다.

기본 동작은 마지막 하네스 업데이트로 반영된 공통 하네스 변경 항목을 보여줍니다.
`)
  process.exit(code)
}

function parseArgs(argv) {
  const opts = { changelog: null, from: null, to: null, json: false }
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
      case '--changelog':
        opts.changelog = requireValue(args, i, arg)
        i += 1
        break
      case '--from':
        opts.from = requireValue(args, i, arg)
        i += 1
        break
      case '--to':
        opts.to = requireValue(args, i, arg)
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

export function parseSemver(value) {
  const m = String(value ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!m) {
    return null
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), version: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` }
}

export function compareSemver(a, b) {
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

function trimBlank(lines) {
  const out = [...lines]
  while (out.length && !out[0].trim()) out.shift()
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out
}

// CHANGELOG.md를 `## X.Y.Z - date` 헤더 기준으로 섹션 배열로 만든다(파일 순서 = 최신 우선).
export function parseChangelog(text) {
  const sections = []
  let current = null
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*(?:[-–]\s*(.*))?$/)
    if (m) {
      current = { version: m[1], date: (m[2] || '').trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (current) {
      current.lines.push(line)
    }
  }
  return sections.map((s) => ({ ...s, lines: trimBlank(s.lines) }))
}

// from < version <= to 인 섹션만 (없으면 전체) 최신 우선으로 반환.
export function changelogDelta(text, fromVersion, toVersion) {
  const sections = parseChangelog(text)
  const from = fromVersion ? parseSemver(fromVersion) : null
  const to = toVersion ? parseSemver(toVersion) : null
  return sections.filter((s) => {
    const v = parseSemver(s.version)
    if (!v) return false
    if (from && compareSemver(v, from) <= 0) return false
    if (to && compareSemver(v, to) > 0) return false
    return true
  })
}

export function formatEntries(entries, { from, to } = {}) {
  const lines = []
  const header = from && to ? ` (${from} → ${to})` : ''
  lines.push(`공통 하네스 변경 내역${header}:`)
  if (!entries.length) {
    lines.push('  (해당 구간에 기록된 변경 항목이 없습니다.)')
    return lines.join('\n')
  }
  for (const e of entries) {
    lines.push('')
    lines.push(`  ## ${e.version}${e.date ? ` - ${e.date}` : ''}`)
    for (const line of e.lines ?? []) {
      lines.push(`  ${line}`)
    }
  }
  return lines.join('\n')
}

function runFromLock(opts) {
  const lock = readJson(lockPath)
  if (!lock) {
    console.error(`harness lock을 찾을 수 없습니다: ${path.relative(repoRoot, lockPath)}`)
    console.error('공통 하네스가 설치된 프로젝트에서 실행하세요.')
    process.exit(1)
  }

  const lastUpdate = lock.lastUpdate ?? null
  if (opts.json) {
    console.log(JSON.stringify(lastUpdate ?? { entries: [] }, null, 2))
    return
  }

  if (!lastUpdate || !(lastUpdate.entries?.length)) {
    console.log('마지막 하네스 업데이트로 기록된 변경 내역이 없습니다.')
    console.log(`현재 공통 하네스 버전: ${lock.baseHarness?.version ?? 'unknown'}`)
    console.log('업데이트 후보는 npm run harness:outdated 로 확인합니다.')
    return
  }

  console.log(formatEntries(lastUpdate.entries, { from: lastUpdate.from, to: lastUpdate.to }))
}

function runFromFile(opts) {
  if (!fs.existsSync(opts.changelog)) {
    console.error(`CHANGELOG 파일을 찾을 수 없습니다: ${opts.changelog}`)
    process.exit(1)
  }
  const text = fs.readFileSync(opts.changelog, 'utf8')
  const entries = changelogDelta(text, opts.from, opts.to)
  if (opts.json) {
    console.log(JSON.stringify({ from: opts.from, to: opts.to, entries }, null, 2))
    return
  }
  console.log(formatEntries(entries, { from: opts.from, to: opts.to }))
}

function main() {
  const opts = parseArgs(process.argv)
  if (opts.changelog) {
    runFromFile(opts)
  } else {
    runFromLock(opts)
  }
}

// 직접 실행될 때만 CLI를 돈다(import 시에는 함수만 노출).
// tmpdir 같은 심볼릭 링크 경로에서도 동작하도록 realpath로 비교한다.
function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return fs.realpathSync(entry) === fs.realpathSync(__filename)
  } catch {
    return path.resolve(entry) === __filename
  }
}

if (invokedDirectly()) {
  main()
}
