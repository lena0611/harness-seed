#!/usr/bin/env node

// 기획 문서 푸시 정산 게이트 (0.2.99 도입, 0.2.100 스냅샷 재판정).
//
// 판정 원칙 (2026-08-06 확정, decision-log 참조):
// - 판정 입력은 전부 push되는 tip(localSha)의 snapshot이다: profile.json, spec-sources.json,
//   spec-lock.json, spec-map.md 를 `git show <localSha>:<path>`로 읽는다. 작업 트리 파일은
//   판정에 쓰지 않는다 — 미커밋 편집(매핑 삭제, enforcement 강등, lock 조작)으로 우회할 수 없고,
//   "정산했지만 lock을 커밋에 안 넣은" push는 tip의 옛 lock 기준으로 자연 차단된다.
// - 범위는 내 몫만: 이번 push 범위의 변경 파일에 tip의 spec-map으로 매핑된 문서만 본다.
//   새 ref의 범위는 push 대상 원격의 remote-tracking만 제외한다(--remotes=<remote> —
//   전체 원격 제외는 양원격 운영에서 게이트 통째 우회를 만들었다).
// - drift 비교는 fetch한 git 객체 내용(git show)에 sha256을 적용한다. 작업 트리 캐시 파일은
//   손편집될 수 있으므로 읽지 않는다.
// - fail-open은 기획 저장소 네트워크 접근 실패에만 적용한다. 커밋된 설정 오류(enforcement 오값,
//   snapshot JSON 파싱 실패)와 로컬 git 계산 실패는 fail-closed로 push를 중단한다 —
//   조용한 advisory 강등은 게이트 옵트인의 의미를 없앤다.
// - 비상 우회: HARNESS_SPEC_GATE=off (사유는 decision-log에 남길 것).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fetchLatestIntoCache,
  findPathCollisions,
  gitShowText,
  mappedDocsForFiles,
  normalizeLock,
  parseSpecMapText,
  sha256Text,
  decodeGitPath,
  validateSourcesConfig,
} from './spec-sync.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const SNAPSHOT_PATHS = {
  profile: '.harness/policy/profile.json',
  sources: '.harness/spec-sources.json',
  lock: '.harness/spec-lock.json',
  map: '.harness/project/spec-map.md',
}

const ZERO_SHA = /^0+$/

