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

  const availableCommands = [
    scripts.includes('harness:guide') ? '`npm run harness:guide -- --open`' : null,
    scripts.includes('harness:scan') ? '`npm run harness:scan`' : null,
    scripts.includes('harness:impact') ? '`npm run harness:impact`' : null,
    scripts.includes('harness:context') ? '`npm run harness:context -- "<작업 설명>"`' : null,
    scripts.includes('harness:check') ? '`npm run harness:check`' : null,
    scripts.includes('harness:update') ? '`npm run harness:update`' : null,
  ].filter(Boolean)

  return `# Harness Handoff

> 설치 또는 업데이트 직후 개발자가 바로 확인할 요약입니다. 이 문서는 런타임 산출물이므로 직접 기준으로 삼지 말고, 필요한 판단은 프로젝트 문서나 decision-log에 옮깁니다.

- generatedAt: ${generatedAt}
- branch: ${branch}
- workingTree: ${changes.length > 0 ? 'dirty' : 'clean'}
- harnessMode: ${profile.harnessMode ?? 'bootstrap'}
- activeStack: ${profile.activeStack ?? 'none'}
- baseHarness: ${baseHarness ? `${baseHarness.version ?? 'unknown'} (${baseHarness.ref ?? baseHarness.source?.type ?? 'unknown'})` : 'unknown'}
- stackHarness: ${stackHarness ? `${stackHarness.version ?? 'unknown'} (${stackHarness.ref ?? 'unknown'})` : 'none'}
- scaffoldTemplate: ${template ? `${template.version ?? 'unknown'} (${template.ref ?? 'unknown'})` : 'none'}

## Read First
- \`.harness/session/project-scan-report.md\`: 현재 프로젝트 구조, 스택, 스타일, 충돌 후보
- \`.harness/project/standards-layers.md\`: 기준 우선순위와 충돌 해석
- \`.harness/policy/context-protocol.md\`: 모든 문서를 한 번에 읽지 않는 컨텍스트 운용 원칙
- \`.harness/documentation/guide/index.html\`: 클릭형 개발자 가이드

## Available Commands
${formatList(availableCommands, '- package.json에 하네스 공개 명령이 아직 연결되지 않았습니다.')}

## Current Changes
${formatList(changes, '- 변경 파일 없음')}
${changes.length >= 20 ? '- ... 출력은 20개로 제한됨' : ''}

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
- npm run harness:check
\`\`\`

첫 줄은 한글 요약, 본문은 하이픈 상세, 검증은 실행한 명령과 미실행 사유를 남깁니다.

## Local Rule Growth Guard
- 새 규칙은 한 번의 구현 세부사항이 아니라 반복되는 도메인, 구조, 검증 기준일 때만 승격합니다.
- 길어진 프로젝트 룰은 인덱스, 세부 문서, 요약으로 나눕니다.
- 에이전트는 항상 모든 로컬룰을 읽지 않고 \`harness:context -- "<작업 설명>"\`으로 이번 작업 관련 후보만 좁힙니다.
- 오래된 판단은 삭제보다 먼저 \`decision-log.md\`에 변경 이유를 남기고 최신 요약을 \`project-memory.md\`나 해당 룰 문서 상단에 둡니다.

## Next Steps
1. \`npm run harness:guide -- --open\`으로 현재 상태와 클릭형 가이드를 확인합니다.
2. \`npm run harness:context -- "<이번 작업>"\`으로 읽을 문서를 좁힙니다.
3. 작업 후 \`npm run harness:check\`로 기준, 링크, 검증 상태를 확인합니다.
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
