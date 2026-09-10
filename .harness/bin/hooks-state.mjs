#!/usr/bin/env node
// 하네스 git 훅의 "켜짐" 판정과 브랜치 무관 래퍼의 정본 (0.2.146, smartscore-backend/common #28).
//
// 왜 래퍼인가: core.hooksPath는 clone 전역 설정이고 .githooks/는 브랜치 소속 파일이다. 예전 방식
// (core.hooksPath=.githooks)은 하네스 없는 브랜치로 checkout하면 폴더가 사라져 git이 훅 파일을
// 못 찾고 **아무 말 없이** 통과했다 — 사흘간 훅 0개인 채 커밋이 이어졌다(제보). 그래서 훅 자리는
// 브랜치와 무관한 clone 안(git 기본 훅 폴더 <공통 .git>/hooks)에 두고, 그 자리의 래퍼가 현재 브랜치의
// .githooks/<훅>에 위임한다. 브랜치에 .githooks가 없으면 이전 훅 체인만 돌리고 한 줄 알린 뒤 통과.
//
// 이 파일은 install-hooks / uninstall-harness / run-previous-hook / policy-harness / 세션·프롬프트 훅이
// 함께 쓴다 — 판정 규칙과 경로 해석을 한 곳에 두어 "설치됨"의 정의가 갈리지 않게 한다.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WRAPPER_MARKER = 'harness-hook-wrapper'
export const WRAPPER_VERSION = 2
// git 클라이언트 훅 전부(githooks(5)). 예전 방식(core.hooksPath=.githooks)은 이름을 가리지 않고 .githooks/*를
// 실행했으므로, 래퍼도 같은 범위를 덮어야 업데이트로 기존 팀 훅이 조용히 꺼지지 않는다(외부 리뷰 P2-3).
// 제외: 서버 측(pre-receive·update·post-receive·post-update·proc-receive·push-to-checkout), 설정으로 켜는
// fsmonitor-watchman, p4-*, 그리고 ref 갱신마다 불려 비용만 큰 reference-transaction.
export const WRAPPED_HOOKS = [
  'applypatch-msg', 'pre-applypatch', 'post-applypatch',
  'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-auto-gc', 'post-rewrite',
  'post-index-change', 'sendemail-validate',
]
export const HARNESS_HOOKS_DIR = '.githooks'
// 0.2.145 이전 설치가 core.hooksPath에 넣던 값 — 보이면 "예전 방식"으로 판정해 래퍼로 갱신한다.
export const LEGACY_HOOKS_PATH = '.githooks'
// 래퍼 자리에 원래 있던 프로젝트 훅을 옮겨 두는 폴더(공통 .git의 훅 폴더 안). 체인으로 계속 실행된다.
export const PREV_DIR_NAME = 'harness-prev'
// harness.previousHooksPath에 적는 보관함 값. `.git/` 접두는 "공통 .git 기준"이라는 뜻이다 — 연결 워크트리의
// .git은 파일이라 작업 폴더 기준으로 풀면 못 찾는다(외부 리뷰 P1-1). 해석은 resolveHooksPath()만 한다.
export const PARKED_HOOKS_PATH = `.git/hooks/${PREV_DIR_NAME}`
// 옛 마커: legacy 파일이 .git/hooks에 있었다는 표시로 previousHooksPath에 적던 값(0.2.131~0.2.145).
export const OLD_DEFAULT_MARKER = '.git/hooks'
// 실행 중인 래퍼 토큰 목록(`<공통 .git>|<훅 이름>;…`)을 나르는 환경변수. 같은 저장소의 같은 훅이 체인 안에서 다시 불리면
// 재진입(→ 보관 원본만 실행, 순환 없음. 외부 리뷰 P1-3). 다른 훅 이름의 호출(pre-merge-commit → `git hook run pre-commit`)은
// 정상 실행이라 막지 않는다(외부 리뷰 2차 P2).
export const WRAPPER_ACTIVE_ENV = 'HARNESS_HOOK_WRAPPER_ACTIVE'
// 전역 core.hooksPath를 덮기 위해 하네스가 로컬에 적은 값의 기록. 로컬 값이 이 기록과 같으면 "우리가 쓴 것"이라
// 재설치가 교정하고 uninstall이 지운다(외부 리뷰 2차 P1). 다르면 팀의 설정(husky 등)이라 이전 훅으로 체인한다.
export const OVERRIDE_KEY = 'harness.hooksPathOverride'

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

