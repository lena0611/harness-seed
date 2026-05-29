import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const guideRel = '.harness/documentation/guide/index.html'
const dashboardRel = '.harness/generated/harness-dashboard.html'

const args = process.argv.slice(2)
const shouldOpen = args.includes('--open')

function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

function relPath(absPath) {
  return toPosix(path.relative(repoRoot, absPath))
}

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel))
}

function readJson(rel, fallback) {
  const abs = path.join(repoRoot, rel)
  if (!fs.existsSync(abs)) return fallback

  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return fallback
  }
}

function readPackageScripts() {
  const pkg = readJson('package.json', {})
  return pkg.scripts ?? {}
}

function gitStatusCount() {
  const result = spawnSync('git', ['status', '--short'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  if (result.status !== 0) return null

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function boolLabel(value) {
  return value ? '있음' : '없음'
}

function scriptLabel(scripts, name) {
  return scripts[name] ? '연결됨' : '없음'
}

function fileUrl(absPath) {
  const normalized = absPath.split(path.sep).map(encodeURIComponent).join('/')
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`
}

function renderCard(title, value, note = '') {
  return `<article class="card">
    <h2>${escapeHtml(title)}</h2>
    <p class="value">${escapeHtml(value)}</p>
    ${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
  </article>`
}

function renderDashboard() {
  const profile = readJson('.harness/policy/profile.json', {})
  const lock = readJson('.harness/harness-lock.json', {})
  const scripts = readPackageScripts()
  const changedCount = gitStatusCount()

  const activeStack = profile.activeStack ?? 'none'
  const harnessMode = profile.harnessMode ?? 'bootstrap'
  const baseVersion = lock.baseHarness?.version ?? 'unknown'
  const stackVersion = lock.stackHarness?.version ?? 'none'
  const templateVersion = lock.scaffoldTemplate?.version ?? 'none'

  const guideAbs = path.join(repoRoot, guideRel)
  const lifecycleAbs = path.join(repoRoot, '.harness/documentation/assets/request-lifecycle-flow.svg')
  const needsStackDecision = activeStack === 'none'

  const cards = [
    renderCard('하네스 모드', harnessMode, 'bootstrap / active / maintenance / strict'),
    renderCard('활성 스택 기준', activeStack, profile.stackManifest ?? 'stack manifest 없음'),
    renderCard('공통 하네스 버전', baseVersion, lock.baseHarness?.ref ?? ''),
    renderCard('스택 하네스 버전', stackVersion, lock.stackHarness?.ref ?? ''),
    renderCard('scaffold 템플릿', templateVersion, lock.scaffoldTemplate?.ref ?? ''),
    renderCard('변경 파일', changedCount === null ? '확인 불가' : `${changedCount}개`, 'git status --short 기준'),
    renderCard('스캔 리포트', boolLabel(exists('.harness/session/project-scan-report.md')), '.harness/session/project-scan-report.md'),
    renderCard('인수인계 요약', boolLabel(exists('.harness/session/handoff.md')), '.harness/session/handoff.md'),
    renderCard('에이전트 판단 컨텍스트', boolLabel(exists('.harness/session/task-context.md')), '.harness/session/task-context.md'),
    renderCard('프로젝트 맵', boolLabel(exists('.harness/generated/project-map.md')), 'npm run harness:sync로 생성'),
    renderCard('lint script', scriptLabel(scripts, 'lint')),
    renderCard('test script', scriptLabel(scripts, 'test')),
    renderCard('build script', scriptLabel(scripts, 'build')),
  ].join('\n')

  const stackDecisionPanel = needsStackDecision
    ? `<section class="panel decision">
      <h2>스택 기준 없음: 정상 선택 가능</h2>
      <p>현재는 공통 하네스만 설치된 상태입니다. 맞는 스택 하네스가 있으면 지금 또는 나중에 추가 적용하고, 없거나 스택 독립 프로젝트라면 공통 기준만 유지해도 됩니다. 공통 기준만 유지한다면 이유를 decision-log에 남깁니다.</p>
      <div class="commands">
        <code>npm run standards:list</code>
        <code>npm run stack:status</code>
        <code>npm run harness:scan</code>
        <code>npm run harness:handoff</code>
      </div>
    </section>`
    : `<section class="panel decision">
      <h2>스택 기준 적용됨</h2>
      <p><strong>${escapeHtml(activeStack)}</strong> 기준이 적용되어 있습니다. 스택 상세는 상태 명령과 프로젝트 로컬룰에서 확인합니다.</p>
      <div class="commands">
        <code>npm run stack:status</code>
        <code>.harness/project/stack-preset-rules.md</code>
      </div>
    </section>`

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Harness Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --panel: #ffffff;
      --line: #cbd5e1;
      --text: #0f172a;
      --muted: #475569;
      --blue: #2563eb;
      --green: #15803d;
      --amber: #b45309;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.55;
    }

    main {
      width: min(1180px, calc(100% - 48px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }

    header {
      display: flex;
      gap: 20px;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 22px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 30px;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--muted);
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    a.button {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 22px 0;
    }

    .card {
      min-height: 120px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 16px;
    }

    .card h2 {
      margin: 0 0 10px;
      font-size: 14px;
      color: var(--muted);
    }

    .value {
      font-size: 22px;
      font-weight: 800;
      color: var(--text);
      overflow-wrap: anywhere;
    }

    .note {
      margin-top: 8px;
      font-size: 13px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 18px;
      margin-top: 14px;
    }

    .decision {
      border-color: ${needsStackDecision ? 'var(--amber)' : 'var(--green)'};
      background: ${needsStackDecision ? '#fffbeb' : '#f0fdf4'};
    }

    .commands {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }

    code {
      display: block;
      border: 1px solid #dbe3ef;
      border-radius: 8px;
      padding: 10px;
      background: #f8fafc;
      color: #172554;
      overflow-wrap: anywhere;
    }

    @media (max-width: 900px) {
      main { width: min(100% - 28px, 1180px); padding-top: 20px; }
      header { display: block; }
      .actions { justify-content: flex-start; margin-top: 14px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .commands { grid-template-columns: 1fr; }
    }

    @media (max-width: 560px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Harness Dashboard</h1>
        <p>현재 프로젝트의 하네스 적용 상태와 다음에 볼 곳을 한 화면에 모았습니다.</p>
      </div>
      <nav class="actions" aria-label="guide links">
        <a class="button" href="${escapeHtml(fileUrl(guideAbs))}">클릭형 가이드</a>
        <a class="button" href="${escapeHtml(fileUrl(lifecycleAbs))}">라이프사이클 SVG</a>
      </nav>
    </header>

    <section class="grid" aria-label="current harness status">
      ${cards}
    </section>

    ${stackDecisionPanel}

    <section class="panel">
      <h2>매일 쓰는 진입점</h2>
      <p>개발자는 상태 확인과 검증 명령을 주로 사용합니다. 작업별 판단 컨텍스트는 에이전트가 큰 작업 전에 필요할 때 생성합니다.</p>
      <div class="commands">
        <code>npm run harness:scan</code>
        <code>npm run harness:handoff</code>
        <code>npm run harness:check</code>
      </div>
      <p>직접 확인이 필요할 때만 <code>npm run harness:context -- "작업 설명"</code>으로 Agent Decision Context를 생성합니다.</p>
    </section>
  </main>
</body>
</html>
`
}

function openFile(absPath) {
  const opener = process.platform === 'darwin'
    ? ['open', [absPath]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', absPath]]
      : ['xdg-open', [absPath]]

  const result = spawnSync(opener[0], opener[1], {
    cwd: repoRoot,
    stdio: 'ignore',
    detached: true,
  })

  return result.status === 0
}

function main() {
  const guideAbs = path.join(repoRoot, guideRel)
  const dashboardAbs = path.join(repoRoot, dashboardRel)

  if (!fs.existsSync(guideAbs)) {
    console.error(`Guide file not found: ${guideRel}`)
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(dashboardAbs), { recursive: true })
  fs.writeFileSync(dashboardAbs, renderDashboard())

  console.log('Harness guide')
  console.log(`  interactive guide: ${guideRel}`)
  console.log(`  status dashboard: ${dashboardRel}`)
  console.log('')
  console.log('Open in browser:')
  console.log(`  ${fileUrl(dashboardAbs)}`)
  console.log('')
  console.log('Recommended commands:')
  console.log('  npm run harness:scan      프로젝트 상태를 다시 스캔할 때')
  console.log('  npm run harness:handoff   설치/업데이트 후 확인할 일과 현재 상태를 볼 때')
  console.log('  npm run harness:check     사용자가 최종 검증을 승인했을 때')
  console.log('')
  console.log('Commit / push guard:')
  console.log('  npm run hooks:install 을 실행하면 사용자가 승인한 git commit/push 직전에 harness:check가 자동 실행됩니다.')
  console.log('  hook 설치 후 커밋/푸시 요청을 처리할 때는 commit 직전 수동 harness:check를 중복 실행하지 않습니다.')
  console.log('')
  console.log('Agent decision context:')
  console.log('  일반 개발자가 매번 실행할 필요는 없습니다.')
  console.log('  필요 시 에이전트 또는 고급 사용자가 npm run harness:context -- "작업 설명" 으로 생성합니다.')
  const profile = readJson('.harness/policy/profile.json', {})
  if ((profile.activeStack ?? 'none') === 'none') {
    console.log('')
    console.log('Stack decision:')
    console.log('  현재는 공통 하네스만 설치된 상태입니다.')
    console.log('  맞는 스택 하네스가 있으면 npm run standards:list 로 후보를 확인하세요.')
    console.log('  맞는 스택 하네스가 없으면 공통 기준만 유지하고 decision-log에 이유를 남기세요.')
  }

  if (shouldOpen) {
    const opened = openFile(dashboardAbs)
    if (!opened) {
      console.warn('')
      console.warn('Could not open browser automatically. Use the file URL above.')
    }
  }

  console.log('')
  console.log(`Generated: ${relPath(dashboardAbs)}`)
}

main()
