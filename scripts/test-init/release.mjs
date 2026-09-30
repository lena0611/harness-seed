// 릴리스 공지·수령 리포트·현황판·스킬 회귀. 실행 등록은 scripts/test-init.mjs의 tests 배열이 정본이다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  repoRoot,
  nodeBin,
  run,
  assert,
  exists,
  read,
  writeJson,
  makeTarget,
  runInit,
  runGuard,
  expectFailure,
} from './helpers.mjs'

// #14: `report:install --help`가 인자로 인식되지 않아 그대로 실행돼 리포트 파일이 생겼다.
// 도움말은 아무것도 쓰지 않고 0으로 끝나야 하며, 표식(pending-report.json)도 그대로 남아야 한다.
function reportInstallHelpWritesNothing() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const marker = '.harness/generated/pending-report.json'
  assert(exists(target, marker), 'precondition: a fresh install leaves a pending marker')
  const reports = () => fs.readdirSync(path.join(target, '.harness/generated')).filter((f) => f.startsWith('install-report-'))
  const before = reports().length
  for (const flag of ['--help', '-h']) {
    const out = run(nodeBin, [path.join(target, '.harness/bin/report-install.mjs'), flag], { cwd: target })
    assert(out.includes('사용법'), `${flag} must print usage`)
  }
  assert(reports().length === before, '--help must not create a report file')
  assert(exists(target, marker), '--help must not consume the pending marker')
}

// 0.2.136 — 설치·업데이트 리포트(결정 98): 토큰이 없으면 등록 대신 파일로 남기는
// fail-open과 dry-run 페이로드를 잠근다. 실제 API 등록은 토큰이 있는 환경에서만 도니
// 회귀는 오프라인 경로를 검증한다.
function reportInstallFailsOpenToFileWithoutToken() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const dry = run(nodeBin, [path.join(target, '.harness/bin/report-install.mjs'), '--kind', 'update', '--from', 'v0.2.135', '--to', 'v0.2.136', '--dry-run'], { cwd: target })
  assert(dry.includes('[업데이트] harness-test-target v0.2.135→v0.2.136'), 'dry-run must print the composed issue title')
  assert(dry.includes('| harness-test-target | 업데이트 | v0.2.135 → v0.2.136 |'), 'dry-run must print the history row')

  const out = run(nodeBin, [path.join(target, '.harness/bin/report-install.mjs'), '--kind', 'install', '--to', 'v0.2.136'], { cwd: target })
  assert(out.includes('파일로 남겼습니다'), 'without a token the reporter must fall back to a local file')
  const generated = fs.readdirSync(path.join(target, '.harness/generated')).filter((name) => name.startsWith('install-report-'))
  assert(generated.length === 1, 'the fallback report file must be created under .harness/generated')
  const body = read(target, `.harness/generated/${generated[0]}`)
  assert(body.includes('[설치] harness-test-target -→v0.2.136') || body.includes('[설치] harness-test-target'), 'the report file must carry the title')
  assert(body.includes('전달 사항 없음'), 'a notes-less report must state it is a clean completion report')

  const usage = (() => { try { run(nodeBin, [path.join(target, '.harness/bin/report-install.mjs')], { cwd: target }); return '' } catch (error) { return `${error.stdout ?? ''}${error.stderr ?? ''}` } })()
  assert(usage.includes('사용법'), 'missing required args must print usage and fail')
}
// club-control-vue3 #55 ①(0.2.152): 토큰 없이 설치해 파일로만 남은 리포트를 다음 날 토큰을 받아 인자로 다시 만들면
// 제목·일자·이력 행이 실행일로 찍혀 파일(설치일)과 어긋났다. 파일에 이미 다 있으니 그것을 그대로 올린다.
function reportInstallRepostsTheSavedFileWithItsOriginalDate() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const script = path.join(target, '.harness/bin/report-install.mjs')
  const generated = () => fs.readdirSync(path.join(target, '.harness/generated')).filter((name) => name.startsWith('install-report-'))

  // ① 토큰 없는 설치일: 파일로 남고, 안내가 --from-file 을 가리킨다.
  const fallback = run(nodeBin, [script, '--kind', 'install', '--to', 'v0.2.142'], { cwd: target })
  assert(fallback.includes('--from-file'), `the fallback message must tell how to post the file later (got: ${fallback})`)
  const [file] = generated()
  assert(file, 'precondition: the fallback file exists')
  const rel = `.harness/generated/${file}`
  const today = new Date().toISOString().slice(0, 10)
  // "다음 날"을 흉내 낸다: 파일 안의 날짜를 설치일(09-28)로 바꾼다 — 실행일은 그대로 오늘이다.
  fs.writeFileSync(path.join(target, rel), read(target, rel).split(today).join('2026-09-28'))

  // ② --from-file: 제목·이력 행이 파일의 날짜(설치일)를 그대로 쓴다 — 실행일이 아니다.
  const dry = run(nodeBin, [script, '--from-file', rel, '--dry-run'], { cwd: target })
  assert(dry.includes('제목: [설치] harness-test-target -→v0.2.142 (2026-09-28)'), `the title must keep the saved date (got: ${dry})`)
  assert(dry.includes('이력 행: | 2026-09-28 | harness-test-target | 설치 | - → v0.2.142 |'), `the history row must keep the saved date (got: ${dry})`)
  assert(!dry.includes(`(${today})`), 'the run date must not replace the saved date')
  assert(dry.includes('| 일자 | 2026-09-28 |'), 'the body must be the saved body, date included')

  // ③ 아직 토큰이 없으면 같은 파일을 또 만들지 않는다 — 파일은 그대로, 방법만 다시.
  const still = run(nodeBin, [script, '--from-file', rel], { cwd: target })
  assert(still.includes('파일은 그대로 있습니다'), `without a token the saved file must be kept, not duplicated (got: ${still})`)
  assert(generated().length === 1, 'no second fallback file may be written')

  // ④ report:install 이 남긴 모양이 아니면 거절한다 — 아무 md 나 이슈로 올리는 문이 아니다.
  fs.writeFileSync(path.join(target, 'notes.md'), '# 메모\n\n아무 내용\n')
  const bad = (() => { try { run(nodeBin, [script, '--from-file', 'notes.md', '--dry-run'], { cwd: target }); return '' } catch (error) { return `${error.stdout ?? ''}${error.stderr ?? ''}` } })()
  assert(bad.includes('report:install 이 남긴 파일만'), `a file that is not a saved report must be refused with a reason (got: ${bad})`)
}

