// 기획 문서 연동(spec-sync) 회귀. 실행 등록은 scripts/test-init.mjs의 tests 배열이 정본이다.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildScreenIndex, normalizeScreenLinks, parseSpecMapExemptions as specMapExemptions, parseSpecMapText as specMapParse, sha256Text as specSyncSha256Text, specContextBudgetMs } from '../../.harness/bin/spec-sync.mjs'
import {
  repoRoot,
  nodeBin,
  run,
  harnessBin,
  assert,
  exists,
  read,
  writeJson,
  sha256Text,
  makeTarget,
  runInit,
  gitCommitAll,
  setupSpecLinkedTarget,
  makePlanningRepoWithFiles,
  makePlanningRepoRaw,
  specSyncCli,
  expectFailure,
} from './helpers.mjs'

// clone 직후 구멍(0.2.112): 기획 본문은 코드 저장소에 없고, post-merge는 clone에서 돌지 않는다.
// 그 시점에 훅은 설치조차 안 돼 있으니 "아직 안 받은 것"이 "기획서가 없는 것"처럼 보인다.
// 훅 설치가 클론 직후 누구나 거치는 유일한 필수 단계라 거기서 본문을 채운다.
function hooksInstallHydratesSpecBodiesForFreshClone() {
  const { target } = setupSpecLinkedTarget()

  // clone 직후 상태 재현: 기준(lock)은 커밋돼 있지만 생성물은 없다.
  fs.rmSync(path.join(target, '.harness/generated'), { recursive: true, force: true })
  assert(!exists(target, '.harness/generated/spec-cache'), 'fresh clone must start without spec bodies (precondition)')

  const output = run(harnessBin(target), ['hooks:install'], { cwd: target })

  assert(output.includes('기획 본문 준비'), 'hooks:install should report that it prepares spec bodies')
  assert(exists(target, '.harness/generated/spec-cache'), 'hooks:install must leave the spec bodies ready to read')
}

// 기획 문서를 쓰지 않는 프로젝트에서 훅 설치가 무거워지거나 시끄러워지면 안 된다.
function hooksInstallStaysQuietWithoutSpecLink() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const output = run(harnessBin(target), ['hooks:install'], { cwd: target })
  assert(!output.includes('기획 본문 준비'), 'a project without spec linkage must not see spec output at hook install')
}

function specSyncFetchRecordsLockAndDetectsChanges() {
  const { target, planning } = setupSpecLinkedTarget()

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(lock.version === 2, 'fresh baseline must be written as lock schema v2')
  const files = Object.keys(lock.sources.planning.files)
  assert(files.includes('features/로그인.md'), 'lock should record included spec files')
  assert(typeof lock.sources.planning.files['features/로그인.md'].sha === 'string', 'v2 lock records per-doc sha')
  assert(typeof lock.sources.planning.files['features/로그인.md'].commit === 'string', 'v2 lock records per-doc commit provenance')
  assert(lock.sources.planning.selector, 'v2 lock records the include/exclude selector')
  assert(!files.some((rel) => rel.endsWith('README.md')), 'excluded README must not enter the lock')
  assert(!files.some((rel) => rel.startsWith('archive/')), 'excluded archive must not enter the lock')

  // lock이 있는 프로젝트의 무인자 fetch는 비파괴(cache-only)다 — 팀 기준은 움직이지 않는다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책이 추가되었다.\n')
  gitCommitAll(planning, '기획 수정')
  const lockBefore = read(target, '.harness/spec-lock.json')
  const bare = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'fetch'], { cwd: target })
  assert(bare.includes('기준 이동 없음'), 'bare fetch with an existing lock must be non-destructive')
  assert(bare.includes('--move-baseline'), 'bare fetch should point to the explicit baseline-move flag')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'bare fetch must not rewrite the lock')

  // 기준 이동은 --move-baseline 명시로만 일어난다.
  const moved = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'fetch', '--move-baseline'], { cwd: target })
  assert(moved.includes('변경 1'), 'baseline move should report one changed spec document')

  const status = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'status'], { cwd: target })
  assert(status.includes('읽고 아직 정산하지 않은 기획 변경이 없습니다'), 'after a baseline move nothing should remain unsettled')
}

function buildContextInjectsRelatedSpecs() {
  const { target } = setupSpecLinkedTarget()

  const out = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(out.includes('## Related Specs'), 'agent context should have a related specs section')
  assert(out.includes('features/로그인.md'), 'matching spec document should be injected')
  assert(!out.includes('archive/구버전.md'), 'excluded archive doc must not be injected')
  assert(out.includes('코드 drift'), 'spec-first decision rule should be stated')
}

function guardShowsSpecAdvisoryForMappedCodeChange() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '# 기획 문서 매핑',
    '',
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
    '',
  ].join('\n'))
  gitCommitAll(target, 'baseline')

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')

  const out = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(out.includes('기획 문서 연동 참고'), 'mapped code change should surface the spec advisory')
  assert(out.includes('features/로그인.md'), 'advisory should name the linked spec document')

  // 최신을 확인해 미정산 변경이 생기면 커밋 검증이 건수를 알려준다 — 이 단계는 네트워크를 쓰지 않는다.
  // (0.2.103: 미정산의 출처는 손편집 캐시가 아니라 "읽은 스냅샷" manifest다.)
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 기획이 갱신되었다.\n')
  gitCommitAll(planning, '기획 개정')
  run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'fetch', '--cache-only'], { cwd: target })

  const out2 = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(out2.includes('정산하지 않은 기획 변경이 1건'), 'an unsettled planning change should be counted in the advisory')
}

function specFetchCacheOnlyDoesNotMoveTeamBaseline() {
  const { target, planning } = setupSpecLinkedTarget()
  const lockBefore = read(target, '.harness/spec-lock.json')

  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책이 추가되었다.\n')
  gitCommitAll(planning, '기획 수정')

  const out = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'fetch', '--cache-only'], { cwd: target })
  assert(out.includes('기준 이동 없음'), 'cache-only fetch must announce that the baseline did not move')
  assert(out.includes('미정산'), 'cache-only fetch should report unsettled changes against the baseline')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'cache-only fetch must not rewrite spec-lock.json')

  const status = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'status'], { cwd: target })
  assert(status.includes('[변경] features/로그인.md'), 'status should list the unsettled planning change')
}

function specFetchAtLockRehydratesCacheAtBaseline() {
  const { target, planning } = setupSpecLinkedTarget()
  const lockBefore = read(target, '.harness/spec-lock.json')

  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 기준 이후에 추가된 문장.\n')
  gitCommitAll(planning, '기획 수정')
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })

  const out = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'fetch', '--at-lock'], { cwd: target })
  assert(out.includes('수화'), 'at-lock fetch should describe itself as rehydration')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'at-lock fetch must not rewrite spec-lock.json')

  const cached = read(target, '.harness/generated/spec-cache/planning/features/로그인.md')
  assert(!cached.includes('기준 이후에 추가된 문장'), 'at-lock cache must contain the baseline version, not the latest')

  const status = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'status'], { cwd: target })
  assert(!status.includes('기준 본문이 아직 준비되지 않았습니다'), 'after rehydration the cache must match the baseline')
}

function specSettleAdvancesOnlyMyScopedDocs() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '# 기획 문서 매핑',
    '',
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/login/**` | 담당: A팀 |',
    '',
  ].join('\n'))
  gitCommitAll(target, 'baseline')

  // 기획이 내 문서(로그인)와 남의 신규 문서(결제)를 함께 바꿨다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책이 추가되었다.\n')
  fs.writeFileSync(path.join(planning, 'features/결제.md'), '# 결제\n\n결제 사양입니다.\n')
  gitCommitAll(planning, '기획 수정')
  run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'fetch', '--cache-only'], { cwd: target })

  fs.mkdirSync(path.join(target, 'src/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login/login.js'), 'export const login = () => {}\n')

  const out = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'settle'], { cwd: target })
  assert(out.includes('[정산] features/로그인.md'), 'settle should advance the doc mapped to my changed code')

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  const cachedSha = sha256Text(read(target, '.harness/generated/spec-cache/planning/features/로그인.md'))
  assert(lock.sources.planning.files['features/로그인.md'].sha === cachedSha, 'settled doc hash must equal the current cache hash')
  assert(!('features/결제.md' in lock.sources.planning.files), 'unrelated new doc must stay unsettled in the baseline')

  const status = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'status'], { cwd: target })
  assert(status.includes('[추가] features/결제.md'), 'unsettled new doc must remain visible in status as the discovery net')
}

function specLinkConsistencyCheckFlagsBrokenDeclarations() {
  const { target } = setupSpecLinkedTarget()
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')

  // 기준(lock)에 없는 기획 문서를 가리키는 매핑 행 — 오타/폐기 잔재.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/없는문서.md` | `src/**` | |',
  ].join('\n'))

  const advisoryOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(advisoryOut.includes('기준(spec-lock)에 없는 기획 문서'), 'consistency check should flag a map row pointing at a non-baseline doc')

  // 구현 경로가 사라진 매핑 — 리팩터링 후 spec-map 미갱신.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/ghost/**` | |',
  ].join('\n'))
  const deadPathOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(deadPathOut.includes('구현 경로가 저장소에 없습니다'), 'dead implementation path should be named with its fix')
}

// CI 백스톱 알림의 정본은 broadcast 출력이다(0.2.115). 종전에는 yaml이 status 출력을 grep으로
// 오려 붙였는데, status 문구가 바뀌면서 마커가 11개 릴리스 동안 조용히 죽어 있었다. 문구를 도구로
// 옮기고 여기서 계약으로 잠근다: ① 혼성 채널(기획자+개발자)이므로 개발 용어 금지 ② 알림이 안내하는
// 명령은 실존해야 함 ③ 조용함 = 변경 없음이 보장돼야 함 ④ 출력은 웹훅에 그대로 POST 가능한 JSON.
function broadcastSpeaksMixedAudienceLanguage() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '# 기획 문서 매핑', '',
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| features/로그인.md | src/views/** | |',
    '',
  ].join('\n'))

  const quiet = specSyncCli(target, ['broadcast', '--json'])
  assert(quiet.trim() === '', 'a settled baseline must produce no broadcast at all — silence must mean "nothing changed"')

  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 정책 추가.\n')
  fs.appendFileSync(path.join(planning, 'features/로그인.html'), '<p>버튼 문구 변경.</p>\n')
  fs.writeFileSync(path.join(planning, 'features/포인트지급.md'), '# 포인트 지급\n')
  gitCommitAll(planning, '기획 수정+신규')
  specSyncCli(target, ['fetch', '--cache-only'])

  const raw = specSyncCli(target, ['broadcast', '--json'])
  const payload = JSON.parse(raw)
  const text = payload.text
  assert(text.includes('확인하지 않은 기획 변경'), 'broadcast must state the fact in plain language')
  assert(text.includes('(수정) features/로그인'), 'a changed doc must appear with a plain kind label')
  assert(text.includes('(신규) features/포인트지급'), 'a new doc must appear')
  assert(text.includes('담당 코드 아직 없음'), 'an unowned doc must say so in plain words')
  assert(text.includes('기획팀:') && text.includes('개발팀:'), 'both audiences must be addressed by name')
  for (const jargon of ['정산', '매핑', 'lock', 'settle']) {
    assert(!text.includes(jargon), `mixed-audience broadcast must not contain developer jargon: ${jargon}`)
  }

  // 첫 실전 알림의 표시 결함 2건을 계약으로(0.2.118).
  // ① 글롭 꼬리: Mattermost가 **를 굵게 마커로 먹어 "src/views/"처럼 보였다 — 원시 **는 금지.
  assert(text.includes('담당 코드: src/views'), 'a mapped doc must name its owning code area')
  assert(!text.includes('**'), 'broadcast must not carry raw glob/markdown markers — Mattermost eats ** as bold')
  // ② 화면 접기: 문서+화면은 한 도장(원자 정산)인데 두 줄로 세면 한 건이 부풀고
  //    화면 줄은 담당 없음처럼 보인다 — 대표 문서 한 줄 + (화면 포함)으로 접는다.
  assert(text.includes('(수정) features/로그인 (화면 포함)'), 'a doc+screen pair must fold into one line marked (화면 포함)')
  assert(!text.includes('로그인.html'), 'the screen file must not appear as its own line')
  assert(text.includes('(2건)'), 'the headline count must count folded units, not raw files')

  // 죽은 마커의 교훈을 명령에도 적용: 알림이 손에 쥐여 주는 명령은 실존해야 한다.
  const command = text.match(/\/([가-힣A-Za-z-]+) 을 입력/)
  assert(command, 'the developer line must hand over a slash command')
  assert(exists(target, `.claude/commands/${command[1]}.md`), 'the command the broadcast references must be installed in the consumer project')
}

// "주소를 깜빡한 문서"와 "구현 대상 아님으로 판정을 끝낸 문서"는 알림에서도 구분돼야 한다(0.2.116).
// 판정 문서를 "아직 없음"으로 말하면 매핑 누락처럼 읽혀서, 이미 내린 판정을 사람들이 다시 의심하게 된다.
function broadcastDistinguishesJudgedDocsFromUnmapped() {
  const { target, planning } = setupSpecLinkedTarget()

  // 판정 대상 문서를 기획에 추가하고 기준에 편입한 뒤, 스펙맵에 (코드 없음) 판정을 남긴다.
  fs.writeFileSync(path.join(planning, 'features/운영안내.md'), '# 운영 안내\n\n배포 창구 안내.\n')
  gitCommitAll(planning, '운영안내 추가')
  specSyncCli(target, ['fetch', '--cache-only'])
  specSyncCli(target, ['settle', '--doc', 'features/운영안내.md'])
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '# 기획 문서 매핑', '',
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| features/운영안내.md | (코드 없음) | 안내문 |',
    '',
  ].join('\n'))

  // 판정된 문서와 미매핑 문서를 같은 라운드에 변경한다.
  fs.appendFileSync(path.join(planning, 'features/운영안내.md'), '\n- 창구 변경.\n')
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 정책 추가.\n')
  gitCommitAll(planning, '기획 수정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const text = JSON.parse(specSyncCli(target, ['broadcast', '--json'])).text
  assert(text.includes('(수정) features/운영안내 — 구현 대상 아님으로 판정된 문서'), 'a judged doc must not read like a forgotten mapping')
  assert(text.includes('(수정) features/로그인 — 담당 코드 아직 없음'), 'an unmapped doc keeps the not-yet label')
}

// 0.2.121: broadcast의 무음은 "확인했고 변경 없음"만 뜻해야 한다. 최신 확인 기록이 아예 없으면
// (클론 직후 등) 이 명령 혼자서는 변경 여부를 알 수 없는데, 조용히 끝나면 "미확인 변경 0건"으로
// 오판된다(멀티사이트 실증: fetch 없이 broadcast만 돌리고 "변경 없음"으로 보고).
function broadcastWithoutCheckRecordAsksForFetchFirst() {
  const { target } = setupSpecLinkedTarget()

  // 최초 연동은 방금 원격 HEAD를 확인한 행위다 — 차이 0건의 확인 기록이 남고 무음이 정직하다.
  assert(exists(target, '.harness/generated/spec-latest/planning/.manifest.json'), 'initial linking must leave a per-source check record')
  assert(specSyncCli(target, ['broadcast', '--json']).trim() === '', 'right after initial linking silence is honest — the remote was just checked')

  // 클론 직후 재현: 기준(lock)은 커밋돼 있지만 생성물(확인 기록)은 없다.
  fs.rmSync(path.join(target, '.harness/generated'), { recursive: true, force: true })
  const raw = specSyncCli(target, ['broadcast', '--json'])
  assert(raw.trim() !== '', 'without any check record broadcast must not be silent — silence would read as "no changes"')
  const text = JSON.parse(raw).text
  assert(text.includes('최신 확인 기록이 없어'), 'the message must name the actual state (no check record yet)')
  assert(text.includes('spec:fetch --cache-only'), 'the message must hand over the command that creates the record')

  // 확인을 실제로 수행하면(변화가 없어도) 기록이 생겨 다시 정당한 무음이 된다.
  specSyncCli(target, ['fetch', '--cache-only'])
  assert(specSyncCli(target, ['broadcast', '--json']).trim() === '', 'after a real check with no changes, silence means "nothing changed" again')
}

// 0.2.121: 같은 status 화면에 "정산 대기 없음"과 "감지 2건"이 나란히 나와 모순으로 읽혔다(멀티사이트
// 실증 — 에이전트가 병렬 실행 순서 문제로 의심하고 재확인). 두 줄은 다른 축(읽은 스냅샷 vs 원격 확인)
// 인데 라벨이 축을 밝히지 않았고, 감지 건수는 화면 접기(결정 79) 없이 파일 단위라 채널 알림(1건)과도
// 갈라졌다. 축 명시·건수 접기·다음 명령 안내를 계약으로 잠근다.
function specStatusSeparatesAxesAndFoldsDetectedCount() {
  const { target, planning } = setupSpecLinkedTarget()

  // md+html 짝을 함께 수정 — 접으면 1건, 파일로 세면 2건.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 정렬 우선순위 정책 추가.\n')
  fs.appendFileSync(path.join(planning, 'features/로그인.html'), '<p>정렬 칼럼 추가.</p>\n')
  gitCommitAll(planning, '기획 수정')

  // 모순이 목격된 상태 재현: 최신 확인(freshness)만 있고 스냅샷(fetch --cache-only)은 없다
  // → 원격 변경은 감지됐지만 읽은 것이 없어 정산 대기는 0건.
  specSyncCli(target, ['freshness'])

  const status = specSyncCli(target, ['status'])
  assert(status.includes('읽고 아직 정산하지 않은 기획 변경이 없습니다'), 'the settle line must name its axis (read snapshots)')
  assert(status.includes('기준 이후 원격 변경 1건'), 'the remote-axis count must fold a doc+screen pair into one unit (decision 79)')
  assert(!status.includes('원격 변경 2건'), 'the remote-axis count must not be counted per raw file')
  assert(status.includes('다른 축입니다'), 'the status must say the two lines measure different things')
  assert(status.includes('spec:fetch --cache-only'), 'the remote-axis line must hand over the next command')

  // 작업 컨텍스트의 라벨도 원격 축으로 말한다 — "미정산"은 읽은 스냅샷의 축이라 여기에 쓰면
  // status의 "정산 대기 없음"과 정면 모순으로 읽힌다.
  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(context.includes('기준 이후 원격에서 변경됨 — 확인 전'), 'the context label must speak the remote axis')
  assert(!context.includes('미정산'), 'the context must not borrow the settle-axis word for remote detections')
}

// 멀티사이트 #24 (2026-09-08): 정산 대기 목록이 파일별로 매핑을 찾아, 매핑된 문서의 짝 화면(.html)에 "(매핑 없음)"을
// 붙였다. 미매핑 집계(findUnmappedSpecs)는 화면 색인으로 짝을 알아 대표 문서에 묶는데 목록만 다른 규칙을 썼다.
// 링크된 화면은 대표 문서의 매핑을 따라 표시해야 한다.
function specStatusLabelsLinkedScreenWithItsDocMapping() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '# 기획 문서 매핑', '', '| 기획 문서 | 구현 경로 | 비고 |', '| --- | --- | --- |', '| `features/로그인.md` | `src/**` | |', '',
  ].join('\n'))
  gitCommitAll(target, 'baseline')

  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 정렬 정책 추가.\n')
  fs.appendFileSync(path.join(planning, 'features/로그인.html'), '<p>정렬 칼럼 추가.</p>\n')
  gitCommitAll(planning, '기획 수정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const status = specSyncCli(target, ['status'])
  const lines = status.split('\n')
  const html = lines.find((line) => line.includes('features/로그인.html'))
  assert(html, 'the changed screen must appear in the pending list (precondition)')
  assert(html.includes('연결 코드') && html.includes('짝 문서'), `a linked screen must show its document's mapping, got: ${html.trim()}`)
  assert(!html.includes('매핑 없음'), 'a linked screen must not be labelled unmapped while its document is mapped')
  const md = lines.find((line) => line.includes('features/로그인.md'))
  assert(md && md.includes('연결 코드'), 'the document line keeps its own mapping')
}

// yaml 예시는 문구를 만들지 않는다 — 도구의 broadcast 출력을 그대로 전달만 한다.
function ciBackstopExampleDelegatesToBroadcast() {
  const skillDoc = fs.readFileSync(path.join(repoRoot, '.claude/commands/기획문서연동.md'), 'utf8')
  assert(skillDoc.includes('spec-sync.mjs broadcast --json'), 'the CI example must delegate message building to the tool')
  assert(!skillDoc.includes('spec-status.txt'), 'the fragile grep-and-paste pipeline must be gone')

  // yaml 지뢰 계약(0.2.117): script의 plain 항목이 ": "를 품으면 YAML이 키:값으로 쪼개서
  // 파이프라인이 생성 단계에서 죽는다 — 실증: 'Content-Type: application/json' 한 줄이
  // 멀티사이트 첫 스케줄 실행(#6688)을 Stages 없이 실패시켰다(2026-08-12). 예시는 존재만이
  // 아니라 파싱까지 계약이다(결정 76의 확장). 콜론+공백이 필요한 명령은 블록 스칼라(|)로 쓴다.
  const fence = skillDoc.match(/```yaml\n([\s\S]*?)```/)
  assert(fence, 'the CI example must be a yaml fence')
  const lines = fence[1].split('\n')
  const scriptIdx = lines.findIndex((line) => /^\s*script:\s*$/.test(line))
  assert(scriptIdx >= 0, 'the example must have a script block')
  const scriptIndent = lines[scriptIdx].match(/^\s*/)[0].length
  let sawBlockScalar = false
  for (let i = scriptIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (line.match(/^\s*/)[0].length <= scriptIndent) break
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue
    if (trimmed.startsWith('- |') || trimmed.startsWith('- >')) { sawBlockScalar = true; continue }
    const body = trimmed.slice(2).replace(/\s#.*$/, '')
    assert(!/: /.test(body), `plain yaml scalar with ": " breaks pipeline creation: ${trimmed}`)
  }
  assert(sawBlockScalar, 'the curl step must be a block scalar so the Content-Type header stays legal yaml')
}