export function readGitConfig(repoRoot, key) {
  try {
    return git(repoRoot, ['config', '--get', key])
  } catch {
    return ''
  }
}

// 저장소 로컬(.git/config)에 적힌 값만. 전역·시스템에서 오는 유효 값과 구분해야 한다(외부 리뷰 P2-2).
export function readLocalGitConfig(repoRoot, key) {
  try {
    return git(repoRoot, ['config', '--local', '--get', key])
  } catch {
    return ''
  }
}

export function isGitRepository(repoRoot) {
  try {
    return git(repoRoot, ['rev-parse', '--is-inside-work-tree']) === 'true'
  } catch {
    return false
  }
}

// 공통 .git(절대 경로). 연결 워크트리에서도 주 저장소의 .git을 가리킨다.
export function gitCommonDir(repoRoot) {
  try {
    return path.resolve(repoRoot, git(repoRoot, ['rev-parse', '--git-common-dir']))
  } catch {
    return path.join(repoRoot, '.git')
  }
}

// git의 **기본** 훅 폴더 = <공통 .git>/hooks. `rev-parse --git-path hooks`는 core.hooksPath를 따라가므로 쓰지 않는다.
export function gitHooksDir(repoRoot) {
  return path.join(gitCommonDir(repoRoot), 'hooks')
}

// harness.previousHooksPath(하네스 내부 표식) → 절대 경로. `.git/…`는 **공통 .git 기준**(보관함 약속), 절대 경로는
// 그대로, 나머지는 작업 폴더 기준. core.hooksPath에는 쓰지 않는다 — git은 이 약속을 모른다(외부 리뷰 2차 P1).
export function resolveHooksPath(repoRoot, value) {
  if (!value) return ''
  if (path.isAbsolute(value)) return value
  if (value === '.git' || value.startsWith('.git/')) return path.join(gitCommonDir(repoRoot), value.slice(4).replace(/^\//, ''))
  return path.resolve(repoRoot, value)
}

// core.hooksPath 값을 **git이 푸는 방식**으로 → 절대 경로. 상대 경로는 훅이 실행되는 작업 폴더(워크트리 루트) 기준이다.
// 연결 워크트리의 `.git`은 파일이라 `.git/hooks` 같은 상대 값은 거기서 아무것도 가리키지 않는다.
export function resolveGitHooksPath(repoRoot, value) {
  if (!value) return ''
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value)
}

// git이 이 작업 폴더에서 실제로 보는 훅 폴더.
export function effectiveGitHooksDir(repoRoot, hooksPathValue) {
  return hooksPathValue ? resolveGitHooksPath(repoRoot, hooksPathValue) : gitHooksDir(repoRoot)
}

export function samePath(a, b) {
  if (!a || !b) return false
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return path.resolve(a) === path.resolve(b)
  }
}

export function relToRepo(repoRoot, abs) {
  const rel = path.relative(repoRoot, abs)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : abs
}

// legacy 자동 갱신을 실제로 수행하는 것은 Claude 세션 시작 훅 하나다(#29 ①, multisite 0.2.146 리포트).
export const CLAUDE_SESSION_START_HOOK = '.claude/hooks/session-start-reminder.sh'
// 프로젝트 스코프 settings 후보. 훅 등록은 두 파일이 **병합**된다(local이 shared를 덮지 않는다) — 어느 쪽에 있어도 배선이다.
export const CLAUDE_SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json']

