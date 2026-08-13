#!/usr/bin/env node

// 하네스 본체 릴리스 공지 payload 생성기 (시드 저장소 전용 — 소비자로 배포되지 않는다).
//
// CHANGELOG.md 최상단 버전 절을 꺼내 Mattermost incoming webhook에 그대로 POST 가능한
// JSON({text})으로 만든다. 문구를 CI yaml이 아니라 도구가 소유하는 이유는 broadcast와
// 같다(0.2.115): yaml 속 문자열 조립은 이스케이프 지뢰밭이고, 회귀로 잠글 수 없다.
//
// 사용: node scripts/release-notice.mjs --json [--file <changelog>] [--tag <vX.Y.Z>]
//  - --json 없이 부르면 사람이 읽는 평문을 낸다.
//  - 실패(파일 없음, 절 못 찾음)는 조용히 빈 출력이 아니라 exit 1이다 — CI에서는
//    allow_failure로 릴리스를 막지 않되 주황 배지로 보이게 한다(비차단 ≠ 무음).

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const jsonOutput = args.includes('--json')
function argValue(flag) {
  const at = args.indexOf(flag)
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null
}

const changelogPath = argValue('--file') ?? path.join(repoRoot, 'CHANGELOG.md')
const MAX_BODY_CHARS = 3500

function fail(message) {
  console.error(`release-notice: ${message}`)
  process.exit(1)
}

let changelog
try {
  changelog = fs.readFileSync(changelogPath, 'utf8')
} catch {
  fail(`CHANGELOG를 읽을 수 없습니다: ${changelogPath}`)
}

// 최상단 절: "## <버전> - <날짜>" 부터 다음 "## " 직전까지.
const sectionMatch = changelog.match(/^## (\S+) - (\S+)\s*\n([\s\S]*?)(?=\n## |$)/m)
if (!sectionMatch) fail('CHANGELOG에서 버전 절을 찾지 못했습니다 ("## <버전> - <날짜>" 형식)')
const [, version, date, rawBody] = sectionMatch

const tag = argValue('--tag') ?? process.env.CI_COMMIT_TAG ?? `v${version}`
// 태그와 CHANGELOG 최상단이 어긋나면 공지가 거짓말이 된다 — 조용히 보내지 않고 멈춘다
// (릴리스 절차상 태그는 기록 커밋 뒤에 달리므로, 어긋남은 절차 위반의 신호다).
if (tag.replace(/^v/, '') !== version) {
  fail(`태그(${tag})와 CHANGELOG 최상단(${version})이 다릅니다 — 기록을 먼저 맞추세요`)
}

let body = rawBody.trim()
if (body.length > MAX_BODY_CHARS) {
  body = `${body.slice(0, MAX_BODY_CHARS).trimEnd()}\n… (전체는 저장소 CHANGELOG.md에서)`
}

const lines = []
lines.push(`[하네스] v${version} 배포 (${date})`)
lines.push('')
lines.push(body)
lines.push('')
lines.push('받기: 각 프로젝트에서 `/하네스업데이트` — 받을 시점은 각 팀 리더 판단입니다.')
const text = lines.join('\n')

process.stdout.write(jsonOutput ? `${JSON.stringify({ text })}\n` : `${text}\n`)
