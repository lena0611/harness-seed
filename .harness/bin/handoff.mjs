#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..', '..')
const args = process.argv.slice(2)
const writeReport = args.includes('--write')
const outputArgIndex = args.indexOf('--output')
const outputPath = outputArgIndex >= 0 && args[outputArgIndex + 1]
  ? args[outputArgIndex + 1]
  : '.harness/session/handoff.md'

function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel))
}

function readJson(rel, fallback = null) {
  const abs = path.join(repoRoot, rel)
  if (!fs.existsSync(abs)) return fallback

  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return fallback
  }
}

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function formatList(items, fallback = '- 없음') {
  if (!items || items.length === 0) return fallback
  return items.map((item) => `- ${item}`).join('\n')
}

function readManualActionsSummary() {
  const content = exists('.harness/session/manual-actions.md')
    ? fs.readFileSync(path.join(repoRoot, '.harness/session/manual-actions.md'), 'utf8')
    : ''

  if (!content) {
    return '- `.harness/session/manual-actions.md` 없음'
  }

  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|') && !line.includes('---') && !line.includes('상태 | 항목'))
    .slice(0, 5)

  if (lines.length === 0) {
    return '- 열린 수동 조치 없음'
  }

  return lines.map((line) => `- ${line.replace(/^\|\s*|\s*\|$/g, '')}`).join('\n')
}

function changedFiles(limit = 20) {
  const status = runGit(['status', '--short'])
  if (!status) return []

  return status
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
}

function readPackageScripts() {
  const pkg = readJson('package.json', {})
  return Object.keys(pkg.scripts ?? {}).sort()
}