// 이 clone에서 legacy가 스스로 래퍼로 갱신되는지. **틀리는 방향이 비대칭이다**: "자동으로 된다"고 잘못 말하면 개발자가
// 아무것도 안 해 훅이 예전 배선에 남고, 하네스 없는 브랜치로 옮기는 순간 검사가 조용히 사라진다(#28 그 장면).
// 반대(자동인데 직접 치라고 말하기)는 성가실 뿐이다. 그래서 조금이라도 불확실하면 false를 낸다(적대적 리뷰 반영):
//   - 훅 파일이 없거나 실행 권한이 없으면 false (settings의 명령이 맨 경로 실행이라 권한이 없으면 죽는다)
//   - `disableAllHooks: true`가 어느 후보 파일에든 있으면 false (등록이 남아 있어도 훅이 전부 안 돈다)
//   - 등록이 `type: "command"`가 아니거나, 주석(`#`)으로 막혔거나, matcher가 세션 시작(startup)을 안 덮으면 false
// 탐지할 수 없는 것 하나: 이 저장소가 세션 주 폴더가 아니면 프로젝트 settings 자체가 읽히지 않는다(CLAUDE.md "세션 주 폴더
// 확인"). `CLAUDE_PROJECT_DIR`는 훅이 부를 때만 실려 이 경로에서는 알 수 없으므로, 판정이 아니라 **문구에 조건**을 붙인다.
export function sessionStartMigrationWired(repoRoot) {
  const hookPath = path.join(repoRoot, CLAUDE_SESSION_START_HOOK)
  try {
    if (!fs.statSync(hookPath).isFile()) return false
    fs.accessSync(hookPath, fs.constants.X_OK)
  } catch {
    return false
  }
  const hookName = path.basename(CLAUDE_SESSION_START_HOOK)
  const parsedFiles = []
  for (const settings of CLAUDE_SETTINGS_FILES) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, settings), 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsedFiles.push(parsed)
    } catch {
      // 후보 파일이 없거나 JSON이 깨졌으면 건너뛴다 — 판정은 닫힌 쪽에 머문다.
    }
  }
  if (parsedFiles.some((parsed) => parsed.disableAllHooks === true)) return false
  for (const parsed of parsedFiles) {
    const groups = parsed.hooks ? parsed.hooks.SessionStart : null
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!coversSessionStartup(group?.matcher)) continue
      for (const hook of (Array.isArray(group?.hooks) ? group.hooks : [])) {
        if (!hook || hook.type !== 'command' || typeof hook.command !== 'string') continue
        if (hook.command.trim().startsWith('#')) continue
        if (hook.command.includes(hookName)) return true
      }
    }
  }
  return false
}

// SessionStart matcher는 startup/resume/clear/compact/fork 중에서 고르고, 생략하면 전부를 뜻한다. "다음 세션 시작 때"를
// 약속하려면 startup이 덮여야 한다 — `matcher: "compact"` 만 걸린 등록은 새 세션에서 돌지 않는다.
function coversSessionStartup(matcher) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true
  if (typeof matcher === 'string') return matcher.includes('startup')
  if (Array.isArray(matcher)) return matcher.some((entry) => typeof entry === 'string' && entry.includes('startup'))
  return false
}

export function isWrapper(file) {
  try {
    if (!fs.statSync(file).isFile()) return false
    return fs.readFileSync(file, 'utf8').includes(WRAPPER_MARKER)
  } catch {
    return false
  }
}