// 0.2.149 — 현황판 머리말은 "지금 최신 릴리스"다(사용자 지시 2026-09-10). 값의 출처는 본체
// 저장소의 릴리스 태그 하나뿐이라, 회귀는 가짜 GitLab을 띄워 실제 경로(태그 조회 → 표 재생성
// → PUT 본문)를 끝까지 밟는다. 조회 실패를 주입해 "지어내지 않는다"까지 함께 잠근다.
function historyBoardHeadlinesTheLatestRelease() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  fs.writeFileSync(path.join(target, '.issue-adapter.env'), 'HARNESS_BODY_ISSUE_TOKEN=test-token\n')

  const driver = path.join(target, 'fake-gitlab.mjs')
  fs.writeFileSync(driver, `
import http from 'node:http'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

const [reportPath, mode, existingPath, outPath] = process.argv.slice(2)
const existing = fs.readFileSync(existingPath, 'utf8')
let captured = ''

// 일부러 어긋난 순서 + 문자열 정렬이면 지는 값(v0.2.99 > v0.2.148)을 섞는다.
const TAGS = [
  { name: 'v0.2.99', commit: { created_at: '2026-08-01T10:00:00.000+09:00' } },
  { name: 'v0.2.148', commit: { created_at: '2026-09-10T11:02:53.000+09:00' } },
  { name: 'not-a-release', commit: { created_at: '2026-09-11T00:00:00.000+09:00' } },
  { name: 'v0.2.100', commit: { created_at: '2026-08-02T10:00:00.000+09:00' } },
  { name: 'v0.2.9', commit: { created_at: '2026-07-01T10:00:00.000+09:00' } }
]
const REPORTS = [
  { iid: 10, title: '[설치] alpha -→v0.2.140 (2026-08-01)' },
  { iid: 11, title: '[업데이트] alpha v0.2.140→v0.2.147 (2026-09-09)' }
]

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (url.pathname.endsWith('/repository/tags')) {
    if (mode === 'tags-fail') return send(500, { message: 'boom' })
    return send(200, TAGS)
  }
  if (req.method === 'GET' && url.pathname.endsWith('/issues')) {
    const labels = url.searchParams.get('labels')
    if (labels === '설치리포트') {
      return send(200, Number(url.searchParams.get('page') || '1') === 1 ? REPORTS : [])
    }
    if (labels === '설치이력표') return send(200, [{ iid: 2, description: existing }])
    return send(200, [])
  }
  if (req.method === 'PUT') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      captured = JSON.parse(body).description || ''
      send(200, { iid: 2 })
    })
    return
  }
  return send(200, {})
})

// spawnSync는 부모의 이벤트 루프를 막아 이 서버가 응답하지 못한다(첫 시도에서 헤더 타임아웃으로 실증).
server.listen(0, '127.0.0.1', () => {
  const child = spawn(process.execPath, [reportPath, '--rebuild-history'], {
    env: Object.assign({}, process.env, { HARNESS_BODY_API_BASE: 'http://127.0.0.1:' + server.address().port }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { out += chunk })
  child.on('close', (code) => {
    fs.writeFileSync(outPath, captured)
    server.close()
    process.stdout.write(out)
    process.exit(code === 0 ? 0 : 1)
  })
})
`)

  const reportPath = path.join(target, '.harness/bin/report-install.mjs')
  const existingPath = path.join(target, 'existing-board.md')
  const outPath = path.join(target, 'captured-board.md')
  const drive = (mode, existingDescription) => {
    fs.writeFileSync(existingPath, existingDescription)
    run(nodeBin, [driver, reportPath, mode, existingPath, outPath], { cwd: target })
    return fs.readFileSync(outPath, 'utf8')
  }

  // ① 최신은 태그에서 고른다 — API가 준 순서(첫 항목 v0.2.99)도 문자열 정렬도 아니다.
  const ok = drive('tags-ok', '(아직 머리말 없음)')
  assert(ok.startsWith('**현재 최신 릴리스: v0.2.148** (커밋 2026-09-10)'), 'the board must open with the newest release tag; the date is the commit date and must be labelled as such')
  assert(!ok.includes('v0.2.99**') && !ok.includes('v0.2.100**') && !ok.includes('not-a-release'), 'semver order must beat API order, string order and non-release tags')
  assert(ok.includes('| 프로젝트 | 설치일 / 버전 | 업데이트일 / 버전 |') && ok.includes('| alpha |'), 'the headline must sit above the existing status table, not replace it')

  // ② 조회가 실패하면 지어내지 않고 직전 머리말을 그대로 이어 쓴다.
  // 실패했으면 그 값을 "현재 최신"이라고 단정하지 않는다 — 값은 지키되 확인되지 않았다고 말한다(코덱스 P1-3).
  const carried = drive('tags-fail', ok)
  assert(carried.startsWith('**마지막으로 확인된 릴리스: v0.2.148** (커밋 2026-09-10) — 이번 갱신에서는 최신 태그를 확인하지 못했습니다'), `a failed lookup must keep the value but drop the "current" claim (got: ${carried.split('\n')[0]})`)
  // 두 번째 실패에서도 머리말이 사라지지 않는다(이미 바뀐 줄을 이어받는다).
  const carriedTwice = drive('tags-fail', carried)
  assert(carriedTwice.startsWith('**마지막으로 확인된 릴리스: v0.2.148**'), `a second failure must keep carrying the stale headline (got: ${carriedTwice.split('\n')[0]})`)

  // ③ 이어 쓸 것도 없으면 머리말을 빼고 표만 그린다 — 틀린 버전을 적는 쪽이 더 나쁘다.
  const bare = drive('tags-fail', '(아직 머리말 없음)')
  assert(!bare.includes('현재 최신 릴리스'), 'with no tag and no previous headline the board must not fabricate a version')
  assert(bare.includes('| alpha |'), 'the status table must still render when the headline is unavailable')
}
// 0.2.152 — 결정 125: 리포트 이슈는 봇 계정이 만들어 본체 회신 알림이 사람에게 가지 않는다. 팀 에이전트가 다음 리포트를
// 올리러 오는 순간 지난 리포트의 회신을 건넨다. 기준은 "가장 최근 리포트가 올라간 뒤의 댓글" — 그 전 댓글은 지난 방문에서
// 봤다고 본다. 가짜 GitLab 으로 실제 경로(목록 조회 → 노트 조회 → 등록)를 밟는다.
function reportInstallRelaysRepliesOnPreviousReports() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  fs.writeFileSync(path.join(target, '.issue-adapter.env'), 'HARNESS_BODY_ISSUE_TOKEN=test-token\n')

  const driver = path.join(target, 'fake-gitlab-replies.mjs')
  fs.writeFileSync(driver, `
import http from 'node:http'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

const [reportPath, mode, outPath] = process.argv.slice(2)
let posted = ''
// 최근 리포트(#21)는 09-20 에 올라갔다. 그 뒤(since)에 달린 댓글만 "새 회신"이다.
const REPORTS = [
  { iid: 22, title: '[설치] harness-test-target-2 -→v0.2.151 (2026-09-25)', created_at: '2026-09-25T10:00:00.000+09:00', user_notes_count: 1, state: 'opened', web_url: 'https://git.example.test/i/22' },
  { iid: 21, title: '[업데이트] harness-test-target v0.2.140→v0.2.151 (2026-09-20)', created_at: '2026-09-20T10:00:00.000+09:00', user_notes_count: 2, state: 'opened', web_url: 'https://git.example.test/i/21' },
  { iid: 20, title: '[업데이트] harness-test-target v0.2.130→v0.2.140 (2026-08-01)', created_at: '2026-08-01T10:00:00.000+09:00', user_notes_count: 1, state: 'closed', web_url: 'https://git.example.test/i/20' },
  { iid: 19, title: '[설치] harness-test-target -→v0.2.130 (2026-07-01)', created_at: '2026-07-01T10:00:00.000+09:00', user_notes_count: 1, state: 'closed', web_url: 'https://git.example.test/i/19' }
]
const NOTES = {
  22: [{ id: 1, system: false, created_at: '2026-09-26T10:00:00.000+09:00', body: 'DECOY-OTHER-PROJECT' }],
  21: [
    { id: 2, system: true, created_at: '2026-09-29T15:00:00.000+09:00', body: 'mentioned in issue #22' },
    { id: 3, system: false, created_at: '2026-09-29T16:00:00.000+09:00', body: 'REPLY-NEW-21: 0.2.152 에 이렇게 반영했습니다.\\n자세한 내용은 changelog 에.' }
  ],
  20: [{ id: 5, system: false, created_at: '2026-08-02T10:00:00.000+09:00', body: 'REPLY-OLD-20: 지난 방문 전 답' }],
  19: [{ id: 4, system: false, created_at: '2026-09-29T17:00:00.000+09:00', body: 'REPLY-NEW-19: 옛 리포트에 늦게 단 답' }]
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (url.pathname.endsWith('/repository/tags')) return send(200, [])
  const notes = url.pathname.match(/\\/issues\\/(\\d+)\\/notes$/)
  if (req.method === 'GET' && notes) {
    if (mode === 'notes-fail') return send(500, { message: 'boom' })
    return send(200, NOTES[notes[1]] || [])
  }
  if (req.method === 'GET' && url.pathname.endsWith('/issues')) {
    const labels = url.searchParams.get('labels')
    if (labels === '설치리포트') return send(200, url.searchParams.get('search') ? REPORTS : [])
    return send(200, [])
  }
  if (req.method === 'POST' && url.pathname.endsWith('/issues')) {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body)
      if (parsed.labels === '설치리포트') posted = parsed.title
      send(200, { iid: parsed.labels === '설치리포트' ? 30 : 2, web_url: 'https://git.example.test/i/30' })
    })
    return
  }
  if (req.method === 'PUT') { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => send(200, { iid: 2 })); return }
  return send(200, {})
})

server.listen(0, '127.0.0.1', () => {
  const child = spawn(process.execPath, [reportPath, '--kind', 'update', '--from', 'v0.2.151', '--to', 'v0.2.152'], {
    env: Object.assign({}, process.env, { HARNESS_BODY_API_BASE: 'http://127.0.0.1:' + server.address().port }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { out += chunk })
  child.on('close', (code) => {
    fs.writeFileSync(outPath, JSON.stringify({ code, out, posted }))
    server.close()
    process.exit(0)
  })
})
`)
  const reportPath = path.join(target, '.harness/bin/report-install.mjs')
  const outPath = path.join(target, 'captured.json')
  const drive = (mode) => { run(nodeBin, [driver, reportPath, mode, outPath], { cwd: target }); return JSON.parse(fs.readFileSync(outPath, 'utf8')) }

  // ① 정상: 최근 리포트(#21)의 회신과, 옛 리포트(#20)에 **지난 방문 뒤** 달린 회신은 보이고, 지난 방문 전 답과 시스템 노트,
  //    다른 프로젝트(search 부분 일치)의 답은 보이지 않는다. 그리고 본업(등록)은 그대로 된다.
  const ok = drive('ok')
  assert(ok.code === 0, `report:install must succeed (got exit ${ok.code}: ${ok.out})`)
  assert(ok.out.includes('::: 지난 리포트에 본체 회신'), `replies on previous reports must be announced (got: ${ok.out})`)
  assert(ok.out.includes('#21 [업데이트] harness-test-target') && ok.out.includes('REPLY-NEW-21: 0.2.152 에 이렇게 반영했습니다.'), 'the reply on the latest report must show with its first line')
  assert(!ok.out.includes('자세한 내용은 changelog'), 'only the first line of a reply is relayed')
  assert(ok.out.includes('#19 [설치] harness-test-target') && ok.out.includes('REPLY-NEW-19'), 'a reply added to an older report after the last visit must show too')
  assert(!ok.out.includes('REPLY-OLD-20') && !ok.out.includes('#20 '), 'a report whose only reply predates the last visit was already seen and must not repeat')
  assert(!ok.out.includes('mentioned in issue'), 'system notes are not replies')
  assert(!ok.out.includes('DECOY-OTHER-PROJECT') && !ok.out.includes('#22'), 'a different project that merely matches the search substring must be excluded')
  assert(ok.out.includes('닫힘'), 'a closed report must be marked as such')
  assert(ok.out.includes('https://git.example.test/i/21'), 'the issue link must be given')
  assert(ok.posted.startsWith('[업데이트] harness-test-target v0.2.151→v0.2.152'), `the new report must still be posted (got: ${ok.posted})`)

  // ② 노트 조회가 실패하면 침묵하되 본업은 그대로 — 부가 정보가 등록을 막지 않는다.
  const failed = drive('notes-fail')
  assert(failed.code === 0 && failed.posted.startsWith('[업데이트] harness-test-target'), 'a failed reply lookup must not block the report')
  assert(!failed.out.includes('지난 리포트에 본체 회신'), 'nothing is announced when the lookup failed')
}