function buildReport() {
  const profile = readJson('.harness/policy/profile.json', {})
  const lock = readJson('.harness/harness-lock.json', {})
  const scripts = readPackageScripts()
  const branch = runGit(['branch', '--show-current']) || '(unknown)'
  const changes = changedFiles()
  const generatedAt = new Date().toISOString()
  const baseHarness = lock.baseHarness
  const stackHarness = lock.stackHarness
  const template = lock.scaffoldTemplate
  const activeStack = profile.activeStack ?? 'none'
  const needsStackDecision = activeStack === 'none'

  const availableCommands = [
    scripts.includes('harness:guide') ? '`npm run harness:guide -- --open`' : null,
    scripts.includes('harness:scan') ? '`npm run harness:scan`' : null,
    scripts.includes('harness:impact') ? '`npm run harness:impact`' : null,
    scripts.includes('harness:check') ? '`npm run harness:check`' : null,
    scripts.includes('harness:update') ? '`npm run harness:update`' : null,
  ].filter(Boolean)

  const stackDecision = needsStackDecision
    ? `## Next Decision
현재는 공통 하네스만 설치된 상태입니다. 이 상태는 정상적인 선택지일 수 있습니다.

선택지는 두 가지입니다.

1. 현재 프로젝트와 맞는 스택 하네스가 있으면 해당 스택 하네스의 \`npx ... init\` 명령을 실행합니다.
2. 맞는 스택 하네스가 없거나 스택 독립 프로젝트라면 공통 기준만 유지합니다.

판단 순서:

1. \`npm run standards:list\`로 회사가 제공하는 스택 하네스 후보를 확인합니다.
2. 맞는 후보가 없으면 \`.harness/session/decision-log.md\`에 "공통 기준만 운영" 이유를 남깁니다.
3. 반복될 프로젝트 유형이라 새 스택 하네스가 필요해 보이면 \`.harness/session/developer-input-queue.md\`에 후보 요청을 남깁니다.

나중에 맞는 스택 하네스가 제공되면 재설치가 아니라 스택 기준 추가 적용으로 진행합니다.

\`\`\`bash
npm run standards:list
npx -y git+<stack-harness-repo-url>#<tag> init
npm run stack:status
npm run harness:check
\`\`\`
`
    : `## Stack Decision
선택된 스택 기준: \`${activeStack}\`

스택 기준 상세는 \`.harness/project/stack-preset-rules.md\`와 \`npm run stack:status\`에서 확인합니다.
`

  return `# Harness Handoff

> 설치 또는 업데이트 직후 개발자가 바로 확인할 요약입니다. 이 문서는 런타임 산출물이므로 직접 기준으로 삼지 말고, 필요한 판단은 프로젝트 문서나 decision-log에 옮깁니다.

- generatedAt: ${generatedAt}
- branch: ${branch}
- workingTree: ${changes.length > 0 ? 'dirty' : 'clean'}
- harnessMode: ${profile.harnessMode ?? 'bootstrap'}
- activeStack: ${activeStack}
- baseHarness: ${baseHarness ? `${baseHarness.version ?? 'unknown'} (${baseHarness.ref ?? baseHarness.source?.type ?? 'unknown'})` : 'unknown'}
- stackHarness: ${stackHarness ? `${stackHarness.version ?? 'unknown'} (${stackHarness.ref ?? 'unknown'})` : 'none'}
- scaffoldTemplate: ${template ? `${template.version ?? 'unknown'} (${template.ref ?? 'unknown'})` : 'none'}

${stackDecision}

## Read First
- \`.harness/session/project-scan-report.md\`: 현재 프로젝트 구조, 스택, 스타일, 충돌 후보
- \`.harness/project/standards-layers.md\`: 기준 우선순위와 충돌 해석
- \`.harness/policy/context-protocol.md\`: 모든 문서를 한 번에 읽지 않는 컨텍스트 운용 원칙
- \`.harness/documentation/guide/index.html\`: 클릭형 개발자 가이드

## Available Commands
새 터미널에서 실행한다면 먼저 프로젝트 루트에서 \`nvm use\`를 실행합니다.

${formatList(availableCommands, '- package.json에 하네스 공개 명령이 아직 연결되지 않았습니다.')}

## Current Changes
${formatList(changes, '- 변경 파일 없음')}
${changes.length >= 20 ? '- ... 출력은 20개로 제한됨' : ''}

## Manual Actions
${readManualActionsSummary()}

외부 콘솔, secret, capability, Pages/배포 설정처럼 에이전트가 직접 끝낼 수 없는 항목은 \`.harness/session/manual-actions.md\`에 남깁니다.

## Work Closure Report
작업 완료 후보가 되면 아래 항목을 최종 응답 또는 업무 히스토리에 남깁니다.

| 항목 | 기록할 내용 |
| --- | --- |
| 변경 파일 | 기능 코드, 설정, 하네스 문서, 생성 파일 구분 |
| 검증 결과 | \`harness:check\`, lint, test, build, 스택별 검증 |
| 정책 영향 | SYNC GAP 등급과 조치 여부 |
| 중요 경로 | \`critical-paths.md\` 매칭 여부 |
| 수동 조치 | secret, Pages, capability 등 사용자 처리 필요 여부 |
| 배포 필요 | 배포/릴리스/마이그레이션 필요 여부 |

## Visible Agent Trace
에이전트의 원시 내부 추론을 그대로 출력하지 않습니다. 대신 작업 중 개발자에게 보여줄 수 있는 trace는 아래 형식으로 남깁니다.

\`\`\`text
[harness] request: 목표/범위/완료조건 정리
[harness] context: 읽은 기준과 추가 확인 문서
[harness] impact: 영향 파일군과 충돌 후보
[harness] action: 실행한 명령 또는 수정한 범위
[harness] decision: 선택한 기준, 예외, 보류 질문
[harness] verify: harness:check/lint/test/build 결과
\`\`\`

## Commit Message Format
\`.github/commit-template.txt\`가 git commit template로 연결됩니다. 커밋 메시지는 아래 형식을 기준으로 씁니다.

\`\`\`text
변경 요약

- 주요 변경 1
- 주요 변경 2

검증
- pre-commit hook: npm run harness:check
\`\`\`

첫 줄은 한글 요약, 본문은 하이픈 상세, 검증은 실행한 명령과 미실행 사유를 남깁니다.

## Local Rule Growth Guard
- 새 규칙은 한 번의 구현 세부사항이 아니라 반복되는 도메인, 구조, 검증 기준일 때만 승격합니다.
- 길어진 프로젝트 룰은 인덱스, 세부 문서, 요약으로 나눕니다.
- 에이전트는 항상 모든 로컬룰을 읽지 않고 \`harness:context -- "<작업 설명>"\`으로 이번 작업의 판단 컨텍스트를 만듭니다.
- 오래된 판단은 삭제보다 먼저 \`decision-log.md\`에 변경 이유를 남기고 최신 요약을 \`project-memory.md\`나 해당 룰 문서 상단에 둡니다.

## 확인할 일
1. 새 터미널이면 프로젝트 루트에서 \`nvm use\`를 실행합니다.
2. \`npm run harness:guide -- --open\`으로 현재 상태와 클릭형 가이드를 확인합니다.
3. 큰 작업이나 낯선 영역이면 에이전트가 \`npm run harness:context -- "<이번 작업>"\`으로 판단 컨텍스트를 만듭니다.
4. \`npm run hooks:install\`을 실행하면 이후 사용자가 승인한 \`git commit\`/\`git push\` 직전에 \`harness:check\`가 자동 실행됩니다.
5. 사용자가 \`커밋해줘\`라고 요청했고 hook이 설치되어 있으면 에이전트는 선행 \`harness:check\`를 중복 실행하지 않고 commit hook 검증에 맡깁니다.
6. hook을 설치하지 않았거나 커밋 전 미리 보고 싶으면 사용자가 최종 검증을 승인한 뒤 \`npm run harness:check\`로 직접 검증합니다.
`
}

const report = buildReport()

if (writeReport) {
  const absOutput = path.resolve(repoRoot, outputPath)
  fs.mkdirSync(path.dirname(absOutput), { recursive: true })
  fs.writeFileSync(absOutput, report)
  console.log(`Harness handoff written: ${toPosix(path.relative(repoRoot, absOutput))}`)
} else {
  process.stdout.write(report)
}
