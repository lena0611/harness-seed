#!/usr/bin/env node
// 시드 모드 전용 원격 동기화 가드 (비차단).
//
// 목적: harness-seed 본체는 GitHub(origin)와 GitLab(company) 두 원격을 항상 같은
//       커밋으로 맞춰야 한다. 한쪽에만 push해 미러가 뒤처지는 사고를 막기 위한 알림.
//
// 동작 원칙:
//  - .harness-seed-mode 마커가 있을 때만 동작한다. 소비자 프로젝트에는 이 마커가
//    없으므로(패키지 files 목록에서 제외됨) 아무 일도 하지 않는다. = consumer no-op.
//  - 네트워크를 쓰지 않는다. 캐시된 remote-tracking ref(refs/remotes/*)만 비교하므로
//    자격증명 프롬프트나 push 지연을 만들지 않는다.
//  - 절대 push를 막지 않는다(항상 exit 0). 어긋남이 의심되면 stderr로 알림만 출력한다.
//
// 사용:
//  - pre-push hook에서 `node .harness/bin/check-remote-sync.mjs "$@"`로 호출하면,
//    첫 인자(현재 push 대상 원격)는 "지금 올리는 중"이므로 비교에서 제외한다.
//  - 인자 없이 직접 실행하면 모든 원격을 로컬 HEAD와 비교한다.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function safe(fn, fallback = null) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function cachedDefaultRef(remote) {
  // 각 원격의 캐시된 기본 브랜치(refs/remotes/<remote>/HEAD)를 우선 사용한다.
  const symbolic = safe(() => git(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]))
  if (symbolic) {
    return symbolic
  }
  // HEAD 심볼릭 ref가 없으면 흔한 기본 브랜치명을 시도한다.
  for (const branch of ['main', 'master']) {
    const ref = `refs/remotes/${remote}/${branch}`
    if (safe(() => git(['rev-parse', '--verify', '--quiet', ref]))) {
      return ref
    }
  }
  return null
}

function main() {
  // 1) 시드 모드가 아니면(소비자 프로젝트) 즉시 종료한다.
  if (!fs.existsSync(path.join(repoRoot, '.harness-seed-mode'))) {
    return
  }

  // 2) pre-push가 넘겨준 push 대상 원격은 지금 올리는 중이므로 제외한다.
  const pushingRemote = (process.argv[2] || '').trim()

  const remotes = safe(() => git(['remote']).split(/\r?\n/).filter(Boolean), [])
  if (remotes.length < 2) {
    return // 미러가 둘 이상일 때만 의미가 있다.
  }

  const head = safe(() => git(['rev-parse', 'HEAD']))
  if (!head) {
    return
  }

  const diverged = []
  for (const remote of remotes) {
    if (remote === pushingRemote) {
      continue
    }
    const ref = cachedDefaultRef(remote)
    if (!ref) {
      continue
    }
    const tip = safe(() => git(['rev-parse', ref]))
    if (!tip || tip === head) {
      continue
    }
    diverged.push({ remote, branch: ref.replace(`refs/remotes/${remote}/`, ''), tip: tip.slice(0, 9) })
  }

  if (diverged.length === 0) {
    return
  }

  console.error('')
  console.error('⚠ [harness] 원격 동기화 확인 (seed-mode · 비차단)')
  console.error(`  로컬 HEAD: ${head.slice(0, 9)}`)
  for (const d of diverged) {
    console.error(`  - ${d.remote} (${d.branch}) 마지막 동기 tip ${d.tip} → 로컬과 다름`)
  }
  console.error('  GitHub와 GitLab을 모두 맞추세요. 예) git push <remote> <branch>[:<remote-branch>]')
  console.error('  (캐시된 remote-tracking 기준이라 fetch 이후 상태일 수 있고, push를 막지는 않습니다.)')
  console.error('')
}

try {
  main()
} catch {
  // 가드는 어떤 경우에도 push를 막지 않는다.
}

process.exit(0)