// 0.2.137 — 보고 대기 백스톱(결정 98 후속, "리포팅할까요?를 건너뛰는 에이전트" 실측):
// 설치/업데이트가 표식을 남기고, check가 상기하고, report:install(파일 fail-open 포함)이 지운다.
function pendingReportMarkerRemindsUntilReported() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const pendingRel = '.harness/generated/pending-report.json'
  assert(exists(target, pendingRel), 'install must leave a pending-report marker')
  const pending = JSON.parse(read(target, pendingRel))
  assert(pending.kind === 'install' && pending.from === null, 'a fresh install marker must record kind install with no prior version')

  const out = runGuard(target)
  assert(out.includes('결과 리포트가 아직 안 남았습니다'), 'check must remind while the marker exists')
  assert(out.includes('pending-report.json'), 'the reminder must state how to opt out')
  // 요약 칸 승격(clubadm 에이전트의 grep 필터 실측 대응): 필터로 봐도 걸리는 자리에 올린다.
  assert(out.includes('수동 조치: 설치·업데이트 리포트 대기'), 'the pending report must surface in the check summary manual-actions line')

  // 업데이트는 from/to를 기록한다. 구버전(0.2.137 이전) 소비자는 표식 파일 자체가
  // 없으므로, 시뮬레이션도 표식을 지운 상태에서 시작해야 현실과 같다.
  fs.rmSync(path.join(target, pendingRel), { force: true })
  const manifestRel = '.harness/install-manifest.json'
  const before = JSON.parse(read(target, manifestRel))
  before.version = '0.2.0' // 구버전 설치본 시뮬레이션
  writeJson(target, manifestRel, before)
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const updated = JSON.parse(read(target, pendingRel))
  assert(updated.kind === 'update' && updated.from === '0.2.0', 'an update marker must record the prior version')

  // 같은 목표 버전으로 init이 한 번 더 돌아도(스택 init의 base 재실행 실측) from은 보존된다.
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const rewritten = JSON.parse(read(target, pendingRel))
  assert(rewritten.from === '0.2.0', 'a same-target rewrite must preserve the original from (multisite #6)')

  // 무인자 report:install은 표식 값을 그대로 쓴다.
  const noArg = run(nodeBin, [path.join(target, '.harness/bin/report-install.mjs'), '--dry-run'], { cwd: target })
  assert(noArg.includes('0.2.0→'), 'argless report:install must adopt the marker from/to')

  // report:install(무토큰 → 파일 fail-open)도 보고 완료로 인정되어 표식과 안내가 사라진다.
  run(nodeBin, [path.join(target, '.harness/bin/report-install.mjs')], { cwd: target })
  assert(!exists(target, pendingRel), 'reporting (even file fallback) must clear the marker')
  const out2 = runGuard(target)
  assert(!out2.includes('결과 리포트가 아직 안 남았습니다'), 'the reminder must stop once reported')
  assert(!out2.includes('리포트 대기'), 'the summary line must clear once reported')
}