// 첫 실전 셋업(2026-08-12)의 학습을 계약으로: 태그 러너는 무태그 잡을 조용히 stuck시키고,
// 셋업 6단계는 전부 메인테이너 권한 작업이다(인프라 스크립트 요청 아님 — 사용자 지시).
function ciBackstopLeaderChecklistCoversLiveSetup() {
  const skillDoc = fs.readFileSync(path.join(repoRoot, '.claude/commands/기획문서연동.md'), 'utf8')
  assert(skillDoc.includes('tags:'), 'the yaml example must carry the tagged-runner hint — untagged jobs stuck silently on tag-required runners')
  assert(skillDoc.includes('처음 켤 때 체크리스트'), 'the leader setup checklist section must exist')
  for (const item of ['Incoming Webhook', 'MATTERMOST_WEBHOOK_URL', 'Masked', 'Protected', 'Job token permissions', '러너', '30 7,12 * * 1-5', '잡 로그']) {
    assert(skillDoc.includes(item), `leader checklist must cover live-run learning: ${item}`)
  }
  assert(skillDoc.includes('메인테이너 권한'), 'the checklist must say maintainers can do all of it — not an infra-script request')
}

// 0.2.142(백엔드 통합 저장소 문답, 2026-09-04): 어댑터는 "주소 인자 → 2절", "이미 연동 → 4절" 두 갈래뿐이라
// 두 번째 기획 저장소를 붙일 때 정본의 '소스 추가 절차'를 가리키지 않았다 — 2절을 다시 밟으면 기존 선언이
// 사라지고, --source 없는 --move-baseline은 기존 기준을 통째로 옮긴다(정본이 경고하는 바로 그 사고).
// 소스 id는 견본의 'planning'(0.2.103, 근거 없는 일반명사)이 그대로 복사되어(멀티사이트 실측) 두 번째
// 소스부터 칸을 구분할 수 없었다 — 견본은 서비스 이름을 요구하고, 이미 커밋된 id는 바꾸지 않는다.
function specLinkAdapterRoutesSecondSourceToAddProcedure() {
  const adapter = fs.readFileSync(path.join(repoRoot, '.claude/commands/기획문서연동.md'), 'utf8')
  assert(adapter.includes('소스 추가 절차'), 'adapter must route an already-linked repo + new address to the add-source procedure')
  assert(adapter.includes('--move-baseline --source <새 id>'), 'adapter must insist on --source when creating the new baseline')
  assert(adapter.includes('기존 소스들의 기준까지'), 'adapter must spell out what --move-baseline without --source does')
  assert(adapter.includes('서비스 이름으로'), 'adapter must name the source after the service')

  const canon = fs.readFileSync(path.join(repoRoot, '.harness/project/spec-authority-workflow.md'), 'utf8')
  assert(!canon.includes('"id": "planning"'), 'the first-link template must not hand out the generic id "planning"')
  assert(canon.includes('제품·서비스 이름'), 'canon must state the source-id naming rule')
  assert(canon.includes('이미 커밋된 id는 바꾸지 않습니다'), 'canon must protect existing ids (renaming forces baseline regeneration)')
  assert(canon.includes('2절(최초 연결)을 다시 밟지 않습니다'), 'the add-source procedure must forbid re-running the first-link step')
}

