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
  analyzeMappingCoverage,
  fetchLatestCommit,
  materializeLatest,
  findDeclarationLockIssues,
  findPathCollisions,
  gitShowText,
  expandMappedSpecs,
  mappedDocsForFiles,
  normalizeScreenLinks,
  screenIndexAtCommit,
  selectSpecFilesAtCommit,
  normalizeLock,
  parseSpecMapExemptions,
  parseSpecMapText,
  sha256Text,
  decodeGitPath,
  validateLockSchema,
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

// fetch된 소스의 화면 링크 색인. 대표 문서만 매핑돼 있어도 링크된 화면을 판정에 포함하려면 필요하다.
// 실패해도 판정을 막지 않는다 — 링크 확장이 안 될 뿐이고, 대표 문서 자체의 drift는 그대로 잡힌다.
const screenIndexCache = new Map()
function safeScreenIndex(fetched, extensions) {
  if (!fetched || fetched.failed || !fetched.dir || extensions.length === 0) return null
  const key = `${fetched.dir}@${fetched.commit}@${extensions.join(',')}`
  if (!screenIndexCache.has(key)) {
    try {
      const selector = { include: ['**/*.md'], exclude: [] }
      const files = selectSpecFilesAtCommit(fetched.dir, fetched.commit, selector, { screenLinks: extensions })
      screenIndexCache.set(key, screenIndexAtCommit(fetched.dir, fetched.commit, files, extensions))
    } catch {
      screenIndexCache.set(key, null)
    }
  }
  return screenIndexCache.get(key)
}

// 이번 push의 base commit. 기존 브랜치면 원격 tip이고, **새 브랜치면 그 원격이 이미 가진
// 커밋 중 이 브랜치의 조상**이다. 새 ref라고 base를 비우면, 브랜치를 새로 만들어 매핑을 지우는
// 것만으로 합집합 방어가 통째로 꺼진다(자체 검토).
function resolveBaseSha(localSha, remoteSha, remoteName) {
  if (remoteSha && !ZERO_SHA.test(remoteSha)) return remoteSha
  if (!remoteName) return null
  for (const candidate of [`${remoteName}/HEAD`, `${remoteName}/main`, `${remoteName}/master`]) {
    try {
      const ref = runGit(['rev-parse', '--verify', '--quiet', candidate])
      if (!ref) continue
      return runGit(['merge-base', localSha, ref])
    } catch {
      // 다음 후보로
    }
  }
  return null
}

// 주어진 commit에서 파일을 읽는다. 없거나 읽을 수 없으면 null.
function showAtBase(baseSha, rel) {
  if (!baseSha) return null
  try {
    return showAtTip(baseSha, rel)
  } catch {
    return null
  }
}

function mergeMapEntries(base, tip) {
  const merged = [...tip]
  for (const entry of base) {
    if (!merged.some((item) => item.spec === entry.spec)) merged.push(entry)
  }
  return merged
}