// 릴리스 공지 payload는 도구가 소유한다(0.2.119) — yaml 속 문자열 조립은 회귀로 잠글 수 없다.
// 0.2.120: 채널에는 사람이 선별한 "### 공지" 블록만 나간다 — 상세(개발 기록)는 발송 금지.
function releaseNoticeBuildsPayloadFromLatestChangelogSection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-release-notice-'))
  const fixture = path.join(dir, 'CHANGELOG.md')
  fs.writeFileSync(fixture, [
    '# Changelog', '',
    '머리말 설명 줄.', '',
    '## 1.2.3 - 2026-08-13', '',
    '### 공지',
    '- [신규] 요약 첫 항목입니다.',
    '- [개선] 요약 둘째 항목입니다.', '',
    '### 상세', '',
    '- 내부 리팩터링 상세 — 공지에 나오면 안 된다.', '',
    '## 1.2.2 - 2026-08-12', '',
    '### 공지',
    '- [신규] 이전 릴리스 항목 — 공지에 나오면 안 된다.', '',
  ].join('\n'))

  const raw = run(nodeBin, [path.join(repoRoot, 'scripts/release-notice.mjs'), '--json', '--file', fixture, '--tag', 'v1.2.3'])
  const payload = JSON.parse(raw)
  assert(payload.text.startsWith('[하네스] v1.2.3 배포'), 'notice must lead with the released version')
  // 다중 불릿 무결성: v0.2.119 첫 발사가 lookahead $ 버그로 불릿 1개만 내보냈다 — 재발 방지.
  assert(payload.text.includes('요약 첫 항목') && payload.text.includes('요약 둘째 항목'), 'every notice bullet must survive — the first live firing silently dropped all but the first')
  assert(!payload.text.includes('내부 리팩터링'), 'detail block (dev record) must never reach the channel')
  assert(!payload.text.includes('이전 릴리스 항목'), 'notice must not leak older sections')
  assert(payload.text.includes('/하네스업데이트'), 'notice must hand leaders the update command')
  assert(payload.text.includes('harness-seed/-/blob/master/CHANGELOG.md'), 'notice must link the full changelog — the channel gets easy summaries only (2026-08-25)')

  // 태그와 CHANGELOG 최상단이 어긋나면 조용히 보내지 않고 멈춘다 — 공지가 거짓말이 되는 경로 차단.
  const out = expectFailure(
    () => run(nodeBin, [path.join(repoRoot, 'scripts/release-notice.mjs'), '--json', '--file', fixture, '--tag', 'v9.9.9']),
    'a tag/CHANGELOG mismatch must fail loudly',
  )
  assert(out.includes('다릅니다'), 'the mismatch failure must say what disagrees')

  // 블록 누락 = 깜빡함 → 실패. "없음" = 의도된 침묵 → 통과 + 무발송. 둘은 다른 상태다.
  const noBlock = path.join(dir, 'CHANGELOG-no-block.md')
  fs.writeFileSync(noBlock, ['## 1.2.3 - 2026-08-13', '', '- 요약 블록 없이 상세만 있는 절.', ''].join('\n'))
  const missing = expectFailure(
    () => run(nodeBin, [path.join(repoRoot, 'scripts/release-notice.mjs'), '--json', '--file', noBlock, '--tag', 'v1.2.3']),
    'a missing notice block must fail loudly, not send the raw section',
  )
  assert(missing.includes('공지'), 'the failure must tell the author to write the notice block')

  const silent = path.join(dir, 'CHANGELOG-silent.md')
  fs.writeFileSync(silent, ['## 1.2.3 - 2026-08-13', '', '### 공지', '없음', '', '### 상세', '', '- 시드 내부 변경만 있는 릴리스.', ''].join('\n'))
  const quiet = run(nodeBin, [path.join(repoRoot, 'scripts/release-notice.mjs'), '--json', '--file', silent, '--tag', 'v1.2.3'])
  assert(quiet.trim() === '', 'an intentional "없음" must produce no payload at all — silence by decision, exit 0')
}

