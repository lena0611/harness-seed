// 설치·업데이트 결과 리포트 등록기 (0.2.136)
//
// 무엇: 이 프로젝트의 하네스 설치/업데이트 결과를 본체 GitLab 이슈보드에 남긴다.
//   ① 결과 리포트 이슈 1건(라벨 '설치리포트') — 개선요청이 있으면 본문에 함께 실린다.
//   ② 고정 '설치·업데이트 이력' 이슈(라벨 '설치이력표')의 표에 한 줄 추가.
// 왜: 본체가 소비자 개선요청을 자동으로 발견하고, 어떤 프로젝트가 언제 어떤 버전을
//   쓰는지 배포 현황을 본체 운영 관점에서 볼 수 있게(2026-09-01 사용자 지시).
//   ⚠ 이것은 본체 운영용 배포 현황이지 개발 행위 추적·지표가 아니다(결정 75의 경계는
//   decision-log 참조). 등록은 옵트인 토큰 + 리더 승인 후 실행이 절차다.
// 어떻게(옵트인): 프로젝트 루트 .issue-adapter.env(git 미추적)에
//   HARNESS_BODY_ISSUE_TOKEN=<본체 이슈 쓰기 토큰>
//   (선택) HARNESS_BODY_PROJECT=<GitLab 경로, 기본 ai-standard/harnesses/harness-seed>
//   토큰이 없으면 등록 대신 .harness/generated/에 리포트 파일을 남기고 전달을 안내한다(fail-open).
//
// 사용:
//   .harness/bin/harness report:install -- --kind install --to v0.2.136
//   .harness/bin/harness report:install -- --kind update --from v0.2.133 --to v0.2.136 \
//     --notes-file 요청서.md   # 개선요청·특이사항 본문(선택)
//   --dry-run: 등록 없이 제목·본문·이력 행을 출력만 한다.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const args = process.argv.slice(2)
const pendingPath = path.join(repoRoot, '.harness/generated/pending-report.json')

function clearPendingMarker() {
  try {
    fs.rmSync(pendingPath, { force: true })
  } catch {}
}

function argValue(name) {
  const index = args.indexOf(name)
  return index !== -1 ? args[index + 1] : null
}

// 무인자 실행이 정상 경로다(0.2.138, 멀티사이트 제안): 에이전트는 표식(pending-report.json)만
// 보고 실행하면 되고, 인자는 표식이 없거나 덮어쓸 때만 쓴다.
const pendingDefaults = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, '.harness/generated/pending-report.json'), 'utf8'))
  } catch {
    return {}
  }
})()
const kind = argValue('--kind') ?? pendingDefaults.kind ?? null
const fromVersion = argValue('--from') ?? pendingDefaults.from ?? '-'
const toVersion = argValue('--to') ?? pendingDefaults.to ?? null
const notesFile = argValue('--notes-file')
const dryRun = args.includes('--dry-run')

const rebuildOnly = args.includes('--rebuild-history')

if (!rebuildOnly && (!['install', 'update'].includes(kind ?? '') || !toVersion)) {
  console.error('사용법: report:install                     # 표식(pending-report.json)의 값으로 실행')
  console.error('       report:install -- --kind install|update --to <버전> [--from <버전>] [--notes-file <md>] [--dry-run]')
  console.error('       report:install -- --rebuild-history   # 리포트 생성 없이 이력 표만 재생성(치유)')
  process.exit(1)
}

function gitOutput(gitArgs) {
  try {
    return execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function projectName() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    if (pkg.name) return pkg.name
  } catch {}
  const remote = gitOutput(['remote', 'get-url', 'origin'])
  if (remote) {
    const tail = remote.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).slice(-2).join('/')
    if (tail) return tail
  }
  return path.basename(repoRoot)
}

// 토큰은 값을 로그에 절대 남기지 않는다. 두 위치를 읽고, 둘 다 있으면
// 프로젝트 루트 .issue-adapter.env가 홈(~/.config/ai-standard/report.env)을 이긴다
// (배열에서 나중에 읽는 쪽이 덮어씀). 홈에 공용 토큰을 개발자당 1회만 두면
// 모든 프로젝트에서 동작하고, 프로젝트별 예외만 로컬 파일로 둔다.
function readAdapterEnv() {
  const values = {}
  const candidates = [
    path.join(os.homedir(), '.config/ai-standard/report.env'),
    path.join(repoRoot, '.issue-adapter.env'),
  ]
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (match) values[match[1]] = match[2].trim()
    }
  }
  return values
}

// 날짜는 실제 오늘(0.2.138): 마지막 커밋 날짜를 우선했더니 리포트 제목이 하루 전으로
// 찍혔다(멀티사이트 #6 실측 — 커밋 없이 업데이트만 한 날).
const today = new Date().toISOString().slice(0, 10)
const project = projectName()
const kindLabel = kind === 'install' ? '설치' : '업데이트'
const manifest = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, '.harness/install-manifest.json'), 'utf8'))
  } catch {
    return null
  }
})()
const managedCount = manifest ? Object.keys(manifest.managedFiles ?? {}).length : '-'
const notes = notesFile ? fs.readFileSync(path.resolve(repoRoot, notesFile), 'utf8').trim() : ''