// 0.2.123 후속(2026-08-18): 멀티사이트 spec-issues-sync.mjs(소비자 소유 CI 스크립트)가
// 아래 표면을 import/호출하는 것이 실사용으로 확인됐다. 내부 구현이었던 것이 소비자
// 의존을 얻으면 공개 계약이다 — 이름·시그니처·출력 형태가 바뀌면 소비자 CI가 죽으므로
// 여기서 잠근다. 바꿔야 한다면 이 테스트를 깨뜨린 커밋이 소비자 마이그레이션을 함께 안내할 것.
// 잠그는 표면: sha256Text · normalizeScreenLinks(기본 확장자 폴백) · buildScreenIndex(unitFor 접기)
//             · readSpecState + pendingSettlements(미정산 축의 정본) · status --json(configured/valid/sources)
//             · import 안전성(CLI 가드 — import가 main을 실행하지 않아야 소비자 import가 성립)
function specSyncPublicSurfaceStaysLocked() {
  assert(typeof specSyncSha256Text === 'function', 'sha256Text must stay exported — consumer CI scripts import it')
  assert(typeof normalizeScreenLinks === 'function', 'normalizeScreenLinks must stay exported')
  assert(typeof buildScreenIndex === 'function', 'buildScreenIndex must stay exported')

  const defaults = normalizeScreenLinks({})
  assert(Array.isArray(defaults) && defaults.includes('.html'), 'undeclared screenLinks must fall back to defaults including .html — folding relies on it')

  const index = buildScreenIndex(
    ['features/로그인.md', 'features/로그인.html'],
    (rel) => (rel.endsWith('.md') ? '[화면](./로그인.html)' : ''),
    ['.html'],
  )
  const unit = index.unitFor('features/로그인.html')
  assert(unit && unit.id === 'features/로그인.md', 'unitFor must fold a screen into its owning doc unit')
  assert(unit.files.includes('features/로그인.md') && unit.files.includes('features/로그인.html'), 'unit.files must carry doc and linked screens')

  const { target, planning } = setupSpecLinkedTarget()
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 표면 계약 검증용 변경.\n')
  gitCommitAll(planning, '기획 수정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const status = JSON.parse(specSyncCli(target, ['status', '--json']))
  assert(status.configured === true && status.valid === true, 'status --json must expose configured/valid')
  assert(Array.isArray(status.sources) && status.sources.every((source) => typeof source.id === 'string'), 'status --json sources must carry string ids')

  // 미정산 축의 정본은 status.diff가 아니라 pendingSettlements다 — diff는 기준 본문
  // 사본의 드리프트 점검 축이라 정상 상태에서 항상 비어 있다(이 오해가 실제 소비자
  // 스크립트 리뷰에서 발견됐다). 소비자의 실사용 형태 그대로, 설치본에서 import해 검증한다.
  const probe = path.join(target, '.harness/generated/surface-probe.mjs')
  fs.writeFileSync(probe, [
    "import { readSpecState, pendingSettlements } from '../bin/spec-sync.mjs'",
    'const state = readSpecState()',
    'console.log(JSON.stringify(pendingSettlements(state.lock)))',
    '',
  ].join('\n'))
  const pending = JSON.parse(run(nodeBin, [probe], { cwd: target }))
  fs.rmSync(probe)
  assert(Array.isArray(pending), 'pendingSettlements must stay exported and return an array')
  assert(
    pending.some((entry) => entry.file === 'features/로그인.md' && entry.kind === '변경' && typeof entry.source === 'string'),
    'an unsettled planning change must surface as {source, file, kind} — consumer issue jobs key on this shape',
  )
}

// 회귀 1(+삭제/rename, 잔재 제거): 서로 다른 planning commit에서 부분 정산된 혼합 기준을
// --at-lock이 정확한 파일 집합으로 복원해야 한다. base checkout이 되살리는 삭제 문서와
// 이전 수화의 untracked 잔재가 남으면 안 된다.
function specAtLockRestoresExactMixedBaselineSet() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planning = makePlanningRepoWithFiles({
    'features/로그인.md': '# 로그인\n\n로그인 사양 v1.\n',
    'features/결제.md': '# 결제\n\n결제 사양 v1.\n',
  })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: ['**/README.md'] }],
  })
  specSyncCli(target, ['fetch'])

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/login/**` | |',
    '| `features/결제.md` | `src/pay/**` | |',
  ].join('\n'))

  // 기획이 로그인은 고치고(=C2) 결제는 삭제(rename의 삭제 측면과 동일)했다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책.\n')
  fs.rmSync(path.join(planning, 'features/결제.md'))
  gitCommitAll(planning, '기획 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  // 내 몫(로그인)만 정산 → lock은 로그인@C2 + 결제@C1 의 혼합 기준이 된다.
  fs.mkdirSync(path.join(target, 'src/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login/login.js'), 'export const login = () => {}\n')
  specSyncCli(target, ['settle'])

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(lock.sources.planning.files['features/로그인.md'].commit !== lock.sources.planning.files['features/결제.md'].commit,
    'fixture must be a mixed baseline (two docs at different planning commits)')

  // 캐시를 지우고 수화 — 혼합 기준 그대로 복원돼야 하고 status가 일치를 보고해야 한다.
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })
  const rehydrated = specSyncCli(target, ['fetch', '--at-lock'])
  assert(rehydrated.includes('수화'), 'at-lock should describe itself as rehydration')
  assert(read(target, '.harness/generated/spec-cache/planning/features/로그인.md').includes('잠금 정책'), 'settled doc must rehydrate at its own commit')
  assert(read(target, '.harness/generated/spec-cache/planning/features/결제.md').includes('결제 사양 v1'), 'unsettled doc must rehydrate at the baseline commit even if deleted upstream')
  const statusAfter = specSyncCli(target, ['status'])
  assert(!statusAfter.includes('기준 본문이 아직 준비되지 않았습니다'), 'mixed baseline must be reproducible: cache matches lock after at-lock')

  // 이전 수화 잔재(selector에 걸리는 untracked 파일)는 다음 수화에서 제거돼야 한다.
  fs.writeFileSync(path.join(target, '.harness/generated/spec-cache/planning/features/잔재.md'), '# 잔재\n')
  specSyncCli(target, ['fetch', '--at-lock'])
  assert(!exists(target, '.harness/generated/spec-cache/planning/features/잔재.md'), 'stale rehydration leftovers must be removed')
  assert(!specSyncCli(target, ['status']).includes('기준 본문이 아직 준비되지 않았습니다'), 'cache must stay lock-consistent after leftover cleanup')
}

// 회귀: --move-baseline --source <id>는 지정 소스만 옮기고 다른 소스의 lock 항목을 그대로 둔다.
function specMoveBaselineSourceScopeKeepsOtherSourcesIntact() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planningA = makePlanningRepoWithFiles({ 'features/에이.md': '# A\n\nA 사양.\n' })
  const planningB = makePlanningRepoWithFiles({ 'features/비.md': '# B\n\nB 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: planningA, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: planningB, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])

  fs.appendFileSync(path.join(planningA, 'features/에이.md'), '\n- A 개정.\n')
  fs.appendFileSync(path.join(planningB, 'features/비.md'), '\n- B 개정.\n')
  gitCommitAll(planningA, 'A 개정')
  gitCommitAll(planningB, 'B 개정')

  const before = JSON.parse(read(target, '.harness/spec-lock.json'))
  specSyncCli(target, ['fetch', '--move-baseline', '--source', 'alpha'])
  const after = JSON.parse(read(target, '.harness/spec-lock.json'))

  assert(JSON.stringify(after.sources.beta) === JSON.stringify(before.sources.beta), 'untargeted source lock entry must stay byte-for-byte identical')
  assert(after.sources.alpha.commit !== before.sources.alpha.commit, 'targeted source baseline must move')
}

// 회귀 10 + 읽기 순수성: v1 lock을 status/doc-link가 수정·네트워크 없이 읽고,
// 변경 명령(settle)이 검증 후 v2로 승격하며, 검증 불일치는 결정적으로 중단한다.
function specV1LockReadPathsArePureAndMutatingCommandsPromote() {
  const { target, planning } = setupSpecLinkedTarget()

  // 0.2.99 v1 형식으로 되돌린다(문서별 sha 문자열).
  const v2 = JSON.parse(read(target, '.harness/spec-lock.json'))
  const v1 = { version: 1, sources: {} }
  for (const [id, recorded] of Object.entries(v2.sources)) {
    v1.sources[id] = {
      repo: recorded.repo,
      ref: recorded.ref,
      commit: recorded.commit,
      fetchedAt: recorded.fetchedAt,
      files: Object.fromEntries(Object.entries(recorded.files).map(([rel, value]) => [rel, value.sha])),
    }
  }
  writeJson(target, '.harness/spec-lock.json', v1)
  const v1Bytes = read(target, '.harness/spec-lock.json')

  // 읽기 경로는 기획 저장소가 사라져도(오프라인) 동작하고 lock을 수정하지 않는다.
  const planningAway = `${planning}-away`
  fs.renameSync(planning, planningAway)
  const status = specSyncCli(target, ['status'])
  assert(status.includes('v1 형식'), 'status should surface the pending v1 lock')
  run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(read(target, '.harness/spec-lock.json') === v1Bytes, 'read paths must not rewrite a v1 lock')
  fs.renameSync(planningAway, planning)

  // 변경 명령(settle)은 로컬 git 객체로 검증한 뒤 v2로 승격해 저장한다.
  const settleOut = specSyncCli(target, ['settle'])
  assert(settleOut.includes('v2로 승격'), 'mutating command should promote a verified v1 lock')
  const promoted = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(promoted.version === 2, 'promoted lock must be schema v2')
  assert(promoted.sources.planning.files['features/로그인.md'].commit === promoted.sources.planning.commit, 'pure v1 docs promote to the source baseline commit')

  // 검증 불일치(혼합/오염 v1)는 이력 탐색 없이 결정적으로 중단한다.
  const corrupted = JSON.parse(JSON.stringify(v1))
  corrupted.sources.planning.files['features/로그인.md'] = sha256Text('오염된 내용')
  writeJson(target, '.harness/spec-lock.json', corrupted)
  const corruptedBytes = read(target, '.harness/spec-lock.json')
  const stopOut = expectFailure(() => specSyncCli(target, ['settle']), 'unverifiable v1 lock must stop the mutating command')
  assert(stopOut.includes('검증할 수 없어 중단'), 'stop message should say verification failed')
  assert(stopOut.includes('--move-baseline'), 'stop message should route to baseline regeneration after review')
  assert(read(target, '.harness/spec-lock.json') === corruptedBytes, 'a failed promotion must not partially rewrite the lock')
}

function specSourceValidationInvalidatesWholeState() {
  const { target } = setupSpecLinkedTarget()

  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'planning', repo: 'https://example.invalid/a.git' },
      { id: 'planning', repo: 'https://example.invalid/b.git' },
    ],
  })
  const dupFetch = expectFailure(() => specSyncCli(target, ['fetch', '--cache-only']), 'duplicate source ids must invalidate fetch')
  assert(dupFetch.includes('중복'), 'duplicate id should be named')
  const dupStatus = expectFailure(() => specSyncCli(target, ['status']), 'duplicate source ids must invalidate status')
  assert(dupStatus.includes('유효하지 않습니다'), 'status should report the invalid declaration')
  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('중복'), 'doc-link consistency should surface the invalid declaration')

  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: '../evil', repo: 'https://example.invalid/a.git' }],
  })
  const unsafeOut = expectFailure(() => specSyncCli(target, ['fetch', '--cache-only']), 'unsafe source id must invalidate the whole state')
  assert(unsafeOut.includes('안전하지 않습니다'), 'unsafe id should be named')
  assert(!fs.existsSync(path.join(target, '.harness/generated/evil')), 'unsafe id must never touch paths outside the cache root')
}

// 회귀 5: 선언 repo가 바뀌면(저장소 이전) 기존 origin을 계속 fetch하며 불일치를 숨기지 않고,
// 새 repo로 재클론한다. 정합 검사는 선언↔기준 repo 불일치를 표면화한다.
function specFetchReclonesWhenRepoUrlChanges() {
  const { target } = setupSpecLinkedTarget()
  const planning2 = makePlanningRepoWithFiles({ 'features/이전후.md': '# 이전 후\n\n새 저장소 사양.\n' })

  const sourcesConfig = JSON.parse(read(target, '.harness/spec-sources.json'))
  sourcesConfig.sources[0].repo = planning2
  writeJson(target, '.harness/spec-sources.json', sourcesConfig)

  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('선언 repo와 기준 기록이 다릅니다'), 'repo migration must be surfaced by the consistency check')

  specSyncCli(target, ['fetch', '--cache-only'])
  const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: path.join(target, '.harness/generated/spec-cache/planning') }).trim()
  assert(origin === planning2, 'cache must be recloned from the newly declared repo, not the stale origin')
  // 기준 본문은 --cache-only가 채우지 않는다(기준 전용 디렉터리). 기준을 옮긴 뒤에 새 저장소 내용이 온다.

  specSyncCli(target, ['fetch', '--move-baseline'])
  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(lock.sources.planning.repo === planning2, 'baseline regeneration records the new repo')
  assert(exists(target, '.harness/generated/spec-cache/planning/features/이전후.md'), 'baseline body must come from the new repo after the baseline moves')
}

// 회귀 6: include/exclude 선언 변경은 기준 기록(selector)과의 불일치로 감지된다.
function specSelectorChangeIsFlaggedByConsistency() {
  const { target } = setupSpecLinkedTarget()
  const sourcesConfig = JSON.parse(read(target, '.harness/spec-sources.json'))
  sourcesConfig.sources[0].exclude = [...(sourcesConfig.sources[0].exclude ?? []), 'features/제외추가.md']
  writeJson(target, '.harness/spec-sources.json', sourcesConfig)

  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('include/exclude 선언이 기준 기록과 다릅니다'), 'selector drift must be surfaced')
  const status = specSyncCli(target, ['status'])
  assert(status.includes('include/exclude'), 'status should also warn about the selector drift')
}

// 회귀 11: uninstall이 spec 계열 package script를 남기지 않는다(dangling script 방지).
function specUninstallRemovesSpecScripts() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run(nodeBin, [path.join(target, '.harness/bin/uninstall-harness.mjs'), '--confirm'], { cwd: target })
  const pkg = JSON.parse(read(target, 'package.json'))
  for (const name of ['harness:spec:fetch', 'harness:spec:status', 'harness:spec:settle']) {
    assert(!(name in (pkg.scripts ?? {})), `${name} must be removed by uninstall`)
  }
}

// status 모순 수정: 캐시가 없으면 "기준과 캐시 일치"를 주장하지 않는다.
function specStatusDoesNotClaimSyncWhenCacheMissing() {
  const { target } = setupSpecLinkedTarget()
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })
  const status = specSyncCli(target, ['status'])
  assert(status.includes('기준 본문이 아직 준비되지 않았습니다'), 'missing cache should be reported as "baseline body not ready"')
  assert(status.includes('기준 본문이 아직 준비되지 않았습니다'), 'status must report that the baseline body is not ready')
}

// 회귀 4: 여러 소스에 같은 문서 경로가 있으면 정합 경고가 뜨고 settle은 정산을 거부한다.
function specSettleRefusesPathCollisionsAcrossSources() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planningA = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 A\n\nA의 사양.\n' })
  const planningB = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 B\n\nB의 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: planningA, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: planningB, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])

  // 0.2.142 재리뷰: 경로가 겹친다는 사실 자체는 오류가 아니다 — 이름 없이 그 경로를 매핑했을 때만
  // 모호성 오류다. 여기서는 매핑이 아직 없으므로 정합 검사는 조용하고, 상태가 그 사실을 알린다.
  run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  const collisionStatus = specSyncCli(target, ['status'])
  assert(collisionStatus.includes('여러 기획 저장소에 있습니다'), 'status must still surface that the same path exists in more than one source')
  assert(collisionStatus.includes('소스 이름을 붙여'), 'status must show how to disambiguate')

  const refuse = expectFailure(() => specSyncCli(target, ['settle', '--doc', 'features/공통.md']), 'settle must refuse ambiguous collision docs')
  assert(refuse.includes('어느 문서인지 알 수 없습니다'), 'settle should explain the ambiguity instead of settling both sources')
}

// 0.2.142 재리뷰 5차 P2: 단위 조회가 "읽은 시점 ?? 기준 시점"이라 **하나만** 골랐다.
// 화면 교체(문서의 링크를 a.html에서 b.html로 바꾸고 같은 커밋에서 a.html 삭제)는 읽은 시점이
// b.html만 알고 기준 시점이 a.html만 아는 상황이라, 옛 화면이 기준에 남는 혼합 기준이 됐다.
// 단위는 두 시점의 합집합이어야 한다.
function specReplacedScreenSettlesOldAndNewTogether() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const withLink = (screen) => `# 공통\n\n화면: [화면](./${screen})\n`
  const screenBody = '<html><body>화면</body></html>\n'
  const alpha = makePlanningRepoWithFiles({ 'features/a.md': withLink('a.html'), 'features/a.html': screenBody })
  const beta = makePlanningRepoWithFiles({ 'features/a.md': withLink('a.html'), 'features/a.html': screenBody })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])
  const alphaBefore = JSON.stringify(JSON.parse(read(target, '.harness/spec-lock.json')).sources.alpha)

  // 화면 교체: 링크를 b.html로 바꾸고 옛 화면을 같은 커밋에서 지운다.
  fs.writeFileSync(path.join(beta, 'features/a.md'), withLink('b.html'))
  fs.rmSync(path.join(beta, 'features/a.html'))
  fs.writeFileSync(path.join(beta, 'features/b.html'), screenBody)
  gitCommitAll(beta, '화면 교체')
  specSyncCli(target, ['fetch', '--cache-only'])

  specSyncCli(target, ['settle', '--doc', 'beta:features/a.md'])
  const after = JSON.parse(read(target, '.harness/spec-lock.json'))

  assert(!after.sources.beta.files['features/a.html'], 'the replaced screen must leave the baseline with its document')
  assert(after.sources.beta.files['features/b.html'], 'the new screen must enter the baseline in the same settlement')
  assert(after.sources.beta.files['features/a.md'].commit === after.sources.beta.files['features/b.html'].commit,
    'the document and its screen must be recorded at the same commit')
  assert(JSON.stringify(after.sources.alpha) === alphaBefore, 'the other source must stay byte-for-byte identical')
}

// 0.2.142 재리뷰 5차: 기준 본문 캐시는 git에 들어가지 않는 생성물이라 fresh clone에는 없다.
// 없는 상태에서 정산이 "링크 없음"으로 진행하면 화면이 조용히 기준에 남을 수 있다.
// **이 회귀는 고친 결함이 아니라 이미 성립하던 fail-closed를 계약으로 잠근다** — 출처 검증이
// 캐시 부재를 먼저 잡아 멈추고, 그때 lock은 1바이트도 바뀌지 않는다. 기준 색인이 git 객체를
// 읽도록 바뀌었으므로(작업 트리 의존 제거) 이 경계가 유지되는지 확인해 두는 것이다.
function specSettleFailsClosedWithoutTheBaselineCache() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const docBody = '# 공통\n\n화면: [화면](./a.html)\n'
  const planning = makePlanningRepoWithFiles({ 'features/a.md': docBody, 'features/a.html': '<html></html>\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: [] }],
  })
  specSyncCli(target, ['fetch'])
  fs.rmSync(path.join(planning, 'features/a.md'))
  fs.rmSync(path.join(planning, 'features/a.html'))
  gitCommitAll(planning, '기획 폐기')
  specSyncCli(target, ['fetch', '--cache-only'])

  // fresh clone 재현: 기준 본문·캐시 저장소가 통째로 없다.
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })
  const lockBefore = read(target, '.harness/spec-lock.json')

  expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'features/a.md']),
    'settling without the baseline cache must fail closed instead of guessing',
  )
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'a fail-closed settle must not change the lock')
}

// 0.2.142 재리뷰 5차 비차단 참고를 채운다: 캐시 **git 저장소는 있는데 체크아웃 본문만 없는** 상태.
// 기준 화면 색인이 작업 트리를 읽던 시절엔 이 상태에서 기준 단위를 못 찾아 화면이 기준에 남았다.
// 이제 git 객체를 읽으므로 폐기 정산이 그대로 성공해야 한다 — 위의 "저장소 전체 부재 → 거부"와
// 짝을 이루는 회귀이고, 이쪽은 고친 코드 경로를 실제로 밟는다(옛 코드에서는 실패).
function specSettleReadsBaselineScreensFromGitObjectsWithoutCheckout() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const docBody = '# 공통\n\n화면: [화면](./a.html)\n'
  const planning = makePlanningRepoWithFiles({ 'features/a.md': docBody, 'features/a.html': '<html></html>\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: [] }],
  })
  specSyncCli(target, ['fetch'])
  fs.rmSync(path.join(planning, 'features/a.md'))
  fs.rmSync(path.join(planning, 'features/a.html'))
  gitCommitAll(planning, '기획 폐기')
  specSyncCli(target, ['fetch', '--cache-only'])

  // 체크아웃 본문만 지우고 .git은 남긴다 — cache-only 경로에서 실제로 생기는 모양이다.
  const cacheDir = path.join(target, '.harness/generated/spec-cache/planning')
  for (const entry of fs.readdirSync(cacheDir)) {
    if (entry !== '.git') fs.rmSync(path.join(cacheDir, entry), { recursive: true, force: true })
  }
  assert(!exists(target, '.harness/generated/spec-cache/planning/features/a.md'), 'the checkout body must be gone (precondition)')

  specSyncCli(target, ['settle', '--doc', 'features/a.md'])
  const after = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(!after.sources.planning.files['features/a.md'], 'the deprecated document must leave the baseline')
  assert(!after.sources.planning.files['features/a.html'],
    'the screen must leave with it — the baseline relation must come from git objects, not the missing checkout')
}

// 0.2.142 재리뷰 4차 P2: 기획자가 문서와 화면을 **같은 커밋에서 함께 삭제**하는 것은 정상적인
// 폐기 절차다(한쪽만 지우면 링크 정합이 막지만, 둘 다 지우면 통과한다). 그런데 정산의 화면 단위
// 색인은 "읽은 시점"에서만 만들어지고 그 시점에는 두 파일이 이미 없어 단위를 찾지 못했다 —
// 범위 확장도 원자성 검사도 건너뛰어, 대표 MD만 기준에서 빠지고 HTML은 남는 혼합 기준이 됐다.
// (이 경로 때문에 3차의 "부분 상태는 만들 수 없다" 결론을 철회했다.)
function specDeletedScreenUnitSettlesTogetherFromBaselineIndex() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const docBody = '# 공통\n\n화면: [화면](./a.html)\n'
  const screenBody = '<html><body>화면</body></html>\n'
  const alpha = makePlanningRepoWithFiles({ 'features/a.md': docBody, 'features/a.html': screenBody })
  const beta = makePlanningRepoWithFiles({ 'features/a.md': docBody, 'features/a.html': screenBody })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])
  const baseline = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(baseline.sources.beta.files['features/a.md'] && baseline.sources.beta.files['features/a.html'],
    'the baseline must hold both members of the screen unit (precondition)')
  const alphaBefore = JSON.stringify(baseline.sources.alpha)

  // 기획자가 문서와 화면을 함께 폐기한다 — 링크 정합이 막지 않는 정상 경로다.
  fs.rmSync(path.join(beta, 'features/a.md'))
  fs.rmSync(path.join(beta, 'features/a.html'))
  gitCommitAll(beta, '기획 폐기')
  specSyncCli(target, ['fetch', '--cache-only'])

  // 대표 문서 한 줄만 정산해도 화면이 함께 빠져야 한다(매핑은 대표 문서만 적는 계약).
  specSyncCli(target, ['settle', '--doc', 'beta:features/a.md'])
  const after = JSON.parse(read(target, '.harness/spec-lock.json'))

  assert(!after.sources.beta.files['features/a.md'], 'the deleted document must leave the baseline')
  assert(!after.sources.beta.files['features/a.html'],
    'the screen must leave the baseline with its document — a lone screen is the mixed baseline the contract forbids')
  assert(JSON.stringify(after.sources.alpha) === alphaBefore, 'the other source must stay byte-for-byte identical')
}

// 0.2.142 재리뷰 3차 P2 2건.
// ① v1→v2 승격도 lock 쓰기다. 거부 검사보다 앞에 있어서 "문서가 없어 실패"라고 반환하면서
//    spec-lock.json은 이미 바뀌어 있었다(거부 경로에서는 lock 불변 계약 위반).
// ② 같은 {소스, 경로}의 누락을 두 번 만나면 첫 항목만 남겨, 이름 없는 요청이 먼저 오면
//    뒤따르는 소스 지정 요청의 엄격함이 사라졌다 — 인자 순서가 판정을 바꿨다.
function specSettleRefusalLeavesLockUntouchedRegardlessOfV1OrArgOrder() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const alpha = makePlanningRepoWithFiles({
    'features/공통.md': '# 공통 A\n\nA의 사양.\n',
    'features/알파만.md': '# 알파만\n\nalpha에만 있는 문서.\n',
  })
  const beta = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 B\n\nB의 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])
  fs.appendFileSync(path.join(alpha, 'features/알파만.md'), '\n- A 개정.\n')
  gitCommitAll(alpha, 'A 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  // ② 인자 순서가 판정을 바꾸면 안 된다 — 양쪽 순서 모두 거부되고 lock은 불변이어야 한다.
  for (const args of [
    ['settle', '--doc', 'features/알파만.md', '--doc', 'beta:features/알파만.md'],
    ['settle', '--doc', 'beta:features/알파만.md', '--doc', 'features/알파만.md'],
  ]) {
    const lockBefore = read(target, '.harness/spec-lock.json')
    const refused = expectFailure(() => specSyncCli(target, args), `a qualified missing request must refuse regardless of argument order: ${args.join(' ')}`)
    assert(refused.includes('[beta] features/알파만.md'), 'the refusal must name the missing request with its source')
    assert(read(target, '.harness/spec-lock.json') === lockBefore, `a refused settle must not change the lock (${args.join(' ')})`)
  }

  // ① v1 lock에서도 거부는 파일을 건드리지 않는다(승격 자체가 쓰기다).
  const v2 = JSON.parse(read(target, '.harness/spec-lock.json'))
  const v1 = { version: 1, sources: {} }
  for (const [id, recorded] of Object.entries(v2.sources)) {
    v1.sources[id] = {
      repo: recorded.repo,
      ref: recorded.ref,
      commit: recorded.commit,
      fetchedAt: recorded.fetchedAt,
      files: Object.fromEntries(Object.entries(recorded.files).map(([rel, value]) => [rel, value.sha])),
    }
  }
  writeJson(target, '.harness/spec-lock.json', v1)
  const v1Bytes = read(target, '.harness/spec-lock.json')

  expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'alpha:features/없는문서.md']),
    'a missing document must refuse the settle on a v1 lock too',
  )
  assert(read(target, '.harness/spec-lock.json') === v1Bytes, 'a refused settle must not promote a v1 lock to v2 — promotion is a write')

  // 정상 정산이면 승격은 그대로 일어난다(거부 경로에서만 미루는 것이 계약이다).
  specSyncCli(target, ['settle', '--doc', 'alpha:features/알파만.md'])
  assert(JSON.parse(read(target, '.harness/spec-lock.json')).version === 2, 'a successful settle must still promote the lock format')
}

// 0.2.142 재리뷰 2차 P1: `(코드 없음)` 판정 행이 소스 검사를 통째로 우회했다. 판정은 일반
// 매핑과 다른 목록으로 파싱되는데 충돌·기준 존재 검사는 매핑만 봤다. 그래서 이름 없는 판정
// 하나로 같은 경로를 가진 **다른 서비스의 문서까지** "구현 대상 아님"으로 숨길 수 있었다.
function specExemptionRowsGetTheSameSourceChecksAsMappings() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const alpha = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 A\n\nA의 사양.\n' })
  const beta = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 B\n\nB의 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])
  const mapPath = path.join(target, '.harness/project/spec-map.md')
  const mapWith = (rows) => fs.writeFileSync(mapPath, ['| 기획 문서 | 구현 경로 | 비고 |', '| --- | --- | --- |', ...rows, ''].join('\n'))

  // (1) 이름 없는 판정은 모호하다 — 안내로 끝내지 않고 strict에서 실패한다.
  mapWith(['| `features/공통.md` | (코드 없음) | 운영 문서 |'])
  const ambiguous = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(ambiguous.includes('어느 문서인지 알 수 없습니다'), 'an unqualified (코드 없음) row on a colliding path must be flagged')
  expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs'), '--strict'], { cwd: target }),
    'strict must fail while an exemption row is ambiguous',
  )

  // (2) 한쪽만 판정하면 다른 쪽은 그대로 미매핑으로 남아야 한다 — 판정이 남의 문서를 숨기지 않는다.
  mapWith(['| `alpha:features/공통.md` | (코드 없음) | 운영 문서 |'])
  run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs'), '--strict'], { cwd: target })
  const status = specSyncCli(target, ['status'])
  assert(status.includes('매핑되지 않은 기획: 1건'), "a source-qualified exemption must not hide the other source's document")
  assert(status.includes('[beta] features/공통.md'), 'the still-unmapped document must be named by its source')

  // (3) 있지도 않은 문서를 판정해 두면 그 문서는 아무 검사도 받지 않는다 — 정합 오류로 잡는다.
  mapWith(['| `alpha:features/없는문서.md` | (코드 없음) | 오타 |'])
  const bogus = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(bogus.includes('(코드 없음) 판정이 가리키는 기획 문서가 기준(spec-lock)에 없습니다'), 'an exemption pointing at a non-existent doc must be surfaced')
}

// 0.2.142 재리뷰 2차 P1: 여러 --doc 중 하나가 없을 때 나머지가 먼저 적용돼, 명령은 실패를
// 반환하면서 lock은 이미 바뀌어 있었다("한 건이라도 거부되면 lock은 1바이트도 바뀌지 않는다"는
// 이 함수의 계약 위반). 게다가 누락 판정이 상대경로만 비교해, 같은 경로를 가진 다른 소스의
// 성공이 누락을 가릴 수 있었다.
function specSettleRefusesAllWhenOneRequestedDocIsMissing() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const alpha = makePlanningRepoWithFiles({
    'features/공통.md': '# 공통 A\n\nA의 사양.\n',
    'features/알파만.md': '# 알파만\n\nalpha에만 있는 문서.\n',
  })
  const beta = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 B\n\nB의 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])
  fs.appendFileSync(path.join(alpha, 'features/알파만.md'), '\n- A 개정.\n')
  gitCommitAll(alpha, 'A 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const lockBefore = read(target, '.harness/spec-lock.json')

  // beta에는 그 문서가 없다 — alpha의 성공이 beta의 누락을 가리면 안 되고, 전체가 거부돼야 한다.
  const refused = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'alpha:features/알파만.md', '--doc', 'beta:features/알파만.md']),
    'a missing source-qualified request must refuse the whole settle',
  )
  assert(refused.includes('lock은 그대로입니다'), 'the refusal must say the baseline was left untouched')
  assert(refused.includes('[beta] features/알파만.md'), 'the missing request must be named with its source')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'a refused settle must not change the lock by a single byte')

  // 이름을 빼고 요청하면 예전 계약대로 "어느 소스에든 있으면 된다".
  specSyncCli(target, ['settle', '--doc', 'features/알파만.md'])
  const after = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(after.sources.alpha.files['features/알파만.md'], 'an unqualified request must still settle where the document exists')
  assert(!after.sources.beta.files['features/알파만.md'], 'the source without that document must stay untouched')
}

// 0.2.142 재리뷰(코덱스) P1 2건: 소스 이름을 붙인 지정(결정 102)이 실제로는 두 곳에서 깨졌다.
// ① 문서 정합 검사가 lock 문서를 상대경로만으로 모아, `alpha:features/공통.md` 같은 정상 매핑을
//    반드시 "기준에 없는 문서"로 오판하고 strict 검사에서 실패했다.
// ② 정산이 최신 확인 스냅샷을 상대경로만으로 지워, alpha를 정산하면 같은 경로를 가진 beta의
//    미정산 변경까지 조용히 사라졌다(다시 fetch하기 전에는 정산할 수도 없다).
// 이 회귀는 겹치는 경로를 **양쪽 다 바꾼** 상태에서 한쪽만 정산해 둘을 함께 확인한다.
function specQualifiedRefsSurviveStrictCheckAndScopedSettle() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const alpha = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 A\n\nA의 사양.\n' })
  const beta = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 B\n\nB의 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])

  fs.mkdirSync(path.join(target, 'src/a'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a/a.js'), 'export const a = 1\n')
  fs.mkdirSync(path.join(target, 'src/b'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/b/b.js'), 'export const b = 1\n')
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `alpha:features/공통.md` | `src/a/**` | |',
    '| `beta:features/공통.md` | `src/b/**` | |',
    '',
  ].join('\n'))

  // ① 소스 이름을 붙인 매핑은 정합 검사에서 오류가 아니고, strict 검사도 통과해야 한다.
  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!docLink.includes('기준(spec-lock)에 없는 기획 문서'), 'a source-qualified mapping must not be judged as missing from the baseline')
  assert(!docLink.includes('어느 문서인지 알 수 없습니다'), 'a collision that every mapping qualifies must not be reported as ambiguous')
  run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs'), '--strict'], { cwd: target })

  // 이름을 빼면 그때는 모호성 오류다 — 충돌 자체가 아니라 이름 없는 지정이 문제라는 계약.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/공통.md` | `src/a/**` | |',
    '',
  ].join('\n'))
  const ambiguous = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(ambiguous.includes('어느 문서인지 알 수 없습니다'), 'an unqualified mapping of a colliding path must still be flagged')
  assert(ambiguous.includes('alpha:features/공통.md'), 'the notice must show the qualified form')

  // ② 양쪽 문서를 모두 바꾼 뒤 alpha만 정산한다.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `alpha:features/공통.md` | `src/a/**` | |',
    '| `beta:features/공통.md` | `src/b/**` | |',
    '',
  ].join('\n'))
  fs.appendFileSync(path.join(alpha, 'features/공통.md'), '\n- A 개정.\n')
  gitCommitAll(alpha, 'A 개정')
  fs.appendFileSync(path.join(beta, 'features/공통.md'), '\n- B 개정.\n')
  gitCommitAll(beta, 'B 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const before = JSON.parse(read(target, '.harness/spec-lock.json'))
  const settleOut = specSyncCli(target, ['settle', '--doc', 'alpha:features/공통.md'])
  assert(settleOut.includes('[정산]'), 'the qualified settle must actually settle')
  const after = JSON.parse(read(target, '.harness/spec-lock.json'))

  assert(after.sources.alpha.files['features/공통.md'].sha !== before.sources.alpha.files['features/공통.md'].sha, 'the settled source must advance')
  assert(JSON.stringify(after.sources.beta) === JSON.stringify(before.sources.beta), 'the other source baseline must not move')

  // beta의 최신 확인 기록과 본문이 남아 있어야 다시 fetch하지 않고 정산할 수 있다.
  const manifest = JSON.parse(read(target, '.harness/generated/spec-latest/beta/.manifest.json'))
  assert(manifest.files?.['features/공통.md'], "settling one source must not delete the other source's reviewed snapshot")
  assert(exists(target, '.harness/generated/spec-latest/beta/features/공통.md'), "the other source's reviewed body must survive")

  const status = specSyncCli(target, ['status'])
  assert(status.includes('[beta] features/공통.md'), "the other source's change must still be listed as pending, named by source")
  assert(status.includes('src/b/**'), 'a source-qualified mapping must be shown as the linked code, not "매핑 없음"')

  specSyncCli(target, ['settle', '--doc', 'beta:features/공통.md'])
  const settled = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(settled.sources.beta.files['features/공통.md'].sha !== before.sources.beta.files['features/공통.md'].sha, 'the second source must still be settleable without another fetch')
}

// 0.2.142: 기획 저장소가 둘 이상이면 같은 상대경로가 겹친다(기획팀마다 features/·policies/ 관례).
// 예전에는 경로만으로 문서를 지정해 겹치면 정산이 거부됐고, 푸는 길이 include/exclude로 한쪽을
// 빼는 것뿐이었다. 이제 `<소스id>:<경로>`로 지정할 수 있고, 이름 없는 지정만 모호로 남는다.
function specRefsQualifiedBySourceSettleTheRightBaseline() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const alpha = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 A\n\nA의 사양.\n' })
  const beta = makePlanningRepoWithFiles({ 'features/공통.md': '# 공통 B\n\nB의 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])
  const before = JSON.parse(read(target, '.harness/spec-lock.json'))

  fs.appendFileSync(path.join(alpha, 'features/공통.md'), '\n- A 개정.\n')
  gitCommitAll(alpha, 'A 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  // 이름 없이 지정하면 여전히 모호하다 — 거부하되 붙이는 법을 그 자리에서 알려준다.
  const refused = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'features/공통.md']),
    'an unqualified colliding path must not settle',
  )
  assert(refused.includes('어느 문서인지 알 수 없습니다'), 'the refusal must name the ambiguity')
  assert(refused.includes('alpha:features/공통.md'), 'the refusal must show the qualified form to use')

  // 소스 이름을 붙이면 그 소스만 전진하고 다른 소스는 한 바이트도 바뀌지 않는다.
  specSyncCli(target, ['settle', '--doc', 'alpha:features/공통.md'])
  const after = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(after.sources.alpha.files['features/공통.md'].sha !== before.sources.alpha.files['features/공통.md'].sha,
    'the qualified source baseline must advance')
  assert(JSON.stringify(after.sources.beta) === JSON.stringify(before.sources.beta),
    'the other source must stay byte-for-byte identical')

  // 매핑 표에서도 같은 표기를 쓴다 — alpha만 매핑되고 beta의 같은 경로는 미매핑으로 남는다.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `alpha:features/공통.md` | `src/a/**` | |',
    '',
  ].join('\n'))
  const status = specSyncCli(target, ['status'])
  assert(status.includes('매핑되지 않은 기획: 1건'), 'a source-qualified mapping must cover only its own source')
}

// 매핑 커버리지 강제(0.2.101): "새 기능을 만들면 spec-map에 한 줄 추가"는 0.2.100까지
// 문서 규칙뿐이라 놓치면 그 코드가 어떤 게이트에도 걸리지 않는 사각지대가 됐다(P6 교훈의 반복).
// 이미 매핑된 영역에 새 파일이 들어오면 커밋에서 안내하고 gate 프로젝트는 push에서 차단한다.
function specMappingCoverageIsEnforcedForNewFilesInMappedAreas() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '# 기획 문서 매핑',
    '',
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/views/login/**` | |',
    '',
  ].join('\n'))
  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')

  // 매핑된 영역(src/views/)에 새 화면이 생겼는데 spec-map 기록이 없다.
  fs.mkdirSync(path.join(target, 'src/views/payment'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/payment/PayView.vue'), '<template><div /></template>\n')

  // 커밋 단계에서 안내한다(막지는 않는다).
  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(advisory.includes('spec-map 기록이 없습니다'), 'commit advisory should surface the missing mapping for a new file in a mapped area')
  assert(advisory.includes('src/views/payment/PayView.vue'), 'advisory should name the uncovered file')


}

// 0.2.142 (백엔드 통합 저장소 실측, 2026-09-04): 표 파서가 "줄 어딘가에 '기획 문서'가 있으면
// 헤더"로 판정해, **비고에 그 말을 쓴 행을 통째로 버렸다.** 그 문구는 이 표의 안내문 자신이
// 권하는 말이라("기획 문서가 필요 없는 코드면 판정으로 기록합니다") 실사용에서 반드시 나온다.
// 실측 증상: `(사양 없음) | ss/lib/** | 공용 라이브러리 — 기획 문서 대상 아님` 한 줄이 무시돼
// push가 막혔고, 비고 문구만 바꾸니 통과했다. 더 나쁜 경우는 매핑 행이 사라지는 쪽이다 —
// 그 코드의 기획 변경 감시가 **조용히** 꺼지고 아무 신호도 남지 않는다.
// 같은 규칙을 세 파일이 복제하고 있었으므로 네 소비자를 한 번에 잠근다.
function specMapRowsSurviveNotesThatMentionTheHeaderWords() {
  const { target } = setupSpecLinkedTarget()

  const mapText = [
    '# 기획 문서 매핑',
    '',
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/views/login/**` | 이 기획 문서의 구현 --- 담당: A팀 |',
    '| (사양 없음) | `src/views/shared/**` | 공용 프리젠테이션 — 기획 문서가 필요 없는 코드 |',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), mapText)

  // (1) 파서 자신 — 비고의 헤더 단어도, 비고의 '---'도 행을 죽이지 않는다.
  const entries = specMapParse(mapText)
  assert(entries.length === 1 && entries[0].spec === 'features/로그인.md', 'a mapping row whose note mentions the header words must survive parsing')
  assert(entries[0].codePaths.join(',') === 'src/views/login/**', 'the surviving row must keep its code paths')
  assert(specMapExemptions(mapText).codePaths.includes('src/views/shared/**'), 'an exemption row whose note mentions the header words must survive parsing')
  assert(specMapParse(['| `기획 문서` | 구현 경로 | 비고 |', '| :--- | ---: | --- |', '| a.md | src/a/** | |'].join('\n')).length === 1,
    'a backticked header cell and an aligned separator row must still be recognised as table furniture')

  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')

  fs.appendFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<!-- edit -->\n')
  fs.mkdirSync(path.join(target, 'src/views/shared'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/shared/Spinner.vue'), '<template><div /></template>\n')

  // (2) 커밋 advisory — policy-harness의 복제 파서(spec 스크립트가 없어도 돌아야 해서 복제다).
  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(advisory.includes('features/로그인.md'), 'the commit advisory must still link the mapped spec for the changed code')
  assert(!advisory.includes('Spinner.vue'), 'the exemption row must still silence the managed-area coverage notice')

  // (3) 컨텍스트 — 매핑이 살아 있어야 연결 구현을 제시한다.
  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(context.includes('연결 구현: src/views/login/**'), 'the context builder must link the mapped implementation paths')


}

// 0.2.142 (백엔드 통합 저장소 실측, 2026-09-04): 한 저장소가 서비스 여럿을 담으면 남의 서비스
// 기획 알림이 매 커밋에 딸려 나왔다 — 레거시 팀이 자기 코드만 고쳐도 멀티사이트 미매핑 22건이
// 열거됐고, 목록에 소스 표기가 없어 어느 서비스 것인지도 알 수 없었다.
// 알림은 저장소가 아니라 이번 변경이 건드린 영역을 따라간다. 접은 것은 조용히 지우지 않고 한 줄로 남긴다.
function specNoticeScopesUnrelatedServicesToOneFoldedLine() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const alpha = makePlanningRepoWithFiles({
    'features/알파.md': '# 알파\n\n알파 사양.\n',
    'features/알파2.md': '# 알파2\n\n아직 매핑 안 된 알파 사양.\n',
  })
  const beta = makePlanningRepoWithFiles({ 'features/베타.md': '# 베타\n\n다른 팀 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/알파.md` | `svc/alpha/**` | |',
    '',
  ].join('\n'))
  fs.mkdirSync(path.join(target, 'svc/alpha'), { recursive: true })
  fs.writeFileSync(path.join(target, 'svc/alpha/a.js'), 'export const a = 1\n')
  fs.mkdirSync(path.join(target, 'svc/legacy'), { recursive: true })
  fs.writeFileSync(path.join(target, 'svc/legacy/b.js'), 'export const b = 1\n')
  gitCommitAll(target, 'baseline')

  // (1) 다른 서비스 코드만 고친 커밋 — 어느 소스의 미매핑 목록도 펴지 않고 한 줄로 접는다.
  fs.appendFileSync(path.join(target, 'svc/legacy/b.js'), 'export const c = 2\n')
  const unrelated = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!unrelated.includes('features/베타.md'), "another service's unmapped specs must not be listed on an unrelated commit")
  assert(!unrelated.includes('features/알파2.md'), 'unmapped specs of an untouched source must not be listed either')
  assert(unrelated.includes('이번 변경과 무관한 다른 서비스'), 'the folded items must still be acknowledged in one line')

  // (2) 매핑된 서비스 코드를 고치면 그 소스의 안내는 펴고, 남의 서비스는 계속 접는다.
  fs.appendFileSync(path.join(target, 'svc/alpha/a.js'), 'export const d = 3\n')
  const touched = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(touched.includes('[alpha] features/알파2.md'), 'the touched source\'s unmapped spec must be listed and named by source')
  assert(!touched.includes('features/베타.md'), "the untouched source's specs must stay folded")
}

// 컨텍스트의 기획 네트워크 예산은 소스 수를 따라야 한다 — 고정 8초는 기획 저장소가 둘일 때
// 본문 준비만으로 소진돼, 최신 확인이 늘 타임아웃으로 떨어졌다(팀원 clone 첫 컨텍스트 9초).
function specContextBudgetGrowsWithSourceCount() {
  assert(specContextBudgetMs(1) === 8000, 'a single-source project must keep the original budget')
  assert(specContextBudgetMs(2) > specContextBudgetMs(1), 'a second planning source must buy more time')
  assert(specContextBudgetMs(50) === specContextBudgetMs(20), 'the budget must be capped so context never hangs')
  assert(specContextBudgetMs(50) <= 20000, 'the cap must keep the agent-visible wait bounded')
  assert(specContextBudgetMs(0) === 8000 && specContextBudgetMs(undefined) === 8000, 'a missing count must fall back to the base budget')
}

// 판정 완료((사양 없음))는 "아직 안 봤다"와 구분되는 1급 상태다 — 기획 문서가 필요 없다고
// 사람이 결론 낸 코드에 매핑을 강요하지 않는다. 매핑 영역 밖 파일은 애초에 대상이 아니다.
function specMappingCoverageRespectsExemptionsAndScope() {
  const { target } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/views/login/**` | |',
    '| (사양 없음) | `src/views/shared/**` | 공용 프리젠테이션 — 기획 대상 아님 |',
  ].join('\n'))
  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')

  // (1) 판정된 영역의 새 파일 (2) 매핑 영역 밖의 새 파일 — 둘 다 걸리면 안 된다.
  fs.mkdirSync(path.join(target, 'src/views/shared'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/shared/Spinner.vue'), '<template><div /></template>\n')
  fs.mkdirSync(path.join(target, 'src/utils'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/utils/date.js'), 'export const now = () => Date.now()\n')

  // 커밋 advisory는 잡음 방지를 위해 관리 영역으로 좁힌다 — 영역 밖 파일은 안내하지 않는다.
  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!advisory.includes('Spinner.vue'), 'an exempted path must not be reported as a missing mapping')
  assert(!advisory.includes('src/utils/date.js'), 'commit advisory must not report files outside mapped areas (noise control)')


}

// 기획 본문 자동 수화(0.2.102): 기획 본문은 git 추적 대상이 아니라 pull만으로는 안 내려온다.
// 동료가 아무것도 모른 채 작업을 시작해도 본문이 준비되게 하고, 실패해도 아무것도 막지 않는다.
function specCacheHydratesAutomaticallyAndFailsHarmlessly() {
  const { target, planning } = setupSpecLinkedTarget()

  // 동료 B의 상태 재현: lock/매핑은 pull로 받았지만 본문 캐시는 없다.
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })

  // (1) 컨텍스트 생성이 백스톱으로 수화한다(rebase pull·훅 미설치 경로).
  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(exists(target, '.harness/generated/spec-cache/planning/features/로그인.md'), 'context build should hydrate the missing spec cache')
  assert(context.includes('features/로그인.md'), 'hydrated spec should then be injected as a related spec')

  // (2) post-merge 훅이 평소 경로를 담당한다: 캐시를 지워도 pull 직후 복원된다.
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })
  run('sh', [path.join(target, '.githooks/post-merge')], { cwd: target })
  assert(exists(target, '.harness/generated/spec-cache/planning/features/로그인.md'), 'post-merge hook should hydrate spec bodies after pull')

  // (3) 기준(lock)은 절대 움직이지 않는다 — 수화는 읽기 전용 행위다.
  const lockBefore = read(target, '.harness/spec-lock.json')
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 기준 이후 변경.\n')
  gitCommitAll(planning, '기획 수정')
  run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'hydrate'], { cwd: target })
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'hydration must never move the team baseline')
  assert(!read(target, '.harness/generated/spec-cache/planning/features/로그인.md').includes('기준 이후 변경'), 'hydration restores the baseline version, not the latest')

  // (4) 기획 저장소에 접근할 수 없어도 무해하다(오프라인/장애).
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })
  const planningAway = `${planning}-offline`
  fs.renameSync(planning, planningAway)
  run('sh', [path.join(target, '.githooks/post-merge')], { cwd: target })
  const offlineContext = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(offlineContext.includes('로컬에 내려받지 않은 상태'), 'when hydration fails, the agent must be told the body is missing (not that no spec exists)')
  assert(!offlineContext.includes('매칭되는 기획 문서를 찾지 못했습니다'), 'missing body must not be reported as "no matching spec"')
  fs.renameSync(planningAway, planning)
}

// P1-1(0.2.102 리뷰): 부분 정산된 lock을 pull하면 소스 HEAD는 그대로인데 문서 기준만 앞선다.
// HEAD만 비교하면 수화가 스킵되고 동료가 옛 본문을 읽는다. 문서별 대조로 판정해야 한다.
function specHydrationDetectsPerDocumentDrift() {
  const { target, planning } = setupSpecLinkedTarget()
  const cacheDoc = path.join(target, '.harness/generated/spec-cache/planning/features/로그인.md')

  // 기획이 바뀌고, 동료 A가 그 문서만 정산해 lock을 갱신한 상태를 만든다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책이 추가되었다.\n')
  gitCommitAll(planning, '기획 수정')
  specSyncCli(target, ['fetch', '--cache-only'])
  specSyncCli(target, ['settle', '--doc', 'features/로그인.md'])

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  const sourceCommit = lock.sources.planning.commit
  const docCommit = lock.sources.planning.files['features/로그인.md'].commit
  assert(sourceCommit !== docCommit, 'fixture must have a per-document commit ahead of the source-level commit')

  // 동료 B 재현: 캐시 HEAD는 소스 기준 commit이고 본문은 옛 내용이다.
  run('git', ['checkout', '--quiet', '--force', sourceCommit], { cwd: path.join(target, '.harness/generated/spec-cache/planning') })
  assert(!read(target, '.harness/generated/spec-cache/planning/features/로그인.md').includes('잠금 정책'), 'fixture: cache should start at the stale content')

  // 수화는 HEAD가 같아도 문서 불일치를 잡아내야 한다.
  specSyncCli(target, ['hydrate'])
  assert(fs.readFileSync(cacheDoc, 'utf8').includes('잠금 정책'), 'hydration must update documents whose per-document commit moved, even when the source HEAD matches')
  assert(!specSyncCli(target, ['status']).includes('기준 본문이 아직 준비되지 않았습니다'), 'cache must match lock after per-document hydration')

  // 캐시 문서가 삭제·변조된 경우도 복구한다.
  fs.rmSync(cacheDoc)
  specSyncCli(target, ['hydrate'])
  assert(exists(target, '.harness/generated/spec-cache/planning/features/로그인.md'), 'a deleted cached document must be restored')

  fs.writeFileSync(cacheDoc, '손으로 고친 내용\n')
  specSyncCli(target, ['hydrate'])
  assert(fs.readFileSync(cacheDoc, 'utf8').includes('잠금 정책'), 'a tampered cached document must be restored to the baseline content')

  // 이전 수화 잔재(selector 대상인데 lock에 없는 파일)는 제거된다.
  fs.writeFileSync(path.join(target, '.harness/generated/spec-cache/planning/features/잔재.md'), '# 잔재\n')
  specSyncCli(target, ['hydrate'])
  assert(!exists(target, '.harness/generated/spec-cache/planning/features/잔재.md'), 'stale leftovers must be removed by hydration')
}

// P1-2/3(0.2.102 리뷰): 기획자가 문서를 고치거나 새로 올려도, 작업 시작 시점에 알지 못하면
// 개발자는 옛 기준으로 구현하고 push에서야 발견한다. 작업 컨텍스트가 세 상태를 구분해 보여줘야 한다.
function specContextSurfacesChangedAndNewPlanningDocs() {
  const { target, planning } = setupSpecLinkedTarget()

  // 기존 문서 수정 + 신규 문서 추가(둘 다 기준에 아직 반영되지 않은 상태).
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책이 추가되었다.\n')
  fs.writeFileSync(path.join(planning, 'features/포인트지급.md'), '# 포인트지급\n\n포인트 지급 사양입니다.\n')
  gitCommitAll(planning, '기획 개정')

  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(context.includes('기준 이후 바뀐 기획 문서'), 'changed planning docs must be surfaced at task start')
  assert(context.includes('features/로그인.md'), 'the changed doc should be named')

  const newDocContext = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '포인트지급 기능 개발'], { cwd: target })
  // 라벨은 '기준' 축으로만 말한다(0.2.113). '새로 올라온'은 기획팀의 행위를 주장하지만,
  // 하네스가 아는 것은 '우리 lock에 없다'뿐이다 — 예전 문서가 편입에서 빠진 경우도 같은 상태다.
  assert(newDocContext.includes('기준에 없는 기획 문서'), 'a doc outside the baseline must be discoverable before it enters the lock')
  assert(!newDocContext.includes('새로 올라온'), 'the label must not claim the planning team just uploaded it')
  assert(newDocContext.includes('features/포인트지급.md'), 'the new doc should be named')
  assert(!newDocContext.includes('매칭되는 기획 문서를 찾지 못했습니다'), 'a relevant new doc must not be reported as "no related spec"')

  // 최신 확인은 비파괴다: 기준(lock)도 캐시 본문도 움직이지 않는다.
  const lockAfter = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert(!('features/포인트지급.md' in lockAfter.sources.planning.files), 'freshness check must not enroll new docs into the baseline')
  assert(!read(target, '.harness/generated/spec-cache/planning/features/로그인.md').includes('잠금 정책'), 'freshness check must leave cached bodies at the baseline')

  // 기획 저장소에 접근할 수 없으면 "확인하지 못함"을 명시하고 기준으로 진행한다.
  const away = `${planning}-offline`
  fs.renameSync(planning, away)
  fs.rmSync(path.join(target, '.harness/generated/spec-hydration-status.json'), { force: true })
  const offline = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(offline.includes('최신 기획 여부를 확인하지 못했습니다'), 'a failed freshness check must be stated, not silently ignored')
  fs.renameSync(away, planning)
}

// 0.2.103 리뷰 P1-1(핵심): 정산은 "실행 시점의 원격 최신"이 아니라 "사람이 실제로 읽은 스냅샷"만 기록해야 한다.
// 그러지 않으면 검토가 끝난 뒤 기획자가 올린 커밋까지 "확인 완료"가 되어 아무도 안 읽은 사양이 기준이 된다.
function specSettleRecordsReviewedSnapshotNotLatest() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))

  // A: 개발자가 확인한 시점
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- A: 잠금 정책이 추가되었다.\n')
  gitCommitAll(planning, '기획 개정 A')
  const commitA = run('git', ['rev-parse', 'HEAD'], { cwd: planning }).trim()
  specSyncCli(target, ['fetch', '--cache-only'])
  assert(exists(target, '.harness/generated/spec-latest/planning/features/로그인.md'), 'the reviewed snapshot must be materialized for reading')

  // B: 검토 후 기획자가 더 올림 (아무도 읽지 않은 상태)
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- B: 아무도 읽지 않은 추가 변경.\n')
  gitCommitAll(planning, '기획 개정 B')

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  const settleOut = specSyncCli(target, ['settle'])
  assert(settleOut.includes('[정산] features/로그인.md'), 'the reviewed document should settle')

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  const settledCommit = lock.sources.planning.files['features/로그인.md'].commit
  assert(settledCommit === commitA, `settle must record the reviewed commit (A), not the current remote head — got ${settledCommit.slice(0, 8)}`)

  const cached = read(target, '.harness/generated/spec-cache/planning/features/로그인.md')
  assert(cached.includes('A: 잠금 정책'), 'baseline body should be the reviewed content')
  assert(!cached.includes('B: 아무도 읽지 않은'), 'unreviewed content must never enter the baseline')

  // B는 다음 확인에서 새 미정산 변경으로 다시 나와야 한다.
  const recheck = specSyncCli(target, ['fetch', '--cache-only'])
  assert(recheck.includes('변경 1'), 'the unreviewed commit must reappear as a pending change')
  assert(specSyncCli(target, ['status']).includes('읽었지만 아직 정산하지 않은'), 'status should list it as pending settlement')
}

// 0.2.103 자체 검토 P1-1(치명): 기준이 다른 경로로 앞서 나갔는데 낡은 스냅샷을 정산하면
// 팀 공유 lock이 **뒤로** 간다. 동료의 정산이 지워지고 기준 본문도 옛것으로 되돌아간다.
function specSettleNeverMovesBaselineBackwards() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  fs.appendFileSync(path.join(planning, docPath), '\n- A 변경\n')
  gitCommitAll(planning, 'A')
  specSyncCli(target, ['fetch', '--cache-only'])   // 스냅샷 = A

  fs.appendFileSync(path.join(planning, docPath), '\n- B 변경\n')
  gitCommitAll(planning, 'B')
  const commitB = run('git', ['rev-parse', 'HEAD'], { cwd: planning }).trim()
  specSyncCli(target, ['fetch', '--move-baseline'])  // 기준이 B로 앞서감

  const lockBefore = JSON.parse(read(target, '.harness/spec-lock.json')).sources.planning.files[docPath].commit
  assert(lockBefore === commitB, 'fixture: baseline must be at B before settling')

  // 낡은 스냅샷(A)으로 정산하려 하면 거부해야 한다.
  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'settling a snapshot older than the current baseline must be refused',
  )
  assert(out.includes('기준이 이미 바뀌어'), 'the refusal should explain that the baseline moved on')

  const lockAfter = JSON.parse(read(target, '.harness/spec-lock.json')).sources.planning.files[docPath].commit
  assert(lockAfter === commitB, `baseline must not move backwards — expected ${commitB.slice(0, 8)}, got ${lockAfter.slice(0, 8)}`)
  assert(read(target, `.harness/generated/spec-cache/planning/${docPath}`).includes('B 변경'), 'baseline body must keep the newer content')

  // 낡은 스냅샷은 정리되어 status가 더 이상 미정산이라 주장하지 않는다.
  assert(!specSyncCli(target, ['status']).includes('읽었지만 아직 정산하지 않은'), 'a stale snapshot must not be reported as pending')
}

// P1-2: 삭제됐다가 되살아난 문서의 낡은 "삭제" 표시가 남아 살아 있는 문서를 기준에서 지우면 안 된다.
function specStaleDeleteSnapshotDoesNotRemoveLiveDoc() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planning = makePlanningRepoWithFiles({
    'features/로그인.md': '# 로그인\n\n로그인 사양.\n',
    'features/결제.md': '# 결제\n\n결제 사양.\n',
  })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: [] }],
  })
  specSyncCli(target, ['fetch'])

  fs.rmSync(path.join(planning, 'features/결제.md'))
  gitCommitAll(planning, '결제 문서 삭제')
  specSyncCli(target, ['fetch', '--cache-only'])   // manifest에 deleted 표시

  fs.writeFileSync(path.join(planning, 'features/결제.md'), '# 결제\n\n결제 사양.\n')
  gitCommitAll(planning, '결제 문서 복구')
  specSyncCli(target, ['fetch', '--cache-only'])   // 이제 삭제 사실이 아니다

  assert(!specSyncCli(target, ['status']).includes('[삭제] features/결제.md'), 'a restored document must not stay marked as deleted')

  // 낡은 삭제 표시가 남아 있으면 여기서 문서가 기준에서 사라진다.
  specSyncCli(target, ['settle'])
  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert('features/결제.md' in lock.sources.planning.files, 'a live document must never be dropped from the baseline by a stale delete marker')
  assert(exists(target, '.harness/generated/spec-cache/planning/features/결제.md'), 'its baseline body must remain available')
}

// P1-3: 캐시가 없는 상태에서 최신을 확인해도 기준 본문 디렉터리에는 최신이 깔리면 안 된다.
function specColdCacheCheckDoesNotLeakLatestIntoBaseline() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 아무도 확인하지 않은 최신.\n')
  gitCommitAll(planning, '기획 개정')
  fs.rmSync(path.join(target, '.harness/generated/spec-cache'), { recursive: true, force: true })

  specSyncCli(target, ['fetch', '--cache-only'])
  const baselineBody = path.join(target, '.harness/generated/spec-cache/planning/features/로그인.md')
  if (fs.existsSync(baselineBody)) {
    assert(!fs.readFileSync(baselineBody, 'utf8').includes('아무도 확인하지 않은 최신'),
      'the baseline cache must never contain unreviewed latest content')
  }
}

// P2-4: 아직 어느 기준에도 없는 문서가 두 소스에 동시에 나타나면 양쪽에 정산하면 안 된다.
function specSettleRefusesNewCollisionAcrossSources() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const alpha = makePlanningRepoWithFiles({ 'features/에이.md': '# A\n\nA 사양.\n' })
  const beta = makePlanningRepoWithFiles({ 'features/비.md': '# B\n\nB 사양.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [
      { id: 'alpha', repo: alpha, ref: 'master', include: ['**/*.md'], exclude: [] },
      { id: 'beta', repo: beta, ref: 'master', include: ['**/*.md'], exclude: [] },
    ],
  })
  specSyncCli(target, ['fetch'])

  // 같은 경로가 양쪽에 새로 생긴다(아직 어느 lock에도 없음).
  fs.writeFileSync(path.join(alpha, 'features/공통.md'), '# 공통 A\n')
  fs.writeFileSync(path.join(beta, 'features/공통.md'), '# 공통 B\n')
  gitCommitAll(alpha, '공통 추가')
  gitCommitAll(beta, '공통 추가')
  specSyncCli(target, ['fetch', '--cache-only'])

  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'features/공통.md']),
    'a path present in two sources must not be settled into both baselines',
  )
  assert(out.includes('어느 문서인지 알 수 없습니다'), 'the refusal should name the ambiguity')

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  const inAlpha = 'features/공통.md' in lock.sources.alpha.files
  const inBeta = 'features/공통.md' in lock.sources.beta.files
  assert(!(inAlpha && inBeta), 'the tool must not create the collision state it forbids')
}