// 시드 파이프라인도 예시와 같은 계약을 진다: 존재 + 파싱(plain 스칼라 콜론+공백 금지) + 도구 위임.
function ciReleaseNoticeYamlParsesAndDelegates() {
  const yaml = fs.readFileSync(path.join(repoRoot, '.gitlab-ci.yml'), 'utf8')
  assert(yaml.includes('scripts/release-notice.mjs --json'), 'the pipeline must delegate message building to the tool')
  assert(yaml.includes('MATTERMOST_WEBHOOK_URL'), 'the pipeline must post via the CI variable, not a hardcoded URL')
  assert(!yaml.includes('chat.smartscore.kr'), 'the webhook URL must never be committed')
  assert(yaml.includes('tags:'), 'the job must carry runner tags — untagged jobs stuck silently on tag-required runners')
  const lines = yaml.split('\n')
  const scriptIdx = lines.findIndex((line) => /^\s*script:\s*$/.test(line))
  assert(scriptIdx >= 0, 'the pipeline must have a script block')
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

// 새 프로젝트 day-0 문서는 정본 포인터 모음이다(0.2.118) — 배포되고, 등록되고,
// 가리키는 정본·명령이 실존해야 한다. 절차 본문을 복제하기 시작하면 두 번째 진실이 된다.
function newProjectChecklistShipsWithPointers() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const rel = '.harness/project/new-project-checklist.md'
  assert(exists(target, rel), 'new-project checklist must ship with init')
  const doc = read(target, rel)
  for (const pointer of ['bootstrap.md', 'spec-authority-workflow.md', 'stack-preset-rules.md']) {
    assert(doc.includes(pointer), `checklist must point to canonical doc: ${pointer}`)
    assert(exists(target, `.harness/project/${pointer}`), `pointed canonical doc must exist: ${pointer}`)
  }
  for (const command of ['기획문서연동', '기획확인']) {
    assert(doc.includes(`/${command}`), `checklist must hand over the command: /${command}`)
    assert(exists(target, `.claude/commands/${command}.md`), `referenced command must be installed: ${command}`)
  }
  const registry = JSON.parse(read(target, '.harness/documentation/document-registry.json'))
  const group = (registry.groups ?? []).find((entry) => entry.id === 'project-harness')
  assert(group && group.children.includes(rel), 'checklist must be registered in the document registry')
  assert(read(target, 'CLAUDE.md').includes('new-project-checklist.md'), 'CLAUDE.md pick-list must point to the checklist')
  assert(read(target, '.harness/project/README.md').includes('new-project-checklist.md'), 'project README reading order must include the checklist')
}