const title = `[${kindLabel}] ${project} ${fromVersion}→${toVersion} (${today})`
const description = [
  `## ${kindLabel} 결과`,
  '',
  `| 항목 | 값 |`,
  `| --- | --- |`,
  `| 프로젝트 | ${project} |`,
  `| 종류 | ${kindLabel} |`,
  `| 버전 | ${fromVersion} → ${toVersion} |`,
  `| 일자 | ${today} |`,
  `| managed 파일 | ${managedCount}개 |`,
  '',
  notes ? `## 전달 사항 (개선요청 포함 가능)\n\n${notes}` : '전달 사항 없음 — 정상 완료 보고입니다.',
].join('\n')
const historyRow = `| ${today} | ${project} | ${kindLabel} | ${fromVersion} → ${toVersion} |`

if (dryRun) {
  console.log('[dry-run] 등록 없이 내용만 출력합니다.')
  console.log(`제목: ${title}`)
  console.log(`이력 행: ${historyRow}`)
  console.log('--- 본문 ---')
  console.log(description)
  process.exit(0)
}

const adapterEnv = readAdapterEnv()
const token = adapterEnv.HARNESS_BODY_ISSUE_TOKEN

if (!token) {
  // fail-open: 등록 수단이 없으면 파일로 남기고 전달을 안내한다. 실패로 만들지 않는다.
  const outDir = path.join(repoRoot, '.harness/generated')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `install-report-${today}-${kind}.md`)
  fs.writeFileSync(outPath, `# ${title}\n\n${description}\n\n${historyRow}\n`)
  console.log('HARNESS_BODY_ISSUE_TOKEN이 없어 이슈 등록 대신 파일로 남겼습니다:')
  console.log(`  ${path.relative(repoRoot, outPath)}`)
  console.log('하네스 본체 개발자에게 이 파일을 전달하거나, 토큰을 받아 넣고 다시 실행하세요(값은 채팅·로그에 붙여넣지 않습니다):')
  console.log('  토큰: 하네스 본체 개발자에게 DM으로 요청 → ~/.config/ai-standard/report.env 에')
  console.log('  HARNESS_BODY_ISSUE_TOKEN=<값> — 한 번 두면 모든 프로젝트에서 동작')
  console.log('  (프로젝트별로 다르게 쓰려면 프로젝트 루트 .issue-adapter.env가 우선합니다)')
  clearPendingMarker() // 파일로 남긴 것도 보고 완료다 — 상기 안내를 멈춘다.
  process.exit(0)
}

const apiBase = 'https://git.smartscore.kr/api/v4'
const projectPath = adapterEnv.HARNESS_BODY_PROJECT || 'ai-standard/harnesses/harness-seed'
const encodedProject = encodeURIComponent(projectPath)

async function gitlab(method, apiPath, body) {
  const response = await fetch(`${apiBase}${apiPath}`, {
    method,
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`GitLab API ${method} ${apiPath} 실패: ${response.status}`)
  }
  return response.json()
}

// 리포트 이슈 제목을 파싱한다. 제목 형식은 이 스크립트가 만들므로 고정이다:
//   [설치|업데이트] <프로젝트> <from>→<to> (<YYYY-MM-DD>)
function parseReportTitle(issue) {
  const match = issue.title.match(/^\[(설치|업데이트)\] (.+) (\S+)→(\S+) \((\d{4}-\d{2}-\d{2})\)$/)
  if (!match) return null
  return { kind: match[1], project: match[2], from: match[3], to: match[4], date: match[5], iid: issue.iid }
}

function tableRowCount(table) {
  // 헤더·구분선 다음의 데이터 행 수 = 소비자 프로젝트 수
  return Math.max(0, table.split('\n').filter((line) => line.startsWith('| ')).length - 2)
}