// P2-6: 실패한 최신 확인이 TTL 캐시에서 성공으로 되살아나면 안 된다.
function specFailedFreshnessIsNotReplayedAsSuccess() {
  const { target, planning } = setupSpecLinkedTarget()
  const away = `${planning}-offline`
  fs.renameSync(planning, away)

  const first = specSyncCli(target, ['freshness'])
  assert(first.includes('확인 실패') || first.includes('확인하지 못'), 'the first offline check must report failure')

  const second = specSyncCli(target, ['freshness'])
  assert(!second.includes('최신 기획 확인 완료'), 'a failed check must not be replayed from cache as a success')
  fs.renameSync(away, planning)
}

// 읽지 않은 문서는 정산할 수 없다 — 정산은 "확인했다"는 선언이기 때문이다.
function specSettleRefusesUnreviewedDocuments() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 변경.\n')
  gitCommitAll(planning, '기획 개정')

  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'features/로그인.md']),
    'settling a document nobody read must fail',
  )
  assert(out.includes('아직 읽지 않은 문서는 정산할 수 없습니다'), 'the refusal should explain why')
  assert(out.includes('--cache-only'), 'it should tell how to review first')
}

// 기획 저장소의 심볼릭 링크로 캐시 밖에 쓰지 못한다(커밋된 lock 파괴 방지).
function specHydrationRefusesSymlinkEscape() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  // 링크는 화면 기획 영역 밖(공통 정책)에 둔다 — 이 회귀의 관심사는 경로 탈출이지 쌍 계약이 아니다.
  const planning = makePlanningRepoWithFiles({ 'features/정상.md': '# 정상\n\n정상 사양.\n', 'policies/정책.md': '# 정책\n' })
  fs.mkdirSync(path.join(planning, 'policies'), { recursive: true })
  fs.symlinkSync('../../../../spec-lock.json', path.join(planning, 'policies/탈출.md'))
  run('git', ['add', '-A'], { cwd: planning })
  run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'add symlink'], { cwd: planning })

  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: [] }],
  })
  specSyncCli(target, ['fetch'])

  const lockBefore = read(target, '.harness/spec-lock.json')
  specSyncCli(target, ['hydrate'])
  const lockAfter = read(target, '.harness/spec-lock.json')
  assert(lockAfter === lockBefore, 'a symlinked planning doc must never overwrite the committed lock file')
  JSON.parse(lockAfter) // 파괴되지 않았음을 파싱으로 재확인

  // 중간 디렉터리 심볼릭 링크도 막는다.
  const cacheDir = path.join(target, '.harness/generated/spec-cache/planning')
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-outside-'))
  fs.rmSync(path.join(cacheDir, 'features'), { recursive: true, force: true })
  fs.symlinkSync(outside, path.join(cacheDir, 'features'))
  specSyncCli(target, ['hydrate'])
  assert(fs.readdirSync(outside).length === 0, 'writes must not follow an intermediate directory symlink')
}