export function wrapperSource() {
  return `#!/bin/sh
# ${WRAPPER_MARKER} v${WRAPPER_VERSION} — 하네스가 설치한 위임 래퍼 (0.2.146). 손으로 고치지 마세요: hooks:install이 다시 씁니다.
# 이 파일은 clone 전용(공통 .git/hooks)이라 브랜치·워크트리를 바꿔도 남는다. 현재 브랜치의 .githooks/<훅>이 있으면
# 그것을 실행하고(그 훅이 이전 훅 체인까지 처리), 없으면 이전 훅 체인(harness.previousHooksPath)만 돌린 뒤 통과한다.
name=\$(basename "\$0")
root=\$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
common=\$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
case "\$common" in /*) ;; *) common="\$root/\$common" ;; esac
resolve_path() {
  case "\$1" in
    /*) printf '%s' "\$1" ;;
    .git) printf '%s' "\$common" ;;
    .git/*) printf '%s/%s' "\$common" "\${1#.git/}" ;;
    *) printf '%s/%s' "\$root" "\$1" ;;
  esac
}
# 재진입 판정은 "같은 저장소(공통 .git)의 같은 훅 이름" 토큰으로만 한다. 하네스 체인(이전 훅 → husky 등)이 이 파일을 같은
# 이름으로 다시 부르면 "옛 .git/hooks 원본을 부른다"는 뜻(0.2.145 이전 안내)이라 보관 원본만 실행하고 하네스로 되돌아가지
# 않는다 — 순환이 생기지 않는다. 다른 훅 이름의 호출(pre-merge-commit → git hook run pre-commit)은 정상 실행이다.
token="\$common|\$name"
active="\${${WRAPPER_ACTIVE_ENV}:-}"
case ";\$active;" in
  *";\$token;"*)
    parked="\$common/hooks/${PREV_DIR_NAME}/\$name"
    if [ -f "\$parked" ]; then
      if [ -x "\$parked" ]; then exec "\$parked" "\$@"; else exec sh "\$parked" "\$@"; fi
    fi
    exit 0 ;;
esac
export ${WRAPPER_ACTIVE_ENV}="\${active:+\$active;}\$token"
hook="\$root/${HARNESS_HOOKS_DIR}/\$name"
if [ -f "\$hook" ]; then
  if [ -x "\$hook" ]; then exec "\$hook" "\$@"; else exec sh "\$hook" "\$@"; fi
fi
prev=\$(git config --get harness.previousHooksPath 2>/dev/null || true)
if [ -n "\$prev" ]; then
  prevhook="\$(resolve_path "\$prev")/\$name"
  if [ -f "\$prevhook" ] && ! grep -q '${WRAPPER_MARKER}' "\$prevhook" 2>/dev/null; then
    if [ -x "\$prevhook" ]; then "\$prevhook" "\$@"; else sh "\$prevhook" "\$@"; fi || exit \$?
  fi
fi
case "\$name" in
  pre-commit|pre-push)
    printf '[harness] 이 브랜치에는 %s/%s 이 없어 하네스 검사 없이 진행합니다 (하네스가 있는 브랜치를 합치면 다시 켜집니다).\\n' "${HARNESS_HOOKS_DIR}" "\$name" >&2 ;;
esac
exit 0
`
}

// 판정: installed(래퍼 방식 켜짐 — 유효 core.hooksPath가 비어 있거나 기본 훅 폴더를 가리킴) · legacy(예전
// core.hooksPath=.githooks) · off(꺼짐 — 미설치, 또는 husky 등 다른 도구가 core.hooksPath를 가져간 상태) ·
// optout(이 PC의 명시적 끄기) · nogit
export function detectHooksState(repoRoot) {
  if (!isGitRepository(repoRoot)) return { state: 'nogit', hooksPath: '', localHooksPath: '', hooksDir: '', missing: [], previousHooksPath: '', hooksPathOverride: false, autoMigrates: false }
  const hooksPath = readGitConfig(repoRoot, 'core.hooksPath')
  const localHooksPath = readLocalGitConfig(repoRoot, 'core.hooksPath')
  const autoEnable = readGitConfig(repoRoot, 'harness.hooksAutoEnable')
  const hooksDir = gitHooksDir(repoRoot)
  const missing = WRAPPED_HOOKS.filter((name) => !isWrapper(path.join(hooksDir, name)))
  // git이 실제로 보는 폴더로 판정한다(외부 리뷰 2차 P1). 상대 `.git/hooks`는 연결 워크트리에서 아무것도 가리키지 않으므로
  // 그 경우 installed가 아니라 off다 — 세션 시작이 재설치해 절대 경로로 교정한다.
  const usesDefaultDir = !hooksPath || samePath(effectiveGitHooksDir(repoRoot, hooksPath), hooksDir)
  const recordedOverride = readLocalGitConfig(repoRoot, OVERRIDE_KEY)
  let state = 'off'
  if (hooksPath === LEGACY_HOOKS_PATH) state = 'legacy'
  else if (usesDefaultDir && !missing.includes('pre-commit') && !missing.includes('pre-push')) state = 'installed'
  if (autoEnable === 'false' && state !== 'installed') state = 'optout'
  return {
    state, hooksPath, localHooksPath, hooksDir, missing,
    previousHooksPath: readGitConfig(repoRoot, 'harness.previousHooksPath'),
    hooksPathOverride: Boolean(localHooksPath) && localHooksPath === recordedOverride,
    // 이 clone이 legacy를 스스로 갱신하는지(#29 ①) — 안내 문구를 환경에 맞춰 가르는 재료다.
    autoMigrates: sessionStartMigrationWired(repoRoot),
  }
}

