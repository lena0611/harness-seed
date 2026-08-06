#!/usr/bin/env node

// 기획 문서 푸시 정산 게이트 (0.2.99 2차).
//
// 설계 (2026-08-06 확정, decision-log 참조):
// - 정산 시점은 커밋이 아니라 push다. push는 어차피 네트워크가 있는 행위라 커밋 오프라인 원칙(결정 2)이
//   그대로 유지되고, 팀에 공개되는 순간에만 "내 변경이 최신 기획과 어긋나지 않는가"를 정산한다.
// - 범위는 내 몫만: 이번 push의 변경 파일에 spec-map으로 매핑된 문서만 본다. 남의 영역 기획 변경은
//   남의 push 게이트가 본다. lock 전체를 옮기지 않으므로 다른 팀의 신호를 삼키지 않는다.
// - 미연동 프로젝트 무영향: .githooks/pre-push가 spec-lock.json이 있을 때만 이 스크립트를 실행하고,
//   스크립트도 미설정이면 무음 종료한다. specEnforcement가 'gate'가 아니면(기본 advisory) 아무것도 하지 않는다.
// - fail-open: 기획 저장소 fetch 실패/지연은 push를 막지 않는다(로컬 기준으로 통과 + 한 줄 안내).
//   차단은 오직 "최신 기획과 내 범위 문서가 어긋남"일 때만.
// - 비상 우회: HARNESS_SPEC_GATE=off (사유는 decision-log에 남길 것).

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeGitPath, mappedDocsForFiles, readSpecState } from './spec-sync.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const harnessRoot = path.join(repoRoot, '.harness')
const profilePath = path.join(harnessRoot, 'policy', 'profile.json')

const FETCH_TIMEOUT_MS = 8000

function readJson(absPath, fallback = null) {
  if (!fs.existsSync(absPath)) return fallback
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

function runGit(argsToRun, cwd, timeout) {
  return execFileSync('git', argsToRun, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(timeout ? { timeout } : {}),
  }).trim()
}

// pre-push stdin: "<local ref> <local sha> <remote ref> <remote sha>" 줄들.
function readPushLines() {
  const fromEnv = process.env.HARNESS_PUSH_STDIN
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const ZERO_SHA = /^0+$/

// push 범위의 변경 파일 목록. stdin이 없으면(수동 실행 등) 원격에 없는 커밋 전체를 범위로 본다.
function collectPushedFiles(pushLines, remoteName) {
  const files = new Set()
  const lines = pushLines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  const addFrom = (output) => {
    for (const line of output.split(/\r?\n/)) {
      if (line.trim()) files.add(toPosix(decodeGitPath(line.trim())))
    }
  }

  if (lines.length === 0) {
    try {
      addFrom(runGit(['log', '--name-only', '--pretty=format:', 'HEAD', '--not', '--remotes'], repoRoot))
    } catch {
      // 빈 저장소 등 — 범위 없음으로 둔다.
    }
    return [...files]
  }

  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(/\s+/)
    if (!localSha || ZERO_SHA.test(localSha)) continue // 브랜치 삭제 push는 정산 대상 아님
    try {
      if (remoteSha && !ZERO_SHA.test(remoteSha)) {
        addFrom(runGit(['diff', '--name-only', remoteSha, localSha], repoRoot))
      } else {
        // 새 브랜치: 어떤 원격에도 없는 커밋들의 파일 합집합.
        addFrom(runGit(['log', '--name-only', '--pretty=format:', localSha, '--not', '--remotes'], repoRoot))
      }
    } catch {
      // 개별 ref 계산 실패는 그 ref만 건너뛴다(fail-open).
    }
  }
  return [...files]
}

// 최신 기획을 캐시에만 받는다(기준 이동 없음). 실패는 fail-open.
function refreshCacheLatest(sources) {
  for (const source of sources) {
    const dir = path.join(harnessRoot, 'generated', 'spec-cache', source.id)
    const ref = source.ref || 'HEAD'
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      runGit(['clone', '--quiet', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), source.repo, dir], repoRoot, FETCH_TIMEOUT_MS)
    } else {
      runGit(['fetch', '--quiet', '--depth', '1', 'origin', ref], dir, FETCH_TIMEOUT_MS)
      runGit(['checkout', '--quiet', '--force', 'FETCH_HEAD'], dir, FETCH_TIMEOUT_MS)
    }
  }
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')
}

function main() {
  if (process.env.HARNESS_SPEC_GATE === 'off') {
    console.log('[spec-gate] HARNESS_SPEC_GATE=off — 기획 정산 게이트를 건너뜁니다. 사유를 decision-log에 남기세요.')
    return
  }

  const profile = readJson(profilePath)
  if (profile?.specEnforcement !== 'gate') {
    // 기본은 advisory: push에서는 아무것도 하지 않는다(커밋 advisory가 오프라인으로 이미 안내).
    return
  }

  const state = readSpecState()
  if (!state.configured || !state.lock?.sources) {
    return
  }

  const remoteName = process.argv[2] ?? ''
  const pushedFiles = collectPushedFiles(readPushLines(), remoteName)
  if (pushedFiles.length === 0) return

  const scope = mappedDocsForFiles(pushedFiles, state.entries)
  if (scope.length === 0) return

  try {
    refreshCacheLatest(state.sources)
  } catch (error) {
    console.log(`[spec-gate] 기획 최신 확인 불가(${String(error.message ?? error).split('\n')[0]}) — 로컬 기준으로 통과합니다.`)
    return
  }

  const drift = []
  for (const entry of scope) {
    for (const [sourceId, recorded] of Object.entries(state.lock.sources)) {
      const lockedSha = recorded?.files?.[entry.spec]
      if (!lockedSha) continue
      if (drift.some((item) => item.spec === entry.spec)) continue
      const abs = path.join(harnessRoot, 'generated', 'spec-cache', sourceId, entry.spec)
      if (!fs.existsSync(abs)) {
        drift.push({ ...entry, kind: '삭제' })
      } else if (sha256File(abs) !== lockedSha) {
        drift.push({ ...entry, kind: '변경' })
      }
    }
  }

  if (drift.length === 0) {
    console.log(`[spec-gate] 기획 정산 통과: 이번 push 범위의 기획 문서 ${scope.length}건이 최신 기획과 일치합니다.`)
    return
  }

  console.error('')
  console.error('[spec-gate] push 중단: 이번 push 범위 코드의 상위 기획 문서가 기준 시점 이후 달라졌습니다.')
  console.error('')
  for (const item of drift) {
    console.error(`  - [${item.kind}] ${item.spec} ← ${item.codePaths.join(', ')}`)
    console.error(`    본문: .harness/generated/spec-cache/*/${item.spec}`)
  }
  console.error('')
  console.error('정산 절차:')
  console.error('  1. 위 문서를 읽고 이번 변경이 새 사양과 어긋나는지 확인합니다. (기본 판정: 코드 drift — 기획을 임의로 고치지 않음)')
  console.error('  2. 반영이 필요하면 코드를 수정해 커밋하고, 영향이 없으면 근거를 decision-log에 남깁니다.')
  console.error('  3. npm run harness:spec:settle  (이번 push 범위 문서만 기준 전진)')
  console.error('  4. spec-lock.json 변경을 커밋에 포함해 다시 push 합니다.')
  console.error('')
  console.error('비상 우회(권장하지 않음): HARNESS_SPEC_GATE=off git push')
  process.exit(1)
}

if (process.argv[1]) {
  try {
    if (fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) {
      main()
    }
  } catch {
    if (path.resolve(process.argv[1]) === __filename) {
      main()
    }
  }
}
