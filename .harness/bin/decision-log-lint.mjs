#!/usr/bin/env node
// 결정 로그 제목 중복 보초 (0.2.152, 결정 126 — clubadm #57: union 머지의 부작용 차단).
//
// 0.2.152 부터 설치가 `.gitattributes` 에 `.harness/session/decision-log.md merge=union` 을 넣는다. 결정 118(#48 B안)로 기록이
// 코드 커밋에 실리면서 브랜치마다 파일 끝에 절이 붙고, 머지마다 같은 자리를 다퉜다(clubadm 8월 이후 TD 머지 충돌: decision-log.md
// 19건 — 전부 "양쪽이 끝에 각자 덧붙여 자리만 겹친 것", 내용 충돌 0건). union 은 그 자리를 둘 다 넣고 멈추지 않는다.
//
// 대가가 하나 있다: 아카이브로 옮긴 옛 절에 다른 브랜치가 줄을 덧붙인 채 머지되면, union 이 **충돌 없이 그 옛 절을 통째로
// 되살린다** — 현행과 아카이브 양쪽에 같은 절이 생긴다(제보자 시뮬레이션 T4, 본체 재현). 이 보초가 그것을 잡는다.
//
// 판정: 현행(decision-log.md)과 아카이브(decision-log-*.md)를 통틀어 `## YYYY-MM-DD …` 제목 줄이 **글자 그대로** 두 번 이상이면
// 중복이다. 제목은 다른데 `## YYYY-MM-DD - 결정 N` 의 번호가 겹치는 것도 따로 센다(두 브랜치가 같은 번호를 딴 경우). 코드 펜스
// 안은 보지 않는다. harness check(policy-harness)와 post-merge 훅이 이 함수 하나를 쓴다 — 판정이 두 벌이면 한쪽만 고친다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HEADING = /^## \d{4}-\d{2}-\d{2}\b/
const NUMBERED = /^## \d{4}-\d{2}-\d{2} - 결정 (\d+)\b/

// 현행 파일을 먼저, 아카이브는 이름순 — 출력의 "어디에" 목록이 매번 같은 순서로 나와야 비교가 쉽다.
export function decisionLogFiles(sessionDir) {
  let names
  try {
    names = fs.readdirSync(sessionDir)
  } catch {
    return []
  }
  const archives = names.filter((name) => /^decision-log-.+\.md$/.test(name)).sort()
  return names.includes('decision-log.md') ? ['decision-log.md', ...archives] : archives
}

export function findDecisionLogDuplicates(sessionDir) {
  const headings = new Map()
  const numbers = new Map()
  for (const name of decisionLogFiles(sessionDir)) {
    let text
    try {
      text = fs.readFileSync(path.join(sessionDir, name), 'utf8')
    } catch {
      continue
    }
    let fenced = false
    text.split(/\r?\n/).forEach((raw, index) => {
      if (/^\s*```/.test(raw)) {
        fenced = !fenced
        return
      }
      if (fenced) return
      const line = raw.trimEnd()
      if (!HEADING.test(line)) return
      const place = `${name}:${index + 1}`
      if (!headings.has(line)) headings.set(line, [])
      headings.get(line).push(place)
      const numbered = NUMBERED.exec(line)
      if (numbered) {
        if (!numbers.has(numbered[1])) numbers.set(numbered[1], [])
        numbers.get(numbered[1]).push({ place, line })
      }
    })
  }
  const duplicateHeadings = [...headings]
    .filter(([, places]) => places.length > 1)
    .map(([heading, places]) => ({ heading, places }))
  // 같은 제목이 겹친 것은 위에서 이미 셌다 — 여기서는 번호만 겹치고 제목이 서로 다른 경우만 낸다.
  const duplicateNumbers = [...numbers]
    .filter(([, items]) => new Set(items.map((item) => item.line)).size > 1)
    .map(([number, items]) => ({ number, places: items.map((item) => item.place) }))
  return { headings: duplicateHeadings, numbers: duplicateNumbers }
}

export function formatDecisionLogDuplicates(found) {
  const lines = []
  for (const { heading, places } of found.headings) lines.push(`  - ${heading}  ← ${places.join(', ')}`)
  for (const { number, places } of found.numbers) lines.push(`  - 결정 ${number} — 서로 다른 절이 같은 번호를 씁니다: ${places.join(', ')}`)
  return lines
}

// 직접 실행 판정: ESM 로더는 심볼릭 링크를 실제 경로로 푼다(/var → /private/var) — 양쪽을 realpath 로 맞춘다(hooks-state.mjs 와 같다).
function samePathLoose(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return path.basename(a) === path.basename(b)
  }
}
const isMain = Boolean(process.argv[1]) && samePathLoose(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))

// post-merge 훅이 부른다. 정상은 침묵이고, 무엇이 있어도 0 으로 끝난다 — pull·머지를 죽이지 않는다.
if (isMain) {
  try {
    const root = process.env.HARNESS_REPO_ROOT || process.cwd()
    const sessionRel = fs.existsSync(path.join(root, '.harness')) ? '.harness/session' : '.github/session'
    const found = findDecisionLogDuplicates(path.join(root, sessionRel))
    const total = found.headings.length + found.numbers.length
    if (total > 0) {
      console.log(`[harness] 결정 로그에 같은 절이 두 번 있습니다(${total}건) — 머지가 아카이브로 옮긴 옛 절을 되살렸을 수 있습니다. 내용을 비교해 한쪽을 지우세요:`)
      for (const line of formatDecisionLogDuplicates(found)) console.log(line)
    }
  } catch {}
  process.exit(0)
}