// ── 0.2.103 보완 재리뷰 P1-1: 정산의 근거는 기획 저장소의 git 객체다 ──
// manifest도 꺼내둔 본문도 로컬 파일이라 손으로 고칠 수 있다. 둘을 함께 고치면 통과하던 시절에는
// 기획 이력에 없는 내용이 팀 공유 기준(lock)에 들어갔다.
function specSettleRefusesForgedSnapshotBody() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  fs.appendFileSync(path.join(planning, docPath), '\n- 진짜 기획 변경.\n')
  gitCommitAll(planning, '기획 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  // manifest와 본문을 **함께** 위조한다(파일끼리만 대조하면 통과하는 조합).
  const manifestPath = path.join(target, '.harness/generated/spec-latest/planning/.manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const forged = '# 로그인\n\n기획에 없는 위조 사양. 무제한 권한을 허용한다.\n'
  const forgedSha = sha256Text(forged)
  manifest.files[docPath].sha = forgedSha
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(target, `.harness/generated/spec-latest/planning/${docPath}`), forged)

  const lockBefore = read(target, '.harness/spec-lock.json')
  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'a snapshot whose content is not in the planning history must never settle',
  )
  assert(out.includes('기획 이력으로 확인되지 않는'), 'the refusal should name provenance as the reason')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must not change by a single byte when provenance fails')
}