// 선언값이 순진하게 읽히는 곳과 실제로 푸는 곳이 다를 때만 ` → 해석값`을 돌려준다. 같으면 빈 문자열(화살표 없음).
function previousHooksPathReveal(repoRoot, declared) {
  if (!declared) return ''
  const resolved = resolveHooksPath(repoRoot, declared)
  const naive = resolveGitHooksPath(repoRoot, declared)
  if (samePath(resolved, naive)) return ''
  return ` → ${relToRepo(repoRoot, resolved)}`
}

// 직접 실행 판정: ESM 로더는 심볼릭 링크를 실제 경로로 푼다(/var → /private/var 등)라 argv[1]과 단순 비교하면
// 임시 폴더에서 어긋난다 — 양쪽을 realpath로 맞춰 비교하고, 못 풀면 파일명으로 판단한다.
function samePathLoose(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return path.basename(a) === path.basename(b)
  }
}
const isMain = Boolean(process.argv[1]) && samePathLoose(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))
if (isMain) {
  const repoRoot = process.env.HARNESS_REPO_ROOT || process.cwd()
  const info = detectHooksState(repoRoot)
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(info))
  } else if (process.argv.includes('--explain')) {
    const label = {
      installed: '켜짐 (브랜치 무관 래퍼)',
      // #29 ①: 세션 시작 훅이 배선된 프로젝트는 아무것도 안 해도 다음 세션에서 갱신된다 — 공지와 같은 말을 해야 한다.
      legacy: info.autoMigrates
        ? '예전 방식 (core.hooksPath=.githooks) — 이 저장소를 주 폴더로 여는 다음 Claude 세션에서 자동 갱신됩니다 (지금 바꾸려면 hooks:install)'
        : '예전 방식 (core.hooksPath=.githooks) — hooks:install 로 갱신하세요',
      // off 도 legacy 와 같은 배선이 켜 준다(세션 시작 훅은 둘 다 처리한다) — 한쪽만 갈라 두면 채널이 어긋난다.
      off: info.autoMigrates
        ? '꺼짐 — 이 저장소를 주 폴더로 여는 다음 Claude 세션에서 자동으로 켜집니다 (지금 켜려면 hooks:install)'
        : '꺼짐',
      optout: '꺼짐 (이 PC의 명시적 선택: harness.hooksAutoEnable=false)',
      nogit: 'git 저장소 아님',
    }[info.state]
    console.log(`하네스 git 훅: ${label}`)
    if (info.state !== 'nogit') {
      console.log(`  git 훅 폴더: ${relToRepo(repoRoot, info.hooksDir)}`)
      console.log(`  core.hooksPath: ${info.hooksPath ? `${info.hooksPath}${info.hooksPathOverride ? ' (전역 설정을 덮는 로컬 명시 — 기본 훅 폴더)' : ''}` : '(해제 — git 기본 폴더 사용)'}`)
      console.log(`  래퍼 없는 훅: ${info.missing.length ? info.missing.join(', ') : '없음'}`)
      // 선언값 → 해석값은 둘이 **다른 곳을 가리킬 때만** 의미가 있다(#29 참고 표시). 비교는 문자열이 아니라 위치로 한다
      // (적대적 리뷰 P3-4): 문자열 비교로는 `.husky/_/`(뒤 슬래시)·`./.husky/_`·`.husky//_` 처럼 같은 곳을 가리키는 변종이
      // 그대로 두 번 찍혔다 — 실제 husky 설치 경로에서 나오는 값이다(install-hooks는 git config 값을 그대로 저장한다).
      // 화살표가 남아야 하는 경우는 `.git/…` 보관함 값이다: 공통 .git 기준이라 연결 워크트리에서 순진한 해석과 갈린다.
      console.log(`  이전 훅 체인(harness.previousHooksPath): ${info.previousHooksPath || '없음'}${previousHooksPathReveal(repoRoot, info.previousHooksPath)}`)
      console.log(`  이 브랜치의 ${HARNESS_HOOKS_DIR}/: ${fs.existsSync(path.join(repoRoot, HARNESS_HOOKS_DIR)) ? '있음' : '없음 — 커밋·푸시 때 한 줄 알리고 통과합니다'}`)
    }
  } else {
    console.log(info.state)
  }
}
