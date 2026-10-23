#!/usr/bin/env node
// 본체 버전 정합 검사 (seed-mode 전용).
//
// 보는 것: package.json의 version과 CHANGELOG.md 최상단 절의 버전이 같은가. 그것뿐이다.
//
// 2026-09-07(결정 108)까지는 이 스크립트가 형제 디렉터리의 스택·템플릿 manifest를 이름으로
// 찾아 base ref까지 써줬다. 본체가 스택을 이름으로 아는 유일한 코드였고, 그래서 본체 릴리스가
// 스택 개수만큼 무거워졌다. 남이 운영하는 스택은 그 자리에 아예 없다.
//
// 지금 계약: **스택·scaffold는 자기 ref를 자기가 소유한다.** 본체 버전을 언제 따라갈지는
// 각 저장소가 정하고(값은 검증한 정확한 태그 — 범위 표기는 2026-09-07 외부 리뷰로 되돌렸다,
// stacks/authoring-guide.md 「`baseHarness.ref`」 절), 그 저장소의 자기 검사가 확인한다. 이 스크립트는
// 남의 릴리스 번호를 쓰지 않는다 — 배포 카탈로그(.harness/stacks·templates/registry.json)가 위성의 검증된
// 태그를 고정하는 것은 별개이고, 소유자 요청으로 손으로 갱신한다(body-release-checklist 6단계,
// 검사는 scripts/test-standards-registry.mjs).
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv.includes('--write')) {
  console.log('참고: 본체 버전 그물에는 쓸 대상이 없습니다 — 위성 ref는 각 저장소 소유입니다(결정 108). 검사만 수행합니다.')
}

const packageVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? null
const changelogVersion = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8').match(/^##\s+(\d+\.\d+\.\d+)/m)?.[1] ?? null

if (packageVersion && changelogVersion === packageVersion) {
  console.log(`ok: package.json ${packageVersion} == CHANGELOG 최상단`)
  process.exit(0)
}

console.log(`mismatch: CHANGELOG 최상단 ${changelogVersion ?? '(없음)'} -> package.json ${packageVersion ?? '(없음)'}`)
console.error('')
console.error('CHANGELOG.md 최상단 절의 버전을 package.json과 맞추세요(릴리스 절차 3단계).')
process.exit(1)