// 가짜 삭제 표시: baseSha까지 맞춰도, 그 commit에 문서가 살아 있으면 기준에서 지우면 안 된다.
function specSettleRefusesForgedDeletion() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  fs.appendFileSync(path.join(planning, docPath), '\n- 변경.\n')
  gitCommitAll(planning, '기획 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const manifestPath = path.join(target, '.harness/generated/spec-latest/planning/.manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const snapshot = manifest.files[docPath]
  manifest.files[docPath] = { deleted: true, commit: snapshot.commit, baseSha: snapshot.baseSha }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const lockBefore = read(target, '.harness/spec-lock.json')
  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'a forged deletion marker must not drop a live document from the baseline',
  )
  assert(out.includes('살아 있습니다'), 'the refusal should say the document still exists at that commit')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must stay byte-identical')
  assert(docPath in JSON.parse(lockBefore).sources.planning.files, 'fixture sanity: the doc is in the baseline')
}

// 다른 저장소에서 만들어진 확인 기록으로는 정산할 수 없다.
function specSettleRefusesSnapshotFromAnotherRepo() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  fs.appendFileSync(path.join(planning, docPath), '\n- 변경.\n')
  gitCommitAll(planning, '기획 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const manifestPath = path.join(target, '.harness/generated/spec-latest/planning/.manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.repo = '/somewhere/else/planning.git'
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const lockBefore = read(target, '.harness/spec-lock.json')
  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'a snapshot recorded against a different repository must be refused',
  )
  assert(out.includes('지금 연동된 기획 저장소의 것이 아니'), 'the refusal should name the identity mismatch')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must stay byte-identical')
}

// ── 재리뷰 P1-2: 보호 루트 자체가 링크여도 그 아래로 나가면 안 된다 ──
function specStorageRootSymlinkIsRefused() {
  const { target, planning } = setupSpecLinkedTarget()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-outside-root-'))

  // (a) 기준 본문 루트가 링크인 경우 — 수화가 그 너머로 쓰면 안 된다.
  const cacheDir = path.join(target, '.harness/generated/spec-cache/planning')
  fs.rmSync(cacheDir, { recursive: true, force: true })
  fs.symlinkSync(outside, cacheDir)
  try { specSyncCli(target, ['hydrate']) } catch { /* 링크 거부로 실패해도 좋다 — 밖으로 쓰지만 않으면 된다 */ }
  assert(fs.readdirSync(outside).length === 0, 'hydration must not write through a symlinked cache source root')
  fs.unlinkSync(cacheDir)

  // (b) 최신 사본 루트가 링크인 경우 — 최신 확인이 그 너머로 쓰면 안 된다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 변경.\n')
  gitCommitAll(planning, '기획 개정')
  const latestDir = path.join(target, '.harness/generated/spec-latest/planning')
  fs.rmSync(latestDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(latestDir), { recursive: true })
  fs.symlinkSync(outside, latestDir)
  try { specSyncCli(target, ['fetch', '--cache-only']) } catch { /* 위와 같다 */ }
  assert(fs.readdirSync(outside).length === 0, 'the latest check must not write through a symlinked latest source root')
}

// 읽기 경로도 링크를 따라가면 안 된다 — 쓰기만 막으면 "읽기로 새는" 비대칭이 남는다.
function specContextRefusesSymlinkedSpecBody() {
  const { target } = setupSpecLinkedTarget()
  const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-secret-'))
  const secret = path.join(secretDir, 'secret.md')
  fs.writeFileSync(secret, '# 비밀\n\n로그인 기능 관련 사내 기밀 문서입니다.\n')

  const cacheDoc = path.join(target, '.harness/generated/spec-cache/planning/features/로그인.md')
  fs.rmSync(cacheDoc, { force: true })
  fs.symlinkSync(secret, cacheDoc)
  // 원격 복구가 링크를 정상 파일로 되돌리지 못하도록 오프라인 상태로 만든다.
  fs.rmSync(path.join(target, '.harness/generated/spec-cache/planning/.git'), { recursive: true, force: true })

  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(!context.includes('사내 기밀'), 'a symlinked cache document must never be read as the current spec')
}

// ── 재리뷰 P1-3: 핵심 상태 파일 손상은 "연동 없음"이 아니다 ──
function specCorruptedStateFilesFailClosed() {
  const { target } = setupSpecLinkedTarget()
  const sourcesPath = path.join(target, '.harness/spec-sources.json')
  const lockPath = path.join(target, '.harness/spec-lock.json')
  const sourcesText = fs.readFileSync(sourcesPath, 'utf8')
  const lockText = fs.readFileSync(lockPath, 'utf8')

  // (a) 선언 손상 — "연동 안 함"으로 보이면 안 된다.
  fs.writeFileSync(sourcesPath, '{ 이건 JSON이 아니다')
  const sourcesOut = expectFailure(() => specSyncCli(target, ['status']), 'a corrupted spec-sources.json must fail')
  assert(sourcesOut.includes('spec-sources.json을 해석할 수 없습니다'), 'the corruption must be named explicitly')
  assert(!sourcesOut.includes('아직 설정되지 않았습니다'), 'corruption must never be reported as "not configured"')
  // 커밋 검증은 손상을 반드시 알린다.
  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('spec-sources.json을 해석할 수 없습니다'), 'doc-link should name the corrupted file')
  fs.writeFileSync(sourcesPath, sourcesText)

  // (b) 기준 손상 — "기준 없음"으로 축소되면 기획 없이 작업하게 된다.
  fs.writeFileSync(lockPath, '{ "sources": ')
  const lockOut = expectFailure(() => specSyncCli(target, ['status']), 'a corrupted spec-lock.json must fail')
  assert(lockOut.includes('spec-lock.json을 해석할 수 없습니다'), 'the corrupted lock must be named')
  fs.writeFileSync(lockPath, lockText)

  // (c) 최신 확인 기록 손상 — 미정산이 조용히 사라지면 안 된다.
  specSyncCli(target, ['fetch', '--cache-only'])
  const manifestPath = path.join(target, '.harness/generated/spec-latest/planning/.manifest.json')
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, '{ broken')
  const settleOut = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'features/로그인.md']),
    'settle must refuse to run against a corrupted manifest',
  )
  assert(settleOut.includes('손상되었습니다'), 'the corrupted manifest must be named')
  // 복구 경로: 전 소스를 다시 확인하는 명령은 기록을 재생성한다.
  specSyncCli(target, ['fetch', '--cache-only'])
  JSON.parse(read(target, '.harness/generated/spec-latest/planning/.manifest.json'))
}