// 현황판 재생성(2026-09-02 사용자 지시): 행 = 소비자 프로젝트 하나(이벤트 로그가 아니라 최신 상태).
// 새 행은 새 소비자가 나타났을 때만 추가되고, 업데이트는 그 프로젝트 행을 갱신한다.
async function rebuildHistoryTable() {
  const entries = []
  for (let page = 1; page <= 10; page += 1) {
    const issues = await gitlab('GET', `/projects/${encodedProject}/issues?labels=${encodeURIComponent('설치리포트')}&state=all&per_page=100&page=${page}&order_by=created_at&sort=asc`)
    for (const issue of issues) {
      const parsed = parseReportTitle(issue)
      if (parsed) entries.push(parsed)
    }
    if (issues.length < 100) break
  }

  const projects = new Map() // 삽입 순서 = 처음 나타난 순서
  for (const entry of entries) {
    if (!projects.has(entry.project)) {
      projects.set(entry.project, { install: null, earliest: entry, latestUpdate: null })
    }
    const state = projects.get(entry.project)
    if (entry.kind === '설치' && !state.install) state.install = entry
    if (entry.kind === '업데이트') state.latestUpdate = entry // asc 순회라 마지막 것이 최신
  }

  const rows = []
  for (const [project, state] of projects) {
    // 설치 기록이 없는 기존 소비자(리포트 기능 이전 설치)는 첫 기록의 from으로 하한만 표시.
    const installCell = state.install
      ? `${state.install.date} / ${state.install.to}`
      : (state.earliest.from && state.earliest.from !== '-' ? `- / ${state.earliest.from} 이전` : '-')
    const updateCell = state.latestUpdate
      ? `${state.latestUpdate.date} / ${state.latestUpdate.from} → ${state.latestUpdate.to} (#${state.latestUpdate.iid})`
      : '-'
    rows.push(`| ${project} | ${installCell} | ${updateCell} |`)
  }
  return `${HISTORY_HEADER}\n${rows.join('\n')}`
}

const HISTORY_TITLE = '하네스 설치·업데이트 이력'
// 5칸 고정(리포트 링크 포함). 처음엔 4칸 헤더를 문자열 치환으로 5칸으로 늘렸는데,
// 구분선 치환이 어긋나 GitLab이 표로 렌더링하지 못했다(첫 실측 #2에서 발견·수동 보정).
const HISTORY_HEADER = [
  '이 이슈는 소비자 프로젝트의 배포 현황판입니다. 행 = 프로젝트 하나(최신 상태), 새 행은 새 소비자가 나타났을 때만 늘어납니다.',
  '리포트 이슈(라벨 설치리포트)들로부터 report:install이 매번 재생성합니다. (본체 운영용 — 개발 행위 추적이 아닙니다.)',
  '',
  '| 프로젝트 | 설치일 / 버전 | 업데이트일 / 버전 |',
  '| --- | --- | --- |',
].join('\n')

if (rebuildOnly) {
  if (!token) {
    console.error('--rebuild-history는 등록 토큰이 필요합니다(HARNESS_BODY_ISSUE_TOKEN).')
    process.exit(1)
  }
  const table = await rebuildHistoryTable()
  const found = await gitlab('GET', `/projects/${encodedProject}/issues?labels=${encodeURIComponent('설치이력표')}&state=all&per_page=1`)
  if (found.length === 0) {
    const historyIssue = await gitlab('POST', `/projects/${encodedProject}/issues`, { title: HISTORY_TITLE, description: table, labels: '설치이력표' })
    console.log(`이력 표 이슈 생성: #${historyIssue.iid} (리포트 ${tableRowCount(table)}건)`)
  } else {
    await gitlab('PUT', `/projects/${encodedProject}/issues/${found[0].iid}`, { description: table })
    console.log(`이력 표 재생성: #${found[0].iid} (리포트 ${tableRowCount(table)}건 반영)`)
  }
  process.exit(0)
}


try {
  const issue = await gitlab('POST', `/projects/${encodedProject}/issues`, {
    title,
    description,
    labels: '설치리포트',
  })
  console.log(`리포트 이슈 등록: #${issue.iid} ${issue.web_url ?? ''}`)

  // 이력 표는 리포트 이슈들(진실 원장)로부터 매번 전체 재생성한다(0.2.137).
  // 종전의 "기존 description에 내 행 append"는 두 구멍이 있었다 — ① 도구를 안 거친
  // 수기 등록 이슈는 행이 영영 안 생긴다(첫날 실측: clubadm #4, API 직접 호출) ② 동시
  // 등록 시 읽고-고쳐-쓰기 경쟁으로 행이 덮일 수 있다. 재생성이면 표는 파생 뷰가 되어
  // 어떤 경로로 이슈가 생겼든 다음 실행이 전체를 다시 그리며 스스로 복구된다.
  const table = await rebuildHistoryTable()
  const found = await gitlab('GET', `/projects/${encodedProject}/issues?labels=${encodeURIComponent('설치이력표')}&state=all&per_page=1`)
  if (found.length === 0) {
    const historyIssue = await gitlab('POST', `/projects/${encodedProject}/issues`, {
      title: HISTORY_TITLE,
      description: table,
      labels: '설치이력표',
    })
    console.log(`이력 표 이슈 생성: #${historyIssue.iid}`)
  } else {
    await gitlab('PUT', `/projects/${encodedProject}/issues/${found[0].iid}`, { description: table })
    console.log(`이력 표 재생성: #${found[0].iid} (리포트 ${tableRowCount(table)}건 반영)`)
  }
  clearPendingMarker()
} catch (error) {
  console.error(`등록 실패: ${error.message}`)
  console.error('네트워크·권한 문제면 --dry-run으로 내용을 확인해 수동 등록하거나, 본체 팀에 파일로 전달하세요.')
  process.exit(1)
}