// 0.2.123: 이슈 어댑터 계약(멀티사이트 제안 수용, 결정 82). 켬 스위치는 "실물 파일의 존재"이므로
// 본체가 실물(issue-adapter.md)을 배포하는 순간 전 소비자에서 기능이 켜지고 업데이트가 프로젝트
// 값을 덮는다 — 견본(.example)만 배포된다는 것 자체가 계약이라 회귀로 잠근다. 견본의 필수 칸과
// 스킬·적용례 문서의 상호 참조가 어긋나면 "문서 따로 규칙 따로"가 되므로 함께 대조한다.
function issueAdapterExampleShipsAsSwitchContract() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const rel = '.harness/project/issue-adapter.example.md'
  assert(exists(target, rel), 'issue adapter example must ship with init')
  assert(!exists(target, '.harness/project/issue-adapter.md'), 'the live adapter must never be distributed — its existence is the on-switch')
  const doc = read(target, rel)
  for (const section of ['① 조회 방법', '② 토큰 환경변수', '③ 요약 형식', '④ "내 담당" 구분']) {
    assert(doc.includes(section), `adapter example must keep required section: ${section}`)
  }
  assert(doc.includes('이슈 조회 실패'), 'example must state that query failure is reported, distinct from zero issues')
  const tokenUses = doc.match(/PRIVATE-TOKEN:\s*(\S+)/g) ?? []
  assert(tokenUses.length > 0 && tokenUses.every((use) => use.includes('$')), 'example must reference tokens only via env vars, never literal values')
  const skillRegistry = JSON.parse(read(target, '.harness/skills/registry.json'))
  const digest = skillRegistry.skills.find((skill) => skill.id === 'harness.issue-digest')
  assert(digest, 'skill registry must carry the issue digest contract')
  assert(digest.read.includes('.harness/project/issue-adapter.md'), 'digest skill must point at the live adapter path (the switch)')
  assert(digest.triggers.includes('커밋') && digest.triggers.includes('push'), 'digest skill must trigger on commit/push requests')
  const spec = read(target, '.harness/project/spec-authority-workflow.md')
  // 이슈보드 요리법(거울형 규칙 1~9·CI 견본)은 결정 89로 본체에서 철수 — 방식은 프로젝트 재량.
  // 남는 계약: 재량 명시 + "닫기 ≠ 정산" + 어댑터 견본 인계. 요리법이 되살아나면 실패해야 한다.
  assert(spec.includes('이슈 트래커 연동'), 'spec workflow must state issue-tracker linkage as project discretion')
  assert(!spec.includes('기획 이슈 보드'), 'mirror-board recipe must stay withdrawn from the body (decision 89)')
  assert(spec.includes('이슈를 닫는 것은 정산이 아닙니다'), 'spec section must keep closing-an-issue distinct from settlement')
  assert(spec.includes('issue-adapter.example.md'), 'spec section must hand over the adapter example')
  const registry = JSON.parse(read(target, '.harness/documentation/document-registry.json'))
  const group = (registry.groups ?? []).find((entry) => entry.id === 'project-harness')
  assert(group && group.children.includes(rel), 'adapter example must be registered in the document registry')
  assert(read(target, 'CLAUDE.md').includes('issue-adapter.example.md'), 'CLAUDE.md pick-list must point to the adapter example')
}

export {
  reportInstallHelpWritesNothing,
  reportInstallFailsOpenToFileWithoutToken,
  reportInstallRepostsTheSavedFileWithItsOriginalDate,
  reportInstallRelaysRepliesOnPreviousReports,
  historyBoardHeadlinesTheLatestRelease,
  pendingReportMarkerRemindsUntilReported,
  releaseNoticeBuildsPayloadFromLatestChangelogSection,
  ciReleaseNoticeYamlParsesAndDelegates,
  newProjectChecklistShipsWithPointers,
  issueAdapterExampleShipsAsSwitchContract,
}