// ── 재리뷰 P1-4: spec-latest 디렉터리는 manifest의 정확한 집합이어야 한다 ──
// 도구는 "삭제됨/정산됨"이라 판정하는데 폴더에는 옛 본문이 남아 있으면, 사람은 그것을 현행으로 읽는다.
function specLatestDirectoryIsExactSnapshotSet() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planning = makePlanningRepoWithFiles({
    'features/로그인.md': '# 로그인\n\n로그인 사양.\n',
    'features/결제.md': '# 결제\n\n결제 사양.\n',
  })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: [] }],
  })
  specSyncCli(target, ['fetch'])
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/결제.md` | `src/pay/**` | |',
  ].join('\n'))

  // (a) 변경 → 삭제: 앞선 확인이 꺼내둔 본문이 남아 있으면 안 된다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 변경 1.\n')
  gitCommitAll(planning, '로그인 개정')
  specSyncCli(target, ['fetch', '--cache-only'])
  assert(exists(target, '.harness/generated/spec-latest/planning/features/로그인.md'), 'fixture: the changed body should be materialized')

  fs.rmSync(path.join(planning, 'features/로그인.md'))
  fs.rmSync(path.join(planning, 'features/로그인.html'), { force: true })
  gitCommitAll(planning, '로그인 문서 삭제')
  specSyncCli(target, ['fetch', '--cache-only'])
  assert(!exists(target, '.harness/generated/spec-latest/planning/features/로그인.md'),
    'a document reported as deleted must not remain readable in the latest folder')

  // (b) 변경 → 정산: 소비된 스냅샷의 본문도 남으면 안 된다(이미 기준이 된 내용이 "최신 변경"처럼 보인다).
  fs.appendFileSync(path.join(planning, 'features/결제.md'), '\n- 결제 변경.\n')
  gitCommitAll(planning, '결제 개정')
  specSyncCli(target, ['fetch', '--cache-only'])
  assert(exists(target, '.harness/generated/spec-latest/planning/features/결제.md'), 'fixture: the changed body should be materialized')

  fs.mkdirSync(path.join(target, 'src/pay'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/pay/index.js'), 'export const pay = () => {}\n')
  specSyncCli(target, ['settle'])
  assert(!exists(target, '.harness/generated/spec-latest/planning/features/결제.md'),
    'a settled snapshot must be removed from the latest folder together with its manifest entry')
  const manifest = JSON.parse(read(target, '.harness/generated/spec-latest/planning/.manifest.json'))
  assert(!('features/결제.md' in (manifest.files ?? {})), 'the manifest entry must be consumed too')
}

// ── 3차 리뷰 P1-1: JSON으로 읽힌다는 것과 기준으로 쓸 수 있다는 것은 다르다 ──
// 값 하나만 망가뜨리면 normalizeLock이 그 문서를 조용히 버려, 그 문서는 "기준에 없는 문서"가 되고
// push 게이트의 drift 검사가 통째로 건너뛰어졌다.
function specCorruptedLockSchemaFailsClosed() {
  const { target } = setupSpecLinkedTarget()
  const lockPath = path.join(target, '.harness/spec-lock.json')
  const original = fs.readFileSync(lockPath, 'utf8')

  const broken = [
    ['sha 타입 오류', (lock) => { lock.sources.planning.files['features/로그인.md'] = { sha: 123 } }],
    ['commit 누락', (lock) => { lock.sources.planning.files['features/로그인.md'] = { sha: 'a'.repeat(64) }; lock.sources.planning.commit = null }],
    ['files가 배열', (lock) => { lock.sources.planning.files = [] }],
    ['version 오류', (lock) => { lock.version = 3 }],
    ['selector 형태 오류', (lock) => { lock.sources.planning.selector = { include: 'all' } }],
    ['안전하지 않은 문서 경로', (lock) => { lock.sources.planning.files['../탈출.md'] = { sha: 'a'.repeat(64), commit: 'abcdef1' } }],
  ]

  for (const [label, mutate] of broken) {
    const lock = JSON.parse(original)
    mutate(lock)
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    const out = expectFailure(() => specSyncCli(target, ['status']), `schema 손상(${label})은 fail-closed여야 한다`)
    assert(out.includes('spec-lock.json'), `${label}: 어느 파일이 문제인지 밝혀야 한다`)
    assert(!out.includes('아직 설정되지 않았습니다'), `${label}: 손상을 미연동으로 강등하면 안 된다`)
  }

  fs.writeFileSync(lockPath, original)
  specSyncCli(target, ['status'])
}

// ── 3차 리뷰 P1-2: 실재하는 과거 commit으로도 기준을 되돌릴 수 없다 ──
function specSettleRefusesRollbackToRealPastCommit() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  // A(과거) → B(현재 기준) → C(최신 확인)
  fs.appendFileSync(path.join(planning, docPath), '\n- A 변경\n')
  gitCommitAll(planning, 'A')
  const commitA = run('git', ['rev-parse', 'HEAD'], { cwd: planning }).trim()
  const contentA = fs.readFileSync(path.join(planning, docPath), 'utf8')
  specSyncCli(target, ['fetch', '--move-baseline'])   // 기준 = A

  fs.appendFileSync(path.join(planning, docPath), '\n- B 변경\n')
  gitCommitAll(planning, 'B')
  specSyncCli(target, ['fetch', '--move-baseline'])   // 기준 = B

  fs.appendFileSync(path.join(planning, docPath), '\n- C 변경\n')
  gitCommitAll(planning, 'C')
  specSyncCli(target, ['fetch', '--cache-only'])      // 스냅샷 = C, baseSha = B

  const lockBefore = read(target, '.harness/spec-lock.json')
  const baselineB = JSON.parse(lockBefore).sources.planning.files[docPath]

  // 최신 확인 기록 전체를 실제 과거 commit A로 **일관되게** 위조한다(내부 정합 검사도 통과하도록).
  // A는 진짜 git 이력이라 provenance가 통과하고, baseSha는 B 그대로라 compare-and-swap도 통과한다
  // — 남은 방어선은 조상 관계 검사뿐이다.
  const htmlPath = 'features/로그인.html'
  const contentHtmlA = run('git', ['show', `${commitA}:${htmlPath}`], { cwd: planning })
  const lockedHtml = JSON.parse(lockBefore).sources.planning.files[htmlPath]
  const manifestPath = path.join(target, '.harness/generated/spec-latest/planning/.manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.commit = commitA
  manifest.files = {
    [docPath]: { sha: sha256Text(contentA), commit: commitA, baseSha: baselineB.sha },
    [htmlPath]: { sha: sha256Text(contentHtmlA), commit: commitA, baseSha: lockedHtml.sha },
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(path.join(target, `.harness/generated/spec-latest/planning/${docPath}`), contentA)
  fs.writeFileSync(path.join(target, `.harness/generated/spec-latest/planning/${htmlPath}`), contentHtmlA)

  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'settling a real but older commit must not move the baseline backwards',
  )
  assert(out.includes('보다 과거입니다'), 'the refusal should say the target is older than the baseline')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must stay byte-identical')
}

// 문서별 commit만 갈아끼우는 조작(그 확인의 commit과 불일치)도 거부한다.
function specSettleRefusesSnapshotCommitMismatch() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  fs.appendFileSync(path.join(planning, docPath), '\n- A 변경\n')
  gitCommitAll(planning, 'A')
  const commitA = run('git', ['rev-parse', 'HEAD'], { cwd: planning }).trim()
  specSyncCli(target, ['fetch', '--move-baseline'])

  fs.appendFileSync(path.join(planning, docPath), '\n- B 변경\n')
  gitCommitAll(planning, 'B')
  specSyncCli(target, ['fetch', '--cache-only'])

  const manifestPath = path.join(target, '.harness/generated/spec-latest/planning/.manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.files[docPath].commit = commitA  // 확인 commit과 다르게
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const lockBefore = read(target, '.harness/spec-lock.json')
  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'a per-document commit that disagrees with its check must be refused',
  )
  assert(out.includes('스냅샷 commit이 그 확인의 commit과 다릅니다'), 'the refusal should name the inconsistency')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must stay byte-identical')
}

// 캐시 저장소를 다른 저장소로 바꿔치기해 "실재하는 commit"을 공급하는 경로도 막는다.
function specSettleRefusesSwappedCacheOrigin() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  fs.appendFileSync(path.join(planning, docPath), '\n- 변경\n')
  gitCommitAll(planning, '기획 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const other = makePlanningRepoWithFiles({ 'features/로그인.md': '# 로그인\n\n다른 저장소의 사양.\n' })
  run('git', ['remote', 'set-url', 'origin', other], { cwd: path.join(target, '.harness/generated/spec-cache/planning') })

  const lockBefore = read(target, '.harness/spec-lock.json')
  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'a cache repository pointing at a different origin must be refused',
  )
  assert(out.includes('origin'), 'the refusal should name the origin mismatch')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must stay byte-identical')
}

// ── 3차 리뷰 P2-1: 선언↔기준이 이미 어긋난 상태에서 정산하면 혼합 lock이 만들어진다 ──
function specSettleRefusesWhenDeclarationDrifted() {
  const { target, planning } = setupSpecLinkedTarget()
  const docPath = 'features/로그인.md'

  fs.appendFileSync(path.join(planning, docPath), '\n- 변경\n')
  gitCommitAll(planning, '기획 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  // 선언의 selector만 바꾼다(기준 기록은 옛 selector 그대로).
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: [] }],
  })

  const lockBefore = read(target, '.harness/spec-lock.json')
  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', docPath]),
    'settling while the declaration disagrees with the baseline must be refused',
  )
  assert(out.includes('어긋난 상태에서는 정산할 수 없습니다'), 'the refusal should explain the declaration drift')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must stay byte-identical')
}

// ── 3차 리뷰 P2-2/P2-3: 선언만 사라진 상태 + 전역 상태 오류의 본문 주입 차단 ──
function specLockOnlyAndGlobalFailureAreSurfaced() {
  const { target } = setupSpecLinkedTarget()

  // (a) lock만 남고 선언이 사라진 상태는 정합 오류로 보고해야 한다.
  const sourcesPath = path.join(target, '.harness/spec-sources.json')
  const sourcesText = fs.readFileSync(sourcesPath, 'utf8')
  fs.rmSync(sourcesPath)
  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('spec-sources.json이 없습니다'), 'a lock without a declaration must be reported')
  fs.writeFileSync(sourcesPath, sourcesText)

  // (b) 전역 상태 오류에서는 캐시 본문이 사양으로 주입되면 안 된다.
  fs.writeFileSync(sourcesPath, '{ 깨진 선언')
  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(!context.includes('로그인 사양'), 'cached bodies must not be injected while the linkage state is unreadable')
  fs.writeFileSync(sourcesPath, sourcesText)
}

// ── 화면 링크 계약(기획자 합의): MD가 화면을 링크하면 그 화면은 문서의 일부다 ──
// 경로 관례가 아니라 **문서가 선언한 링크**로 판정한다. 링크가 없으면 정책만 다루는 문서다.
function specScreenLinkIntegrityIsEnforced() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const link = (repo) => {
    writeJson(target, '.harness/spec-sources.json', {
      version: 1,
      sources: [{ id: 'planning', repo, ref: 'master', exclude: ['**/README.md', 'archive/**'] }],
    })
    fs.rmSync(path.join(target, '.harness/spec-lock.json'), { force: true })
    fs.rmSync(path.join(target, '.harness/generated'), { recursive: true, force: true })
  }

  // (a) 링크한 화면이 없으면 실패 — 이것이 진짜 "짝 누락"이다.
  link(makePlanningRepoRaw({ 'features/a11.md': '# a11\n\n화면: [a11](./a11.html)\n' }))
  let out = expectFailure(() => specSyncCli(target, ['fetch']), 'a linked screen that does not exist must fail')
  assert(out.includes('features/a11.html'), 'the missing screen file should be named')

  // (b) 링크가 없으면 정책 문서다 — features/ 아래여도 정상이고, README도 마찬가지다.
  link(makePlanningRepoRaw({
    'features/README.md': '# 폴더 안내\n',
    'features/정책만.md': '# 정책\n\n화면 없이 규칙만 정의합니다.\n',
    'policies/공통.md': '# 공통\n',
  }))
  specSyncCli(target, ['fetch'])
  let lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  assert('features/정책만.md' in lock.sources.planning.files, 'a policy-only doc under features/ needs no screen')

  // (c) 링크가 있으면 화면이 기준에 함께 들어온다(include에 html이 없어도).
  link(makePlanningRepoRaw({
    'features/로그인.md': '# 로그인\n\n[화면](./로그인.html)\n',
    'features/로그인.html': '<h1>로그인</h1>\n',
    'policies/공통.md': '# 공통\n',
  }))
  specSyncCli(target, ['fetch'])
  lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  const files = Object.keys(lock.sources.planning.files)
  assert(files.includes('features/로그인.md') && files.includes('features/로그인.html'),
    'a linked screen enters the baseline together with its document')
  assert(files.includes('policies/공통.md'), 'a policy MD still needs no screen')

  // (d) 코드 블록·인라인 코드 안의 예시 링크는 링크가 아니다 —
  //     "이렇게 링크하세요"라고 알려주는 안내문이 스스로 연동 오류를 내면 안 된다(실물 E2E에서 발견).
  link(makePlanningRepoRaw({
    'policies/작성안내.md': '# 작성 안내\n\n화면은 이렇게 링크합니다.\n\n```markdown\n- 화면: [로그인.html](./로그인.html)\n```\n\n인라인 예시도 마찬가지입니다: `[화면](./없는화면.html)`\n',
  }))
  specSyncCli(target, ['fetch'])
  assert(!('policies/로그인.html' in JSON.parse(read(target, '.harness/spec-lock.json')).sources.planning.files),
    'an example link inside a code block must not be treated as a real screen link')

  // (e) 아무 문서도 참조하지 않는 화면 파일은 떠도는 상태로 잡는다.
  link(makePlanningRepoRaw({ 'features/떠돌이.html': '<h1>떠돌이</h1>\n', 'policies/공통.md': '# 공통\n' }))
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: JSON.parse(read(target, '.harness/spec-sources.json')).sources[0].repo, ref: 'master', include: ['**/*.md', '**/*.html'], exclude: [] }],
  })
  out = expectFailure(() => specSyncCli(target, ['fetch']), 'a screen referenced by nothing must be reported')
  assert(out.includes('떠돌이.html'), 'the dangling screen should be named')

  // 기획 저장소 CI용 독립 명령도 같은 판정을 한다.
  const broken = makePlanningRepoRaw({ 'features/a11.md': '# a11\n\n[화면](./a11.html)\n' })
  const check = expectFailure(
    () => specSyncCli(target, ['screen-check', '--dir', broken]),
    'the standalone screen check must fail on a broken link',
  )
  assert(check.includes('features/a11.html'), 'the standalone check should name the missing screen')
}

// 화면만 바뀌어도 문서 단위 전체가 변경으로 잡히고, 정산은 둘을 같은 시점으로 함께 기록한다.
function specScreenLinkSettlesAtomically() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | 대표 문서 한 줄만 기록 |',
  ].join('\n'))

  fs.writeFileSync(path.join(planning, 'features/로그인.html'), '<h1>로그인 화면 v2</h1>\n<p>소셜 로그인 버튼 추가.</p>\n')
  gitCommitAll(planning, '화면 개정')
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: planning }).trim()

  const check = specSyncCli(target, ['fetch', '--cache-only'])
  assert(check.includes('features/로그인.html'), 'a screen-only change must be reported')
  assert(exists(target, '.harness/generated/spec-latest/planning/features/로그인.md'),
    'the whole document unit must be materialized, not just the changed screen')

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  const settled = specSyncCli(target, ['settle', '--doc', 'features/로그인.md'])
  assert(settled.includes('features/로그인.html'), 'settling the document must settle the screen it links')

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  const md = lock.sources.planning.files['features/로그인.md']
  const html = lock.sources.planning.files['features/로그인.html']
  assert(md.commit === html.commit, `document and screen must share one reviewed commit — got ${md.commit?.slice(0, 8)} / ${html.commit?.slice(0, 8)}`)
  assert(md.commit === commit, 'both must be recorded at the reviewed commit')

  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(context.includes('화면'), 'the context must surface the linked screen')
  assert(context.includes('features/로그인.html'), 'the screen path must be shown')
  assert(context.includes('검토 시점'), 'the shared reviewed commit must be shown')
}

// ── 4차 리뷰 P1-4: lock에 없는 문서도 과거 commit에서 되살릴 수 없다 ──
function specSettleRefusesRevivingDeletedDocFromPast() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planning = makePlanningRepoRaw({ 'policies/공통.md': '# 공통\n', 'policies/폐기예정.md': '# 폐기예정\n\n옛 정책.\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', exclude: [] }],
  })
  specSyncCli(target, ['fetch'])
  const commitA = run('git', ['rev-parse', 'HEAD'], { cwd: planning }).trim()
  const contentA = fs.readFileSync(path.join(planning, 'policies/폐기예정.md'), 'utf8')

  // 기획팀이 문서를 폐기하고, 팀 기준도 그 시점(B)으로 옮긴다 → lock에서 사라진다.
  fs.rmSync(path.join(planning, 'policies/폐기예정.md'))
  gitCommitAll(planning, '폐기')
  specSyncCli(target, ['fetch', '--move-baseline'])
  const lockBefore = read(target, '.harness/spec-lock.json')
  assert(!('policies/폐기예정.md' in JSON.parse(lockBefore).sources.planning.files), 'fixture: the doc must be gone from the baseline')

  // 과거 commit A의 실제 내용으로 "신규 문서"인 척 되살린다. lock에 없으니 기준 비교 대상이 없다.
  specSyncCli(target, ['fetch', '--cache-only'])
  const manifestPath = path.join(target, '.harness/generated/spec-latest/planning/.manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.commit = commitA
  manifest.files = { 'policies/폐기예정.md': { sha: sha256Text(contentA), commit: commitA, baseSha: null } }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.mkdirSync(path.join(target, '.harness/generated/spec-latest/planning/policies'), { recursive: true })
  fs.writeFileSync(path.join(target, '.harness/generated/spec-latest/planning/policies/폐기예정.md'), contentA)

  const out = expectFailure(
    () => specSyncCli(target, ['settle', '--doc', 'policies/폐기예정.md']),
    'a document deleted before the baseline must not be revived from an older commit',
  )
  assert(out.includes('과거입니다'), 'the refusal should say the target predates the baseline')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'the lock must stay byte-identical')
}

// 저장소 어디에도 링크되지 않은 화면 파일은 include와 무관하게 드러나야 한다.
function specUnlinkedScreenIsSurfacedRegardlessOfInclude() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planning = makePlanningRepoRaw({
    'policies/공통.md': '# 공통\n',
    'features/화면만.html': '<h1>아무도 링크하지 않은 화면</h1>\n',
  })
  // include는 markdown뿐 — 종전에는 이 html이 선택되지 않아 검사 자체가 없었다.
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: ['**/README.md'] }],
  })
  const out = expectFailure(() => specSyncCli(target, ['fetch']), 'an unlinked screen must be surfaced even with an md-only include')
  assert(out.includes('features/화면만.html'), 'the unlinked screen should be named')
}

