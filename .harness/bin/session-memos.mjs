#!/usr/bin/env node
// 개인 세션 메모(0.2.153, #48 A): next-session-reminder.md · active-context.md 는 그 개발자의 대화를
// 다음 대화로 넘기는 메모다. 팀 저장소에 올리면 개발자끼리 섞이고, 브랜치를 바꿀 때 메모가 브랜치를
// 따라가고, 작업 커밋마다 딸려 들어가 머지 때 부딪힌다(clubadm 실측: B 원칙 뒤 커밋 3개 중 1개).
// 그래서 .gitignore 에 든 .harness/session/local/ 에 둔다.
//
// 옛 자리(.harness/session/<이름>)의 파일은 **건드리지 않고 복사만** 한다. 옛 파일을 이 릴리스에서 지우면
// 그 파일을 고치던 중인 팀원의 pull 이 "로컬 변경이 덮인다"로 멈춘다. 이 릴리스 뒤로는 아무도 옛 파일을
// 고치지 않으므로, 지우는 것은 다음 업데이트가 한다(init 의 retireLegacySessionMemos).
//
// 부르는 곳: 설치·업데이트(init), pull 직후(post-merge), 세션 시작(Claude 훅), harness context(모든 에이전트).
// 어느 자리에서든 실패해도 그 일을 막지 않는다 — 옮기지 못하면 옛 파일이 그대로 남아 있을 뿐이다.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

// 심볼릭 링크는 옮기지도, 링크 자리에 쓰지도 않는다 — 저장소에 든 링크를 따라가면 링크 너머의 파일을 읽어 메모 자리에 복사하고,
// 그 내용은 세션 시작 때 에이전트 컨텍스트에 찍힌다(설치기의 isRegularFile 과 같은 경계).
function isSymlink(abs) {
  try {
    return lstatSync(abs).isSymbolicLink()
  } catch {
    return false
  }
}

// 설치 루트 아래 경로 구성요소(.harness → session → local → 파일) 중 하나라도 링크면 참(Codex 2R #2). 잎만 보면 상위 폴더가
// 링크일 때 그 너머에 쓰거나 거기서 읽는다. 설치기·훅·여기가 같은 판정을 쓴다.
export function pathHasSymlinkComponent(root, rel) {
  const parts = rel.split('/').filter(Boolean)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    if (isSymlink(current)) return true
  }
  return false
}
import { fileURLToPath } from 'node:url'

export const LOCAL_SESSION_DIR = '.harness/session/local'
export const SESSION_MEMOS = ['next-session-reminder.md', 'active-context.md']

export const localMemoPath = (name) => `${LOCAL_SESSION_DIR}/${name}`
export const legacyMemoPath = (name) => `.harness/session/${name}`

// `<ref>:<경로>` 는 저장소 루트 기준이라 하위 폴더 설치(모노레포 안 한 서비스)에서 어긋난다 — `./` 를 붙이면 cwd 기준이다.
function gitShow(root, ref, rel) {
  try {
    return execFileSync('git', ['show', `${ref}:./${rel}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// restoreFromRef: 옛 파일이 작업 트리에 없을 때 꺼내 올 커밋. pull 직후에는 ORIG_HEAD(머지 전 내 상태)다 —
// 옛 파일을 지우는 커밋과 이 릴리스를 한 번에 받은 팀원의 메모를 그 자리에서 되살린다.
// skip: 옮기지 않을 이름. 설치기가 "하네스가 심은 견본 그대로(손대지 않음)"로 판정한 옛 파일은 옮기지 않는다 —
// 옮겨 봐야 견본이고, 새 자리에는 새 견본이 생긴다.
export function migrateSessionMemos(root, { restoreFromRef = null, dryRun = false, skip = [] } = {}) {
  const result = { moved: [], restored: [] }
  for (const name of SESSION_MEMOS) {
    if (skip.includes(name)) continue
    // 링크 너머에는 쓰지도 읽지도 않는다(Codex 1R #1, 2R #2): 새 자리·옛 자리의 경로 구성요소(.harness·session·local·파일) 중
    // 하나라도 링크면 이 이름은 건너뛴다 — 복사도, pull 뒤 되살리기도.
    if (pathHasSymlinkComponent(root, localMemoPath(name)) || pathHasSymlinkComponent(root, legacyMemoPath(name))) continue
    const localAbs = join(root, localMemoPath(name))
    if (existsSync(localAbs)) continue

    const legacyAbs = join(root, legacyMemoPath(name))
    if (existsSync(legacyAbs)) {
      if (!dryRun) {
        mkdirSync(dirname(localAbs), { recursive: true })
        copyFileSync(legacyAbs, localAbs)
      }
      result.moved.push(name)
      continue
    }

    if (!restoreFromRef) continue
    const content = gitShow(root, restoreFromRef, legacyMemoPath(name))
    if (content === null) continue
    if (!dryRun) {
      mkdirSync(dirname(localAbs), { recursive: true })
      writeFileSync(localAbs, content)
    }
    result.restored.push(name)
  }
  return result
}

export function describeMigration(result) {
  const lines = []
  if (result.moved.length) {
    lines.push(`[harness] 개인 메모를 ${LOCAL_SESSION_DIR}/ 로 옮겼습니다(git 에 올라가지 않는 자리): ${result.moved.join(', ')}`)
  }
  if (result.restored.length) {
    lines.push(`[harness] 이번 pull 이 지운 개인 메모를 머지 전 상태에서 되살렸습니다 → ${LOCAL_SESSION_DIR}/: ${result.restored.join(', ')}`)
  }
  return lines
}

function main(argv) {
  const rootIndex = argv.indexOf('--root')
  const root = rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : process.cwd()
  const restoreFromRef = argv.includes('--after-merge') ? 'ORIG_HEAD' : null
  try {
    for (const line of describeMigration(migrateSessionMemos(root, { restoreFromRef }))) console.log(line)
  } catch (error) {
    console.log(`[harness] 개인 메모 옮기기 실패(작업에는 영향 없음): ${error.message}`)
  }
}

// 직접 실행 판정: ESM 로더는 심볼릭 링크를 실제 경로로 푼다(/var → /private/var) — 양쪽을 realpath 로 맞춘다(decision-log-lint.mjs 와 같다).
function samePathLoose(a, b) {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return basename(a) === basename(b)
  }
}

if (process.argv[1] && samePathLoose(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2))
}