function parseJsonStrict(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} 이 push tip에서 JSON으로 읽히지 않습니다 — 커밋된 파일을 고치세요.`)
  }
}

// 매핑 커버리지 판정 대상: push 범위에서 추가되거나 수정된 파일(0.2.102 리뷰 P1-4).
// 신규 파일만 보면 미매핑 기존 파일을 계속 고치는 동안 사각지대가 유지된다.
function collectAddedOrModifiedFiles(localSha, remoteSha, remoteName) {
  const files = new Set()
  const addFrom = (output) => {
    for (const line of output.split(/\r?\n/)) {
      if (line.trim()) files.add(decodeGitPath(line.trim()))
    }
  }

  try {
    if (remoteSha && !ZERO_SHA.test(remoteSha)) {
      addFrom(runGit(['diff', '--name-only', '--diff-filter=AM', remoteSha, localSha]))
    } else {
      const exclusion = remoteName && hasRemoteTracking(remoteName) ? ['--not', `--remotes=${remoteName}`] : []
      addFrom(runGit(['log', '--name-only', '--diff-filter=AM', '--pretty=format:', localSha, ...exclusion]))
    }
  } catch {
    // 계산 실패 시 커버리지 판정은 생략한다(drift 판정은 별도 경로에서 fail-closed).
    return []
  }
  return [...files]
}

function hasRemoteTracking(remoteName) {
  try {
    return runGit(['for-each-ref', `refs/remotes/${remoteName}`]).length > 0
  } catch {
    return false
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
  const exclusion = hasRemoteTracking(remoteName) ? [`--remotes=${remoteName}`] : []
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
      blocked.push({ ref: remoteRef ?? localSha.slice(0, 10), reasons: verdict.blockedReasons, drift: verdict.drift, uncovered: verdict.uncovered })
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

  // 차단할 때는 그 문서를 실제로 열 수 있어야 한다. 기준 캐시(spec-cache)는 lock 전용이므로
  // 최신 본문은 spec-latest에 꺼내고 manifest를 남긴다 — 이 스냅샷이 이후 settle의 근거가 된다.
  const readablePaths = materializeBlockedDocs(blocked, fetchedBySource)

  console.error('')
  console.error('[spec-gate] push 중단:')
  for (const item of blocked) {
    console.error(`  ref ${item.ref}:`)
    for (const reason of item.reasons) {
      console.error(`    - ${reason}`)
    }
  }
  if (readablePaths.length > 0) {
    console.error('')
    console.error('바뀐 기획 문서를 아래 경로에서 바로 열 수 있습니다(최신 내용):')
    for (const item of readablePaths) {
      console.error(`  - ${item}`)
    }
  }
  const hasDrift = blocked.some((item) => (item.drift ?? []).length > 0)
  const hasUncovered = blocked.some((item) => (item.uncovered ?? []).length > 0)

  if (hasDrift) {
    console.error('')
    console.error('무슨 일인가요: 이번에 push하는 코드의 기획서가 그 사이 바뀌었습니다. 바뀐 내용을 아직 아무도 확인하지 않아 멈췄습니다.')
    console.error('')
    console.error('이렇게 하면 됩니다:')
    console.error('  1. 위 기획 문서를 읽습니다. 바뀐 내용이 이번 코드에 영향을 주나요?')
    console.error('  2. 영향이 있으면 코드를 고쳐서 커밋합니다.')
    console.error('     영향이 없으면 그 판단 근거를 .harness/session/decision-log.md에 한 줄 남깁니다.')
    console.error('     (기획 문서를 개발자가 직접 고치지는 않습니다. 문서가 틀렸다면 기획팀과 논의하세요.)')
    console.error('  3. npm run harness:spec:settle     ← "확인했다"를 기록하는 명령입니다')
    console.error('  4. 바뀐 .harness/spec-lock.json을 커밋에 포함해서 다시 push 합니다.')
    console.error('     (이 파일이 "우리 팀은 이 시점 기획을 확인했다"는 팀 공유 기록입니다)')
  }

  if (hasUncovered) {
    console.error('')
    console.error('매핑 누락 해소 절차 (.harness/project/spec-map.md에 한 줄 추가 후 커밋):')
    console.error('  - 사양이 있으면 매핑을 기록합니다:      | features/○○.md | <위 파일 경로> | |')
    console.error('  - 기획 문서가 필요 없는 코드면 판정을 기록합니다:  | (사양 없음) | <경로 또는 디렉터리/**> | 사유 |')
    console.error('  - 디렉터리 단위(예: src/views/○○/**)로 적으면 이후 파일 추가에 다시 걸리지 않습니다.')
  }

  console.error('')
  console.error('비상 우회(권장하지 않음): HARNESS_SPEC_GATE=off git push')
  process.exit(1)
}

// 차단된 문서를 읽을 수 있는 경로를 안내한다.
//
// 판정 경계: 판정 입력과 결과는 push tip snapshot + fetch된 git 객체의 함수이고,
// 판정 중 tracked 파일(lock/map/profile)은 절대 건드리지 않는다. 최신 본문은 기준 캐시가 아니라
// spec-latest에 꺼내고 manifest를 남긴다(generated 산출물 갱신은 허용된 보조 부수효과).
function materializeBlockedDocs(blocked, fetchedBySource) {
  const paths = []
  for (const [sourceId, fetched] of fetchedBySource.entries()) {
    if (!fetched || fetched.failed || !fetched.source) continue

    const screenLinks = normalizeScreenLinks(fetched.source) ?? []
    const screenIndex = safeScreenIndex(fetched, screenLinks)
    const changedSpecs = []
    const deletedSpecs = []
    for (const item of blocked) {
      for (const drift of item.drift ?? []) {
        // 화면 기획은 한쪽만 바뀌어도 단위 전체를 꺼낸다. 짝을 빼놓으면 이어지는 정산이
        // "일부만 정산할 수 있는 상태"로 거부된다 — 차단 안내가 막다른 길이 된다.
        const targets = drift.kind === '기준 누락' ? [drift.spec] : expandMappedSpecs([drift.spec], screenIndex)
        for (const rel of targets) {
          if (drift.kind === '삭제') {
            if (!deletedSpecs.includes(rel)) deletedSpecs.push(rel)
          } else if (!changedSpecs.includes(rel)) {
            changedSpecs.push(rel)
          }
        }
      }
    }
    if (changedSpecs.length === 0 && deletedSpecs.length === 0) continue

    try {
      const result = materializeLatest(fetched.source, fetched.commit, changedSpecs, fetched.dir, {
        deletedPaths: deletedSpecs,
        lockedFiles: fetched.lockedFiles ?? {},
      })
      for (const rel of Object.keys(result.files)) {
        if (result.files[rel]?.deleted) continue
        const shown = `.harness/generated/spec-latest/${sourceId}/${rel}`
        if (!paths.includes(shown)) paths.push(shown)
      }
    } catch {
      // 꺼내기 실패는 차단 판정을 바꾸지 않는다 — 경로 안내만 못 할 뿐이다.
    }
  }
  return paths
}

function evaluateRef({ localSha, remoteRef, remoteSha, remoteName, fetchedBySource }) {
  const result = { blockedReasons: [], drift: [], uncovered: [], checkedDocs: 0, failOpenNote: null }

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

  // schema 검증 없이 normalize하면 형태가 어긋난 문서 항목이 조용히 사라진다. 그러면 그 문서는
  // "기준에 없는 문서"가 되어 drift 검사를 건너뛴다 — 값 하나를 망가뜨려 게이트를 끌 수 있었다(3차 리뷰 P1-1).
  const rawLock = parseJsonStrict(lockText, SNAPSHOT_PATHS.lock)
  const lockSchemaErrors = validateLockSchema(rawLock)
  if (lockSchemaErrors.length > 0) {
    result.blockedReasons.push(...lockSchemaErrors.map((message) => `기준 기록 손상(push되는 커밋 기준): ${message}`))
    return result
  }
  const lock = normalizeLock(rawLock)

  // 선언↔기준 정합도 tip snapshot으로 판정한다(0.2.102 재리뷰 P1-5).
  // 작업 트리만 정상으로 만들어 커밋 검증을 통과시키고 불일치 tip을 push하는 경로를 막는다.
  const declarationIssues = findDeclarationLockIssues(sources, lock)
  if (declarationIssues.length > 0) {
    result.blockedReasons.push(...declarationIssues.map((message) => `연동 설정 불일치(push되는 커밋 기준): ${message}`))
    return result
  }

  const collisions = findPathCollisions(lock)
  if (collisions.length > 0) {
    result.blockedReasons.push(...collisions.map((item) => `경로 충돌: ${item.rel} 이 여러 소스(${item.sourceIds.join(', ')})에 있습니다 — 활성 소스 전역에서 문서 경로는 유일해야 합니다.`))
    return result
  }

  // 매핑 표 자체가 tip에 없으면 게이트가 통째로 무력화된다 — 파일 하나를 지우는 커밋으로
  // 차단을 끌 수 있으면 옵트인의 의미가 없다(0.2.103 자체 검토 P2-5). 선언 누락과 같은 fail-closed다.
  // 표는 있는데 아직 매핑 행이 없는 상태(연동 초기)는 정상이므로 통과시킨다.
  const mapText = showAtTip(localSha, SNAPSHOT_PATHS.map)
  if (mapText === null) {
    result.blockedReasons.push('spec-lock.json은 커밋되어 있는데 .harness/project/spec-map.md가 push tip에 없습니다 — 매핑 표를 복원해 커밋하세요(없으면 기획 연동 검사가 전부 꺼집니다).')
    return result
  }
  // 매핑 행을 **비우는 것**도 파일을 지우는 것과 같은 self-disable이다(4차 리뷰 P1-3-A).
  // 그래서 이번 push의 base에 있던 매핑까지 합쳐서 scope를 잡는다 — 행을 지운 그 push에서는
  // 여전히 옛 매핑이 적용되고, 연동을 정말 끊으려면 lock/선언까지 정리해야 한다.
  // 최초 연동(base에도 행이 없음)과 "있던 매핑을 없앤 상태"는 이렇게 자연히 구분된다.
  const tipEntries = parseSpecMapText(mapText)
  const baseSha = resolveBaseSha(localSha, remoteSha, remoteName)
  const baseEntries = parseSpecMapText(showAtBase(baseSha, SNAPSHOT_PATHS.map) ?? '')
  const entries = mergeMapEntries(baseEntries, tipEntries)

  // 단, **기준에서 이미 사라진 문서**의 행을 정리하는 것은 정상 절차다(삭제 정산 후 뒷정리).
  // 이걸 막으면 기획 폐기 → settle → 매핑 정리라는 정규 흐름이 push에서 걸린다(자체 검토).
  // 살아 있는 사양의 매핑을 지우는 것만 self-disable로 본다.
  const stillLocked = (spec) => Object.values(lock.sources).some((recorded) => recorded?.files?.[spec])
  const removedMappings = baseEntries
    .filter((base) => !tipEntries.some((tip) => tip.spec === base.spec))
    .filter((base) => stillLocked(base.spec))
  if (removedMappings.length > 0) {
    result.blockedReasons.push(
      ...removedMappings.map((entry) => `매핑 제거: ${entry.spec} 행이 이번 push에서 사라졌습니다(기준에는 아직 살아 있는 사양입니다) — 복원하거나, 대상이 아니라면 (사양 없음) 판정으로 남기세요.`),
    )
  }
  if (entries.length === 0) return result

  // 매핑된 대표 문서가 기준(lock)에서 사라지면 그 문서는 어떤 검사에도 안 걸린다(4차 리뷰 P1-3-B).
  // schema는 정상이므로 lock schema 검증으로는 못 잡는다 — 매핑↔기준 대응을 직접 본다.
  for (const entry of tipEntries) {
    const owners = Object.entries(lock.sources).filter(([, recorded]) => recorded?.files?.[entry.spec])
    if (owners.length === 0) {
      result.blockedReasons.push(`기준 누락: 매핑된 ${entry.spec} 이(가) spec-lock.json에 없습니다 — 기준에서 빠진 문서는 변경 검사를 받지 않습니다.`)
    }
  }

  // 3) 매핑 커버리지: 이미 매핑된 영역에 새 파일이 들어왔는데 매핑도 판정도 없으면 차단한다.
  // 매핑 기록 누락은 "그 코드가 앞으로 어떤 게이트에도 안 걸리는" 사각지대를 만들기 때문에,
  // 문서 규칙이 아니라 실행 게이트로 막는다(0.2.101).
  const exemptions = parseSpecMapExemptions(mapText ?? '')
  const uncovered = analyzeMappingCoverage(collectAddedOrModifiedFiles(localSha, remoteSha, remoteName), entries, exemptions)
  if (uncovered.length > 0) {
    result.uncovered = uncovered
    result.blockedReasons.push(
      ...uncovered.map((filePath) => `매핑 누락: ${filePath} — 매핑된 영역에 새로 추가됐는데 spec-map에 기록이 없습니다.`),
    )
  }

  // 4) push 범위 → 매핑된 문서 스코프.
  const changedFiles = collectChangedFiles(localSha, remoteSha, remoteName)
  const scope = mappedDocsForFiles(changedFiles, entries)
  if (scope.length === 0) return result

  // 4) 최신 기획 확보(네트워크) — 여기"만" fail-open.
  for (const source of sources) {
    if (fetchedBySource.has(source.id)) continue
    try {
      fetchedBySource.set(source.id, { ...fetchLatestCommit(source), source })
    } catch (error) {
      fetchedBySource.set(source.id, { failed: String(error.message ?? error).split('\n')[0] })
    }
  }

  // 5) drift: fetch된 git 객체 내용 vs tip lock.
  //
  // 매핑 표에는 대표 문서(`features/로그인.md`) 한 줄만 있어도 된다 — 같은 화면 기획의 HTML은
  // 여기서 자동으로 포함된다. 그래야 "와이어프레임만 바뀐 변경"이 조용히 통과하지 않는다.
  for (const entry of scope) {
    for (const [sourceId, recorded] of Object.entries(lock.sources)) {
      const fetchedForIndex = fetchedBySource.get(sourceId)
      const links = recorded?.screenLinks ?? normalizeScreenLinks(sources.find((item) => item.id === sourceId)) ?? []
      const targets = expandMappedSpecs([entry.spec], safeScreenIndex(fetchedForIndex, links))
      if (!targets.some((rel) => recorded?.files?.[rel])) continue

      const fetched = fetchedBySource.get(sourceId)
      // 스냅샷의 compare-and-swap 기준값(baseSha)은 tip lock에서 온다. 없으면 settle이
      // 그 스냅샷을 낡은 것으로 보고 거부한다(게이트 안내 → settle 실패의 원인).
      if (fetched && !fetched.failed) fetched.lockedFiles = recorded?.files ?? {}
      if (!fetched || fetched.failed) {
        result.failOpenNote = `[spec-gate] 기획 최신 확인 불가(${fetched?.failed ?? '소스 미확보'}) — 로컬 기준으로 통과합니다.`
        continue
      }

      for (const rel of targets) {
        const lockedDoc = recorded?.files?.[rel]
        const latest = gitShowText(fetched.dir, fetched.commit, rel)
        if (!lockedDoc) {
          // 기준에 짝이 없는데 원격에는 있다 = 화면 기획이 반쪽으로 정산된 상태. 통과시키면
          // 그 화면의 와이어프레임은 영영 검사 대상이 되지 않는다.
          if (latest !== null) result.drift.push({ spec: rel, kind: '기준 누락', codePaths: entry.codePaths })
          continue
        }
        result.checkedDocs += 1
        if (latest === null) {
          result.drift.push({ spec: rel, kind: '삭제', codePaths: entry.codePaths })
        } else if (sha256Text(latest) !== lockedDoc.sha) {
          result.drift.push({ spec: rel, kind: '변경', codePaths: entry.codePaths })
        }
      }
    }
  }

  if (result.drift.length > 0) {
    result.blockedReasons.push(...result.drift.map((item) => (
      item.kind === '기준 누락'
        ? `기획 문서 쌍 누락: ${item.spec} 이(가) 기준에 없습니다 — 화면 기획은 MD와 HTML을 함께 정산해야 합니다 (이 코드의 사양: ${item.codePaths.join(', ')})`
        : `기획서 ${item.kind}: ${item.spec} — 이 코드의 사양입니다: ${item.codePaths.join(', ')}`
    )))
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