// 훅은 clone으로 공유되지 않는다 — 미설치 상태를 검사가 알려줘야 한다.
function specGuardNoticesMissingHookInstall() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  // 미설치 상태로 만든다(래퍼 제거).
  for (const name of ['pre-commit', 'pre-push']) fs.rmSync(path.join(target, '.git/hooks', name), { force: true })

  const out = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(out.includes('git hook 미설치'), 'a clone without hooks must be told')
  assert(out.includes('.harness/bin/harness hooks:install'), 'the install command must be shown')
  assert(!out.includes('harness:hooks:install'), 'the command must be the one that actually exists')

  run(nodeBin, [path.join(target, '.harness/bin/install-hooks.mjs')], { cwd: target })
  const after = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!after.includes('git hook 미설치'), 'an installed clone must not be nagged')
}

// 최신 사본 정리 중 본문을 못 읽으면 기록에서도 빠져야 한다(기록과 디렉터리가 어긋나면 안 된다).
function specLatestPruneKeepsRecordAndFilesInSync() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))

  fs.mkdirSync(path.join(planning, 'policies'), { recursive: true })
  fs.writeFileSync(path.join(planning, 'policies/추가.md'), '# 추가\n')
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 변경.\n')
  gitCommitAll(planning, '기획 개정')
  specSyncCli(target, ['fetch', '--cache-only'])

  const latestRoot = path.join(target, '.harness/generated/spec-latest/planning')
  const manifestPath = path.join(latestRoot, '.manifest.json')
  assert('policies/추가.md' in JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files, 'fixture: the new doc should be recorded')

  // 남을 예정인 문서의 본문을 밖에서 지운다 — 정리 후 기록에도 남아 있으면 안 된다.
  fs.rmSync(path.join(latestRoot, 'policies/추가.md'))

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  specSyncCli(target, ['settle', '--doc', 'features/로그인.md'])

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const rel of Object.keys(manifest.files ?? {})) {
    if (manifest.files[rel]?.deleted) continue
    assert(exists(target, `.harness/generated/spec-latest/planning/${rel}`),
      `record and directory must agree — ${rel} is recorded but missing on disk`)
  }
}

// ── 실전(멀티사이트 온보딩): 1MiB 넘는 화면 파일이 기준에서 조용히 빠졌다 ──
// gitShowText의 execFileSync 기본 maxBuffer(1MiB)에 걸린 실패가 "문서 없음"과 같은 null로
// 뭉개져, 3.5MB 화면 HTML이 lock에서 빠진 채 "동기화 완료"가 됐다. ls-tree에는 maxBuffer를
// 넣고(0.2.103) git show를 빠뜨린 반쪽 수정이었다.
function specLargeScreenFileEntersBaseline() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const bigHtml = `<h1>큰 화면</h1>\n<div>${'x'.repeat(2 * 1024 * 1024)}</div>\n`
  const planning = makePlanningRepoRaw({
    'features/큰화면.md': '# 큰화면\n\n- 화면: [큰화면.html](./큰화면.html)\n',
    'features/큰화면.html': bigHtml,
  })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', exclude: ['**/README.md'] }],
  })
  specSyncCli(target, ['fetch'])

  const files = JSON.parse(read(target, '.harness/spec-lock.json')).sources.planning.files
  assert('features/큰화면.html' in files, 'a >1MiB screen file must enter the baseline, not vanish silently')
  assert(files['features/큰화면.html'].sha === sha256Text(bigHtml), 'its recorded hash must match the real content')
  // 기준 본문도 통째로 수화됐는지 확인.
  assert(read(target, '.harness/generated/spec-cache/planning/features/큰화면.html').length === bigHtml.length,
    'the hydrated baseline body must be complete')
}

// ── 0.2.104: 도입 직후(매핑 0건)가 사각지대였다 ──
// 매핑 커버리지는 "이미 매핑이 있는 영역"을 기준으로 도는 구조라, 매핑이 0건이면 아무 말도 하지 않았다.
// 실제 도입 시점이 정확히 그 상태(기획은 다 있고 코드는 스캐폴딩)라 시작을 유도하는 곳이 없었다.
function specStatusGuidesMappingAtStart() {
  const { target } = setupSpecLinkedTarget()

  const status = specSyncCli(target, ['status'])
  assert(status.includes('매핑은 아직 0건입니다'), 'a freshly linked project must be told the empty mapping is normal')
  assert(status.includes('정상적인 시작 상태'), 'it must not read like an error')
  assert(status.includes('매핑되지 않은 기획'), 'the unmapped spec list must be shown')
  assert(!status.includes('구현되지 않은'), 'the label must not claim implementation status — the tool only knows mapping presence')
  assert(status.includes('features/로그인.md'), 'the spec doc should be listed')
  // 링크된 화면은 대표 문서로 매핑되므로 별도 매핑 대상이 아니다.
  assert(!status.includes('features/로그인.html'), 'a linked screen must not be listed as its own mapping target')

  // 커밋 검증에서도 같은 안내가 나온다(개발자가 매일 보는 곳).
  const guard = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(guard.includes('매핑은 아직 0건입니다'), 'the commit advisory must guide the first mapping too')

  // 매핑을 넣으면 그 문서는 목록에서 빠진다.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  const after = specSyncCli(target, ['status'])
  assert(!after.includes('features/로그인.md'), 'a mapped spec must leave the unimplemented list')
  assert(!after.includes('매핑은 아직 0건입니다'), 'the start-up guidance must stop once mapping begins')

  // (코드 없음) 판정도 목록에서 빠진다 — "봤고 불필요"와 "아직 안 봤다"의 구분.
  fs.appendFileSync(path.join(target, '.harness/project/spec-map.md'), '\n| `operations/운영.md` | (코드 없음) | 운영 문서 |\n')
  const exempted = specSyncCli(target, ['status'])
  assert(!exempted.includes('operations/운영.md'), 'an exempted spec must not be listed as unimplemented')
}

// 0.2.103 백로그: 매핑되지 않은 문서의 화면이 기준에서 어긋나도 아무도 보지 않았다.
function specStatusFlagsDocScreenBaselineMismatch() {
  const { target } = setupSpecLinkedTarget()

  // 기준에서 화면의 commit만 다른 값으로 바꾼다(문서와 화면이 다른 시점이 된 상태).
  const lockPath = path.join(target, '.harness/spec-lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  lock.sources.planning.files['features/로그인.html'].commit = 'a'.repeat(40)
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)

  const out = expectFailure(() => specSyncCli(target, ['status']), 'a document/screen baseline mismatch must be reported')
  assert(out.includes('문서와 화면의 기준이 어긋나'), 'the mismatch must be named')
  assert(out.includes('features/로그인.html'), 'the screen should be named')

  // 화면이 기준에서 통째로 빠진 경우도 잡는다.
  const lock2 = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  delete lock2.sources.planning.files['features/로그인.html']
  fs.writeFileSync(lockPath, `${JSON.stringify(lock2, null, 2)}\n`)
  const out2 = expectFailure(() => specSyncCli(target, ['status']), 'a screen missing from the baseline must be reported')
  assert(out2.includes('기준에 없습니다'), 'the missing screen must be named')
}

// 재리뷰 P1-1: 과거 성공 상태가 남아 있어도 "이번 실행"이 실패했으면 실패로 보고해야 한다.
// 과거 결과를 재사용하면 "최신 확인 못함" 경고가 사라져 옛 기준으로 구현하게 된다.
function specFreshnessFailureIsNotMaskedByPastSuccess() {
  const { target, planning } = setupSpecLinkedTarget()

  // 1) 성공 결과를 상태 파일에 남긴다.
  run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(exists(target, '.harness/generated/spec-hydration-status.json'), 'a successful freshness check should be recorded')

  // 2) TTL을 만료시키고(기록 시각을 과거로) 저장소를 오프라인으로 만든다.
  const statusPath = path.join(target, '.harness/generated/spec-hydration-status.json')
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'))
  status.freshness.checkedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`)
  const away = `${planning}-offline`
  fs.renameSync(planning, away)

  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(context.includes('최신 기획 여부를 확인하지 못했습니다'), 'a current failure must not be masked by a previously successful status file')
  fs.renameSync(away, planning)
}

// 재리뷰 P1-2: 캐시는 있지만 lock과 다르고 복구도 실패하면, 그 본문을 사양으로 주입하면 안 된다.
function specContextRefusesUnverifiedBodies() {
  const { target, planning } = setupSpecLinkedTarget()
  const cacheDoc = path.join(target, '.harness/generated/spec-cache/planning/features/로그인.md')

  // 캐시 문서를 lock과 다른 내용으로 오염시키고, 로컬 복구 수단(.git)과 원격을 모두 끊는다.
  // (.git이 남아 있으면 수화가 오프라인에서도 정상 복구한다 — 그건 의도된 동작이다.)
  fs.writeFileSync(cacheDoc, '# 로그인\n\n오래되었거나 변조된 내용. 로그인 사양이라고 주장한다.\n')
  fs.rmSync(path.join(target, '.harness/generated/spec-cache/planning/.git'), { recursive: true, force: true })
  const away = `${planning}-offline`
  fs.renameSync(planning, away)

  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(!context.includes('오래되었거나 변조된'), 'an unverified cached body must never be injected as the current spec')
  assert(context.includes('기획 본문을 팀 기준으로 준비하지 못했습니다') || context.includes('본문이 이 환경에 아직 없습니다'),
    'the agent must be told the body could not be prepared')
  assert(context.includes('--at-lock'), 'recovery command should be shown')
  fs.renameSync(away, planning)
}

// 재리뷰 P1-3: 파일명이 요청어와 달라도(REQ-142.md) 관련 변경·신규를 숨기면 안 된다.
function specContextSurfacesOpaquelyNamedDocs() {
  const { target, planning } = setupSpecLinkedTarget()

  // (a) 본문으로 후보가 된 기존 문서의 최신 변경은 파일명이 안 맞아도 반드시 표시된다.
  fs.writeFileSync(path.join(planning, 'features/REQ-142.md'), '# REQ-142\n\n포인트 지급 규칙을 정의합니다.\n')
  gitCommitAll(planning, '신규 요구사항')
  specSyncCli(target, ['fetch', '--move-baseline'])
  fs.appendFileSync(path.join(planning, 'features/REQ-142.md'), '\n- 지급 한도가 추가되었다.\n')
  gitCommitAll(planning, '요구사항 개정')

  const changedContext = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '포인트 지급 기능 수정'], { cwd: target })
  assert(changedContext.includes('REQ-142.md'), 'a body-matched doc must be reported as changed even when its filename does not match the request')
  assert(changedContext.includes('기준 이후 바뀐 기획 문서'), 'the change warning section should be present')

  // (b) 파일명으로 판단할 수 없는 신규 문서는 숨기지 말고 "관련성 미판정"으로 노출한다.
  fs.writeFileSync(path.join(planning, 'features/REQ-999.md'), '# REQ-999\n\n쿠폰 발급 사양입니다.\n')
  gitCommitAll(planning, '신규 요구사항 2')
  fs.rmSync(path.join(target, '.harness/generated/spec-hydration-status.json'), { force: true })

  const addedContext = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '쿠폰 발급 개발'], { cwd: target })
  assert(addedContext.includes('REQ-999.md'), 'an opaquely named new doc must still be surfaced for the developer to check')
}

// P1-4(0.2.102 리뷰): 매핑된 영역의 "기존 미매핑 파일 수정"도 검출해야 한다.
// 신규 파일만 보면, 그 파일을 계속 고치는 동안 아무 안내 없이 사각지대가 유지된다.
function specMappingCoverageDetectsModifiedExistingFiles() {
  const { target } = setupSpecLinkedTarget()

  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  fs.mkdirSync(path.join(target, 'src/views/legacy'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/legacy/OldView.vue'), '<template><div /></template>\n')
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/views/login/**` | |',
  ].join('\n'))
  gitCommitAll(target, 'baseline')

  // 신규 파일이 아니라 "기존 미매핑 파일 수정"이다.
  fs.appendFileSync(path.join(target, 'src/views/legacy/OldView.vue'), '<!-- 수정 -->\n')

  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(advisory.includes('src/views/legacy/OldView.vue'), 'modifying an unmapped existing file in a managed area must be surfaced')


}

export {
  hooksInstallHydratesSpecBodiesForFreshClone,
  hooksInstallStaysQuietWithoutSpecLink,
  specSyncFetchRecordsLockAndDetectsChanges,
  buildContextInjectsRelatedSpecs,
  guardShowsSpecAdvisoryForMappedCodeChange,
  specFetchCacheOnlyDoesNotMoveTeamBaseline,
  specFetchAtLockRehydratesCacheAtBaseline,
  specSettleAdvancesOnlyMyScopedDocs,
  specLinkConsistencyCheckFlagsBrokenDeclarations,
  broadcastSpeaksMixedAudienceLanguage,
  broadcastDistinguishesJudgedDocsFromUnmapped,
  broadcastWithoutCheckRecordAsksForFetchFirst,
  specStatusSeparatesAxesAndFoldsDetectedCount,
  specStatusLabelsLinkedScreenWithItsDocMapping,
  ciBackstopExampleDelegatesToBroadcast,
  ciBackstopLeaderChecklistCoversLiveSetup,
  specLinkAdapterRoutesSecondSourceToAddProcedure,
  specSyncPublicSurfaceStaysLocked,
  specAtLockRestoresExactMixedBaselineSet,
  specMoveBaselineSourceScopeKeepsOtherSourcesIntact,
  specV1LockReadPathsArePureAndMutatingCommandsPromote,
  specSourceValidationInvalidatesWholeState,
  specFetchReclonesWhenRepoUrlChanges,
  specSelectorChangeIsFlaggedByConsistency,
  specUninstallRemovesSpecScripts,
  specStatusDoesNotClaimSyncWhenCacheMissing,
  specSettleRefusesPathCollisionsAcrossSources,
  specReplacedScreenSettlesOldAndNewTogether,
  specSettleFailsClosedWithoutTheBaselineCache,
  specSettleReadsBaselineScreensFromGitObjectsWithoutCheckout,
  specDeletedScreenUnitSettlesTogetherFromBaselineIndex,
  specSettleRefusalLeavesLockUntouchedRegardlessOfV1OrArgOrder,
  specExemptionRowsGetTheSameSourceChecksAsMappings,
  specSettleRefusesAllWhenOneRequestedDocIsMissing,
  specQualifiedRefsSurviveStrictCheckAndScopedSettle,
  specRefsQualifiedBySourceSettleTheRightBaseline,
  specMappingCoverageIsEnforcedForNewFilesInMappedAreas,
  specMapRowsSurviveNotesThatMentionTheHeaderWords,
  specNoticeScopesUnrelatedServicesToOneFoldedLine,
  specContextBudgetGrowsWithSourceCount,
  specMappingCoverageRespectsExemptionsAndScope,
  specCacheHydratesAutomaticallyAndFailsHarmlessly,
  specHydrationDetectsPerDocumentDrift,
  specContextSurfacesChangedAndNewPlanningDocs,
  specSettleRecordsReviewedSnapshotNotLatest,
  specSettleNeverMovesBaselineBackwards,
  specStaleDeleteSnapshotDoesNotRemoveLiveDoc,
  specColdCacheCheckDoesNotLeakLatestIntoBaseline,
  specSettleRefusesNewCollisionAcrossSources,
  specFailedFreshnessIsNotReplayedAsSuccess,
  specSettleRefusesUnreviewedDocuments,
  specHydrationRefusesSymlinkEscape,
  specSettleRefusesForgedSnapshotBody,
  specSettleRefusesForgedDeletion,
  specSettleRefusesSnapshotFromAnotherRepo,
  specStorageRootSymlinkIsRefused,
  specContextRefusesSymlinkedSpecBody,
  specCorruptedStateFilesFailClosed,
  specLatestDirectoryIsExactSnapshotSet,
  specCorruptedLockSchemaFailsClosed,
  specSettleRefusesRollbackToRealPastCommit,
  specSettleRefusesSnapshotCommitMismatch,
  specSettleRefusesSwappedCacheOrigin,
  specSettleRefusesWhenDeclarationDrifted,
  specLockOnlyAndGlobalFailureAreSurfaced,
  specScreenLinkIntegrityIsEnforced,
  specScreenLinkSettlesAtomically,
  specSettleRefusesRevivingDeletedDocFromPast,
  specUnlinkedScreenIsSurfacedRegardlessOfInclude,
  specGuardNoticesMissingHookInstall,
  specLatestPruneKeepsRecordAndFilesInSync,
  specLargeScreenFileEntersBaseline,
  specStatusGuidesMappingAtStart,
  specStatusFlagsDocScreenBaselineMismatch,
  specFreshnessFailureIsNotMaskedByPastSuccess,
  specContextRefusesUnverifiedBodies,
  specContextSurfacesOpaquelyNamedDocs,
  specMappingCoverageDetectsModifiedExistingFiles,
}
