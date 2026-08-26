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
// 정규식 lookahead의 $는 m 플래그에서 "각 줄 끝"이라 본문을 첫 줄에서 잘라먹는다
// (v0.2.119 첫 공지가 불릿 3개 중 1개만 나간 원인) — 줄 경계 분리로 파싱한다.
const sections = changelog.split(/\n(?=## )/)
const top = sections.map((chunk) => chunk.replace(/^\n+/, '')).find((chunk) => /^## \S+ - \S+/.test(chunk))
if (!top) fail('CHANGELOG에서 버전 절을 찾지 못했습니다 ("## <버전> - <날짜>" 형식)')
const [, version, date] = top.match(/^## (\S+) - (\S+)/)
const rawBody = top.slice(top.indexOf('\n') + 1)

const tag = argValue('--tag') ?? process.env.CI_COMMIT_TAG ?? `v${version}`
// 태그와 CHANGELOG 최상단이 어긋나면 공지가 거짓말이 된다 — 조용히 보내지 않고 멈춘다
// (릴리스 절차상 태그는 기록 커밋 뒤에 달리므로, 어긋남은 절차 위반의 신호다).
if (tag.replace(/^v/, '') !== version) {
  fail(`태그(${tag})와 CHANGELOG 최상단(${version})이 다릅니다 — 기록을 먼저 맞추세요`)
}

// 채널에는 "### 공지" 블록만 나간다 — CHANGELOG 본문은 개발 기록이라 수신자(리더)에게
// 투머치다(결정 77 계열). 블록이 없으면 깜빡한 것이므로 실패, "없음"이면 의도된 침묵이므로
// 무발송 통과 — 무음은 언제나 의도의 결과여야 한다(broadcast와 같은 원칙).
const noticeMatch = rawBody.match(/(?:^|\n)### 공지[^\n]*\n([\s\S]*?)(?=\n### |\n## |$)/)
if (!noticeMatch) {
  fail('최상단 절에 "### 공지" 블록이 없습니다 — 채널로 나갈 [신규]/[개선]/[결함픽스] 목록을 적거나, 알릴 것이 없으면 "없음" 한 줄을 적으세요')
}
let body = noticeMatch[1].trim()
// \b(단어 경계)는 ASCII 전용이라 한글에 안 걸린다 — 정확 비교로 판정한다.
if (body.replace(/^-\s*/, '').trim() === '없음') {
  console.error('release-notice: 공지 "없음" — 발송을 생략합니다 (의도된 무공지)')
  process.exit(0)
}
if (body.length > MAX_BODY_CHARS) {
  body = `${body.slice(0, MAX_BODY_CHARS).trimEnd()}\n… (전체는 저장소 CHANGELOG.md에서)`
}

const lines = []
lines.push(`[하네스] v${version} 배포 (${date})`)
lines.push('')
lines.push(body)
lines.push('')
lines.push('받기: 각 프로젝트에서 `/하네스업데이트` (시점은 리더 판단)')
// 공지는 아주 쉽게 요약만 나가므로(2026-08-25 사용자 지시), 자세한 변경 내용은 상시 링크로 안내한다.
lines.push('자세한 변경 내용: https://git.smartscore.kr/ai-standard/harnesses/harness-seed/-/blob/master/CHANGELOG.md')
const text = lines.join('\n')

process.stdout.write(jsonOutput ? `${JSON.stringify({ text })}\n` : `${text}\n`)