function runGit(argsToRun, cwd = repoRoot) {
  return execFileSync('git', argsToRun, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

// pre-push stdin: "<local ref> <local sha> <remote ref> <remote sha>" 줄들. 훅이 버퍼링해 env로 준다.
function readPushLines() {
  const fromEnv = process.env.HARNESS_PUSH_STDIN
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv
  try {
    return fs.readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// tip snapshot에서 파일 하나를 읽는다. 부재(null)와 로컬 git 실패(throw)를 구분한다.
function showAtTip(localSha, rel) {
  try {
    return execFileSync('git', ['show', `${localSha}:${rel}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const message = String(error.stderr ?? error.message ?? '')
    if (/does not exist|exists on disk, but not in|invalid object name|bad revision/i.test(message)) {
      return null
    }
    throw new Error(`git show ${localSha.slice(0, 10)}:${rel} 실패: ${message.split('\n')[0]}`)
  }
}

function parseJsonStrict(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} 이 push tip에서 JSON으로 읽히지 않습니다 — 커밋된 파일을 고치세요.`)
  }
}

function collectChangedFiles(localSha, remoteSha, remoteName) {
  const files = new Set()
  const addFrom = (output) => {
    for (const line of output.split(/\r?\n/)) {
      if (line.trim()) files.add(decodeGitPath(line.trim()))
    }
  }

  if (remoteSha && !ZERO_SHA.test(remoteSha)) {
    addFrom(runGit(['diff', '--name-only', remoteSha, localSha]))
    return [...files]
  }

  // 새 ref: push 대상 원격에 이미 있는 commit만 제외한다. 다른 원격(양원격 운영의 반대쪽)에
  // 있다는 이유로 제외하면 게이트가 통째로 우회된다.
  if (!remoteName) {
    throw new Error('push 대상 원격 이름이 없어 새 ref의 변경 범위를 계산할 수 없습니다. (훅이 전달하는 인자를 확인하세요)')
  }
  let hasRemoteTracking = false
  try {
    hasRemoteTracking = runGit(['for-each-ref', `refs/remotes/${remoteName}`]).length > 0
  } catch {
    hasRemoteTracking = false
  }
  const exclusion = hasRemoteTracking ? [`--remotes=${remoteName}`] : []
  addFrom(runGit(['log', '--name-only', '--pretty=format:', localSha, ...(exclusion.length > 0 ? ['--not', ...exclusion] : [])]))
  return [...files]
}

function main() {
  if (process.env.HARNESS_SPEC_GATE === 'off') {
    console.log('[spec-gate] HARNESS_SPEC_GATE=off — 기획 정산 게이트를 건너뜁니다. 사유를 decision-log에 남기세요.')
    return
  }

  const remoteName = process.argv[2] ?? ''
  const lines = readPushLines().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return

  const fetchedBySource = new Map() // id -> { dir, commit } | { failed: reason }
  const blocked = []
  const passNotes = []

  for (const line of lines) {
    const [, localSha, remoteRef, remoteSha] = line.split(/\s+/)
    if (!localSha || ZERO_SHA.test(localSha)) continue // 브랜치 삭제 push는 정산 대상 아님

    let verdict
    try {
      verdict = evaluateRef({ localSha, remoteRef, remoteSha, remoteName, fetchedBySource })
    } catch (error) {
      // 로컬 git 계산/스냅샷 해석 실패는 fail-closed — 판정 불가 상태로 통과시키지 않는다.
      blocked.push({ ref: remoteRef ?? localSha.slice(0, 10), reasons: [`판정 실패: ${String(error.message ?? error)}`], configError: true })
      continue
    }
    if (verdict.blockedReasons.length > 0) {
      blocked.push({ ref: remoteRef ?? localSha.slice(0, 10), reasons: verdict.blockedReasons, drift: verdict.drift })
    } else if (verdict.checkedDocs > 0) {
      passNotes.push(`[spec-gate] 기획 정산 통과 (${remoteRef ?? localSha.slice(0, 10)}): push 범위 문서 ${verdict.checkedDocs}건이 tip 기준과 일치합니다.`)
    } else if (verdict.failOpenNote) {
      passNotes.push(verdict.failOpenNote)
    }
  }

  for (const note of passNotes) {
    console.log(note)
  }

  if (blocked.length === 0) return

  console.error('')
  console.error('[spec-gate] push 중단:')
  for (const item of blocked) {
    console.error(`  ref ${item.ref}:`)
    for (const reason of item.reasons) {
      console.error(`    - ${reason}`)
    }
  }
  console.error('')
  console.error('정산 절차:')
  console.error('  1. 위 문서를 읽고 이번 변경이 새 사양과 어긋나는지 확인합니다. (기본 판정: 코드 drift — 기획을 임의로 고치지 않음)')
  console.error('  2. 반영이 필요하면 코드를 수정해 커밋하고, 영향이 없으면 근거를 decision-log에 남깁니다.')
  console.error('  3. npm run harness:spec:settle  (이번 push 범위 문서만 기준 전진)')
  console.error('  4. spec-lock.json 변경을 커밋에 포함해 다시 push 합니다. (게이트는 push되는 커밋의 lock을 봅니다)')
  console.error('')
  console.error('비상 우회(권장하지 않음): HARNESS_SPEC_GATE=off git push')
  process.exit(1)
}

function evaluateRef({ localSha, remoteRef, remoteSha, remoteName, fetchedBySource }) {
  const result = { blockedReasons: [], drift: [], checkedDocs: 0, failOpenNote: null }

  // 1) enforcement — push tip의 profile 기준. 부재/advisory는 무동작, 오값·파싱 실패는 차단.
  const profileText = showAtTip(localSha, SNAPSHOT_PATHS.profile)
  if (profileText === null) return result
  const profile = parseJsonStrict(profileText, SNAPSHOT_PATHS.profile)
  const enforcement = profile.specEnforcement ?? 'advisory'
  if (enforcement === 'advisory') return result
  if (enforcement !== 'gate') {
    result.blockedReasons.push(`설정 오류: specEnforcement 값이 유효하지 않습니다: ${JSON.stringify(enforcement)} (advisory|gate). 조용히 낮추지 않고 중단합니다.`)
    return result
  }

  // 2) 연동 선언/기준/매핑 — 전부 tip snapshot.
  const lockText = showAtTip(localSha, SNAPSHOT_PATHS.lock)
  if (lockText === null) return result // tip 기준 미연동
  const sourcesText = showAtTip(localSha, SNAPSHOT_PATHS.sources)
  if (sourcesText === null) {
    result.blockedReasons.push('spec-lock.json은 커밋되어 있는데 spec-sources.json이 push tip에 없습니다 — 연동 선언을 커밋하세요.')
    return result
  }

  const sourcesConfig = parseJsonStrict(sourcesText, SNAPSHOT_PATHS.sources)
  const { sources, errors } = validateSourcesConfig(sourcesConfig)
  if (errors.length > 0) {
    result.blockedReasons.push(...errors.map((message) => `설정 오류(spec-sources.json): ${message}`))
    return result
  }

  const lock = normalizeLock(parseJsonStrict(lockText, SNAPSHOT_PATHS.lock))
  const collisions = findPathCollisions(lock)
  if (collisions.length > 0) {
    result.blockedReasons.push(...collisions.map((item) => `경로 충돌: ${item.rel} 이 여러 소스(${item.sourceIds.join(', ')})에 있습니다 — 활성 소스 전역에서 문서 경로는 유일해야 합니다.`))
    return result
  }

  const mapText = showAtTip(localSha, SNAPSHOT_PATHS.map)
  const entries = parseSpecMapText(mapText ?? '')
  if (entries.length === 0) return result

  // 3) push 범위 → 매핑된 문서 스코프.
  const changedFiles = collectChangedFiles(localSha, remoteSha, remoteName)
  const scope = mappedDocsForFiles(changedFiles, entries)
  if (scope.length === 0) return result

  // 4) 최신 기획 확보(네트워크) — 여기"만" fail-open.
  for (const source of sources) {
    if (fetchedBySource.has(source.id)) continue
    try {
      fetchedBySource.set(source.id, fetchLatestIntoCache(source))
    } catch (error) {
      fetchedBySource.set(source.id, { failed: String(error.message ?? error).split('\n')[0] })
    }
  }

  // 5) drift: fetch된 git 객체 내용 vs tip lock.
  for (const entry of scope) {
    for (const [sourceId, recorded] of Object.entries(lock.sources)) {
      const lockedDoc = recorded?.files?.[entry.spec]
      if (!lockedDoc) continue
      const fetched = fetchedBySource.get(sourceId)
      if (!fetched || fetched.failed) {
        result.failOpenNote = `[spec-gate] 기획 최신 확인 불가(${fetched?.failed ?? '소스 미확보'}) — 로컬 기준으로 통과합니다.`
        continue
      }
      result.checkedDocs += 1
      const latest = gitShowText(fetched.dir, fetched.commit, entry.spec)
      if (latest === null) {
        result.drift.push({ spec: entry.spec, kind: '삭제', codePaths: entry.codePaths })
      } else if (sha256Text(latest) !== lockedDoc.sha) {
        result.drift.push({ spec: entry.spec, kind: '변경', codePaths: entry.codePaths })
      }
    }
  }

  if (result.drift.length > 0) {
    result.blockedReasons.push(...result.drift.map((item) => `[${item.kind}] ${item.spec} ← ${item.codePaths.join(', ')} (본문: .harness/generated/spec-cache/*/${item.spec})`))
  }

  return result
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
