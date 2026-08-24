#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isHistoryLogPath, isIgnorableCodePath } from '../.harness/bin/doc-link-check.mjs'
import { buildScreenIndex, normalizeScreenLinks, sha256Text as specSyncSha256Text } from '../.harness/bin/spec-sync.mjs'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..')
const nodeBin = process.execPath
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const packageRef = `v${packageVersion}`

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    // input은 stdio[0]이 'ignore'면 전달되지 않는다(실측) — input이 있으면 pipe로 연다.
    stdio: options.stdio ?? (options.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']),
    env: options.env,
    input: options.input,
  })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function exists(target, rel) {
  return fs.existsSync(path.join(target, rel))
}

function read(target, rel) {
  return fs.readFileSync(path.join(target, rel), 'utf8')
}

function writeJson(target, rel, value) {
  fs.mkdirSync(path.dirname(path.join(target, rel)), { recursive: true })
  fs.writeFileSync(path.join(target, rel), `${JSON.stringify(value, null, 2)}\n`)
}

function sha256Text(content) {
  return createHash('sha256').update(content).digest('hex')
}

function sha256File(absPath) {
  return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')
}

function makeBareTarget() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-init-test-'))
  run('git', ['init', '--quiet'], { cwd: target })
  return target
}

function makeTarget() {
  // 대부분의 기존 테스트는 Node 소비자(=package.json 보유) 설치를 가정한다.
  // P1(2026-06-09) 이후 init은 package.json이 없으면 새로 만들지 않으므로,
  // 기존 거동(harness 별칭 머지, `npm run` 명령)을 검증하려면 타깃이 package.json을 가져야 한다.
  // package.json 비주입/비-Node 경로는 makeBareTarget() 기반 별도 테스트로 검증한다.
  const target = makeBareTarget()
  writeJson(target, 'package.json', {
    name: 'harness-test-target',
    private: true,
    type: 'module',
    scripts: {},
  })
  return target
}

function makeNoGitTarget() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-no-git-target-'))
  writeJson(target, 'package.json', {
    name: 'harness-no-git-target',
    private: true,
    type: 'module',
    scripts: {},
  })
  return target
}

function runInit(target, ...args) {
  return run(nodeBin, [path.join(repoRoot, 'scripts/init.mjs'), 'init', ...args], { cwd: target })
}

function runGuard(target, ...args) {
  return run(nodeBin, [path.join(target, '.harness/bin/guard.mjs'), ...args], { cwd: target })
}

function runInitWithEnv(target, env, ...args) {
  return run(nodeBin, [path.join(repoRoot, 'scripts/init.mjs'), 'init', ...args], {
    cwd: target,
    env: { ...process.env, ...env },
  })
}

// dual-runtime 테스트용 가짜 nvm 디렉터리. NVM_DIR 환경변수로 주입해 머신의 실제 nvm 상태와 무관하게 만든다.
function makeFakeNvmDir(versions) {
  const fakeNvm = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fake-nvm-'))
  fs.writeFileSync(path.join(fakeNvm, 'nvm.sh'), '# fake nvm for tests\n')
  for (const version of versions) {
    const binDir = path.join(fakeNvm, 'versions', 'node', version, 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'node'), `#!/bin/sh\necho ${version}\n`)
    fs.chmodSync(path.join(binDir, 'node'), 0o755)
  }
  return fakeNvm
}

function cleanInstallCreatesExpectedFiles() {
  const target = makeTarget()
  runInit(target)

  assert(exists(target, '.harness/policy/profile.json'), 'clean install should copy .harness')
  assert(exists(target, '.claude/settings.json'), 'clean install should copy Claude Code adapter')
  assert(exists(target, '.harness/bin/scan-project.mjs'), 'clean install should copy scan report script under .harness/bin')
  assert(exists(target, '.harness/bin/list-stack-standards.mjs'), 'clean install should copy stack standard listing script under .harness/bin')
  assert(exists(target, '.harness/bin/list-templates.mjs'), 'clean install should copy template listing script under .harness/bin')
  assert(exists(target, '.harness/bin/outdated-harness.mjs'), 'clean install should copy harness outdated script under .harness/bin')
  assert(exists(target, '.harness/bin/update-harness.mjs'), 'clean install should copy harness update script under .harness/bin')
  assert(exists(target, '.harness/bin/sync-context.mjs'), 'clean install should copy harness sync script under .harness/bin')
  assert(exists(target, '.harness/bin/build-context.mjs'), 'clean install should copy harness context script under .harness/bin')
  assert(exists(target, '.harness/bin/harness-guide.mjs'), 'clean install should copy harness guide script under .harness/bin')
  assert(exists(target, '.harness/bin/handoff.mjs'), 'clean install should copy harness handoff script under .harness/bin')
  assert(exists(target, '.harness/documentation/guide/index.html'), 'clean install should copy interactive guide')
  assert(exists(target, '.github/commit-template.txt'), 'clean install should copy commit message template')
  assert(!exists(target, '.github/workflows/policy-guard.yml'), 'clean install should not copy seed GitHub Actions workflow')
  assert(!exists(target, 'scripts'), 'clean install should not create root scripts directory')
  assert(!exists(target, '.nvmrc'), 'clean install should not create project runtime contract')
  assert(exists(target, '.harness/install-manifest.json'), 'clean install should write install manifest')
  assert(exists(target, '.harness/harness-lock.json'), 'clean install should write harness lock')
  assert(exists(target, '.harness/session/project-scan-report.md'), 'clean install should auto-create scan report')
  assert(exists(target, '.harness/session/handoff.md'), 'clean install should auto-create handoff report')
  assert(exists(target, '.claude/hooks/enforce-check.sh'), 'clean install should copy agent completion check hook')
  assert(exists(target, '.codex/hooks/inject-context.sh'), 'clean install should copy Codex context injection hook')
  assert(exists(target, '.claude/hooks/scan-secrets.sh'), 'clean install should copy prompt secret scanner hook')
  assert(exists(target, '.claude/hooks/block-dangerous.sh'), 'clean install should copy dangerous bash guard hook')
  assert(exists(target, '.claude/hooks/protect-paths.sh'), 'clean install should copy protected path guard hook')
  assert(exists(target, '.claude/hooks/record-tool-failure.sh'), 'clean install should copy capped tool failure recorder hook')
  assert(exists(target, '.harness/session/decision-log.md'), 'clean install should create consumer decision log')
  assert(exists(target, '.harness/session/active-context.md'), 'clean install should create consumer active context')
  assert(exists(target, '.harness/session/project-memory.md'), 'clean install should create consumer project memory')
  assert(exists(target, '.harness/maintenance/README.md'), 'clean install should create maintenance history guide')
  const currentYear = String(new Date().getFullYear())
  assert(exists(target, `.harness/maintenance/work-history/${currentYear}/.gitkeep`), 'clean install should create year-based work history folder for git tracking')
  assert(exists(target, '.claude/commands/운영업무.md'), 'clean install should copy operational work slash command')
  assert(exists(target, '.claude/commands/업무요약.md'), 'clean install should copy work summary slash command')
  assert(exists(target, '.claude/commands/하네스업데이트.md'), 'clean install should copy harness update slash command')
  assert(exists(target, '.claude/commands/검증설정.md'), 'clean install should copy verify ownership slash command')
  assert(exists(target, '.claude/commands/하네스용어.md'), 'clean install should copy terminology lookup slash command')
  assert(read(target, '.claude/commands/하네스용어.md').includes('.harness/project/terminology.md'), 'terminology command must point at the terminology source of truth')
  const terminologySkill = JSON.parse(read(target, '.harness/skills/registry.json')).skills.find((skill) => skill.id === 'harness.terminology')
  assert(terminologySkill, 'skill registry must carry the terminology lookup contract')
  assert(terminologySkill.read.includes('.harness/project/terminology.md'), 'terminology skill must read the terminology source of truth')

  const claudeInstructions = read(target, 'CLAUDE.md')
  assert(claudeInstructions.includes('하네스 자동 인식 의무'), 'CLAUDE.md should require automatic harness detection')
  assert(claudeInstructions.includes('사용자가 "하네스"를 언급하지 않아도'), 'CLAUDE.md should not depend on explicit harness mention')
  // 0.2.127 다이어트: 최종화 규칙은 CLAUDE.md 작업 원칙 한 곳에만 둔다(3중 서술 통합). 내용 계약을 잠근다.
  assert(claudeInstructions.includes('최종화 규칙(정본'), 'CLAUDE.md must carry the single canonical finalization rule')
  assert(claudeInstructions.includes('완료 승인 전에는'), 'CLAUDE.md finalization rule must forbid heavy actions before approval')
  assert(claudeInstructions.includes('hook 검증에 맡겨 중복 실행을 피하고'), 'CLAUDE.md should avoid duplicate manual check before hooked commit')

  const agentInstructions = read(target, 'AGENTS.md')
  assert(agentInstructions.includes('비-Claude 에이전트 필수 동작'), 'AGENTS.md should include non-Claude required behavior')
  assert(agentInstructions.includes('하네스 작업 프로토콜을 자동으로 적용'), 'AGENTS.md should require automatic protocol application')
  assert(agentInstructions.includes('hook이 설치되어 있으면 선행 `harness:check`를 중복 실행하지 않고'), 'AGENTS.md should avoid duplicate manual check before hooked commit')

  const sessionStartAlert = read(target, '.harness/session/session-start-alert.md')
  assert(sessionStartAlert.includes('사용자가 하네스를 언급하지 않는 것은 하네스를 비활성화한다는 뜻이 아닙니다'), 'session start alert should keep harness active without explicit mention')
  assert(sessionStartAlert.includes('선행 `harness:check`를 중복 실행하지 않습니다'), 'session start alert should mention duplicate check avoidance')

  const reminderCommand = read(target, '.claude/commands/reminder.md')
  assert(reminderCommand.includes('project/*'), 'reminder command should mention project rule pointer policy')
  assert(reminderCommand.includes('append-only로 계속 늘리지 않습니다'), 'reminder command should prevent append-only reminder growth')

  const decisionCommand = read(target, '.claude/commands/decision.md')
  assert(decisionCommand.includes('→ <대상 문서> 참조'), 'decision command should compact superseded decisions into pointers')
  assert(decisionCommand.includes('append-only로만 늘리지 말고'), 'decision command should prevent append-only decision log growth')

  const memoryCommand = read(target, '.claude/commands/memory.md')
  assert(memoryCommand.includes('한 항목 한 줄'), 'memory command should keep memory index entries compact')
  assert(memoryCommand.includes('supersede된 기억'), 'memory command should remove stale memory entries')

  const sessionStartHook = read(target, '.claude/hooks/session-start-reminder.sh')
  assert(sessionStartHook.includes('^[[:space:]]*\\|[^|]+\\|[[:space:]]*(open|deferred)[[:space:]]*\\|'), 'session start hook should only match actual open/deferred queue rows')
  assert(!sessionStartHook.includes("status:[[:space:]]*(open|deferred)|open|deferred"), 'session start hook should not match queue status definitions')

  const commitPushRules = read(target, '.harness/project/commit-push-rules.md')
  assert(commitPushRules.includes('## 요청별 검증 경로'), 'commit/push rules should explain request-specific verification paths')
  assert(commitPushRules.includes('hook 설치 여부는 `git config core.hooksPath`가 `.githooks`'), 'commit/push rules should explain hook installation detection')
  assert(commitPushRules.includes('commit hook에서 같은 검증이 다시 실행될 수 있음'), 'commit/push rules should warn about intentional manual check duplication')

  const skillRegistry = JSON.parse(read(target, '.harness/skills/registry.json'))
  const sessionStartSkill = skillRegistry.skills.find((skill) => skill.id === 'harness.session-start')
  const memoryHygieneSkill = skillRegistry.skills.find((skill) => skill.id === 'harness.memory-hygiene')
  const handoffSkill = skillRegistry.skills.find((skill) => skill.id === 'harness.handoff-flow')
  const commitPushSkill = skillRegistry.skills.find((skill) => skill.id === 'harness.commit-push-finalization')
  const updateSkill = skillRegistry.skills.find((skill) => skill.id === 'harness.update-flow')
  assert(sessionStartSkill, 'consumer skill registry should include session start skill')
  assert(memoryHygieneSkill, 'consumer skill registry should include memory hygiene skill')
  assert(handoffSkill, 'consumer skill registry should include handoff skill')
  assert(sessionStartSkill.outputs.some((output) => output.includes('권위 문서 포인터')), 'session start skill should enforce pointer-based slim session files')
  assert(sessionStartSkill.outputs.some((output) => output.includes('open/deferred')), 'session start skill should keep only actionable queue items loaded')
  assert(memoryHygieneSkill.outputs.some((output) => output.includes('answered/obsolete')), 'memory hygiene skill should clean answered or obsolete queue items')
  assert(memoryHygieneSkill.records.includes('.harness/session/developer-input-queue.md'), 'memory hygiene skill should record queue cleanup')
  assert(handoffSkill.outputs.some((output) => output.includes('슬림 유지')), 'handoff skill should report session file slimness')
  assert(handoffSkill.outputs.some((output) => output.includes('기억 표면 정리')), 'handoff skill should report memory surface hygiene')
  assert(commitPushSkill, 'consumer skill registry should include commit/push finalization skill')
  assert(commitPushSkill.audience.includes('consumer'), 'commit/push finalization skill should be consumer-facing')
  assert(commitPushSkill.read.includes('.harness/project/commit-push-rules.md'), 'commit/push finalization skill should read commit/push rules')
  assert(commitPushSkill.triggers.includes('커밋하고 푸시'), 'commit/push finalization skill should trigger on combined commit and push requests')
  assert(commitPushSkill.commands.some((command) => command.includes('git config --get core.hooksPath')), 'commit/push finalization skill should check hook installation')
  assert(commitPushSkill.outputs.includes('중복 검증 생략 여부'), 'commit/push finalization skill should report duplicate check avoidance')
  assert(updateSkill, 'consumer skill registry should include harness update flow')
  assert(updateSkill.audience.includes('consumer'), 'harness update flow should be consumer-facing')
  assert(updateSkill.commands.includes('npm run harness:outdated'), 'harness update flow should check outdated state')
  assert(updateSkill.commands.includes('npm run harness:update -- --base-only'), 'harness update flow should document base-only update')

  const decisionLog = read(target, '.harness/session/decision-log.md')
  assert(decisionLog.includes('소비자 프로젝트 전용 로그'), 'consumer decision log should explain project scope')
  assert(decisionLog.includes('사용자가 하네스를 직접 언급하지 않았더라도'), 'consumer decision log should mention implicit harness decisions')
  assert(decisionLog.includes('→ <대상 문서> 참조'), 'consumer decision log should describe pointer compaction')
  assert(decisionLog.includes('append-only로만 늘리지 말고'), 'consumer decision log should describe memory hygiene')
  assert(decisionLog.includes('하네스 초기 설치 또는 업데이트'), 'consumer decision log should include install entry')
  assert(!decisionLog.includes('정식 공개 전 공개 명령 정리'), 'consumer decision log should not include seed development history')
  assert(!decisionLog.includes('시드 하네스 저장소 분리'), 'consumer decision log should not include seed repository history')

  const developerInputQueue = read(target, '.harness/session/developer-input-queue.md')
  assert(developerInputQueue.includes('상시 로드되는 큐에는 `open`과 `deferred` 항목만 유지'), 'consumer input queue should keep only open/deferred items loaded')
  assert(developerInputQueue.includes('answered` 또는 `obsolete` 항목은 관련 문서 반영'), 'consumer input queue should remove answered or obsolete items after reflection')

  const activeContext = read(target, '.harness/session/active-context.md')
  assert(activeContext.includes('소비자 프로젝트 전용 문서'), 'consumer active context should explain project scope')
  assert(activeContext.includes('사용자가 "하네스"를 언급하지 않아도'), 'consumer active context should remind agents to auto-detect harness')
  assert(activeContext.includes('운영 규칙 본문은 복사하지 않고'), 'consumer active context should stay slim and point to project rules')
  assert(activeContext.includes('.harness/project/workflow-rules.md'), 'consumer active context should point to workflow rules')
  assert(!activeContext.includes('일반화 하네스 + 외부 스택 기준 런타임'), 'consumer active context should not include seed current state')

  const reminder = read(target, '.harness/session/next-session-reminder.md')
  assert(reminder.includes('권위 문서 포인터'), 'consumer reminder should include authority document pointers')
  assert(reminder.includes('규칙 본문을 복사하지 않고'), 'consumer reminder should avoid copying project rule body')

  const projectMemory = read(target, '.harness/session/project-memory.md')
  assert(projectMemory.includes('한 항목은 한 줄로 유지'), 'consumer project memory should keep compact one-line entries')
  assert(projectMemory.includes('supersede된 기억'), 'consumer project memory should remove stale facts')

  // P5 회귀 잠금: Node 프로젝트(.gitignore)는 기존처럼 node 전용 항목을 받는다.
  const cleanGitignore = read(target, '.gitignore')
  assert(cleanGitignore.includes('node_modules/'), 'Node install should keep adding node_modules/ to .gitignore')
  assert(cleanGitignore.includes('dist/'), 'Node install should keep adding dist/ to .gitignore')

  const pkg = JSON.parse(read(target, 'package.json'))
  assert(pkg.scripts['harness:scan'], 'clean install should merge harness scan script')
  assert(pkg.scripts['harness:handoff'], 'clean install should merge harness handoff script')
  assert(pkg.scripts['harness:check'], 'clean install should merge harness check script')
  assert(pkg.scripts['harness:impact'], 'clean install should merge harness impact script')
  assert(pkg.scripts['harness:outdated'], 'clean install should merge harness outdated script')
  assert(pkg.scripts['harness:update'], 'clean install should merge harness update script')
  assert(pkg.scripts['harness:guide'], 'clean install should merge harness guide script')
  assert(pkg.scripts['harness:sync'], 'clean install should merge harness sync script')
  assert(pkg.scripts['harness:context'], 'clean install should merge harness context script')
  assert(pkg.scripts['standards:list'], 'clean install should merge stack standard listing script')
  assert(!pkg.scripts.guard, 'clean install should not add deprecated guard alias')
  assert(!pkg.scripts['stack:list'], 'clean install should not add deprecated stack list alias')
  assert(!pkg.scripts['node:check'], 'clean install should not expose harness internal node check script')
  assert(!pkg.scripts['policy:impact'], 'clean install should not expose harness internal policy script')
  assert(!pkg.scripts['docs:check'], 'clean install should not expose harness internal docs script')
  assert(pkg.scripts['harness:check'].startsWith('node .harness/bin/check-node-version.mjs &&'), 'consumer harness scripts should not depend on node:check npm script')
  assert(pkg.scripts['template:apply'], 'clean install should merge template apply script')
  assert(exists(target, '.harness/project/template-contract.md'), 'clean install should copy template contract bridge')
  assert(exists(target, '.harness/project/commit-push-rules.md'), 'clean install should copy commit/push rules')

  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(manifest.tool === 'harness-seed', 'install manifest should identify harness-seed')
  assert(manifest.version === packageVersion, 'install manifest should record package version')
  assert(manifest.source.packageVersion === packageVersion, 'install manifest should record source package version')
  assert(manifest.managedFiles['.harness/bin/guard.mjs'], 'install manifest should record managed files')
  assert(manifest.managedFiles['.harness/bin/harness-guide.mjs'], 'install manifest should record harness guide script')
  assert(manifest.managedFiles['.harness/bin/sync-context.mjs'], 'install manifest should record sync context script')
  assert(!manifest.managedFiles['.harness/session/decision-log.md'], 'consumer decision log should not be managed as seed file')
  assert(manifest.projectOwnedFiles.includes('.harness/session/decision-log.md'), 'install manifest should list decision log as project-owned')
  assert(manifest.projectOwnedFiles.includes('.harness/project/commit-push-rules.md'), 'install manifest should list commit/push rules as project-owned')

  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(lock.baseHarness.version === packageVersion, 'harness lock should record base harness version')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(profile.activeStack === 'none', 'clean install should default to stack-agnostic mode')

  run('npm', ['run', 'harness:sync'], { cwd: target })
  run('npm', ['run', 'harness:context', '--', 'context smoke'], { cwd: target })
  assert(exists(target, '.harness/generated/project-map.md'), 'harness sync should generate project map')
  assert(exists(target, '.harness/session/task-context.md'), 'harness context should generate task context')

  const status = fs.statSync(path.join(target, '.claude/hooks/statusline.sh'))
  assert((status.mode & 0o111) !== 0, 'Claude hook should be executable')
  const agentCheckStatus = fs.statSync(path.join(target, '.claude/hooks/enforce-check.sh'))
  assert((agentCheckStatus.mode & 0o111) !== 0, 'Claude agent completion check hook should be executable')
  const codexInjectStatus = fs.statSync(path.join(target, '.codex/hooks/inject-context.sh'))
  assert((codexInjectStatus.mode & 0o111) !== 0, 'Codex context injection hook should be executable')
  const secretHookStatus = fs.statSync(path.join(target, '.claude/hooks/scan-secrets.sh'))
  assert((secretHookStatus.mode & 0o111) !== 0, 'Claude prompt secret scanner hook should be executable')
  const dangerousHookStatus = fs.statSync(path.join(target, '.claude/hooks/block-dangerous.sh'))
  assert((dangerousHookStatus.mode & 0o111) !== 0, 'Claude dangerous bash guard hook should be executable')
  const failureHookStatus = fs.statSync(path.join(target, '.claude/hooks/record-tool-failure.sh'))
  assert((failureHookStatus.mode & 0o111) !== 0, 'Claude tool failure recorder hook should be executable')

  const claudeSettings = JSON.parse(read(target, '.claude/settings.json'))
  assert(claudeSettings.hooks.UserPromptSubmit.some((entry) => entry.hooks.some((hook) => hook.command.includes('scan-secrets.sh'))), 'Claude settings should register prompt secret scanner')
  assert(claudeSettings.hooks.PreToolUse.some((entry) => entry.matcher === 'Bash' && entry.hooks.some((hook) => hook.command.includes('block-dangerous.sh'))), 'Claude settings should register dangerous bash guard')
  assert(claudeSettings.hooks.PostToolUseFailure.some((entry) => entry.hooks.some((hook) => hook.command.includes('record-tool-failure.sh'))), 'Claude settings should register capped tool failure recorder')
  assert(read(target, '.codex/hooks/inject-context.sh').includes('Harness reporting: when reporting actual work progress'), 'Codex hook should remind conditional visible trace reporting')

  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('## Standards Layers'), 'scan report should include standards layers')
  assert(report.includes('## Conflict Candidates'), 'scan report should include conflict candidates')

  // 시드 저장소 전용 릴리스 파이프라인은 소비자에게 가면 안 된다(0.2.119) —
  // INSTALL_ITEMS 허용 목록 덕에 자연 제외되지만, 목록이 넓어져도 이 계약이 지키게 잠근다.
  assert(!exists(target, '.gitlab-ci.yml'), 'seed release pipeline must not ship to consumers')
  assert(!exists(target, 'scripts/release-notice.mjs'), 'seed release-notice tool must not ship to consumers')
}

function installOutputUsesConditionalNvmAndGitGuidance() {
  const gitTarget = makeTarget()
  const gitOutput = runInit(gitTarget, '--no-scan', '--no-handoff', '--no-check')

  assert(gitOutput.includes('프로젝트 .nvmrc 없음'), 'install output should say when .nvmrc is absent')
  assert(!gitOutput.includes('\n       nvm use\n'), 'install output should not tell users to run nvm use when .nvmrc is absent')
  assert(gitOutput.includes('git commit/push 전 자동 검증 연결'), 'git project should still suggest hook installation')

  const noGitTarget = makeNoGitTarget()
  const noGitOutput = runInit(noGitTarget, '--no-scan', '--no-handoff', '--no-check')

  assert(noGitOutput.includes('현재 git 저장소가 아니므로 건너뜁니다'), 'non-git install output should not present hook install as an immediate step')
  assert(noGitOutput.includes('git init 후 npm run hooks:install'), 'non-git install output should explain how to enable hooks later')
}

function hooksInstallFailsClearlyOutsideGit() {
  const target = makeNoGitTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  let failed = false
  try {
    run('npm', ['run', '--silent', 'hooks:install'], { cwd: target })
  } catch (error) {
    failed = error.status === 1
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    assert(output.includes('git 저장소가 아니라 hook을 설치하지 않았습니다'), 'hooks:install should fail with a clear non-git message')
    assert(!output.includes('node:internal/errors'), 'hooks:install should not print a Node stack trace for non-git projects')
  }

  assert(failed, 'hooks:install outside git should fail with exit code 1')
}

function nonNodeInstallSkipsPackageJson() {
  // P1(2026-06-09): PHP/Java 같은 비-Node 백엔드 프로젝트(package.json 없음)에는
  // package.json을 새로 만들지 않는다. 프로젝트 매니페스트 오염 방지.
  const target = makeBareTarget()
  fs.writeFileSync(path.join(target, 'composer.json'), '{\n  "name": "acme/app"\n}\n')
  fs.writeFileSync(path.join(target, 'pom.xml'), '<project></project>\n')

  const output = runInit(target, '--no-scan', '--no-handoff', '--no-check')

  assert(!exists(target, 'package.json'), 'non-Node install should not create package.json')
  assert(output.includes('package.json: 없음 → 생성하지 않음'), 'non-Node install should report package.json skip')
  assert(output.includes('비-Node 프로젝트 안내'), 'non-Node install should print npm-free command guidance')
  assert(read(target, 'composer.json').includes('acme/app'), 'non-Node install should preserve composer.json')
  assert(read(target, 'pom.xml').includes('<project>'), 'non-Node install should preserve pom.xml')

  // 하네스 본체는 정상 설치되어야 한다.
  assert(exists(target, '.harness/policy/profile.json'), 'non-Node install should still copy harness body')
  assert(exists(target, '.harness/bin/guard.mjs'), 'non-Node install should still copy guard')
  assert(exists(target, '.harness/install-manifest.json'), 'non-Node install should still write install manifest')

  // P5: 비-Node 프로젝트의 .gitignore는 Node 전용 항목으로 오염되지 않아야 한다.
  const gitignore = read(target, '.gitignore')
  assert(!gitignore.includes('node_modules/'), 'non-Node install should not add node_modules/ to .gitignore')
  assert(!gitignore.split(/\r?\n/).includes('dist/'), 'non-Node install should not add dist/ to .gitignore')
  assert(gitignore.includes('.harness/generated/'), 'non-Node install should still add harness artifacts to .gitignore')
  assert(gitignore.includes('.harness-backup/'), 'non-Node install should still add harness backup dir to .gitignore')

  // npm/package.json 없이 Node 도구로 직접 검증이 동작해야 한다(activeStack=none → 일반 검사).
  run(nodeBin, [path.join(target, '.harness/bin/guard.mjs')], { cwd: target })
}

function optInCreatesPackageJsonForGreenfieldNode() {
  // 드문 greenfield Node 케이스: --with-package-json 명시 시에만 생성한다.
  const target = makeBareTarget()

  runInit(target, '--with-package-json', '--no-scan', '--no-handoff', '--no-check')

  assert(exists(target, 'package.json'), 'opt-in should create package.json when missing')
  const pkg = JSON.parse(read(target, 'package.json'))
  assert(pkg.scripts['harness:check'], 'opt-in package.json should merge harness check script')
  assert(
    pkg.scripts['harness:check'].startsWith('node .harness/bin/check-node-version.mjs &&'),
    'opt-in consumer scripts should not depend on node:check npm script',
  )
}

function launcherRunsHarnessWithoutNpm() {
  // P2(2026-06-09): npm/package.json 없이도 `.harness/bin/harness <command>`로 하네스를 실행한다.
  const target = makeBareTarget()
  fs.writeFileSync(path.join(target, 'composer.json'), '{\n  "name": "acme/app"\n}\n')
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const launcherRel = '.harness/bin/harness'
  assert(exists(target, launcherRel), 'install should include npm-free harness launcher')
  const mode = fs.statSync(path.join(target, launcherRel)).mode
  assert((mode & 0o111) !== 0, 'harness launcher should be executable')

  const launcher = path.join(target, launcherRel)

  const help = run(launcher, ['--help'], { cwd: target })
  assert(help.includes('Usage: harness'), 'launcher --help should print usage')
  const prefixEnv = { ...process.env, npm_config_prefix: '/opt/homebrew', NPM_CONFIG_PREFIX: '/opt/homebrew' }
  const helpWithNpmPrefix = run(launcher, ['--help'], { cwd: target, env: prefixEnv })
  assert(helpWithNpmPrefix.includes('Usage: harness'), 'launcher should tolerate npm_config_prefix when sourcing nvm')

  // npm/package.json 없이 통합 검사가 동작해야 한다(activeStack=none → 일반 검사 후 종료).
  const checkOut = run(launcher, ['check'], { cwd: target })
  assert(checkOut.includes('Harness check summary'), 'launcher check should run guard without npm')

  // 알 수 없는 명령은 usage와 함께 비정상 종료해야 한다.
  let failed = false
  try {
    run(launcher, ['definitely-not-a-command'], { cwd: target })
  } catch (error) {
    failed = error.status === 1
    assert(String(`${error.stdout ?? ''}${error.stderr ?? ''}`).includes('알 수 없는 명령'), 'launcher should reject unknown command')
  }
  assert(failed, 'launcher unknown command should exit non-zero')

  // Windows shim도 함께 설치되어야 한다(cmd.exe/PowerShell 사용자용 — bw-windows-shim).
  const cmdRel = '.harness/bin/harness.cmd'
  assert(exists(target, cmdRel), 'install should include Windows cmd shim for the harness launcher')
  const cmdText = read(target, cmdRel)

  // 드리프트 가드: 소비자 npm script가 호출하는 .harness/bin/*.mjs를 sh 런처와 .cmd shim이 모두 커버해야 한다.
  const launcherText = read(target, launcherRel)
  const seedPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const initSrc = fs.readFileSync(path.join(repoRoot, 'scripts/init.mjs'), 'utf8')
  const namesBlock = initSrc.match(/const CONSUMER_SCRIPT_NAMES = \[([\s\S]*?)\]/)
  assert(namesBlock, 'test should locate CONSUMER_SCRIPT_NAMES in init.mjs')
  const consumerNames = [...namesBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  const referenced = new Set()
  for (const name of consumerNames) {
    const script = seedPkg.scripts[name]
    if (!script) continue
    for (const m of script.matchAll(/\.harness\/bin\/([\w.-]+\.mjs)/g)) {
      referenced.add(m[1])
    }
  }
  assert(referenced.size > 0, 'drift guard should find consumer-referenced bin scripts')
  for (const mjs of referenced) {
    assert(launcherText.includes(mjs), `launcher should cover ${mjs} (drift guard vs consumer npm scripts)`)
    assert(cmdText.includes(mjs), `Windows shim should cover ${mjs} (drift guard vs consumer npm scripts)`)
  }

  // sh 런처와 .cmd shim의 명령 이름표 드리프트 가드: sh case 라벨이 .cmd 분기에도 있어야 한다.
  const shCommands = [...launcherText.matchAll(/^  ([a-z:]+)\)/gm)].map((m) => m[1])
  assert(shCommands.length > 0, 'drift guard should find sh launcher command labels')
  for (const name of shCommands) {
    assert(cmdText.includes(`"%CMD%"=="${name}"`), `Windows shim should support command '${name}' (drift vs sh launcher)`)
  }
}

function gitHooksRunWithoutNpm() {
  // P3(2026-06-09): git hook이 npm 대신 harness 런처를 호출해
  // package.json 없는 비-Node 프로젝트에서도 commit/push 검증이 동작한다.
  const target = makeBareTarget()
  fs.writeFileSync(path.join(target, 'composer.json'), '{\n  "name": "acme/app"\n}\n')
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // hook은 npm을 참조하지 않아야 한다(npm-free 보장).
  for (const rel of ['.githooks/pre-commit', '.githooks/pre-push']) {
    const hook = read(target, rel)
    assert(!hook.includes('npm run'), `${rel} should not depend on npm run`)
    assert(hook.includes('.harness/bin/harness check'), `${rel} should call harness launcher`)
  }

  // 런처 경유 hooks:install 도 동작해야 한다.
  run(path.join(target, '.harness/bin/harness'), ['hooks:install'], { cwd: target })
  const hooksPath = run('git', ['config', '--get', 'core.hooksPath'], { cwd: target }).trim()
  assert(hooksPath === '.githooks', 'launcher hooks:install should set core.hooksPath')

  // 실제 hook 스크립트를 직접 실행해 npm 없이 통과하는지 e2e 확인
  // (consumer: previous hook 없음, seed-mode 없음, activeStack=none → 일반 검사 통과).
  const prefixEnv = { ...process.env, npm_config_prefix: '/opt/homebrew', NPM_CONFIG_PREFIX: '/opt/homebrew' }
  run('sh', [path.join(target, '.githooks/pre-commit')], { cwd: target, env: prefixEnv })
  run('sh', [path.join(target, '.githooks/pre-push')], { cwd: target, env: prefixEnv })
}

// 0.2.124: 세션 기록 전용 커밋은 통합 검사를 생략한다. --no-verify는 에이전트 가드가 막는
// 것이 맞으므로(사람 판단의 우회 방지), 훅이 스테이징 파일 목록으로 스스로 판정한다.
// 경계가 계약이다: 다른 파일이 하나라도 섞이면 평소 검사 — 이게 무너지면 우회 통로가 된다.
function sessionOnlyCommitSkipsHeavyCheck() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  fs.appendFileSync(path.join(target, '.harness/session/next-session-reminder.md'), '\n- 기록 한 줄.\n')
  run('git', ['add', '.harness/session/next-session-reminder.md'], { cwd: target })
  const skipped = run('sh', [path.join(target, '.githooks/pre-commit')], { cwd: target })
  assert(skipped.includes('세션 기록 전용 커밋'), 'session-only staging must announce the skip')
  assert(!skipped.includes('Harness check summary'), 'session-only staging must not run the full check')

  fs.appendFileSync(path.join(target, 'README.md'), '\n한 줄.\n')
  run('git', ['add', 'README.md'], { cwd: target })
  const full = run('sh', [path.join(target, '.githooks/pre-commit')], { cwd: target })
  assert(!full.includes('세션 기록 전용 커밋'), 'mixed staging must not take the skip path')
  assert(full.includes('Harness check summary'), 'mixed staging must run the full check')
}

function makeVerifyPreset() {
  // P4: lint/test를 npm script가 아니라 raw shell 명령으로 선언하는 비-Node 스택 프리셋.
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-verify-preset-test-'))

  fs.mkdirSync(path.join(preset, 'instructions'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'instructions/rules.md'), '# Backend Rule\n\nUse raw verify commands.\n')
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    id: 'backend-verify-demo',
    title: 'Backend Verify Demo',
    stackHarness: {
      repo: 'https://example.test/backend-verify-demo.git',
      ref: 'v1.0.0',
    },
    baseHarness: {
      repo: 'https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git',
      ref: packageRef,
      minVersion: packageVersion,
    },
    framework: {
      runtime: 'php',
    },
    designPattern: ['Raw Verify Contract'],
    instructions: ['instructions/rules.md'],
    policiesFile: 'policies.json',
    checksKey: null,
    verify: {
      lint: 'echo lint-ok > raw-verify-lint.txt',
      test: 'echo test-ok > raw-verify-test.txt',
    },
    source: {
      type: 'none',
    },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'policies.json'), JSON.stringify({
    version: 1,
    stackId: 'backend-verify-demo',
    policies: [],
  }, null, 2))

  return preset
}

// verify 명령이 `node --version`을 파일로 남겨, 검증이 어느 Node로 실행됐는지 확인할 수 있는 프리셋.
function makeNodeVersionVerifyPreset() {
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-nodever-preset-test-'))
  fs.mkdirSync(path.join(preset, 'instructions'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'instructions/rules.md'), '# Node Version Probe\n\nVerify runs node --version.\n')
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    id: 'nodever-verify-demo',
    title: 'Node Version Verify Demo',
    stackHarness: { repo: 'https://example.test/nodever-verify-demo.git', ref: 'v1.0.0' },
    baseHarness: {
      repo: 'https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git',
      ref: packageRef,
      minVersion: packageVersion,
    },
    framework: { runtime: 'php' },
    designPattern: ['Node Version Probe'],
    instructions: ['instructions/rules.md'],
    policiesFile: 'policies.json',
    checksKey: null,
    verify: { lint: 'node --version > verify-node.txt' },
    source: { type: 'none' },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'policies.json'), JSON.stringify({
    version: 1,
    stackId: 'nodever-verify-demo',
    policies: [],
  }, null, 2))

  return preset
}

function stackVerifyRunsRawCommandsWithoutNpm() {
  // P4(2026-06-09): 스택 manifest의 verify 섹션(raw shell 명령)이 npm script 없이 실행된다.
  const target = makeBareTarget()
  fs.writeFileSync(path.join(target, 'composer.json'), '{\n  "name": "acme/app"\n}\n')
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const launcher = path.join(target, '.harness/bin/harness')
  const preset = makeVerifyPreset()
  run(launcher, ['stack:apply', '--preset-path', preset], { cwd: target })

  const checkOut = run(launcher, ['check'], { cwd: target })
  assert(checkOut.includes('Stack verify (lint)'), 'check should announce raw lint verify command')
  assert(checkOut.includes('Stack verify (test)'), 'check should announce raw test verify command')
  assert(read(target, 'raw-verify-lint.txt').includes('lint-ok'), 'raw lint verify command should run from project root')
  assert(read(target, 'raw-verify-test.txt').includes('test-ok'), 'raw test verify command should run from project root')
  assert(checkOut.includes('verify:lint, verify:test 통과'), 'summary should report raw verify stages as passed')

  // fast check는 npm script와 동일하게 test/build stage를 건너뛴다.
  fs.rmSync(path.join(target, 'raw-verify-lint.txt'))
  fs.rmSync(path.join(target, 'raw-verify-test.txt'))
  const fastOut = run(launcher, ['check', '--fast'], { cwd: target })
  assert(fastOut.includes('Fast check mode'), 'fast check should announce skipped stages')
  assert(exists(target, 'raw-verify-lint.txt'), 'fast check should still run lint stage')
  assert(!exists(target, 'raw-verify-test.txt'), 'fast check should skip raw test stage')
}

function initPatchesEslintConfigForHarnessFiles() {
  const target = makeTarget()
  writeJson(target, 'package.json', {
    name: 'eslint-target',
    private: true,
    type: 'module',
    scripts: {
      lint: 'eslint .',
    },
    devDependencies: {
      globals: '^16.5.0',
    },
  })
  fs.writeFileSync(path.join(target, 'eslint.config.js'), `import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import js from '@eslint/js'

export default defineConfig([
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,js,mjs,jsx}'],
  },

  globalIgnores(['**/dist/**', '**/coverage/**']),

  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  js.configs.recommended,
])
`)

  const output = runInit(target, '--no-scan', '--no-check')
  const config = read(target, 'eslint.config.js')

  assert(output.includes('eslint config: eslint.config.js .harness lint 제외 추가'), 'init should report eslint harness config patch')
  assert(config.includes("'**/.harness-backup/**'"), 'init should add harness backup ignore')
  // 0.2.109: 하네스 코드를 소비자 lint 표면에서 뺀다. Node globals override만으로는 자동수정을 못 막는다.
  assert(config.includes("'.harness/**'"), 'init must exclude .harness from lint entirely')
  // 0.2.110: 제외했으면 Node globals override는 죽은 설정이다. 소비자 설정에 쓰레기를 남기지 않는다.
  assert(!config.includes("files: ['.harness/bin/**/*.mjs']"), 'an excluded .harness must not also get a node globals override')
  assert(!config.includes('...globals.node'), 'no dead node-globals config once the directory is excluded')
}

function initAddsHarnessBackupIgnoreWhenNodeOverrideExists() {
  const target = makeTarget()
  writeJson(target, 'package.json', {
    name: 'eslint-target-existing-node',
    private: true,
    type: 'module',
    scripts: {
      lint: 'eslint .',
    },
  })
  fs.writeFileSync(path.join(target, 'eslint.config.js'), `import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import js from '@eslint/js'

export default defineConfig([
  globalIgnores(['**/dist/**', '**/coverage/**']),

  {
    files: ['.harness/bin/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  js.configs.recommended,
])
`)

  const output = runInit(target, '--no-scan', '--no-check')
  const config = read(target, 'eslint.config.js')

  assert(output.includes('eslint config: eslint.config.js .harness lint 제외 추가'), 'init should report the harness lint exclusion patch')
  assert(config.includes("'**/.harness-backup/**'"), 'init should add harness backup ignore when node override already exists')
  assert(config.includes("'.harness/**'"), 'an existing node override must not stop the lint exclusion from being added')
}

function reinstallPreservesProjectOwnedFiles() {
  const target = makeTarget()
  runInit(target)

  const sentinel = 'PROJECT OWNED SENTINEL\n'
  fs.writeFileSync(path.join(target, '.harness/project/project-charter.md'), sentinel)
  fs.writeFileSync(path.join(target, '.harness/project/local-methodology.md'), sentinel)
  fs.writeFileSync(path.join(target, '.harness/policy/profile.json'), '{"activeStack":"custom"}\n')

  runInit(target)

  assert(read(target, '.harness/project/project-charter.md') === sentinel, 'reinstall should preserve project charter')
  assert(read(target, '.harness/project/local-methodology.md') === sentinel, 'reinstall should preserve local methodology')
  assert(read(target, '.harness/policy/profile.json').includes('"custom"'), 'reinstall should preserve profile')
  assert(exists(target, '.harness-backup'), 'reinstall should create backup directory')
}

function reinstallMigratesUnchangedSeedSessionStateToConsumerTemplates() {
  const target = makeTarget()
  runInit(target)

  const seedDecisionLog = fs.readFileSync(path.join(repoRoot, '.harness/session/decision-log.md'), 'utf8')
  const seedActiveContext = fs.readFileSync(path.join(repoRoot, '.harness/session/active-context.md'), 'utf8')
  fs.writeFileSync(path.join(target, '.harness/session/decision-log.md'), seedDecisionLog)
  fs.writeFileSync(path.join(target, '.harness/session/active-context.md'), seedActiveContext)

  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles['.harness/session/decision-log.md'] = {
    sha256: sha256Text(seedDecisionLog),
  }
  manifest.managedFiles['.harness/session/active-context.md'] = {
    sha256: sha256Text(seedActiveContext),
  }
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-check')
  const migratedDecisionLog = read(target, '.harness/session/decision-log.md')
  const migratedActiveContext = read(target, '.harness/session/active-context.md')
  const nextManifest = JSON.parse(read(target, '.harness/install-manifest.json'))

  assert(output.includes('프로젝트 상태 문서:'), 'reinstall should report project state migration')
  assert(migratedDecisionLog.includes('소비자 프로젝트 전용 로그'), 'unchanged seed decision log should migrate to consumer template')
  assert(!migratedDecisionLog.includes('정식 공개 전 공개 명령 정리'), 'migrated decision log should remove seed development history')
  assert(migratedActiveContext.includes('소비자 프로젝트 전용 문서'), 'unchanged seed active context should migrate to consumer template')
  assert(!nextManifest.managedFiles['.harness/session/decision-log.md'], 'migrated consumer decision log should not remain managed')
}

function reinstallPreservesEditedConsumerSessionState() {
  const target = makeTarget()
  runInit(target)

  const customDecision = '# 결정 로그\n\n프로젝트에서 직접 쓴 판단입니다.\n'
  fs.writeFileSync(path.join(target, '.harness/session/decision-log.md'), customDecision)

  runInit(target, '--no-scan', '--no-check')

  assert(read(target, '.harness/session/decision-log.md') === customDecision, 'reinstall should preserve edited consumer decision log')
}

function reinstallMigratesManagedRootScriptsIntoHarnessBin() {
  const target = makeTarget()
  runInit(target)

  fs.mkdirSync(path.join(target, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(target, 'scripts/guard.mjs'), 'managed legacy guard\n')
  fs.writeFileSync(path.join(target, 'scripts/custom-project-script.mjs'), 'project owned script\n')

  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles['scripts/guard.mjs'] = {
    hash: 'legacy',
    size: 21,
  }
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-check')

  assert(output.includes('legacy root scripts: 1개 제거'), 'reinstall should report managed root script migration')
  assert(!exists(target, 'scripts/guard.mjs'), 'reinstall should remove managed legacy root script')
  assert(exists(target, 'scripts/custom-project-script.mjs'), 'reinstall should preserve project-owned root script')
  assert(exists(target, '.harness/bin/guard.mjs'), 'reinstall should keep harness runtime under .harness/bin')
}

function forceOverwritesProjectOwnedFiles() {
  const target = makeTarget()
  runInit(target)

  fs.writeFileSync(path.join(target, '.harness/project/project-charter.md'), 'FORCE SHOULD REPLACE\n')
  runInit(target, '--force', '--confirm-overwrite-project-files')

  assert(!read(target, '.harness/project/project-charter.md').includes('FORCE SHOULD REPLACE'), '--force should overwrite project-owned files')
}

function forceRequiresOverwriteConfirmation() {
  const target = makeTarget()
  runInit(target)
  fs.writeFileSync(path.join(target, '.harness/project/project-charter.md'), 'FORCE SHOULD STOP\n')

  let failed = false
  try {
    runInit(target, '--force')
  } catch (error) {
    failed = error.status === 1
    assert(String(error.stderr).includes('--confirm-overwrite-project-files'), '--force failure should explain confirmation flag')
  }

  assert(failed, '--force without overwrite confirmation should fail')
  assert(read(target, '.harness/project/project-charter.md') === 'FORCE SHOULD STOP\n', '--force without confirmation should preserve project-owned files')
}

function dryRunDoesNotWriteFiles() {
  const target = makeBareTarget()
  const output = runInit(target, '--dry-run')

  assert(output.includes('mode: dry-run'), 'dry-run should report dry-run mode')
  assert(!exists(target, '.harness'), 'dry-run should not write .harness')
  assert(!exists(target, 'package.json'), 'dry-run should not write package.json')
}

function noBackupRequiresForce() {
  const target = makeTarget()
  let failed = false

  try {
    runInit(target, '--no-backup')
  } catch (error) {
    failed = true
    assert(error.status === 1, '--no-backup without --force should fail with status 1')
  }

  assert(failed, '--no-backup without --force should fail')
}

// 0.2.63: 저버전 .nvmrc는 설치 중단 대신 dual-runtime 모드로 설치된다.
function lowProjectNvmrcInstallsInDualRuntimeMode() {
  const target = makeTarget()
  fs.writeFileSync(path.join(target, '.nvmrc'), '12\n')
  const fakeNvm = makeFakeNvmDir(['v12.18.4', 'v24.15.0'])

  const output = runInitWithEnv(target, { NVM_DIR: fakeNvm }, '--no-scan', '--no-handoff', '--no-check')
  assert(output.includes('dual-runtime 모드로 설치합니다'), 'low .nvmrc should install in dual-runtime mode instead of stopping')
  assert(output.includes('v24.15.0 설치됨'), 'dual-runtime diagnostics should report harness node from nvm installs')
  assert(output.includes('v12.18.4 설치됨'), 'dual-runtime diagnostics should report project node from nvm installs')
  assert(exists(target, '.harness/bin/dual-node.sh'), 'dual-runtime install should ship dual-node.sh')
  assert(exists(target, '.harness/bin/node-env.mjs'), 'dual-runtime install should ship node-env.mjs')
  assert(read(target, '.nvmrc') === '12\n', 'dual-runtime install should preserve project .nvmrc')
}

// dual-runtime은 nvm이 전환 수단이다. nvm이 없으면 이전처럼 설치를 중단하고 안내한다.
function lowProjectNvmrcWithoutNvmStopsInit() {
  const target = makeTarget()
  fs.writeFileSync(path.join(target, '.nvmrc'), '12\n')
  const missingNvm = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-no-nvm-')), 'none')

  let failed = false
  try {
    runInitWithEnv(target, { NVM_DIR: missingNvm }, '--no-scan', '--no-handoff', '--no-check')
  } catch (error) {
    failed = error.status === 1
    assert(String(error.stderr).includes('dual-runtime에는 nvm이 필요'), 'missing nvm should explain dual-runtime requirement')
  }

  assert(failed, 'low .nvmrc without nvm should stop init')
  assert(!exists(target, '.harness'), 'stopped init should not install harness files')
  assert(read(target, '.nvmrc') === '12\n', 'existing .nvmrc should be preserved when init stops')
}

function projectNodeFlagWritesNvmrcWithUserConfirmation() {
  const target = makeTarget()
  const fakeNvm = makeFakeNvmDir(['v12.18.4', 'v24.15.0'])

  const output = runInitWithEnv(target, { NVM_DIR: fakeNvm }, '--project-node', '12', '--no-scan', '--no-handoff', '--no-check')
  assert(read(target, '.nvmrc') === '12\n', '--project-node should write the confirmed project .nvmrc')
  assert(output.includes('.nvmrc 12 생성'), '--project-node should report .nvmrc creation')
  assert(output.includes('dual-runtime 모드로 설치합니다'), 'low --project-node should enable dual-runtime mode')
}

function missingNvmrcWithLowNodeSignalRequiresInterview() {
  const target = makeBareTarget()
  // ^12.22.0은 20.19+로 만족 불가한 capped-low 범위이므로 인터뷰를 강제해야 한다.
  writeJson(target, 'package.json', { name: 'legacy', private: true, engines: { node: '^12.22.0' }, scripts: {} })
  const fakeNvm = makeFakeNvmDir(['v24.15.0'])

  let failed = false
  try {
    runInitWithEnv(target, { NVM_DIR: fakeNvm }, '--no-scan', '--no-handoff', '--no-check')
  } catch (error) {
    failed = error.status === 1
    assert(String(error.stderr).includes('--project-node'), 'low node signal should request --project-node interview')
    assert(String(error.stderr).includes('package.json engines.node'), 'interview message should list detected candidates')
  }

  assert(failed, 'missing .nvmrc with low node signal should stop init for the interview')
  assert(!exists(target, '.nvmrc'), 'init must not guess and write a project node version')
  assert(!exists(target, '.harness'), 'stopped init should not install harness files')
}

// engines floor('>=18')는 20.19+로 만족 가능하므로 저버전 신호로 오탐하면 안 된다(인터뷰 미강제).
function enginesFloorDoesNotForceProjectNodeInterview() {
  const target = makeBareTarget()
  writeJson(target, 'package.json', { name: 'modern', private: true, engines: { node: '>=18.0.0' }, scripts: {} })
  const fakeNvm = makeFakeNvmDir(['v24.15.0'])

  const output = runInitWithEnv(target, { NVM_DIR: fakeNvm }, '--no-scan', '--no-handoff', '--no-check')
  assert(!output.includes('저버전 Node 신호를 감지'), 'engines floor >=18 must not trigger the low-node interview')
  assert(!exists(target, '.nvmrc'), 'engines floor >=18 should not create .nvmrc')
  assert(exists(target, '.harness'), 'engines floor >=18 should install (20.19+ satisfies it)')
}

// dual-node.sh 헬퍼는 인자 없이 호출돼도 set -u에서 죽지 않아야 한다(0.2.61 exit-2 클래스 회귀 방지).
function dualNodeHelpersAreArgSafeUnderSetU() {
  const script = 'set -eu; . .harness/bin/dual-node.sh; harness_node_supported || true; harness_node_sort_key || true; echo ARG_SAFE_OK'
  const shells = ['sh']
  if (spawnSync('sh', ['-c', 'command -v dash'], { encoding: 'utf8' }).status === 0) shells.push('dash')
  for (const shell of shells) {
    const result = spawnSync(shell, ['-c', script], { cwd: repoRoot, encoding: 'utf8' })
    assert(result.status === 0, `${shell}: arg-less dual-node helpers must not exit non-zero under set -u (got ${result.status}: ${result.stderr})`)
    assert(result.stdout.includes('ARG_SAFE_OK'), `${shell}: script should run to completion`)
  }
}

// node가 셸 함수/별칭이면 command -v가 절대경로를 주지 않으므로 HARNESS_PROJECT_NODE_BIN에 '.'를 export하면 안 된다.
function dualNodeDoesNotExportDotWhenNodeIsShellFunction() {
  const fakeNvm = makeFakeNvmDir(['v24.15.0'])
  const script = 'set -eu; node(){ echo v18.20.4; }; . .harness/bin/dual-node.sh; harness_dual_node_activate >/dev/null 2>&1; echo "BIN=[${HARNESS_PROJECT_NODE_BIN:-unset}]"'
  const result = spawnSync('sh', ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', NVM_DIR: fakeNvm, HOME: os.homedir() },
  })
  assert(result.status === 0, `activation with node-as-function should succeed: ${result.stderr}`)
  assert(result.stdout.includes('BIN=[unset]'), `node-as-function must not export HARNESS_PROJECT_NODE_BIN='.': ${result.stdout}`)
}

// guard는 hook이 넘긴 HARNESS_PROJECT_NODE_BIN이 .nvmrc와 불일치하면 맹신하지 않고,
// .nvmrc Node가 미설치면 '검증 신뢰성 우선'으로 하드페일해야 한다(hook 경로의 우회 차단).
function guardRejectsHookNodeMismatchingNvmrc() {
  const target = makeBareTarget()
  fs.writeFileSync(path.join(target, 'composer.json'), '{\n  "name": "acme/app"\n}\n')
  // fake nvm에는 v24만 있고 .nvmrc가 요구하는 v12는 없다.
  const fakeNvm = makeFakeNvmDir(['v24.15.0'])
  const v24Bin = path.join(fakeNvm, 'versions', 'node', 'v24.15.0', 'bin')
  runInitWithEnv(target, { NVM_DIR: fakeNvm }, '--project-node', '12', '--no-scan', '--no-handoff', '--no-check')

  const launcher = path.join(target, '.harness/bin/harness')
  const preset = makeVerifyPreset()
  run(launcher, ['stack:apply', '--preset-path', preset], { cwd: target, env: { ...process.env, NVM_DIR: fakeNvm } })

  let failed = false
  let combined = ''
  try {
    // 불일치 fromHook(v24)을 직접 주입한 채 guard 실행. .nvmrc=12, v12 미설치 → 하드페일 기대.
    run(nodeBin, [path.join(target, '.harness/bin/guard.mjs')], {
      cwd: target,
      env: { ...process.env, NVM_DIR: fakeNvm, HARNESS_PROJECT_NODE_BIN: v24Bin, PATH: `${v24Bin}:/usr/bin:/bin` },
    })
  } catch (error) {
    failed = error.status !== 0
    combined = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
  }

  assert(failed, 'guard must not trust a hook-provided node that mismatches .nvmrc when the .nvmrc node is missing')
  assert(combined.includes('nvm install 12'), `guard should hard-fail asking for the .nvmrc node, got: ${combined}`)
}

// 반대로 .nvmrc와 일치하는 fromHook은 신뢰하고, 프로젝트 검증을 그 Node로 실행한다.
function guardRunsStackVerifyOnProjectNode() {
  const target = makeBareTarget()
  fs.writeFileSync(path.join(target, 'composer.json'), '{\n  "name": "acme/app"\n}\n')
  const fakeNvm = makeFakeNvmDir(['v12.18.4', 'v24.15.0'])
  const v12Bin = path.join(fakeNvm, 'versions', 'node', 'v12.18.4', 'bin')
  runInitWithEnv(target, { NVM_DIR: fakeNvm }, '--project-node', '12', '--no-scan', '--no-handoff', '--no-check')

  const launcher = path.join(target, '.harness/bin/harness')
  const preset = makeNodeVersionVerifyPreset()
  run(launcher, ['stack:apply', '--preset-path', preset], { cwd: target, env: { ...process.env, NVM_DIR: fakeNvm } })

  run(nodeBin, [path.join(target, '.harness/bin/guard.mjs')], {
    cwd: target,
    env: { ...process.env, NVM_DIR: fakeNvm, HARNESS_PROJECT_NODE_BIN: v12Bin, PATH: `${v12Bin}:/usr/bin:/bin` },
  })
  assert(read(target, 'verify-node.txt').includes('v12.18.4'), 'stack verify should run on the project (.nvmrc) node, not the harness node')
}

function backendWithoutNvmrcSkipsProjectNodeInterview() {
  const target = makeBareTarget()
  const fakeNvm = makeFakeNvmDir(['v24.15.0'])

  const output = runInitWithEnv(target, { NVM_DIR: fakeNvm }, '--no-scan', '--no-handoff', '--no-check')
  assert(!exists(target, '.nvmrc'), 'non-Node project install should not create .nvmrc')
  assert(!output.includes('--project-node를 붙여'), 'non-Node project should not be asked for the project node interview')
  assert(exists(target, '.harness/bin/harness'), 'non-Node project should still get the harness launcher')
}

// dual-node.sh가 활성 Node가 낮을 때 nvm 설치본 중 최신(>=20.19)으로 전환하는지 검증한다.
function dualNodeShSwitchesHarnessNodeWhenActiveNodeIsLow() {
  const fakeNvm = makeFakeNvmDir(['v12.18.4', 'v18.20.8', 'v20.19.0', 'v24.9.0', 'v24.15.0'])
  // 활성 node를 저버전으로 시뮬레이션: node --version이 v12.0.0을 출력하는 가짜 bin을 PATH 선두에 둔다.
  const lowBin = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-low-node-'))
  fs.writeFileSync(path.join(lowBin, 'node'), '#!/bin/sh\necho v12.0.0\n')
  fs.chmodSync(path.join(lowBin, 'node'), 0o755)

  const script = '. .harness/bin/dual-node.sh && harness_dual_node_activate && command -v node && echo "projbin=$HARNESS_PROJECT_NODE_BIN"'
  const result = spawnSync('sh', ['-c', `set -eu; ${script}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { PATH: `${lowBin}:/usr/bin:/bin`, NVM_DIR: fakeNvm, HOME: os.homedir() },
  })

  assert(result.status === 0, `dual-node.sh activation should succeed: ${result.stderr}`)
  assert(result.stdout.includes(path.join(fakeNvm, 'versions', 'node', 'v24.15.0', 'bin', 'node')), 'dual-node.sh should switch to the highest installed harness node')
  assert(result.stdout.includes(`projbin=${lowBin}`), 'dual-node.sh should record the project node bin for guard')
}

function existingProjectNvmrcIsPreserved() {
  const target = makeTarget()
  fs.writeFileSync(path.join(target, '.nvmrc'), '20.19.0\n')

  const output = runInit(target)
  assert(output.includes('project node: existing .nvmrc 20.19.0 preserved'), 'init should report existing project .nvmrc preservation')
  assert(read(target, '.nvmrc') === '20.19.0\n', 'init should preserve existing project .nvmrc')
}

function externalHarnessWithoutManifestIsPreserved() {
  const target = makeTarget()

  fs.mkdirSync(path.join(target, '.harness/policy'), { recursive: true })
  fs.writeFileSync(path.join(target, '.harness/policy/README.md'), 'EXTERNAL HARNESS\n')
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'EXTERNAL CLAUDE\n')

  const output = runInit(target)

  assert(output.includes('이전에 설치된 하네스 흔적이 있어 기존 파일은 보존하고 누락된 공통 기준만 보강합니다.'), 'external harness install should explain preserved existing harness files')
  assert(output.includes('브리지 섹션 추가 후보'), 'external harness install should suggest bridge section candidates')
  assert(read(target, '.harness/policy/README.md') === 'EXTERNAL HARNESS\n', 'external harness file should be preserved')
  assert(read(target, 'CLAUDE.md') === 'EXTERNAL CLAUDE\n', 'external CLAUDE.md should be preserved')
  assert(exists(target, '.harness/install-manifest.json'), 'external harness install should write manifest for future runs')

  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!manifest.managedFiles['.harness/policy/README.md'], 'preserved external harness file should not become managed')
  assert(!manifest.managedFiles['CLAUDE.md'], 'preserved external CLAUDE.md should not become managed')
}

function scanReportSuggestsBridgeCandidates() {
  const target = makeTarget()

  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# Personal Rules\n')
  runInit(target)
  run('npm', ['run', 'harness:scan'], { cwd: target })

  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('## Bridge Section Candidates'), 'scan report should include bridge section candidate section')
  assert(report.includes('CLAUDE.md'), 'scan report should suggest CLAUDE.md bridge candidate')
  assert(report.includes('Project Harness Bridge'), 'scan report should include bridge template')
}

function makePreset() {
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-preset-test-'))

  fs.mkdirSync(path.join(preset, 'instructions'), { recursive: true })
  fs.mkdirSync(path.join(preset, 'scaffold'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'instructions/rules.md'), '# External Rule\n\nUse the external preset contract.\n')
  fs.writeFileSync(path.join(preset, 'scaffold/hello.txt'), 'hello from external preset\n')
  fs.writeFileSync(path.join(preset, 'scaffold/package.merge.json'), JSON.stringify({
    scripts: {
      external: 'echo external',
    },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'package.json'), JSON.stringify({
    name: 'external-demo-preset',
    version: '9.8.7',
    private: true,
    type: 'module',
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    id: 'external-demo',
    title: 'External Demo Preset',
    stackHarness: {
      repo: 'https://example.test/external-demo.git',
      ref: 'v9.8.7',
    },
    baseHarness: {
      repo: 'https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git',
      ref: packageRef,
      minVersion: packageVersion,
    },
    framework: {
      runtime: 'demo',
    },
    designPattern: ['External Preset Contract'],
    instructions: ['instructions/rules.md'],
    policiesFile: 'policies.json',
    checksKey: null,
    source: {
      type: 'local',
      path: 'scaffold',
      packageMerge: 'scaffold/package.merge.json',
    },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'policies.json'), JSON.stringify({
    version: 1,
    stackId: 'external-demo',
    policies: [],
  }, null, 2))

  return preset
}

function makeRulesOnlyPreset() {
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-rules-only-preset-test-'))

  fs.mkdirSync(path.join(preset, 'instructions'), { recursive: true })
  fs.mkdirSync(path.join(preset, '.idea'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'instructions/rules.md'), '# Rules Only\n\nApply stack instructions without copying scaffold files.\n')
  fs.writeFileSync(path.join(preset, '.idea/workspace.xml'), '<project />\n')
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    id: 'rules-only-demo',
    title: 'Rules Only Demo',
    framework: {
      runtime: 'demo',
    },
    designPattern: ['Rules Only Stack Standard'],
    instructions: ['instructions/rules.md'],
    policiesFile: 'policies.json',
    checksKey: null,
    source: {
      type: 'none',
    },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'policies.json'), JSON.stringify({
    version: 1,
    stackId: 'rules-only-demo',
    policies: [],
  }, null, 2))

  return preset
}

function makeScaffoldTemplatePreset(requiredStackId = 'rules-only-demo') {
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-template-preset-test-'))

  fs.mkdirSync(path.join(preset, 'developmentGuide'), { recursive: true })
  fs.mkdirSync(path.join(preset, 'src'), { recursive: true })
  fs.mkdirSync(path.join(preset, 'node_modules/ignored'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'README.md'), '# Demo Template\n')
  fs.writeFileSync(path.join(preset, '.nvmrc'), 'v24.14.0\n')
  fs.writeFileSync(path.join(preset, 'developmentGuide/README.md'), '# Template Guide\n')
  fs.writeFileSync(path.join(preset, 'developmentGuide/menu.md'), '# Menu Contract\n')
  fs.writeFileSync(path.join(preset, 'src/App.vue'), '<template><main>demo</main></template>\n')
  fs.writeFileSync(path.join(preset, 'node_modules/ignored/file.txt'), 'ignore me\n')
  fs.writeFileSync(path.join(preset, 'package.json'), JSON.stringify({
    name: 'demo-template',
    version: '1.2.3',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
    },
    dependencies: {
      vue: '^3.5.0',
    },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    kind: 'scaffold-template',
    id: 'demo-template',
    title: 'Demo Scaffold Template',
    version: '1.2.3',
    template: {
      repo: 'https://example.test/demo-template.git',
      ref: 'v1.2.3',
      range: '^1.2.3',
      guideRoot: 'developmentGuide/README.md',
      docs: [
        'developmentGuide/README.md',
        'developmentGuide/menu.md',
      ],
    },
    requiredStackHarness: {
      id: requiredStackId,
      repo: 'https://example.test/rules-only-demo.git',
      ref: 'v1.0.0',
    },
    source: {
      type: 'local',
      path: '.',
      packageMerge: 'package.json',
      exclude: [
        'manifest.json',
        'package.json',
      ],
    },
  }, null, 2))

  return preset
}

function makeTaggedHarnessRepo(tags) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-tagged-repo-test-'))

  run('git', ['init', '--quiet'], { cwd: repo })
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  run('git', ['config', 'user.name', 'Harness Test'], { cwd: repo })
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'demo-stack-harness',
    version: tags[0].replace(/^v/, ''),
    type: 'module',
  }, null, 2))
  run('git', ['add', '.'], { cwd: repo })
  run('git', ['commit', '--quiet', '-m', 'initial'], { cwd: repo })

  for (const tag of tags) {
    run('git', ['tag', tag], { cwd: repo })
  }

  return repo
}

function stackApplyMaterializesPresetAsLocalRules() {
  const target = makeTarget()
  const preset = makePreset()

  runInit(target)
  const lockBeforeStackApply = JSON.parse(read(target, '.harness/harness-lock.json'))
  lockBeforeStackApply.lastUpdate = {
    from: '0.2.70',
    to: '0.2.72',
    at: '2026-06-25T00:00:00.000Z',
    entries: [
      {
        version: '0.2.72',
        date: '2026-06-25',
        lines: ['base update summary'],
      },
    ],
  }
  writeJson(target, '.harness/harness-lock.json', lockBeforeStackApply)
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })

  const localRules = read(target, '.harness/project/stack-preset-rules.md')
  assert(localRules.includes('## 적용된 스택:'), 'stack apply should write applied stack section')
  assert(localRules.includes('External Preset Contract'), 'stack apply should materialize stack instructions as local rules')
  assert(localRules.includes('harness-stack-rules:start'), 'stack local rules should stay inside managed section')
  const appliedLock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(appliedLock.lastUpdate?.to === '0.2.72', 'stack apply should preserve base changelog metadata')

  const profileBeforeReset = JSON.parse(read(target, '.harness/policy/profile.json'))
  profileBeforeReset.harnessMode = 'active'
  profileBeforeReset.sources = [
    {
      path: 'developmentGuide/agent-rules.md',
      kind: 'methodology',
      owner: 'PROJECT_OWNED',
      inject: 'always',
    },
  ]
  writeJson(target, '.harness/policy/profile.json', profileBeforeReset)

  run('npm', ['run', 'stack:reset'], { cwd: target })

  const resetRules = read(target, '.harness/project/stack-preset-rules.md')
  assert(resetRules.includes('적용된 스택 프리셋이 없습니다.'), 'stack reset should restore previous local rules file')
  const resetProfile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(resetProfile.activeStack === 'none', 'stack reset should restore stack-owned activeStack')
  assert(resetProfile.harnessMode === 'active', 'stack reset should preserve project-owned harnessMode')
  assert(resetProfile.sources?.[0]?.path === 'developmentGuide/agent-rules.md', 'stack reset should preserve project-owned profile sources')
  const resetLock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(resetLock.stackHarness === null, 'stack reset should clear stack harness lock')
  assert(resetLock.lastUpdate?.to === '0.2.72', 'stack reset should preserve base changelog metadata')
  assert(!exists(target, '.harness/stacks/.applied/external-demo/manifest.json'), 'stack reset should remove applied stack snapshot')
}

function stackApplySupportsExternalPresetPath() {
  const target = makeTarget()
  const preset = makePreset()

  runInit(target)
  writeJson(target, '.harness/policy/profile.json', {
    version: 2,
    activeStack: 'external-demo',
    available: ['none'],
    stackManifest: null,
  })
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })

  assert(read(target, 'hello.txt').includes('external preset'), 'external preset should copy scaffold files')

  const localRules = read(target, '.harness/project/stack-preset-rules.md')
  assert(localRules.includes('External Demo Preset'), 'external preset should materialize title as local rules')
  assert(localRules.includes('Use the external preset contract.'), 'external preset should materialize relative instruction files')

  const pkg = JSON.parse(read(target, 'package.json'))
  assert(pkg.scripts.external === 'echo external', 'external preset should merge package metadata')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(profile.activeStack === 'external-demo', 'external preset should update activeStack')
  assert(profile.stackManifest === '.harness/stacks/.applied/external-demo/manifest.json', 'external preset should snapshot manifest into project')
  assert(exists(target, '.harness/stacks/.applied/external-demo/instructions/rules.md'), 'external preset should snapshot instruction files')

  const marker = JSON.parse(read(target, '.harness/.stack-applied.json'))
  assert(marker.manifestPath === '.harness/stacks/.applied/external-demo/manifest.json', 'external preset marker should point to project snapshot')
  assert(marker.sourceManifestPath, 'external preset marker should keep source manifest path for traceability')

  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(lock.stackHarness.id === 'external-demo', 'harness lock should record applied stack id')
  assert(lock.stackHarness.version === '9.8.7', 'harness lock should record stack package version')
  assert(lock.stackHarness.repo === 'https://example.test/external-demo.git', 'harness lock should record stack repository')
  assert(lock.stackHarness.ref === 'v9.8.7', 'harness lock should record stack ref')
  assert(lock.stackHarness.manifestPath === '.harness/stacks/.applied/external-demo/manifest.json', 'harness lock should record stack manifest snapshot')
  assert(lock.stackHarness.requiredBaseHarness.ref === packageRef, 'harness lock should record required base harness ref')

  const updatePlan = run('npm', ['run', 'harness:update', '--', '--dry-run'], { cwd: target })
  assert(updatePlan.includes('npx -y git+https://example.test/external-demo.git#semver:^9.8.7 init'), 'harness update dry-run should target compatible stack range')
}

function harnessOutdatedDetectsBaseAndStackUpdates() {
  const target = makeTarget()
  const baseRepo = makeTaggedHarnessRepo(['v0.2.48', 'v0.2.49', 'v0.3.0'])
  const stackRepo = makeTaggedHarnessRepo(['v1.0.0', 'v1.0.1', 'v2.0.0'])

  runInit(target, '--no-scan', '--no-check')
  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  lock.baseHarness = {
    id: 'harness-seed',
    version: '0.2.48',
    repo: baseRepo,
    ref: 'v0.2.48',
  }
  lock.stackHarness = {
    id: 'demo-stack',
    title: 'Demo Stack',
    version: '1.0.1',
    repo: stackRepo,
    ref: 'v1.0.1',
  }
  writeJson(target, '.harness/harness-lock.json', lock)

  const output = run('npm', ['run', '--silent', 'harness:outdated', '--', '--json'], { cwd: target })
  const status = JSON.parse(output)
  assert(status.overall === 'outdated', 'harness outdated should report overall outdated when base is outdated')
  assert(status.targets.baseHarness.outdated === true, 'harness outdated should check base harness by default')
  assert(status.targets.baseHarness.latestVersion === '0.2.49', 'base outdated should stay inside compatible minor range')
  assert(status.targets.baseHarness.updateCommand === 'npm run harness:update -- --base-only', 'base outdated should print base update command')
  assert(status.targets.stackHarness.outdated === false, 'harness outdated should also check stack harness by default')
  assert(status.targets.stackHarness.updateCommand === null, 'up-to-date stack should not require update command')

  const baseOnly = JSON.parse(run('npm', ['run', '--silent', 'harness:outdated', '--', '--json', '--base-only'], { cwd: target }))
  assert(baseOnly.checkedTargets.length === 1 && baseOnly.checkedTargets[0] === 'baseHarness', '--base-only should only check base harness')

  const stackOnly = JSON.parse(run('npm', ['run', '--silent', 'harness:outdated', '--', '--json', '--stack-only'], { cwd: target }))
  assert(stackOnly.checkedTargets.length === 1 && stackOnly.checkedTargets[0] === 'stackHarness', '--stack-only should only check stack harness')
  assert(stackOnly.overall === 'up-to-date', '--stack-only should report up-to-date when stack has no update')

  let failed = false
  try {
    run('npm', ['run', '--silent', 'harness:outdated', '--', '--fail-on-outdated'], { cwd: target })
  } catch (error) {
    failed = error.status === 1
  }
  assert(failed, 'harness outdated --fail-on-outdated should exit 1 when base or stack update is available')

  lock.baseHarness.version = '0.2.49'
  lock.baseHarness.ref = 'v0.2.49'
  lock.stackHarness.version = '1.0.0'
  lock.stackHarness.ref = 'v1.0.0'
  writeJson(target, '.harness/harness-lock.json', lock)

  const stackUpdate = JSON.parse(run('npm', ['run', '--silent', 'harness:outdated', '--', '--json'], { cwd: target }))
  assert(stackUpdate.overall === 'outdated', 'harness outdated should report overall outdated when stack is outdated')
  assert(stackUpdate.targets.baseHarness.outdated === false, 'base should be up-to-date after lock update')
  assert(stackUpdate.targets.stackHarness.outdated === true, 'stack outdated should be detected by default')
  assert(stackUpdate.targets.stackHarness.latestVersion === '1.0.1', 'stack outdated should stay inside compatible major range')
  assert(stackUpdate.targets.stackHarness.updateCommand === 'npm run harness:update', 'stack outdated should print stack update command')

  lock.baseHarness.repo = null
  lock.baseHarness.ref = null
  lock.baseHarness.version = '0.2.48'
  lock.baseHarness.source = {
    type: 'git',
    repo: baseRepo,
    ref: 'v0.2.48',
    packageVersion: '0.2.48',
    spec: `${baseRepo}#v0.2.48`,
  }
  lock.stackHarness = null
  writeJson(target, '.harness/harness-lock.json', lock)

  const recoveredBase = JSON.parse(run('npm', ['run', '--silent', 'harness:outdated', '--', '--json', '--base-only'], { cwd: target }))
  assert(recoveredBase.targets.baseHarness.outdated === true, 'base outdated should recover repo/ref from lock source metadata')

  lock.baseHarness.repo = null
  lock.baseHarness.ref = null
  lock.baseHarness.version = '0.2.49'
  lock.baseHarness.source = {
    type: 'bundled',
    repo: null,
    ref: null,
    packageVersion: '0.2.49',
    spec: 'bundled',
  }
  lock.stackHarness = null
  writeJson(target, '.harness/harness-lock.json', lock)
  writeJson(target, '.harness/install-manifest.json', {
    tool: 'harness-seed',
    version: '0.2.49',
    source: {
      type: 'bundled',
      repo: null,
      ref: null,
      packageVersion: '0.2.49',
      spec: 'bundled',
    },
    managedFiles: {},
  })

  const envWithDefaultBaseRepo = { ...process.env, AI_STANDARD_BASE_HARNESS_REPO: baseRepo }
  const recoveredBundledBaseOnly = JSON.parse(run('npm', ['run', '--silent', 'harness:outdated', '--', '--json', '--base-only'], { cwd: target, env: envWithDefaultBaseRepo }))
  assert(recoveredBundledBaseOnly.overall === 'up-to-date', 'base-only bundled install should recover the default base repo')
  assert(recoveredBundledBaseOnly.targets.baseHarness.repo === baseRepo, 'base-only bundled install should use the configured default base repo')
  assert(recoveredBundledBaseOnly.targets.baseHarness.currentRef === 'v0.2.49', 'base-only bundled install should infer current ref from installed version')

  const bundledBaseOnlyUpdatePlan = run('npm', ['run', '--silent', 'harness:update', '--', '--base-only', '--dry-run'], { cwd: target, env: envWithDefaultBaseRepo })
  assert(bundledBaseOnlyUpdatePlan.includes(`npx -y git+${baseRepo}#semver:^0.2.49 init`), 'base-only update dry-run should recover default base repo for bundled installs')

  lock.baseHarness.repo = null
  lock.baseHarness.ref = null
  lock.baseHarness.version = '0.2.49'
  lock.baseHarness.source = {
    type: 'bundled',
    repo: null,
    ref: null,
    packageVersion: '0.2.49',
    spec: 'bundled',
  }
  lock.stackHarness = {
    id: 'demo-stack',
    version: '1.0.1',
    repo: stackRepo,
    ref: 'v1.0.1',
    requiredBaseHarness: {
      repo: baseRepo,
      ref: 'v0.2.48',
      minVersion: '0.2.48',
    },
  }
  writeJson(target, '.harness/harness-lock.json', lock)
  writeJson(target, '.harness/install-manifest.json', {
    tool: 'harness-seed',
    version: '0.2.49',
    source: {
      type: 'bundled',
      repo: null,
      ref: null,
      packageVersion: '0.2.49',
      spec: 'bundled',
    },
    managedFiles: {},
  })

  const recoveredFromStackRequirement = JSON.parse(run('npm', ['run', '--silent', 'harness:outdated', '--', '--json'], { cwd: target }))
  assert(recoveredFromStackRequirement.overall === 'up-to-date', 'bundled base metadata should recover repo from stack requiredBaseHarness')
  assert(recoveredFromStackRequirement.targets.baseHarness.status === 'up-to-date', 'recovered bundled base should not be unavailable')
  assert(recoveredFromStackRequirement.targets.baseHarness.repo === baseRepo, 'recovered bundled base should use required base repo')
  assert(recoveredFromStackRequirement.targets.baseHarness.currentRef === 'v0.2.49', 'recovered bundled base should infer current ref from installed version')

  lock.baseHarness.version = '0.2.48'
  writeJson(target, '.harness/harness-lock.json', lock)

  const bundledBaseUpdate = JSON.parse(run('npm', ['run', '--silent', 'harness:outdated', '--', '--json', '--base-only'], { cwd: target }))
  assert(bundledBaseUpdate.targets.baseHarness.outdated === true, 'bundled base should still report outdated when a newer base tag exists')
  assert(bundledBaseUpdate.targets.baseHarness.updateCommand === `npx -y git+${stackRepo}#semver:^1.0.1 init`, 'bundled base update should point to stack harness init instead of base-only update')
  assert(bundledBaseUpdate.targets.baseHarness.updateNote.includes('--base-only'), 'bundled base update should explain why base-only update is not valid')
}

function sourceMetadataNormalizesSemverSourceRef() {
  const target = makeTarget()
  const sourceRepo = 'https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git'

  runInit(target, '--source-repo', sourceRepo, '--source-ref', `semver:^${packageVersion}`, '--no-scan', '--no-handoff', '--no-check')

  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))

  assert(lock.baseHarness.repo === sourceRepo, 'base lock should keep git source repo')
  assert(lock.baseHarness.ref === packageRef, 'base lock should normalize semver source ref to installed package tag')
  assert(lock.baseHarness.source.type === 'git', 'base lock source should be git when source repo is passed')
  assert(lock.baseHarness.source.spec === `${sourceRepo}#${packageRef}`, 'base lock source spec should point to installed package tag')
  assert(manifest.source.type === 'git', 'install manifest source should be git when source repo is passed')
  assert(manifest.source.ref === packageRef, 'install manifest should normalize semver source ref to installed package tag')
}

function baseOnlyUpdateDryRunPassesSourceMetadata() {
  const target = makeTarget()
  const baseRepo = 'https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git'

  runInit(target, '--source-repo', baseRepo, '--source-ref', 'v0.2.49', '--no-scan', '--no-handoff', '--no-check')

  const output = run('npm', ['run', '--silent', 'harness:update', '--', '--base-only', '--dry-run'], { cwd: target })
  assert(output.includes(`--source-repo ${baseRepo}`), 'base-only update should pass source repo into init')
  assert(output.includes(`--source-ref semver:^${packageVersion}`), 'base-only update should pass selected semver ref into init')
}

function stackApplySupportsExternalPresetGit() {
  const target = makeTarget()
  const preset = makePreset()

  run('git', ['init', '--quiet'], { cwd: preset })
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: preset })
  run('git', ['config', 'user.name', 'Harness Test'], { cwd: preset })
  run('git', ['add', '.'], { cwd: preset })
  run('git', ['commit', '--quiet', '-m', 'preset'], { cwd: preset })
  run('git', ['branch', '-M', 'main'], { cwd: preset })

  runInit(target)
  run('npm', ['run', 'stack:apply', '--', '--preset-git', preset, '--ref', 'main'], { cwd: target })

  assert(read(target, 'hello.txt').includes('external preset'), 'git preset should copy scaffold files')

  const localRules = read(target, '.harness/project/stack-preset-rules.md')
  assert(localRules.includes('External Demo Preset'), 'git preset should materialize local rules')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(profile.activeStack === 'external-demo', 'git preset should update activeStack')
  assert(exists(target, '.harness/stacks/.applied/external-demo/manifest.json'), 'git preset should snapshot manifest into project')
}

function stackApplySupportsRulesOnlyPreset() {
  const target = makeTarget()
  const preset = makeRulesOnlyPreset()

  runInit(target)
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })

  assert(!exists(target, 'scaffold'), 'rules-only preset should not copy scaffold files')

  const localRules = read(target, '.harness/project/stack-preset-rules.md')
  assert(localRules.includes('Rules Only Demo'), 'rules-only preset should materialize title as local rules')
  assert(localRules.includes('Apply stack instructions without copying scaffold files.'), 'rules-only preset should materialize instructions')

  const marker = JSON.parse(read(target, '.harness/.stack-applied.json'))
  assert(marker.source.type === 'none', 'rules-only preset should record source.type=none')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(profile.activeStack === 'rules-only-demo', 'rules-only preset should update activeStack')
  assert(profile.stackManifest === '.harness/stacks/.applied/rules-only-demo/manifest.json', 'rules-only preset should snapshot manifest into project')
  assert(!exists(target, '.harness/stacks/.applied/rules-only-demo/.idea/workspace.xml'), 'stack snapshot should exclude local IDE metadata')

  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(lock.stackHarness.requiredBaseHarness === null, 'rules-only preset without baseHarness should record null base requirement')
}

function templateApplyCreatesBridgeWithoutReplacingActiveStack() {
  const target = makeTarget()
  const stackPreset = makeRulesOnlyPreset()
  const templatePreset = makeScaffoldTemplatePreset()

  runInit(target)
  fs.writeFileSync(path.join(target, '.nvmrc'), '20.19.0\n')
  run('npm', ['run', 'stack:apply', '--', '--preset-path', stackPreset], { cwd: target })
  run('npm', ['run', 'template:apply', '--', '--preset-path', templatePreset], { cwd: target })

  assert(exists(target, 'src/App.vue'), 'template apply should copy scaffold files')
  assert(read(target, '.nvmrc') === '20.19.0\n', 'template apply should preserve existing project .nvmrc')
  assert(!exists(target, 'node_modules/ignored/file.txt'), 'template apply should exclude node_modules')
  assert(!exists(target, 'manifest.json'), 'template apply should not copy template manifest to project root')

  const pkg = JSON.parse(read(target, 'package.json'))
  assert(pkg.scripts['harness:check'], 'template package merge should preserve harness scripts')
  assert(pkg.scripts.dev === 'vite', 'template package merge should add template scripts')
  assert(pkg.dependencies.vue === '^3.5.0', 'template package merge should add template dependencies')

  const contract = read(target, '.harness/project/template-contract.md')
  assert(contract.includes('Demo Scaffold Template'), 'template apply should write template contract bridge')
  assert(contract.includes('developmentGuide/README.md'), 'template contract should list guide root')
  assert(contract.includes('rules-only-demo'), 'template contract should list required stack')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(profile.activeStack === 'rules-only-demo', 'template apply should not replace active stack')

  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(lock.stackHarness.id === 'rules-only-demo', 'template apply should preserve stack harness lock')
  assert(lock.scaffoldTemplate.id === 'demo-template', 'template apply should record scaffold template lock')
  assert(lock.scaffoldTemplate.version === '1.2.3', 'template lock should record template version')
  assert(lock.scaffoldTemplate.requiredStackHarness.id === 'rules-only-demo', 'template lock should record required stack')

  const marker = JSON.parse(read(target, '.harness/.template-applied.json'))
  assert(marker.templateId === 'demo-template', 'template marker should record applied template id')
  assert(marker.manifestPath === '.harness/templates/.applied/demo-template/manifest.json', 'template marker should point to template snapshot')
  assert(exists(target, '.harness/templates/.applied/demo-template/manifest.json'), 'template apply should snapshot manifest')
  assert(exists(target, '.harness/templates/.applied/demo-template/developmentGuide/README.md'), 'template apply should snapshot guide docs')

  const status = run('npm', ['run', 'template:status'], { cwd: target })
  assert(status.includes('template: demo-template 1.2.3'), 'template status should show template version')
  assert(status.includes('requiredStack: rules-only-demo'), 'template status should show required stack')

  run('npm', ['run', 'template:reset'], { cwd: target })
  assert(!exists(target, 'src/App.vue'), 'template reset should remove scaffold files')
  assert(!exists(target, '.harness/.template-applied.json'), 'template reset should remove marker')
  const resetLock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(resetLock.stackHarness.id === 'rules-only-demo', 'template reset should preserve stack harness lock')
  assert(resetLock.scaffoldTemplate === null, 'template reset should clear template lock')
}

function templateApplyCreatesProjectNvmrcWhenMissing() {
  const target = makeTarget()
  const stackPreset = makeRulesOnlyPreset()
  const templatePreset = makeScaffoldTemplatePreset()

  runInit(target)
  run('npm', ['run', 'stack:apply', '--', '--preset-path', stackPreset], { cwd: target })
  run('npm', ['run', 'template:apply', '--', '--preset-path', templatePreset], { cwd: target })

  assert(read(target, '.nvmrc') === 'v24.14.0\n', 'template apply should create project .nvmrc when missing')
}

function templateApplyStopsWhenRequiredStackDoesNotMatch() {
  const target = makeTarget()
  const stackPreset = makeRulesOnlyPreset()
  const templatePreset = makeScaffoldTemplatePreset('other-stack')

  runInit(target)
  run('npm', ['run', 'stack:apply', '--', '--preset-path', stackPreset], { cwd: target })

  let failed = false
  try {
    run('npm', ['run', 'template:apply', '--', '--preset-path', templatePreset], { cwd: target })
  } catch (error) {
    failed = error.status === 1
    assert(String(error.stderr).includes('템플릿 요구 스택'), 'template mismatch should explain required stack failure')
  }

  assert(failed, 'template apply should fail when required stack does not match')
  assert(!exists(target, 'src/App.vue'), 'template mismatch should not copy scaffold files')
  assert(!exists(target, '.harness/.template-applied.json'), 'template mismatch should not write marker')
}

function scanReportSuggestsStylePresetsWhenStyleSourceMissing() {
  const target = makeTarget()

  fs.rmSync(path.join(target, '.editorconfig'), { force: true })
  runInit(target)
  fs.rmSync(path.join(target, '.editorconfig'), { force: true })
  run('npm', ['run', 'harness:scan'], { cwd: target })

  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('## Code Formatting Preset Candidates'), 'scan report should include code formatting preset candidates')
  assert(report.includes('standard-js'), 'scan report should suggest standard-js preset')
  assert(report.includes('explicit-ts'), 'scan report should suggest explicit-ts preset')
  assert(report.includes('formatter-owned'), 'scan report should suggest formatter-owned preset')
}

function scanReportDraftsStyleRulesFromConfigFiles() {
  const target = makeTarget()

  runInit(target)
  fs.writeFileSync(path.join(target, '.editorconfig'), `root = true

[*]
indent_style = space
indent_size = 2
insert_final_newline = true
`)
  fs.writeFileSync(path.join(target, '.eslintrc'), JSON.stringify({
    rules: {
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'import/order': ['warn'],
    },
  }, null, 2))

  run('npm', ['run', 'harness:scan'], { cwd: target })

  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('## Code Formatting Rule Draft'), 'scan report should include code formatting rule draft')
  assert(report.includes('.editorconfig *: indent_style = space'), 'scan report should draft editorconfig style rules')
  assert(report.includes('.eslintrc: quote = single'), 'scan report should draft eslint quote rule')
  assert(report.includes('.eslintrc: semicolon = always'), 'scan report should draft eslint semicolon rule')
  assert(report.includes('.eslintrc: import grouping/order rule is configured'), 'scan report should draft eslint import order rule')
  assert(!report.includes('## Code Formatting Preset Candidates'), 'scan report should not suggest presets when style sources exist')
}

function workflowWorkstreamChangeDoesNotTriggerCommitPushHookPolicy() {
  const target = makeTarget()

  runInit(target)
  run('git', ['add', '.'], { cwd: target })
  run('git', [
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'baseline',
  ], { cwd: target })

  fs.appendFileSync(path.join(target, '.harness/project/workflow-rules.md'), `

## Workstream 운영
- 긴 대화창은 업무 흐름별로 분리합니다.
`)

  const workflowImpact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact'], { cwd: target })
  assert(!workflowImpact.includes('common.hooks.commit-push-check'), 'workflow workstream-only change should not trigger commit/push hook policy')

  fs.appendFileSync(path.join(target, '.harness/project/commit-push-rules.md'), `

## 프로젝트 예외
- 커밋 전 검증은 팀 기준에 맞게 조정할 수 있습니다.
`)

  const hookImpact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact'], { cwd: target })
  assert(hookImpact.includes('common.hooks.commit-push-check'), 'commit/push rules change should trigger commit/push hook policy')
}

function harnessBaselineDocUpdateDoesNotTriggerSyncGap() {
  const target = makeTarget()

  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('git', ['add', '.'], { cwd: target })
  run('git', [
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'baseline',
  ], { cwd: target })

  const baselineDoc = '.harness/project/portability-guide.md'
  const baselinePath = path.join(target, baselineDoc)
  const manifestPath = path.join(target, '.harness/install-manifest.json')
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(manifest.managedFiles[baselineDoc], 'portability guide should be a managed baseline document')

  fs.appendFileSync(baselinePath, '\n## Baseline update smoke\n- 본체 baseline 문서 갱신 시뮬레이션입니다.\n')
  manifest.managedFiles[baselineDoc].sha256 = sha256File(baselinePath)
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const baselineImpact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact', '--verbose'], { cwd: target })
  assert(baselineImpact.includes('Harness baseline update notice'), 'baseline update should be announced as baseline notice')
  assert(!baselineImpact.includes('기준 동기화 검토 후보'), 'managed baseline doc update should not trigger a sync review candidate')
  assert(!baselineImpact.includes('common.runtime.minimum-node'), 'managed baseline doc update should not trigger runtime policy review')

  fs.appendFileSync(baselinePath, '\n## Local project edit\n- 프로젝트가 직접 수정한 런타임 기준입니다.\n')
  const localImpact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact', '--verbose'], { cwd: target })
  assert(localImpact.includes('common.runtime.minimum-node'), 'local edit to same document should still trigger runtime policy review')
  assert(localImpact.includes('기준 동기화 검토 후보'), 'local edit to same document should still create a sync review candidate')
}

function guardDerivesAppliedStackFromTrackedSnapshotWhenMarkerMissing() {
  const target = makeTarget()
  const preset = makeRulesOnlyPreset()

  writeJson(target, 'package.json', {
    name: 'stack-derived-check-target',
    private: true,
    type: 'module',
    scripts: {
      lint: "node -e \"require('fs').writeFileSync('lint-ran.txt', 'yes')\"",
    },
  })

  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })
  const derivedProfile = JSON.parse(read(target, '.harness/policy/profile.json'))
  derivedProfile.verify = { lint: 'harness' } // 결정 86: npm script 실행은 옵트인
  writeJson(target, '.harness/policy/profile.json', derivedProfile)
  fs.rmSync(path.join(target, '.harness/.stack-applied.json'), { force: true })

  const output = run('npm', ['run', 'harness:check', '--', '--no-cache', '--brief'], { cwd: target })
  assert(output.includes('Stack applied state derived from tracked snapshot'), 'guard should derive stack state from tracked snapshot when marker is missing')
  assert(!output.includes('Stack not applied'), 'guard should not silently skip project validations when tracked stack snapshot exists')
  assert(exists(target, 'lint-ran.txt'), 'guard should run lint when stack snapshot exists without local marker')
}

function npmVerifyStagesRequireOptIn() {
  // 결정 86(멀티사이트 실측): package.json에 lint가 있어도 profile.verify 옵트인 없이는
  // 실행하지 않는다 — 전체 lint가 커밋 범위 밖 파일을 심판해 커밋을 막던 문제의 구조적 제거.
  const target = makeTarget()
  const preset = makeRulesOnlyPreset()
  writeJson(target, 'package.json', {
    name: 'verify-opt-in-target',
    private: true,
    type: 'module',
    scripts: { lint: "node -e \"require('fs').writeFileSync('lint-ran.txt', 'yes')\"" },
  })
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })

  // 기본: 실행 안 함 + 감지 안내
  const defaultOut = run('npm', ['run', 'harness:check', '--', '--no-cache', '--brief'], { cwd: target })
  assert(!exists(target, 'lint-ran.txt'), 'lint must NOT run without explicit opt-in (결정 86)')
  assert(defaultOut.includes('하네스는 실행하지 않습니다'), 'check must announce detected-but-not-run stages')

  // external: 위임 표기 + 미실행
  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  profile.verify = { lint: 'external' }
  writeJson(target, '.harness/policy/profile.json', profile)
  const externalOut = run('npm', ['run', 'harness:check', '--', '--no-cache', '--brief'], { cwd: target })
  assert(externalOut.includes('external 위임'), 'external delegation must be announced in check output')
  assert(!exists(target, 'lint-ran.txt'), 'external delegation must not run lint')

  // harness 옵트인: 실행
  profile.verify = { lint: 'harness' }
  writeJson(target, '.harness/policy/profile.json', profile)
  run('npm', ['run', 'harness:check', '--', '--no-cache', '--brief'], { cwd: target })
  assert(exists(target, 'lint-ran.txt'), 'opt-in must run the npm lint script')

  // 알 수 없는 값: 조용히 옵트인되지 않고 경고
  fs.rmSync(path.join(target, 'lint-ran.txt'))
  profile.verify = { lint: 'huskyy' }
  writeJson(target, '.harness/policy/profile.json', profile)
  const typoOut = run('npm', ['run', 'harness:check', '--', '--no-cache', '--brief'], { cwd: target })
  assert(!exists(target, 'lint-ran.txt'), 'unknown verify value must not silently opt in')
  assert(typoOut.includes('인식할 수 없어'), 'unknown verify value must warn')
}

function guardFailsWhenActiveStackHasNoTrackedSnapshot() {
  const target = makeTarget()

  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  writeJson(target, '.harness/policy/profile.json', {
    activeStack: 'missing-stack',
    stackManifest: '.harness/stacks/.applied/missing-stack/manifest.json',
  })
  fs.rmSync(path.join(target, '.harness/.stack-applied.json'), { force: true })

  let output = ''
  let failed = false
  try {
    run(nodeBin, [path.join(target, '.harness/bin/guard.mjs'), '--brief'], { cwd: target })
  } catch (error) {
    failed = true
    output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
  }

  assert(failed, 'guard should fail when activeStack is set but no tracked stack snapshot exists')
  assert(output.includes('Stack state is incomplete'), 'guard failure should explain incomplete stack state')
  assert(output.includes('결과: 실패'), 'consumer summary should show failure instead of pass')
}

function updateRecordsAndReplaysChangelogDelta() {
  const target = makeTarget()
  runInit(target)

  // 최초 설치는 이전 버전이 없으므로 lastUpdate를 기록하지 않아야 한다.
  const firstLock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(firstLock.baseHarness.version === packageVersion, 'clean install lock should record current version')
  assert(!firstLock.lastUpdate, 'clean install should not record lastUpdate without a previous version')

  // 이전 버전을 낮춰 업데이트 상황을 만든다.
  firstLock.baseHarness.version = '0.0.1'
  delete firstLock.lastUpdate
  writeJson(target, '.harness/harness-lock.json', firstLock)

  const output = runInit(target)
  assert(output.includes('이번 업데이트로 반영된 공통 하네스 변경'), 'update should print the changelog delta inline')

  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(lock.lastUpdate, 'update should record lastUpdate in the lock')
  assert(lock.lastUpdate.from === '0.0.1', 'lastUpdate.from should be the previous version')
  assert(lock.lastUpdate.to === packageVersion, 'lastUpdate.to should be the newly installed version')
  assert(Array.isArray(lock.lastUpdate.entries) && lock.lastUpdate.entries.length >= 1, 'lastUpdate should carry changelog entries')
  assert(lock.lastUpdate.entries[0].version === packageVersion, 'newest CHANGELOG entry should equal package.json version (release sync)')

  // 독립 harness:changelog 명령이 lock의 lastUpdate를 다시 출력해야 한다.
  const replay = run(nodeBin, [path.join(target, '.harness/bin/changelog-delta.mjs')], { cwd: target })
  assert(replay.includes(packageVersion), 'harness:changelog should re-print the recorded delta from lock.lastUpdate')
}

function existingClaudeSettingsGetsHarnessHooksMerged() {
  const target = makeTarget()
  // 소비자가 이미 자기 .claude/settings.json을 갖고 있는 상황 (clubadm 같은 기존 프로젝트)
  fs.mkdirSync(path.join(target, '.claude'), { recursive: true })
  writeJson(target, '.claude/settings.json', {
    permissions: { allow: ['Bash(npm run dev*)'], deny: ['Bash(rm -rf /*)'] },
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'my-own-hook.sh' }] }] },
    statusLine: { type: 'command', command: 'my-statusline.sh' },
    myCustomKey: 'keep-me',
  })

  runInit(target)
  const merged = JSON.parse(read(target, '.claude/settings.json'))

  // 1) 소비자 고유 설정 보존
  assert(merged.myCustomKey === 'keep-me', 'consumer custom key should be preserved')
  assert(merged.statusLine.command === 'my-statusline.sh', 'consumer statusLine should not be overridden')
  assert(merged.permissions.allow.includes('Bash(npm run dev*)'), 'consumer allow entry should be preserved')
  assert(
    (merged.hooks.UserPromptSubmit || []).some((e) => (e.hooks || []).some((h) => h.command === 'my-own-hook.sh')),
    'consumer own hook should be preserved',
  )

  // 2) 하네스 안전 훅이 실제로 wiring됨
  const cmds = (event) => (merged.hooks[event] || []).flatMap((e) => (e.hooks || []).map((h) => h.command))
  assert(cmds('UserPromptSubmit').some((c) => c.includes('inject-context.sh')), 'harness inject-context hook should be wired')
  assert(cmds('UserPromptSubmit').some((c) => c.includes('scan-secrets.sh')), 'harness scan-secrets hook should be wired')
  assert(cmds('PreToolUse').some((c) => c.includes('protect-paths.sh')), 'harness protect-paths hook should be wired')
  assert((merged.hooks.SessionStart || []).length >= 1, 'harness SessionStart hook should be wired')
  assert(merged.permissions.deny.some((d) => d.includes('--no-verify')), 'harness deny entries should be merged')

  // 3) 멱등성: 재실행해도 하네스 훅이 중복되지 않음
  runInit(target)
  const again = JSON.parse(read(target, '.claude/settings.json'))
  const injectCount = (again.hooks.UserPromptSubmit || [])
    .flatMap((e) => (e.hooks || []).map((h) => h.command))
    .filter((c) => c.includes('inject-context.sh')).length
  assert(injectCount === 1, 'reinstall should not duplicate harness hooks (idempotent)')
}

// 통짜 안전망(0.2.65)은 마커 비대상 managed 파일에 적용된다. 마커 대상(CLAUDE.md 등)은 0.2.67 마커 머지로
// 별도 처리되므로, 여기서는 hook 스크립트 같은 마커 비대상 managed 파일로 통짜 보존/사이드카/중단을 검증한다.
const NON_MARKER_MANAGED_REL = '.claude/hooks/enforce-check.sh'

function reinstallPreservesLocallyEditedManagedHarnessFile() {
  const target = makeTarget()
  runInit(target)

  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(manifest.managedFiles[NON_MARKER_MANAGED_REL], 'hook script should be a managed file (precondition)')

  const original = read(target, NON_MARKER_MANAGED_REL)
  const sentinel = '\n# consumer local edit\n'
  fs.writeFileSync(path.join(target, NON_MARKER_MANAGED_REL), original + sentinel)

  const output = runInit(target, '--no-scan', '--no-check')

  const after = read(target, NON_MARKER_MANAGED_REL)
  assert(after.includes('consumer local edit'), 'reinstall should preserve consumer edit in a non-marker managed file')
  // 0.2.109 문구 정정: 이 목록은 "안전망이 잘 돌았다"가 아니라 "이 파일들은 앞으로도 계속 제외된다"는 뜻이다.
  assert(output.includes('갱신하지 못한 하네스 파일'), 'reinstall should report preserved managed files as a problem, not as a working safety net')
  assert(!output.includes('안전망 작동'), 'the report must not frame a permanent update skip as a safety net working')
  assert(output.includes('--resync-managed'), 'the report must point at the managed-only recovery path')
  assert(!output.includes('--force --confirm-overwrite-project-files'), 'the report must not recommend the option that also overwrites project-owned files')
  assert(output.includes(NON_MARKER_MANAGED_REL), 'preserved-managed report should name the file')
  assert(!exists(target, `${NON_MARKER_MANAGED_REL}.harness-bak`), 'preservation path should not leave a .harness-bak sidecar')
}

// 0.2.109 — 소비자 lint가 하네스 코드를 자동수정해 업데이트를 영구 차단한 사고(2026-08-11 multisite)의 회귀.
// 사고 경로: eslint.config.ts가 .harness/를 제외하지 않음 → `eslint . --fix`가 import 순서를 고침 →
// manifest sha 불일치 → 업데이터가 "소비자 수정"으로 보고 스킵 → 그 파일들은 이후 모든 업데이트에서 제외.
// 핵심은 "설치 후 프로젝트 lint를 돌려도 managed 파일이 안 변한다"이므로, 도구별 제외 파일을 전부 본다.
function initExcludesHarnessFromEveryLintSurface() {
  const target = makeTarget()
  writeJson(target, 'package.json', {
    name: 'lint-surface-target',
    private: true,
    type: 'module',
    scripts: { lint: 'run-s "lint:*"' },
  })
  // create-vue 스캐폴딩 모양: flat config를 .ts로 쓰고, globalIgnores는 빌드 산출물만 뺀다.
  fs.writeFileSync(path.join(target, 'eslint.config.ts'), `import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores(["**/dist/**", "**/coverage/**"]),
])
`)
  writeJson(target, '.oxlintrc.json', { plugins: ['eslint'], env: { browser: true } })
  writeJson(target, '.prettierrc.json', { semi: false })

  runInit(target, '--no-scan', '--no-check')

  const eslintConfig = read(target, 'eslint.config.ts')
  assert(eslintConfig.includes('.harness/**'), 'eslint.config.ts must be recognized and excluded (not only .js/.mjs)')
  // 소비자 설정 파일 자체는 계속 린트되므로 따옴표를 섞으면 그 프로젝트의 quotes 규칙에 걸린다.
  assert(eslintConfig.includes('".harness/**"'), 'the inserted entry must follow the file existing quote style')
  assert(!eslintConfig.includes("'.harness/**'"), 'it must not mix quote styles into a double-quoted config')

  const oxlint = JSON.parse(read(target, '.oxlintrc.json'))
  assert(
    (oxlint.ignorePatterns ?? []).some((entry) => entry.includes('.harness/')),
    'oxlint must exclude .harness too — excluding only eslint leaves the same autofix path open',
  )

  assert(exists(target, '.prettierignore'), 'a prettier-configured project without .prettierignore must get one')
  assert(read(target, '.prettierignore').includes('.harness/'), 'prettier must not reformat harness code')

  // 제외해 놓고 Node globals override를 요구하면, 소비자는 죽은 설정을 넣게 된다.
  const output = runInit(target, '--no-scan', '--no-check')
  assert(!output.includes('Node scripts override'), 'an excluded .harness needs no node globals override — do not ask for dead config')
}

// 원인이 아니라 결과를 검사하는 백스톱: 무엇이 고쳤든 managed 파일이 기록과 다르면 알린다.
// 이 검사가 없어서 10개 파일이 여러 버전 동안 조용히 동결됐다.
function harnessCheckReportsManagedFileDrift() {
  const target = makeTarget()
  runInit(target)

  const clean = runGuard(target, '--fast', '--no-cache')
  assert(!clean.includes('업데이트에서 제외'), 'a clean install must not report drift')

  fs.writeFileSync(
    path.join(target, NON_MARKER_MANAGED_REL),
    `${read(target, NON_MARKER_MANAGED_REL)}\n# formatter touched this\n`,
  )

  const output = runGuard(target, '--fast', '--no-cache')
  assert(output.includes('업데이트에서 제외됩니다'), 'check must say the file will be excluded from updates, not just that it differs')
  assert(output.includes(NON_MARKER_MANAGED_REL), 'the drift report must name the file')
  assert(output.includes('--resync-managed'), 'the drift report must give the recovery command')
  assert(output.includes(`하네스 파일 1건이 업데이트에서 제외됨`), 'drift must surface in the one-line summary, not only in the detail block')
}

// 마커 하이브리드 파일(CLAUDE.md 등)은 소비자 영역이 있어 본체와 달라도 정상이다. 이걸 drift로 세면
// 모든 프로젝트가 상시 경고를 보게 되고, 경고는 그 순간부터 무시된다.
function managedDriftIgnoresMarkerHybridFiles() {
  const target = makeTarget()
  runInit(target)

  fs.writeFileSync(path.join(target, 'CLAUDE.md'), `${read(target, 'CLAUDE.md')}\n## 프로젝트 고유 규칙\n`)

  const output = runGuard(target, '--fast', '--no-cache')
  assert(!output.includes('업데이트에서 제외'), 'consumer content in a marker-managed file is normal, not drift')
}

// --force와의 결정적 차이: 사정거리가 managed 파일로 한정된다. 0.2.108까지는 복구 수단이
// --force --confirm-overwrite-project-files뿐이었는데, 그건 spec-map.md 같은 온보딩 산출물까지 덮는다.
function resyncManagedRestoresHarnessFilesButNotProjectOwned() {
  const target = makeTarget()
  runInit(target)

  const upstream = read(target, NON_MARKER_MANAGED_REL)
  fs.writeFileSync(path.join(target, NON_MARKER_MANAGED_REL), `${upstream}\n# formatter touched this\n`)

  const projectOwnedRel = '.harness/project/spec-map.md'
  const projectOwned = '| features/로그인.md | src/views/LoginView.vue | 실제 매핑 |\n'
  fs.writeFileSync(path.join(target, projectOwnedRel), projectOwned)

  const output = runInit(target, '--resync-managed', '--no-scan', '--no-check')

  assert(read(target, NON_MARKER_MANAGED_REL) === upstream, '--resync-managed must restore the managed file byte-for-byte')
  assert(read(target, projectOwnedRel) === projectOwned, '--resync-managed must never touch project-owned files')
  assert(output.includes('본체 원본으로 되돌린 하네스 파일'), 'the resync must report what it replaced')
  assert(!output.includes('갱신하지 못한 하네스 파일'), 'nothing should remain frozen after a resync')

  const afterCheck = runGuard(target, '--fast', '--no-cache')
  assert(!afterCheck.includes('업데이트에서 제외'), 'drift must be gone after resync')
}

// 형제 생성물 3건은 배포되는데 task-context.md만 빠져 소비자 저장소에서 untracked로 떠다녔다.
function consumerGitignoreCoversAllGeneratedSessionArtifacts() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-check')

  const gitignore = read(target, '.gitignore')
  for (const rel of [
    '.harness/session/project-scan-report.md',
    '.harness/session/handoff.md',
    '.harness/session/template-gap-report.md',
    '.harness/session/task-context.md',
  ]) {
    assert(gitignore.includes(rel), `consumer .gitignore must cover the regenerable artifact ${rel}`)
  }
}

function forceConfirmOverwritesLocallyEditedManagedHarnessFileWithBackup() {
  // 소비자가 위험을 인지하고 --force --confirm-overwrite-project-files를 함께 지정하면
  // 덮어쓰되 소비자본은 같은 디렉터리의 .harness-bak 사이드카로 남겨야 한다.
  const target = makeTarget()
  runInit(target)

  const consumerVersion = `${read(target, NON_MARKER_MANAGED_REL)}\n# consumer local edit\n`
  fs.writeFileSync(path.join(target, NON_MARKER_MANAGED_REL), consumerVersion)

  const output = runInit(target, '--force', '--confirm-overwrite-project-files', '--no-scan', '--no-check')

  const after = read(target, NON_MARKER_MANAGED_REL)
  assert(!after.includes('consumer local edit'), '--force --confirm should replace consumer-modified managed file')
  assert(exists(target, `${NON_MARKER_MANAGED_REL}.harness-bak`), '--force --confirm should leave a .harness-bak sidecar with consumer content')
  assert(read(target, `${NON_MARKER_MANAGED_REL}.harness-bak`) === consumerVersion, '.harness-bak should hold the consumer-modified bytes verbatim')
  assert(output.includes('.harness-bak'), 'post-install report should mention the .harness-bak sidecar')
}

function forceAloneStopsWhenManagedHarnessFileWasLocallyEdited() {
  // 동일한 사고를 막기 위해 --force만 주고 동의 플래그가 없으면 init이 중단되어야 한다.
  const target = makeTarget()
  runInit(target)
  fs.writeFileSync(path.join(target, NON_MARKER_MANAGED_REL), '# CONSUMER EDIT\n')

  let failed = false
  try {
    runInit(target, '--force')
  } catch (error) {
    failed = error.status === 1
    assert(String(error.stderr).includes('--confirm-overwrite-project-files'), '--force failure should advise the confirmation flag')
  }

  assert(failed, '--force without confirmation should fail when a managed file is locally modified')
  assert(read(target, NON_MARKER_MANAGED_REL) === '# CONSUMER EDIT\n', '--force without confirmation should preserve the modified managed file')
}

// 옵션 A(0.2.67): CLAUDE.md/AGENTS.md/.github/copilot-instructions.md는 마커 머지로 처리된다.
// 마커 밖(소비자 영역)은 보존하고 마커 안(회사 영역)은 본체로 갱신한다. 위의 통짜 안전망 3개 테스트는
// 마커 비대상 managed 파일(hook 스크립트 등)에만 적용되고, 아래는 마커 융합 동작을 잠근다.
const MARKER_START_T = '<!-- harness-managed:start -->'
const MARKER_END_T = '<!-- harness-managed:end -->'

function newInstallWritesMarkerAndRegionSha() {
  const target = makeTarget()
  runInit(target)

  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  for (const rel of ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']) {
    const content = read(target, rel)
    assert(content.includes(MARKER_START_T) && content.includes(MARKER_END_T), `${rel} should ship with managed markers`)
    assert(manifest.managedFiles[rel], `${rel} should be managed`)
    assert(manifest.managedFiles[rel].managedRegionSha256, `${rel} manifest entry should record managedRegionSha256`)
  }
}

function markerMergePreservesConsumerAreaAndUpdatesManagedBlock() {
  const target = makeTarget()
  runInit(target)

  const consumerSection = '\n## 우리 팀 모노레포 (#250)\n프로젝트 고유 지침.\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), read(target, 'CLAUDE.md') + consumerSection)

  const output = runInit(target, '--no-scan', '--no-check')

  const after = read(target, 'CLAUDE.md')
  assert(after.includes('우리 팀 모노레포 (#250)'), 'merge should preserve consumer area outside markers')
  assert(after.includes(MARKER_START_T) && after.includes(MARKER_END_T), 'merge should keep managed markers')
  assert(output.includes('마커 머지된'), 'should report marker merge')
  assert(!exists(target, 'CLAUDE.md.harness-bak'), 'clean merge should not leave a sidecar')
}

function markerMergeRestoresTamperedManagedBlockWithSidecar() {
  const target = makeTarget()
  runInit(target)

  const original = read(target, 'CLAUDE.md')
  // 소비자가 마커 안 본체 문구를 훼손 + 마커 밖에 자기 영역 추가
  const tampered = original.replace('모든 에이전트의 기준 진입점', '소비자가 바꾼 문구') + '\n## 소비자 영역\n보존돼야 함\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), tampered)

  const output = runInit(target, '--no-scan', '--no-check')

  const after = read(target, 'CLAUDE.md')
  assert(after.includes('모든 에이전트의 기준 진입점'), 'managed block should be restored to canonical content')
  assert(!after.includes('소비자가 바꾼 문구'), 'tampered managed content should be replaced')
  assert(after.includes('소비자 영역'), 'consumer area outside markers should be preserved')
  assert(exists(target, 'CLAUDE.md.harness-bak'), 'tampered managed region should be backed up to sidecar')
  assert(read(target, 'CLAUDE.md.harness-bak') === tampered, 'sidecar should hold the consumer bytes verbatim')
  assert(output.includes('회사 영역'), 'should report managed-region backup')
}

function autoMigrateUnmodifiedLegacyFileToMarkerVersion() {
  const target = makeTarget()
  runInit(target)

  // 마커 없는 옛 버전(미수정)을 시뮬: 마커 없는 내용으로 덮고 manifest를 그 내용 기준으로 set.
  const legacy = '# CLAUDE\n\n옛 버전 본문. 마커 없음.\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), legacy)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles['CLAUDE.md'] = { sha256: sha256Text(legacy) }
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-check')

  const after = read(target, 'CLAUDE.md')
  assert(after.includes(MARKER_START_T), 'unmodified legacy file should auto-migrate to the marker version')
  assert(!after.includes('옛 버전 본문'), 'legacy content should be replaced on auto-migration')
  assert(output.includes('자동 이전'), 'should report auto-migration')
  assert(!exists(target, 'CLAUDE.md.harness-bak'), 'auto-migration of unmodified file needs no sidecar')
}

function preserveModifiedLegacyFileWithoutMarkerAndAdvise() {
  const target = makeTarget()
  runInit(target)

  // 마커 없는 옛 파일을 소비자가 수정(sha 불일치) → 자동 분리 불가 → 보존 + 안내.
  const legacyModified = '# CLAUDE\n\n옛 버전인데 소비자가 수정함. 마커 없음.\n## 내 메모\n중요\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), legacyModified)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles['CLAUDE.md'] = { sha256: sha256Text('# CLAUDE\n\n옛 정본(소비자 수정 전).\n') }
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-check')

  assert(read(target, 'CLAUDE.md') === legacyModified, 'modified legacy file without markers should be preserved as-is')
  assert(output.includes('수동 이전 필요'), 'should advise manual marker migration')
}

function markerMergeIsIdempotent() {
  const target = makeTarget()
  runInit(target)

  const consumerSection = '\n## 소비자 영역\n한 번만 있어야 함\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), read(target, 'CLAUDE.md') + consumerSection)

  runInit(target, '--no-scan', '--no-check')
  const first = read(target, 'CLAUDE.md')
  runInit(target, '--no-scan', '--no-check')
  const second = read(target, 'CLAUDE.md')

  assert(first === second, 'repeated marker merge should be byte-identical (idempotent)')
  assert(second.split('## 소비자 영역').length - 1 === 1, 'consumer area should not duplicate across merges')
  assert(second.split(MARKER_START_T).length - 1 === 1, 'managed start marker should not duplicate')
}

// doc-link-check 오탐(0.2.68): 백틱 디렉토리 예시/CI 어댑터 경로를 dead code-path로 잘못 표시하던 문제.
function isIgnorableCodePathClassifiesExamplesAndCiPaths() {
  // 예시/디렉토리/CI 어댑터 경로는 무결성 검사 대상이 아니다.
  assert(isIgnorableCodePath('.github/workflows/'), 'trailing-slash CI dir is a directory example')
  assert(isIgnorableCodePath('.harness/policy/'), 'trailing-slash dir is a directory example')
  assert(isIgnorableCodePath('.github/workflows/policy-guard.yml'), 'CI adapter path is ignorable (not injected into consumers)')
  assert(isIgnorableCodePath('.harness/bin/*.mjs'), 'glob is ignorable')
  assert(isIgnorableCodePath('.harness/session/...'), 'ellipsis is ignorable')
  // 구체 파일 참조는 여전히 검사 대상이어야 한다(오탐 수정이 진짜 dead까지 가리면 안 된다).
  assert(!isIgnorableCodePath('.harness/bin/guard.mjs'), 'concrete harness file must still be checked')
  assert(!isIgnorableCodePath('.claude/hooks/enforce-check.sh'), 'concrete hook file must still be checked')
  assert(!isIgnorableCodePath('src/index.ts'), 'concrete src file must still be checked')
}

function consumerDocLinkCheckIgnoresCiExamplePaths() {
  const target = makeTarget()
  runInit(target)
  // 소비자에는 본체 CI 어댑터(.github/workflows/)가 주입되지 않는다(전제).
  assert(!exists(target, '.github/workflows'), 'consumer should not have .github/workflows (precondition)')
  // 본체 문서(harness-scan.md 등)는 `.github/workflows/`를 백틱 예시로 언급한다. 설치된 doc-link-check를
  // 소비자 루트에서 실행해도 그 예시/CI 경로를 dead로 보고하지 않아야 한다.
  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!out.includes('.github/workflows'), 'consumer doc-link-check must not flag .github/workflows example/CI paths')
}

// seed-only 문서(0.2.69+): 본체 전용 문서는 소비자에 배포하지 않는다.
const SEED_ONLY_DOCS = [
  '.harness/project/body-release-checklist.md',
  '.harness/project/body-roadmap.md',
  '.harness/project/standards-adoption-roadmap.md',
]
const SEED_ONLY_DOC = SEED_ONLY_DOCS[0]

function consumerInstallExcludesSeedOnlyDocs() {
  const target = makeTarget()
  runInit(target)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  for (const docPath of SEED_ONLY_DOCS) {
    assert(!exists(target, docPath), 'seed-only doc must not be installed to a consumer project')
    assert(!manifest.managedFiles[docPath], 'seed-only doc must not appear in consumer install manifest')
  }
}

function consumerDocLinkCheckHandlesAbsentSeedOnlyDoc() {
  const target = makeTarget()
  runInit(target)
  // seed-only 문서는 소비자에 없고 document-registry에도 없으므로 missing/orphan으로 표시되면 안 된다.
  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  for (const docPath of SEED_ONLY_DOCS) {
    assert(!out.includes(path.basename(docPath, '.md')), 'consumer doc-link-check must not flag the absent seed-only doc')
  }
}

function reinstallRemovesPreexistingSeedOnlyDocWhenUnmodified() {
  const target = makeTarget()
  runInit(target)
  // 옛 버전(0.2.68 이하)이 설치해 둔 상태를 시뮬: 파일 + manifest에 미수정 sha 기록.
  const body = '# 본체 전용\n옛 버전이 설치한 내용\n'
  fs.writeFileSync(path.join(target, SEED_ONLY_DOC), body)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles[SEED_ONLY_DOC] = { sha256: sha256Text(body) }
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-check')

  assert(!exists(target, SEED_ONLY_DOC), 'unmodified pre-existing seed-only doc should be removed on update')
  assert(output.includes('정리된 본체 전용'), 'should report seed-only cleanup')
}

function reinstallPreservesModifiedSeedOnlyDoc() {
  const target = makeTarget()
  runInit(target)
  const modified = '# 소비자가 직접 고친 내용\n'
  fs.writeFileSync(path.join(target, SEED_ONLY_DOC), modified)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles[SEED_ONLY_DOC] = { sha256: sha256Text('# 다른 원본(수정 전)\n') } // sha 불일치
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-check')

  assert(exists(target, SEED_ONLY_DOC), 'modified seed-only doc should be preserved (not silently deleted)')
  assert(read(target, SEED_ONLY_DOC) === modified, 'modified seed-only content should be preserved verbatim')
  assert(output.includes('보존한'), 'should report preserved seed-only doc')
}

// 세션 이력 아카이브 배포 차단(0.2.95): 본체의 decision-log 아카이브가 소비자에 복사되던 회귀(clubadm 보고).
const SEED_HISTORY_LOG = '.harness/session/decision-log-2026H1.md'

function consumerInstallExcludesSessionHistoryLogs() {
  const target = makeTarget()
  runInit(target)
  assert(!exists(target, SEED_HISTORY_LOG), 'seed session history archive must not be installed to a consumer project')
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!manifest.managedFiles[SEED_HISTORY_LOG], 'seed session history archive must not appear in consumer install manifest')
  // clubadm 요청 2: 관례 파일명이 managed와 충돌할 수 없도록 project-owned 계약으로 선언된다.
  assert(manifest.projectOwnedFiles.includes(SEED_HISTORY_LOG), 'session history archive path must be declared project-owned in the manifest contract')
}

function updateRemovesSeedDistributedHistoryLogWhenUnmodified() {
  const target = makeTarget()
  runInit(target)
  // 옛 버전(0.2.92~0.2.94)이 배포해 둔 상태를 시뮬: 파일 + manifest에 미수정 sha 기록.
  const body = '# 본체 아카이브 (옛 버전이 배포한 상태 시뮬)\n\n- 본체 이력 항목.\n'
  fs.writeFileSync(path.join(target, SEED_HISTORY_LOG), body)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles[SEED_HISTORY_LOG] = { sha256: sha256Text(body) }
  writeJson(target, '.harness/install-manifest.json', manifest)

  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  assert(!exists(target, SEED_HISTORY_LOG), 'unmodified seed-distributed history archive should be removed on update')
  const after = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!after.managedFiles[SEED_HISTORY_LOG], 'stale manifest entry for the removed archive must not carry over')
}

function updatePreservesConsumerOwnedHistoryLog() {
  const target = makeTarget()
  runInit(target)
  // 소비자가 옛 배포본을 자기 아카이브로 덮어쓴 상태(score-print 사례): sha 불일치 + manifest 엔트리 잔존.
  const consumerBody = '# 결정 로그 아카이브 (소비자 자신의 이관본)\n\n- 소비자 프로젝트의 이력 항목.\n'
  fs.writeFileSync(path.join(target, SEED_HISTORY_LOG), consumerBody)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles[SEED_HISTORY_LOG] = { sha256: sha256Text('# 본체가 배포했던 원본\n') }
  writeJson(target, '.harness/install-manifest.json', manifest)
  // 소비자가 처음부터 직접 만든 아카이브(manifest 기록 없음)는 어떤 보고에도 등장하면 안 된다.
  const ownArchive = '.harness/session/thread-handoff-2026-08-04.md'
  fs.writeFileSync(path.join(target, ownArchive), '# 소비자 스레드 핸드오프\n')

  const output = runInit(target, '--no-scan', '--no-handoff', '--no-check')

  assert(read(target, SEED_HISTORY_LOG) === consumerBody, 'consumer-overwritten history archive must be preserved verbatim')
  assert(exists(target, ownArchive), 'consumer-created archive must be untouched')
  const after = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!after.managedFiles[SEED_HISTORY_LOG], 'preserved consumer archive must be dropped from managed entries (project-owned reclassification)')
  assert(!after.managedFiles[ownArchive], 'consumer-created archive must never enter managed entries')
  assert(!output.includes(ownArchive), 'consumer-created archive must not be reported at all')
}

function seedModeTargetKeepsSeedOnlyDocs() {
  const target = makeTarget()
  // seed-mode 마커가 있으면 본체 타깃으로 간주 → seed-only 문서를 그대로 설치한다.
  fs.writeFileSync(path.join(target, '.harness-seed-mode'), 'seed mode marker for test\n')
  runInit(target)
  for (const docPath of SEED_ONLY_DOCS) {
    assert(exists(target, docPath), 'seed-mode target must keep seed-only docs (body repo needs them)')
  }
}

// 검증 캐시(0.2.70): 같은 git tree면 policy/doc-link/test-init/stack verify 전체를 스킵해 push/배포 중복 검사를 제거.
function guardCacheHitSkipsRevalidationOnSameTree() {
  const target = makeTarget()
  runInit(target)
  runGuard(target) // 1회차: 캐시 미스 → 전체 검증 → 통과 기록
  const second = runGuard(target) // 2회차: 같은 tree → 캐시 재사용
  assert(second.includes('캐시 재사용'), 'second guard run on the same git tree should reuse the validation cache')
}

function guardFullCacheSatisfiesFastRequest() {
  const target = makeTarget()
  runInit(target)
  runGuard(target) // full 통과 기록 (commit hook 시뮬)
  const fast = runGuard(target, '--fast') // push hook 시뮬: full ⊇ fast 이므로 full 캐시 재사용
  assert(fast.includes('캐시 재사용'), 'fast request should reuse a full cache on the same tree (full superset of fast)')
}

function guardNoCacheForcesRevalidation() {
  const target = makeTarget()
  runInit(target)
  runGuard(target) // 기록
  const out = runGuard(target, '--no-cache')
  assert(!out.includes('캐시 재사용'), '--no-cache must force full revalidation, never reuse cache')
}

function guardCacheMissAfterTreeChange() {
  const target = makeTarget()
  runInit(target)
  runGuard(target) // 기록
  fs.appendFileSync(path.join(target, '.harness/project/domain-rules.md'), '\n<!-- tree change -->\n')
  const out = runGuard(target) // working tree가 바뀌어 키가 달라짐 → 미스 → 재검증
  assert(!out.includes('캐시 재사용'), 'a changed git tree must miss the cache and revalidate')
}

// P0-1(0.2.71): profile.json의 프로젝트 소유 sources[]에 inject:always로 선언된
// 비표준 위치 룰 문서를 build-context가 Always Read에 병합한다(본체는 읽기만 함).
function buildContextMergesProfileAlwaysSources() {
  const target = makeTarget()
  runInit(target)

  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/team-conventions.md'), '# Team Conventions\n\n팀 규칙.\n')
  fs.writeFileSync(path.join(target, 'docs/standards/reference.md'), '# Reference\n')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  profile.sources = [
    { path: 'docs/standards/team-conventions.md', kind: 'methodology', owner: 'team', inject: 'always' },
    { path: 'docs/standards/reference.md', kind: 'reference', owner: 'team', inject: 'context' },
  ]
  writeJson(target, '.harness/policy/profile.json', profile)

  run('npm', ['run', 'harness:context', '--', 'context smoke'], { cwd: target })
  const context = read(target, '.harness/session/task-context.md')
  const alwaysSection = (context.split('## Always Read\n')[1] ?? '').split('\n## ')[0]

  assert(alwaysSection.includes('docs/standards/team-conventions.md'), 'build-context should merge inject:always profile source into Always Read')
  assert(alwaysSection.includes('(project source: profile.json sources[])'), 'merged project source should be tagged as project-declared in Always Read')
  assert(!alwaysSection.includes('docs/standards/reference.md'), 'a source with inject other than always must not be merged into Always Read')
}

// P0-1(0.2.71): harness:scan은 선언된 sources[] 경로가 실제 존재하는지만 검증한다(zero false positive).
// 없는 경로는 Open Questions로 표면화하고, 선언 소스를 인벤토리에 나열한다.
function scanValidatesDeclaredProjectSources() {
  const target = makeTarget()
  runInit(target)

  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/team-conventions.md'), '# Team Conventions\n')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  profile.sources = [
    { path: 'docs/standards/team-conventions.md', kind: 'methodology', owner: 'team', inject: 'always' },
    { path: 'docs/standards/does-not-exist.md', kind: 'rule', owner: 'team', inject: 'context' },
  ]
  writeJson(target, '.harness/policy/profile.json', profile)

  run('npm', ['run', 'harness:scan'], { cwd: target })
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('### Declared Project Sources (profile.json sources[])'), 'scan report should include the declared project sources inventory')
  assert(report.includes('docs/standards/team-conventions.md') && report.includes('exists'), 'scan should mark an existing declared source as exists')
  assert(report.includes('docs/standards/does-not-exist.md'), 'scan should surface the missing declared source path')
  assert(/sources\[\]에 선언된 경로가 실제로 없습니다/.test(report), 'scan should raise an open question for a missing declared source path')
}

function installReportsExistingAiRuleDocuments() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/agent-rules.md'), '# Agent Rules\n\nAlways keep existing team AI rules visible.\n')
  run('git', ['add', 'docs/standards/agent-rules.md'], { cwd: target })

  const output = runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')
  const handoff = read(target, '.harness/session/handoff.md')

  assert(output.includes('기존 AI 작업 룰 후보 1건을 감지했습니다'), 'install output should summarize detected existing AI rule docs')
  assert(output.includes('::: 하네스가 바로 확인한 것 :::'), 'install output should show immediate harness effect summary')
  assert(output.includes('이번 설치는'), 'install output should explain what harness applied in this project')
  assert(output.includes('::: 다음 작업에서 달라지는 점 :::'), 'install output should include workflow change heading')
  assert(output.includes('작업 시작: `npm run harness:context -- "<작업 설명>"`'), 'install output should explain how future work starts')
  assert(report.includes('### Existing AI Rule Document Candidates'), 'scan report should include existing AI rule candidate section')
  assert(report.includes('## Harness Effect Summary'), 'scan report should include a project-level harness effect summary')
  assert(report.includes('이번 설치는'), 'effect summary should explain what harness applied')
  assert(report.includes('## What Changes For Developers'), 'scan report should explain how developer workflow changes')
  assert(report.includes('작업 시작: `npm run harness:context -- "<작업 설명>"`'), 'workflow summary should name context command')
  assert(report.includes('작업 완료: `npm run harness:check`'), 'workflow summary should name final check command')
  assert(report.includes('테스트 루트나 test script가 없어 완료 기준이 사람마다 달라질 수 있습니다'), 'effect summary should expose missing verification strategy')
  assert(report.includes('docs/standards/agent-rules.md (미등록 후보'), 'scan report should list the pre-existing AI rule doc as unregistered')
  assert(report.includes('docs/standards/agent-rules.md (미등록 후보, rule-like markdown name, git tracked)'), 'scan report should show git tracked safety state')
  assert(report.includes('하네스는 위 후보 문서를 삭제하거나 자동 병합하지 않고 보존합니다'), 'scan report should explain preservation behavior')
  assert(report.includes('profile.json sources[]에 등록'), 'scan report should explain source registration')
  assert(report.includes('### Existing AI Rule Registration Guide'), 'scan report should include registration guide section')
  assert(report.includes('### Project Rule Authoring Guide'), 'scan report should include project rule authoring guide section')
  assert(report.includes('"path": "docs/standards/agent-rules.md"'), 'registration guide should include a concrete sources[] path example')
  assert(report.includes('inject: "always"'), 'registration guide should explain Always Read effect')
  assert(report.includes('git rm --cached <path>'), 'scan report should explain tracked personal-rule removal')
  assert(report.includes('.harness/project/workflow-rules.md'), 'project rule authoring guide should explain workflow rules target')
  assert(handoff.includes('## Harness Effect Summary'), 'handoff should include harness effect summary')
  assert(handoff.includes('## What Changes For Developers'), 'handoff should include workflow effect summary')
  assert(handoff.includes('작업 완료: `npm run harness:check`'), 'handoff should repeat final check effect')
  assert(handoff.includes('## Existing AI Rules'), 'handoff should include existing AI rules summary')
  assert(handoff.includes('docs/standards/agent-rules.md'), 'handoff should repeat the detected AI rule doc')
  assert(handoff.includes('git rm --cached <path>'), 'handoff should explain tracked personal-rule removal')
  assert(handoff.includes('## Project Rule Authoring'), 'handoff should include project rule authoring guidance')
}

function scanReportsHeadingOnlyAiRuleDocuments() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/agent-rules.md'), '# Agent Rules\n')
  run('git', ['add', 'docs/standards/agent-rules.md'], { cwd: target })

  runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('docs/standards/agent-rules.md (미등록 후보, rule-like markdown name, git tracked)'), 'heading-only agent-rules.md should still be reported as an AI rule candidate')
}

function scanReportsIgnoredAiRuleCandidates() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, '.cursor/rules'), { recursive: true })
  fs.writeFileSync(path.join(target, '.cursor/rules/private.mdc'), '# Private Rule\n\nUse my temporary prompts.\n')
  fs.writeFileSync(path.join(target, '.gitignore'), '.cursor/rules/private.mdc\n')

  runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('.cursor/rules/private.mdc (미등록 후보, agent rule directory, .gitignore 적용됨)'), 'scan report should show ignored personal rule candidates')
  assert(report.includes('"path": "<team-rule-path.md>"'), 'registration guide should not use ignored personal files as the team-rule example')
}

function scanPrefersTrackedAiRuleForRegistrationExample() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, '.cursor/rules'), { recursive: true })
  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, '.cursor/rules/private.mdc'), '# Private Rule\n\nUse my temporary prompts.\n')
  fs.writeFileSync(path.join(target, 'docs/standards/agent-rules.md'), '# Agent Rules\n\nAlways keep existing team AI rules visible.\n')
  fs.writeFileSync(path.join(target, '.gitignore'), '.cursor/rules/private.mdc\n')
  run('git', ['add', 'docs/standards/agent-rules.md'], { cwd: target })

  runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('.cursor/rules/private.mdc (미등록 후보, agent rule directory, .gitignore 적용됨)'), 'scan report should include ignored personal candidate')
  assert(report.includes('docs/standards/agent-rules.md (미등록 후보, rule-like markdown name, git tracked)'), 'scan report should include tracked team-like candidate')
  assert(report.includes('"path": "docs/standards/agent-rules.md"'), 'registration guide should prefer tracked team-like candidates')
  assert(!report.includes('"path": ".cursor/rules/private.mdc"'), 'registration guide should not prefer ignored personal candidates')
}

function profileProjectSourcesDoNotTriggerInstallSyncGap() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('git', ['add', '.'], { cwd: target })
  run('git', [
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'baseline',
  ], { cwd: target })

  fs.mkdirSync(path.join(target, 'developmentGuide'), { recursive: true })
  fs.writeFileSync(path.join(target, 'developmentGuide/agent-rules.md'), '# Agent Rules\n')
  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  profile.harnessMode = 'active'
  profile.sources = [
    { path: 'developmentGuide/agent-rules.md', kind: 'methodology', owner: 'team', inject: 'always' },
  ]
  writeJson(target, '.harness/policy/profile.json', profile)

  const impact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact'], { cwd: target })
  assert(!impact.includes('기준 동기화 검토 후보'), 'project-owned profile sources should not create a sync review candidate')
  assert(!impact.includes('common.install.preserve-project-owned-files'), 'project-owned profile edits must not trigger install preserve source policy')
}

function gitCommitAll(target, message) {
  run('git', ['add', '.'], { cwd: target })
  run('git', [
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    message,
  ], { cwd: target })
}

// 이력 로그 예외(0.2.90, score-print P3): decision-log 계열의 백틱 코드 경로는 역사 참조라
// 라이브 무결성 검사에서 제외한다. 살아있는 세션/기준 문서는 계속 검사한다.
function historyLogPathClassifiesDecisionLogFamily() {
  assert(isHistoryLogPath('.harness/session/decision-log.md'), 'decision-log is a history log')
  assert(isHistoryLogPath('.harness/session/decision-log-2026H1.md'), 'decision-log archive is a history log')
  assert(isHistoryLogPath('.harness/session/thread-handoff-2026-08-04.md'), 'thread handoff snapshot is a history log')
  assert(isHistoryLogPath('.github/session/decision-log.md'), 'legacy .github harness root decision-log is a history log')
  assert(!isHistoryLogPath('.harness/session/active-context.md'), 'living session state doc must still be checked')
  assert(!isHistoryLogPath('.harness/session/project-memory.md'), 'project memory must still be checked')
  assert(!isHistoryLogPath('.harness/project/domain-rules.md'), 'standards docs must still be checked')
}

function consumerDocLinkCheckSkipsDecisionLogHistoryPaths() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // 이력 항목이 언급하는 삭제된 소스 경로(역사 참조)는 dead code path로 잡히면 안 된다.
  // 반면 이력 문서 안에서도 마크다운 링크는 탐색용이라 계속 검사되어야 한다.
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 구조 정리\n- `src/apis/system.js`를 제거하고 호출부를 정리했다.\n- [폐기 설계](../project/removed-design.md) 참조.\n',
  )
  fs.writeFileSync(
    path.join(target, '.harness/session/decision-log-2026H1.md'),
    '# 결정 로그 아카이브 (2026 상반기)\n\n- `src/store/settings.js`를 폐기했다.\n',
  )

  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!out.includes('src/apis/system.js'), 'decision-log history code path must not be reported as dead reference')
  assert(!out.includes('src/store/settings.js'), 'decision-log archive code path must not be reported as dead reference')
  assert(!out.includes('decision-log-2026H1.md'), 'dynamically named decision-log archive must not be reported as orphan')
  assert(out.includes('removed-design.md'), 'markdown links inside history logs must still be checked')
}

function consumerDocLinkCheckStillFlagsLiveDocDeadPaths() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // 이력 예외가 살아있는 기준 문서의 진짜 dead 참조까지 가리면 안 된다.
  fs.appendFileSync(
    path.join(target, '.harness/project/domain-rules.md'),
    '\n## 규칙 근거\n- 판정 구현: `src/rules/engine.js`\n',
  )

  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(out.includes('src/rules/engine.js'), 'live standards docs must still flag dead code paths')
  assert(out.includes('code-path'), 'dead reference should keep the code-path kind label')
}

// 통과 시 1줄 출력(0.2.90, score-print P4): 신호 대 잡음비를 위해 clean 결과는 요약 한 줄로 끝낸다.
function docLinkCheckPrintsSingleLineWhenClean() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  const lines = out.trim().split('\n')
  assert(lines.length === 1, `clean doc-link check should print a single line, got ${lines.length}: ${out}`)
  assert(lines[0].includes('OK'), 'clean doc-link check line should state OK')
}

// guard 요약 기본(0.2.90, score-print P4): guard 경로의 기본 출력은 요약이고 상세는 --verbose.
// 픽스처 주의: 문서가 정책의 documents에만 있어야 한쪽 변경 gap이 생긴다.
// workflow-rules.md는 local-rule.promotion의 documents와 ownedAreas 양쪽에 있어 gap이 되지 않는다.
// portability-guide.md는 minimum-node의 documents에만 있어 로컬 수정 시 document-only 후보가 된다
// (harnessBaselineDocUpdateDoesNotTriggerSyncGap의 검증된 픽스처와 동일).
function guardModeDefaultsToSummaryImpactOutput() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')

  fs.appendFileSync(
    path.join(target, '.harness/project/portability-guide.md'),
    '\n## Local project edit\n- 프로젝트가 직접 수정한 런타임 기준입니다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('기준 동기화 검토 후보'), 'summary output should keep the sync candidate header')
  assert(/(가볍게 확인|참고) \d+건/.test(summary), 'summary output should aggregate advisory candidates as counts')
  assert(!summary.includes('연결 문서:'), 'default guard output must not expand advisory candidate detail')
  assert(!summary.includes('trigger files:'), 'default guard output must not expand per-policy file mappings')
  assert(summary.includes('--verbose'), 'summary output should point to the detailed path')
  // P4 잔여 압축(0.2.94): 요약 모드의 변경 파일 분류는 한 줄이다.
  assert(/Changed files: user \d+/.test(summary), 'summary mode should compress changed-file groups to one line')
  assert(!summary.includes('Changed files brief:'), 'summary mode must not print the old two-block breakdown')

  const detailed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--verbose'], { cwd: target })
  assert(detailed.includes('연결 문서:'), '--verbose should expand candidate detail')
  assert(detailed.includes('[common.runtime.minimum-node]'), '--verbose should name the linked policy')
}

// guard 요약 예외(0.2.90): syncEnforcement가 hook/block인 '확인 필수/차단' 후보는
// 요약 모드에서도 상세를 펴고, strict에서는 실패 원인 상세와 함께 실패한다.
function makeSyncHookPreset() {
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-sync-hook-preset-test-'))

  fs.mkdirSync(path.join(preset, 'instructions'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'instructions/rules.md'), '# Sync Hook Demo\n\n계약 문서 동기화를 명시 강제하는 데모 스택 기준.\n')
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    id: 'sync-hook-demo',
    title: 'Sync Hook Demo',
    framework: {
      runtime: 'demo',
    },
    designPattern: ['Sync Hook Stack Standard'],
    instructions: ['instructions/rules.md'],
    policiesFile: 'policies.json',
    checksKey: null,
    source: {
      type: 'none',
    },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'policies.json'), JSON.stringify({
    version: 1,
    stackId: 'sync-hook-demo',
    policies: [
      {
        id: 'stack.demo.contract-sync',
        title: 'Contract doc must follow src changes',
        documents: ['docs/contract.md'],
        ownedAreas: ['src/**'],
        syncEnforcement: 'hook',
      },
    ],
  }, null, 2))

  return preset
}

function guardSummaryStillDetailsMustActSyncCandidates() {
  const target = makeTarget()
  const preset = makeSyncHookPreset()

  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/contract.md'), '# 계약 문서\n')
  gitCommitAll(target, 'baseline')

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('[확인 필수] [stack.demo.contract-sync]'), 'hook-enforced candidate must surface as 확인 필수 in summary mode')
  assert(summary.includes('연결 문서:'), 'must-act candidate must expand detail even in summary mode')
  assert(summary.includes('docs/contract.md'), 'must-act detail should include the linked contract document')

  let failed = false
  let combined = ''
  try {
    run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  } catch (error) {
    failed = true
    combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(failed, 'strict mode must fail when a hook-enforced sync candidate is open')
  assert(combined.includes('[확인 필수] [stack.demo.contract-sync]'), 'strict failure output must include the failing candidate detail')
}

// 정책 번복 승격(0.2.91, score-print P2): 현행 decision-log diff에 ⛔ 폐기/번복 배너가 추가된
// 커밋은 그 실행의 동기화 검토 후보를 '확인 필수'로 승격한다. ⛔ 없는 본문 서술은 승격하지 않는다.
function makeSyncReviewPreset() {
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-sync-review-preset-test-'))

  fs.mkdirSync(path.join(preset, 'instructions'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'instructions/rules.md'), '# Sync Review Demo\n\n기본 등급(가볍게 확인) 동기화 후보를 만드는 데모 스택 기준.\n')
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    id: 'sync-review-demo',
    title: 'Sync Review Demo',
    framework: {
      runtime: 'demo',
    },
    designPattern: ['Sync Review Stack Standard'],
    instructions: ['instructions/rules.md'],
    policiesFile: 'policies.json',
    checksKey: null,
    source: {
      type: 'none',
    },
  }, null, 2))
  fs.writeFileSync(path.join(preset, 'policies.json'), JSON.stringify({
    version: 1,
    stackId: 'sync-review-demo',
    policies: [
      {
        id: 'stack.demo.contract-review',
        title: 'Contract doc should follow src changes',
        documents: ['docs/contract.md'],
        ownedAreas: ['src/**'],
      },
    ],
  }, null, 2))

  return preset
}

function setupSyncReviewTarget() {
  const target = makeTarget()
  const preset = makeSyncReviewPreset()

  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/contract.md'), '# 계약 문서\n')
  gitCommitAll(target, 'baseline')

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')
  return target
}

function guardEscalatesSyncCandidatesOnReversalCommit() {
  const target = setupSyncReviewTarget()
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - 인쇄 후 첫화면 복귀 ⛔ 번복됨(2026-08-04, 현재 화면 유지로 대체)\n- 새 결정: 인쇄 후 현재 화면을 유지한다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('정책 번복 감지'), 'reversal banner in decision-log diff must be announced')
  assert(summary.includes('[확인 필수] [stack.demo.contract-review]'), 'reversal commit must escalate default review candidates to 확인 필수')
  assert(summary.includes('연결 문서:'), 'escalated candidate must expand detail in summary mode')

  let failed = false
  let combined = ''
  try {
    run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  } catch (error) {
    failed = true
    combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(failed, 'strict mode must fail on a reversal commit with open sync candidates')
  assert(combined.includes('정책 번복 감지'), 'strict failure output must explain the reversal escalation')
}

function guardDoesNotEscalateProseWithoutBannerEmoji() {
  const target = setupSyncReviewTarget()
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - 구형 API 정리\n- 레거시 목 API를 폐기했다. 관련 결정을 번복 없이 유지한다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!summary.includes('정책 번복 감지'), 'prose 폐기/번복 mentions without ⛔ must not trigger reversal escalation')
  assert(!summary.includes('[확인 필수]'), 'default review candidate must stay advisory without a reversal banner')
  assert(/가볍게 확인 \d+건/.test(summary), 'default review candidate should remain a summarized advisory count')
}

function guardNoticesLogOnlyReversalCommit() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - 세션 수명 30일 ⛔ 폐기됨(2026-08-04, 1일로 축소)\n- 새 결정: 세션 수명은 1일.\n',
  )

  // 동기화 후보가 없는 로그 단독 번복 커밋: 안내는 나오되 실패하지 않는다(strict 포함).
  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('정책 번복 감지'), 'log-only reversal commit should still print the reversal notice')
  const strict = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  assert(strict.includes('정책 번복 감지'), 'strict log-only reversal should print the notice without failing')
}

// 권고 뒤집기 기록 검사(0.2.91, score-print P1 축소): [권고 뒤집기] 항목이 추가되면
// 같은 diff에 근거 반박: 필드가 있어야 한다. 없으면 확인 필수, strict에서는 실패.
function guardLintsOverrideEntryRebuttalField() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - CSS purge 채택 [권고 뒤집기]\n- 번들 감사가 purge를 비권장했지만 채택한다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('권고 뒤집기 기록 검사'), 'override entry without rebuttal must be reported')
  assert(summary.includes('근거 반박'), 'override finding should name the missing field')

  const guardOut = runGuard(target)
  assert(guardOut.includes('필수 조치: 1건'), 'guard summary must count the missing rebuttal as required action')
  assert(guardOut.includes('결과: 조치 필요'), 'guard summary result should demand action for missing rebuttal')
  // 차단 옵트인 표면화(0.2.94): 필수 조치가 있을 때만 strict 승격 안내가 나온다.
  assert(guardOut.includes('harnessMode: strict'), 'guard summary should surface the strict escalation hint when required actions exist')

  let failed = false
  try {
    run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  } catch {
    failed = true
  }
  assert(failed, 'strict mode must fail when an override entry lacks the rebuttal field')

  // 같은 diff에 근거 반박을 채우면 검사는 통과한다.
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '- 근거 반박: 키오스크 전 화면을 E2E 스냅샷으로 커버해 safelist 누락이 빌드에서 실패한다.\n',
  )
  const fixed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  assert(!fixed.includes('권고 뒤집기 기록 검사'), 'override entry with rebuttal must not be reported')
}

// decision-log 임계 안내(0.2.92, score-print P5): 임계(400줄) 초과 상태에서 "그 파일을 만진"
// 커밋에만 아카이브 분리를 안내한다. 초과 상태여도 안 만진 커밋에는 반복 안내하지 않는다.
function guardNudgesDecisionLogArchiveWhenOversizedAndTouched() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')

  // 임계 미만에서 만진 경우: 안내 없음.
  fs.appendFileSync(path.join(target, '.harness/session/decision-log.md'), '\n## 2026-08-04 - 작은 결정\n- 내용.\n')
  const small = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!small.includes('Decision log size notice'), 'under-threshold decision-log must not trigger the archive nudge')

  // 임계 초과 + 만진 커밋: 안내 + guard 요약 추천 조치.
  const filler = Array.from({ length: 420 }, (_, i) => `- 이력 항목 ${i}`).join('\n')
  fs.appendFileSync(path.join(target, '.harness/session/decision-log.md'), `\n## 2026-08-04 - 누적 이력\n${filler}\n`)
  const touched = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(touched.includes('Decision log size notice'), 'oversized decision-log touched in this change must trigger the archive nudge')
  const guardOut = runGuard(target)
  assert(guardOut.includes('아카이브로 분리'), 'guard summary should recommend archive split for oversized decision-log')

  // 임계 초과 상태여도 이번 변경이 decision-log를 안 만졌으면 안내하지 않는다(반복 노이즈 금지).
  gitCommitAll(target, 'oversized log')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')
  const untouched = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!untouched.includes('Decision log size notice'), 'oversized but untouched decision-log must not repeat the nudge')
}

// 승격 분기(0.2.92, score-print P6): 로컬룰 승격 안내가 "문서 규칙 vs 실행 가능한 검증" 분기를 묻는다.
function promotionReminderAsksExecutableGuardBranch() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('테스트/CI 가드'), 'summary promotion reminder should mention executable guards')

  const detailed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--verbose'], { cwd: target })
  assert(detailed.includes('런타임 불변식'), 'verbose promotion reminder should name runtime invariants')
  assert(detailed.includes('실행 가능한 검증으로 만들 것인가'), 'verbose promotion reminder should ask the doc-vs-guard question')
}

// 의존성 미설치 진단(0.2.97): node_modules 없이 검증하면 `run-s: command not found` 같은
// 원인 불명 실패로 보이던 것을 명확한 진단+다음 행동 안내로 바꾼다(신규 설치 온보딩 실측 2회).
function guardExplainsMissingNodeModulesInsteadOfRawToolError() {
  const target = makeTarget()
  const preset = makeRulesOnlyPreset()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })

  const pkg = JSON.parse(read(target, 'package.json'))
  pkg.scripts.lint = 'run-s lint:*'
  pkg.devDependencies = { 'npm-run-all2': '^7.0.0' }
  writeJson(target, 'package.json', pkg)
  const nmProfile = JSON.parse(read(target, '.harness/policy/profile.json'))
  nmProfile.verify = { lint: 'harness' } // 결정 86: npm script 실행은 옵트인
  writeJson(target, '.harness/policy/profile.json', nmProfile)

  let failed = false
  let combined = ''
  try {
    runGuard(target, '--no-cache')
  } catch (error) {
    failed = true
    combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(failed, 'guard must still fail when dependencies are not installed')
  assert(combined.includes('node_modules가 없습니다'), 'failure must name the real cause (dependencies not installed)')
  assert(combined.includes('npm install'), 'failure must tell the next action')
  assert(!combined.includes('command not found'), 'raw tool-not-found error must not be the visible diagnosis')
}

// 기획 문서 연동(0.2.99): 외부 기획 저장소 fetch → lock 기록 → 컨텍스트 주입 → 커밋 advisory.
// 로컬 git 저장소를 기획 저장소로 써서 네트워크 없이 전 흐름을 검증한다.
function makePlanningRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-planning-repo-'))
  run('git', ['init', '--quiet', '--initial-branch', 'master'], { cwd: repo })
  fs.mkdirSync(path.join(repo, 'features'), { recursive: true })
  fs.mkdirSync(path.join(repo, 'archive'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'README.md'), '# 기획 저장소 안내\n')
  // 관련 화면이 있으면 문서가 링크한다. 링크가 없으면 정책만 다루는 문서다(기획자 합의 계약).
  fs.writeFileSync(path.join(repo, 'features/로그인.md'), '# 로그인\n\n사용자가 계정으로 로그인하는 기능의 사양입니다.\n\n화면: [로그인 화면](./로그인.html)\n\n## 확인 기준\n- 올바른 계정이면 첫 화면으로 이동한다.\n')
  fs.writeFileSync(path.join(repo, 'features/로그인.html'), '<h1>로그인 화면</h1>\n<p>아이디·비밀번호 입력 후 로그인 버튼.</p>\n')
  fs.writeFileSync(path.join(repo, 'archive/구버전.md'), '# 폐기된 사양\n')
  gitCommitAll(repo, '기획 초안')
  return repo
}

function setupSpecLinkedTarget() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planning = makePlanningRepo()
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', include: ['**/*.md'], exclude: ['**/README.md', 'archive/**'] }],
  })
  run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'fetch'], { cwd: target })
  return { target, planning }
}

// clone 직후 구멍(0.2.112): 기획 본문은 코드 저장소에 없고, post-merge는 clone에서 돌지 않는다.
// 그 시점에 훅은 설치조차 안 돼 있으니 "아직 안 받은 것"이 "기획서가 없는 것"처럼 보인다.
// 훅 설치가 클론 직후 누구나 거치는 유일한 필수 단계라 거기서 본문을 채운다.
function hooksInstallHydratesSpecBodiesForFreshClone() {
  const { target } = setupSpecLinkedTarget()

  // clone 직후 상태 재현: 기준(lock)은 커밋돼 있지만 생성물은 없다.
  fs.rmSync(path.join(target, '.harness/generated'), { recursive: true, force: true })
  assert(!exists(target, '.harness/generated/spec-cache'), 'fresh clone must start without spec bodies (precondition)')

  const output = run('npm', ['run', '--silent', 'hooks:install'], { cwd: target })

  assert(output.includes('기획 본문 준비'), 'hooks:install should report that it prepares spec bodies')
  assert(exists(target, '.harness/generated/spec-cache'), 'hooks:install must leave the spec bodies ready to read')
}

// 기획 문서를 쓰지 않는 프로젝트에서 훅 설치가 무거워지거나 시끄러워지면 안 된다.
function hooksInstallStaysQuietWithoutSpecLink() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const output = run('npm', ['run', '--silent', 'hooks:install'], { cwd: target })
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

// 개발자가 가장 자연스럽게 쓰는 말이 가장 나쁜 결과를 내면 안 된다.
// "개발"이 유형 키워드에 없어 unknown/low로 떨어졌고, 유형 가점이 죽어 관련 문서가 밀리고
// 엉뚱한 스킬(JIRA 운영 업무 접수)이 올라왔다(2026-08-11 multisite 실측).
function contextClassifiesPlainKoreanDevelopmentRequest() {
  const { target } = setupSpecLinkedTarget()

  const out = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 페이지 개발'], { cwd: target })
  assert(out.includes('detected: feature'), 'plain "개발" must classify as feature, not unknown')
  assert(!out.includes('detected: unknown'), 'the most common Korean phrasing must not fall through to unknown')
  // confidence는 키워드 2개 이상일 때만 medium이다(설계). 여기서 중요한 건 유형이 잡혀
  // taskTypes 가점 경로가 살아나는 것이다.
  assert(out.includes('개발'), 'the reason should name the keyword that matched')
  assert(out.includes('features/로그인.md'), 'the matching spec must still be injected')
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

// ── 기획 문서 연동 2차(0.2.99): 푸시 정산 게이트 ──
// fetch(팀 기준 이동) / --cache-only(캐시만) / --at-lock(수화) / settle(내 몫만 전진)의 분리와,
// push 게이트의 차단·정산·침묵, 연동 정합 검사를 검증한다.

function specTargetProfile(target, patch) {
  const rel = '.harness/policy/profile.json'
  const profile = JSON.parse(read(target, rel))
  writeJson(target, rel, { ...profile, ...patch })
}

function addOriginRemote(target) {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-origin-'))
  run('git', ['init', '--bare', '--quiet', '--initial-branch', 'master'], { cwd: remote })
  run('git', ['remote', 'add', 'origin', remote], { cwd: target })
  return remote
}

function pushWithoutHooks(target) {
  run('git', ['-c', 'core.hooksPath=.git/hooks-disabled', 'push', '--quiet', 'origin', 'HEAD:master'], { cwd: target })
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

function specPushGateBlocksDriftThenPassesAfterSettle() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '# 기획 문서 매핑',
    '',
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
    '',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, 'feature')

  // push되기 전에 기획이 먼저 움직였다 — 게이트가 잡아야 하는 상황.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책이 추가되었다.\n')
  gitCommitAll(planning, '기획 수정')

  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const stdinLine = `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n`
  const gateEnv = { ...process.env, HARNESS_PUSH_STDIN: stdinLine }
  const lockBefore = read(target, '.harness/spec-lock.json')

  let blocked = false
  let combined = ''
  try {
    run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: gateEnv })
  } catch (error) {
    blocked = true
    combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(blocked, 'push gate must block when a mapped spec changed after the baseline')
  assert(combined.includes('push 중단'), 'gate block message should say the push was stopped')
  assert(combined.includes('features/로그인.md'), 'gate block message should name the drifted spec document')
  assert(combined.includes('harness:spec:settle'), 'gate block message should point to the settle command')
  assert(read(target, '.harness/spec-lock.json') === lockBefore, 'a blocked gate must not move the team baseline')

  const settleOut = run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), 'settle'], { cwd: target })
  assert(settleOut.includes('[정산] features/로그인.md'), 'settle should cover the docs mapped to the outgoing commits')

  // 스냅샷 판정: 정산한 lock을 커밋에 넣지 않으면 push tip에는 여전히 옛 기준이라 계속 차단된다.
  let stillBlocked = false
  try {
    run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: gateEnv })
  } catch {
    stillBlocked = true
  }
  assert(stillBlocked, 'settled-but-uncommitted lock must still block: the gate judges the pushed tip, not the worktree')

  gitCommitAll(target, 'settle lock')
  const newLocalSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const committedEnv = { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${newLocalSha} refs/heads/master ${remoteSha}\n` }
  const rerun = run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: committedEnv })
  assert(rerun.includes('기획 정산 통과'), 'gate should pass with a one-line trace once the settled lock is part of the push')
}

function specPushGateStaysSilentWithoutOptIn() {
  // 미연동 프로젝트: 게이트 스크립트가 실행되더라도 완전한 무음이어야 한다.
  const unlinked = makeTarget()
  runInit(unlinked, '--no-scan', '--no-handoff', '--no-check')
  const silent = run(nodeBin, [path.join(unlinked, '.harness/bin/spec-push-gate.mjs'), 'origin', 'https://example.invalid/repo.git'], {
    cwd: unlinked,
    env: { ...process.env, HARNESS_PUSH_STDIN: 'refs/heads/master 1111111111111111111111111111111111111111 refs/heads/master 0000000000000000000000000000000000000000\n' },
  })
  assert(silent.trim() === '', 'unlinked project must see zero gate output')

  // 연동됐지만 기본(advisory) 등급: 기획이 변해도 push에서는 아무것도 하지 않는다.
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  gitCommitAll(target, 'baseline')
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책.\n')
  gitCommitAll(planning, '기획 수정')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, 'feature')

  const out = run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', 'unused'], {
    cwd: target,
    env: { ...process.env, HARNESS_PUSH_STDIN: '' },
  })
  assert(out.trim() === '', 'advisory-grade project must see zero gate output at push')
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

  // 게이트 옵트인 프로젝트에서는 정합 깨짐이 차단이다 — 게이트 판정의 입력이 spec-map이기 때문.
  specTargetProfile(target, { specEnforcement: 'gate' })
  let failed = false
  try {
    run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  } catch (error) {
    failed = true
    const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
    assert(combined.includes('기준(spec-lock)에 없는 기획 문서'), 'blocking run should still print the actionable reason')
  }
  assert(failed, 'gate-grade project must fail the check on spec-map inconsistencies')

  // 구현 경로가 사라진 매핑 — 리팩터링 후 spec-map 미갱신.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/ghost/**` | |',
  ].join('\n'))
  let deadPathFailed = false
  try {
    run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  } catch (error) {
    deadPathFailed = true
    const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
    assert(combined.includes('구현 경로가 저장소에 없습니다'), 'dead implementation path should be named with its fix')
  }
  assert(deadPathFailed, 'gate-grade project must fail on dead implementation paths in spec-map')
}

// ── 기획 문서 연동 0.2.100: lock v2 · 비파괴 fetch · 스냅샷 게이트 정합 ──

// 화면 여부는 문서가 링크로 선언한다 — 링크가 없는 문서는 정책 문서이므로 픽스처를 손대지 않는다.
function makePlanningRepoWithFiles(files) {
  return makePlanningRepoRaw(files)
}

function makePlanningRepoRaw(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-planning-repo-'))
  run('git', ['init', '--quiet', '--initial-branch', 'master'], { cwd: repo })
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), content)
  }
  gitCommitAll(repo, '기획 초안')
  return repo
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
  assert(text.includes('fetch -- --cache-only'), 'the message must hand over the command that creates the record')

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
  assert(status.includes('fetch -- --cache-only'), 'the remote-axis line must hand over the next command')

  // 작업 컨텍스트의 라벨도 원격 축으로 말한다 — "미정산"은 읽은 스냅샷의 축이라 여기에 쓰면
  // status의 "정산 대기 없음"과 정면 모순으로 읽힌다.
  const context = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 기능 수정'], { cwd: target })
  assert(context.includes('기준 이후 원격에서 변경됨 — 확인 전'), 'the context label must speak the remote axis')
  assert(!context.includes('미정산'), 'the context must not borrow the settle-axis word for remote detections')
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

function guideSyncPolicyKeepsBundledGuideLinked() {
  // 클릭형 가이드는 0.2.98→0.2.124 사이 26개 릴리스 동안 갱신 연결고리가 없어 방치됐다(실측).
  // 개발자 대면 표면이 바뀌면 harness:impact가 번들 가이드·대시보드를 지목하는 매핑을 잠근다.
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const registry = JSON.parse(read(target, '.harness/policy/policy-registry.json'))
  const policy = (registry.policies ?? []).find((entry) => entry.id === 'common.documentation.guide-sync')
  assert(policy, 'guide-sync policy must ship — developer-facing surface changes must point at the bundled guide')
  for (const doc of ['.harness/documentation/guide/index.html', '.harness/bin/harness-guide.mjs']) {
    assert(policy.documents.includes(doc), `guide-sync documents must cover: ${doc}`)
    assert(exists(target, doc), `guide surface must ship with init: ${doc}`)
  }
  for (const surface of ['package.json', '.githooks/**', '.harness/skills/registry.json', '.harness/project/spec-authority-workflow.md', '.harness/project/commit-push-rules.md']) {
    assert(policy.ownedAreas.includes(surface), `guide-sync triggers must cover developer-facing surface: ${surface}`)
  }
  assert(policy.syncEnforcement === 'review', 'guide-sync must stay a nudge (review), not a gate')
  // 사람 쪽 절반: 본체 릴리스 체크리스트(시드 전용)가 같은 확인을 지시한다.
  const checklist = read(repoRoot, '.harness/project/body-release-checklist.md')
  assert(checklist.includes('guide/index.html'), 'release checklist must instruct updating the bundled guide')
  assert(checklist.includes('harness-guide.mjs'), 'release checklist must instruct updating the dashboard generator')
}

function specSyncCli(target, cliArgs, options = {}) {
  return run(nodeBin, [path.join(target, '.harness/bin/spec-sync.mjs'), ...cliArgs], { cwd: target, ...options })
}

function expectFailure(fn, label) {
  try {
    fn()
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  throw new Error(label)
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

// 회귀 3: 게이트 판정 입력은 push tip snapshot이다 — 작업 트리의 미커밋 편집(매핑 삭제,
// enforcement 강등)으로 우회할 수 없고, tip에 커밋된 강등은 그대로 존중된다.
function specPushGateJudgesTipSnapshotNotWorktree() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, 'feature')
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책.\n')
  gitCommitAll(planning, '기획 수정')

  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const gateEnv = { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` }

  // 작업 트리에서 매핑을 지우고 enforcement를 강등해도 tip 기준으로 계속 차단된다.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), '# 기획 문서 매핑\n')
  specTargetProfile(target, { specEnforcement: 'advisory' })
  const blockedOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: gateEnv }),
    'uncommitted worktree edits must not bypass the tip-snapshot gate',
  )
  assert(blockedOut.includes('push 중단'), 'tip snapshot judgement should still block')

  // 강등을 커밋하면 새 tip의 enforcement가 advisory라 게이트는 무동작이다.
  gitCommitAll(target, 'enforcement 강등 커밋')
  const downgradedSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const downgradedEnv = { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${downgradedSha} refs/heads/master ${remoteSha}\n` }
  const silent = run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: downgradedEnv })
  assert(silent.trim() === '', 'a committed advisory downgrade at the tip is honored (and audit-visible in history)')
}

// 회귀 9: 새 ref의 변경 범위는 push 대상 원격만 제외하고 계산한다. 다른 원격(양원격 운영의
// 반대쪽)에 이미 있는 commit이라는 이유로 제외하면 게이트가 통째로 우회된다.
function specPushGateScopesNewBranchToTargetRemote() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline')
  const origin = addOriginRemote(target)
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-backup-'))
  run('git', ['init', '--bare', '--quiet', '--initial-branch', 'master'], { cwd: backup })
  run('git', ['remote', 'add', 'backup', backup], { cwd: target })
  pushWithoutHooks(target)
  run('git', ['-c', 'core.hooksPath=.git/hooks-disabled', 'push', '--quiet', 'backup', 'HEAD:master'], { cwd: target })

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, 'feature')
  run('git', ['-c', 'core.hooksPath=.git/hooks-disabled', 'push', '--quiet', 'backup', 'HEAD:master'], { cwd: target })
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책.\n')
  gitCommitAll(planning, '기획 수정')

  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const newBranchLine = `refs/heads/feat ${localSha} refs/heads/feat 0000000000000000000000000000000000000000\n`

  // origin에는 feature commit이 없다 → 범위에 들어와 차단돼야 한다(구현 결함이던 우회 경로).
  const blockedOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', origin], { cwd: target, env: { ...process.env, HARNESS_PUSH_STDIN: newBranchLine } }),
    'commits already on another remote must still be in scope for a new branch push to this remote',
  )
  assert(blockedOut.includes('features/로그인.md'), 'the drifted spec must be reported for the new-branch push')

  // 대조군: backup 원격에는 이미 전부 있으므로 같은 push라도 범위가 0이라 무동작이다.
  const silent = run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'backup', backup], { cwd: target, env: { ...process.env, HARNESS_PUSH_STDIN: newBranchLine } })
  assert(silent.trim() === '', 'scope calculation must be keyed to the push target remote')
}

// 회귀 8 + HEAD≠tip: pre-push 훅이 stdin을 버퍼링해 이전 훅과 게이트에 재전달하고,
// 작업 트리에 lock이 없어도 push tip에 lock이 있으면 게이트를 실행한다.
function specPrePushHookBuffersStdinAndChecksTipLock() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, 'feature')
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 잠금 정책.\n')
  gitCommitAll(planning, '기획 수정')

  // stdin을 전부 소비하는 이전 훅을 연결한다 — 버퍼링이 없으면 게이트가 빈 입력을 받는다.
  fs.mkdirSync(path.join(target, '.git/custom-hooks'), { recursive: true })
  fs.writeFileSync(path.join(target, '.git/custom-hooks/pre-push'), '#!/bin/sh\ncat > /dev/null\nexit 0\n')
  fs.chmodSync(path.join(target, '.git/custom-hooks/pre-push'), 0o755)
  run('git', ['config', 'harness.previousHooksPath', '.git/custom-hooks'], { cwd: target })

  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const line = `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n`

  // 작업 트리 lock을 지워도(구 조건이면 게이트 통째 생략) tip의 lock을 보고 게이트가 실행·차단된다.
  // 작업 트리는 advisory로 강등해 check --fast(작업 트리 기준)는 통과시키고, tip은 gate 그대로다.
  fs.rmSync(path.join(target, '.harness/spec-lock.json'))
  specTargetProfile(target, { specEnforcement: 'advisory' })

  const hookOut = expectFailure(
    () => run('sh', [path.join(target, '.githooks/pre-push'), 'origin', remote], { cwd: target, input: line, env: { ...process.env } }),
    'hook must run the gate from the pushed tip lock even when the worktree lock is missing',
  )
  assert(hookOut.includes('push 중단'), 'gate must receive the buffered stdin and block on tip judgement')
  assert(hookOut.includes('features/로그인.md'), 'blocked reason should name the drifted spec')
}

// 회귀 12 + snapshot 해석 실패: 커밋된 설정 오류는 조용한 advisory 강등 없이 fail-closed다.
function specGateFailsClosedOnConfigErrors() {
  const { target } = setupSpecLinkedTarget()
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  // (1) 알 수 없는 enforcement 값.
  specTargetProfile(target, { specEnforcement: 'strict' })
  gitCommitAll(target, 'invalid enforcement')
  let localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const invalidOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` } }),
    'unknown committed specEnforcement value must fail closed',
  )
  assert(invalidOut.includes('설정 오류'), 'block reason should name the configuration error')

  // (2) push tip의 profile JSON 파싱 실패.
  fs.writeFileSync(path.join(target, '.harness/policy/profile.json'), '{ broken json\n')
  gitCommitAll(target, 'broken profile json')
  localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const brokenOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` } }),
    'unparsable committed profile must fail closed',
  )
  assert(brokenOut.includes('JSON으로 읽히지 않습니다'), 'block reason should name the parse failure')
}

// 회귀 7: 잘못된 source 선언(중복/위험 id)은 조용히 걸러지지 않고 전체 상태를 invalid로 만든다.
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

  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('경로 충돌'), 'path collisions across sources must be surfaced')

  const refuse = expectFailure(() => specSyncCli(target, ['settle', '--doc', 'features/공통.md']), 'settle must refuse ambiguous collision docs')
  assert(refuse.includes('정산을 거부'), 'settle should explain the ambiguity instead of settling both sources')
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
  specTargetProfile(target, { specEnforcement: 'gate' })
  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  // 매핑된 영역(src/views/)에 새 화면이 생겼는데 spec-map 기록이 없다.
  fs.mkdirSync(path.join(target, 'src/views/payment'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/payment/PayView.vue'), '<template><div /></template>\n')

  // 커밋 단계: advisory로 먼저 알려준다(차단은 아님).
  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(advisory.includes('spec-map 기록이 없습니다'), 'commit advisory should surface the missing mapping for a new file in a mapped area')
  assert(advisory.includes('src/views/payment/PayView.vue'), 'advisory should name the uncovered file')

  gitCommitAll(target, 'add payment view')
  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const gateEnv = { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` }

  // push 단계: gate 프로젝트에서는 차단된다.
  const blockedOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: gateEnv }),
    'gate must block a new file in a mapped area with no spec-map record',
  )
  assert(blockedOut.includes('매핑 누락'), 'block reason should name the missing mapping')
  assert(blockedOut.includes('src/views/payment/PayView.vue'), 'block reason should name the uncovered file')
  assert(blockedOut.includes('(사양 없음)'), 'block message should offer the exemption route for code that needs no spec')

  // 매핑을 기록하면 통과한다.
  fs.appendFileSync(path.join(target, '.harness/project/spec-map.md'), '| `features/로그인.md` | `src/views/payment/**` | |\n')
  gitCommitAll(target, 'map payment view')
  const mappedSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const mappedEnv = { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${mappedSha} refs/heads/master ${remoteSha}\n` }
  run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: mappedEnv })
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
  specTargetProfile(target, { specEnforcement: 'gate' })
  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  // (1) 판정된 영역의 새 파일 (2) 매핑 영역 밖의 새 파일 — 둘 다 걸리면 안 된다.
  fs.mkdirSync(path.join(target, 'src/views/shared'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/shared/Spinner.vue'), '<template><div /></template>\n')
  fs.mkdirSync(path.join(target, 'src/utils'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/utils/date.js'), 'export const now = () => Date.now()\n')

  // 커밋 advisory는 잡음 방지를 위해 관리 영역으로 좁힌다 — 영역 밖 파일은 안내하지 않는다.
  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!advisory.includes('Spinner.vue'), 'an exempted path must not be reported as a missing mapping')
  assert(!advisory.includes('src/utils/date.js'), 'commit advisory must not report files outside mapped areas (noise control)')

  // gate는 전수 판정이다(5차 리뷰 P1-1) — 영역 밖 구현 파일도 매핑/판정 없이는 막힌다.
  gitCommitAll(target, 'add exempt and unrelated files')
  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const gateEnv = { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` }
  const blocked = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env: gateEnv }),
    'gate must block an implementation file outside mapped areas until it is judged',
  )
  assert(blocked.includes('src/utils/date.js'), 'the unjudged file should be named')
  assert(!blocked.includes('Spinner.vue'), 'the exempted path must still pass in gate mode')

  // (사양 없음) 판정을 남기면 통과한다 — 전수 판정의 잡음 밸브.
  fs.appendFileSync(path.join(target, '.harness/project/spec-map.md'), '\n| (사양 없음) | `src/utils/**` | 유틸 — 기획 대상 아님 |\n')
  gitCommitAll(target, 'judge utils')
  const judgedSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const out = run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
    cwd: target,
    env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${judgedSha} refs/heads/master ${remoteSha}\n` },
  })
  assert(!out.includes('매핑 누락'), 'gate must pass once every implementation file is mapped or judged')
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
  assert(out.includes('정산을 거부'), 'the refusal should name the ambiguity')

  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  const inAlpha = 'features/공통.md' in lock.sources.alpha.files
  const inBeta = 'features/공통.md' in lock.sources.beta.files
  assert(!(inAlpha && inBeta), 'the tool must not create the collision state it forbids')
}

// P2-5: 매핑 표를 지우는 커밋 하나로 게이트가 조용히 꺼지면 안 된다.
function specGateBlocksWhenSpecMapMissingAtTip() {
  const { target } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  // 커밋 검증도 매핑 표 삭제를 잡아야 한다(연동 중인 프로젝트에서는 선택 사항이 아니다).
  fs.rmSync(path.join(target, '.harness/project/spec-map.md'))
  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('spec-map.md'), 'deleting the mapping table in a linked project must be reported')

  gitCommitAll(target, 'remove spec-map')
  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const blocked = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` },
    }),
    'removing spec-map.md must not silently disable the gate',
  )
  assert(blocked.includes('spec-map.md'), 'the block reason should name the missing mapping table')
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
  // 커밋 검증은 손상을 반드시 알린다(advisory에서는 안내, gate에서는 차단 — 기존 사다리 그대로).
  const docLink = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(docLink.includes('spec-sources.json을 해석할 수 없습니다'), 'doc-link should name the corrupted file')
  const profilePath = path.join(target, '.harness/policy/profile.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  fs.writeFileSync(profilePath, `${JSON.stringify({ ...profile, specEnforcement: 'gate' }, null, 2)}\n`)
  const gated = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target }),
    'a gate project must fail closed while the declaration is unreadable',
  )
  assert(gated.includes('spec-sources.json을 해석할 수 없습니다'), 'the gated failure should name the corrupted file')
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
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

// 게이트 우회 실증: 매핑된 문서 항목만 망가뜨린 tip은 push가 통과하면 안 된다.
function specGateBlocksSchemaCorruptedLockAtTip() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  const profilePath = path.join(target, '.harness/policy/profile.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  fs.writeFileSync(profilePath, `${JSON.stringify({ ...profile, specEnforcement: 'gate' }, null, 2)}\n`)

  // 기획이 앞서 나간 상태(정상이면 drift로 차단되는 상황)를 만든다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 확인되지 않은 변경.\n')
  gitCommitAll(planning, '기획 개정')

  // 매핑된 문서 항목만 형태를 망가뜨린다 → 종전에는 lockedDoc이 사라져 drift 검사를 건너뛰었다.
  const lockPath = path.join(target, '.harness/spec-lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  lock.sources.planning.files['features/로그인.md'] = { sha: 123 }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, '로그인 구현')

  const out = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin'], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()} refs/heads/master 0000000000000000000000000000000000000000\n` },
    }),
    'a schema-corrupted lock at the push tip must not silently disable drift checks',
  )
  assert(out.includes('기준 기록 손상'), 'the gate should name the corrupted lock instead of passing')
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

// 대표 MD 한 줄만 매핑해도, 링크된 화면의 변경이 push 게이트에 걸린다.
function specScreenLinkDriftBlocksPushViaRepresentativeMapping() {
  const { target, planning } = setupSpecLinkedTarget()

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  const profilePath = path.join(target, '.harness/policy/profile.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  fs.writeFileSync(profilePath, `${JSON.stringify({ ...profile, specEnforcement: 'gate' }, null, 2)}\n`)

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, '로그인 구현')

  // 화면만 바뀐다 — 매핑 표에는 MD만 있다.
  fs.writeFileSync(path.join(planning, 'features/로그인.html'), '<h1>로그인 화면 v2</h1>\n')
  gitCommitAll(planning, '화면 개정')

  const out = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin'], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()} refs/heads/master 0000000000000000000000000000000000000000\n` },
    }),
    'a screen-only drift must block the push even when only the document is mapped',
  )
  assert(out.includes('features/로그인.html'), 'the gate should name the drifted screen')
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

// ── 4차 리뷰 P1-3: 정상 JSON/정상 표를 유지한 채 매핑·기준을 비워 게이트를 끌 수 없다 ──
function specGateBlocksSelfDisablingMapAndLock() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  const profilePath = path.join(target, '.harness/policy/profile.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  fs.writeFileSync(profilePath, `${JSON.stringify({ ...profile, specEnforcement: 'gate' }, null, 2)}\n`)
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()

  // 기획이 앞서 나간다 — 정상이라면 drift로 차단되는 상황.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 확인되지 않은 변경.\n')
  gitCommitAll(planning, '기획 개정')

  const gate = (sha) => expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${sha} refs/heads/master ${remoteSha}\n` },
    }),
    'a self-disabling tip must not pass the gate',
  )

  // (a) 매핑 행만 비운다(파일은 그대로) → 종전에는 scope가 0이 되어 통과했다.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
  ].join('\n'))
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => null\n')
  gitCommitAll(target, '매핑 제거 + 코드 변경')
  let out = gate(run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim())
  assert(out.includes('매핑 제거'), 'emptying the mapping table must be reported')
  assert(out.includes('features/로그인.md'), 'the base mapping must still define the scope in that push')
  run('git', ['reset', '--hard', 'HEAD~1'], { cwd: target })

  // (b) lock의 문서 항목만 뺀다(schema는 정상) → 종전에는 lockedDoc이 없어 검사를 건너뛰었다.
  const lock = JSON.parse(read(target, '.harness/spec-lock.json'))
  delete lock.sources.planning.files['features/로그인.md']
  delete lock.sources.planning.files['features/로그인.html']
  writeJson(target, '.harness/spec-lock.json', lock)
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => false\n')
  gitCommitAll(target, 'lock 항목 제거 + 코드 변경')
  out = gate(run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim())
  assert(out.includes('기준 누락'), 'removing a mapped doc from the lock must be reported')
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
  // init이 훅을 설치하지 않았을 수도 있다(--no-check 경로) — 없으면 그대로 미설치 상태다.
  try {
    run('git', ['config', '--unset', 'core.hooksPath'], { cwd: target })
  } catch {
    // 설정 자체가 없음
  }

  const out = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(out.includes('git hook 미설치'), 'a clone without hooks must be told')
  assert(out.includes('npm run hooks:install'), 'the install command must be shown')
  assert(!out.includes('harness:hooks:install'), 'the command must be the one that actually exists')

  run('git', ['config', 'core.hooksPath', '.githooks'], { cwd: target })
  const after = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!after.includes('git hook 미설치'), 'an installed clone must not be nagged')
}

// ── 자체 검토: self-disable 차단이 정규 흐름을 막으면 안 된다 ──
// 기획 폐기 → settle(삭제 정산) → spec-map 행 정리는 정상 절차다. 이걸 "매핑 제거"로 막으면
// 개발자는 정리할 방법이 없어진다. 살아 있는 사양의 매핑을 지우는 것만 막아야 한다.
function specGateAllowsMapCleanupForDeletedSpec() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const planning = makePlanningRepoRaw({ 'policies/공통.md': '# 공통\n', 'policies/폐기.md': '# 폐기 예정\n' })
  writeJson(target, '.harness/spec-sources.json', {
    version: 1,
    sources: [{ id: 'planning', repo: planning, ref: 'master', exclude: [] }],
  })
  specSyncCli(target, ['fetch'])

  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `policies/공통.md` | `src/common/**` | |',
    '| `policies/폐기.md` | `src/old/**` | |',
  ].join('\n'))
  const profilePath = path.join(target, '.harness/policy/profile.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  fs.writeFileSync(profilePath, `${JSON.stringify({ ...profile, specEnforcement: 'gate' }, null, 2)}\n`)
  fs.mkdirSync(path.join(target, 'src/common'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/common/util.js'), 'export const a = 1\n')
  fs.mkdirSync(path.join(target, 'src/old'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/old/legacy.js'), 'export const b = 1\n')
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()

  // 기획에서 폐기되고, 개발자가 삭제를 정산한다 → 기준에서 사라진다.
  fs.rmSync(path.join(planning, 'policies/폐기.md'))
  gitCommitAll(planning, '문서 폐기')
  specSyncCli(target, ['fetch', '--cache-only'])
  specSyncCli(target, ['settle', '--doc', 'policies/폐기.md'])
  assert(!('policies/폐기.md' in JSON.parse(read(target, '.harness/spec-lock.json')).sources.planning.files),
    'fixture: the deleted spec must be settled out of the baseline')

  // 이제 매핑 행을 정리한다 — 정상 절차이므로 push가 막히면 안 된다.
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `policies/공통.md` | `src/common/**` | |',
  ].join('\n'))
  gitCommitAll(target, '폐기 문서 매핑 정리')
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
    cwd: target,
    env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${sha} refs/heads/master ${remoteSha}\n` },
  })
}

// 새 브랜치로 push해도 base 매핑 방어가 살아 있어야 한다(새 ref라고 base를 비우면 우회가 된다).
function specGateResolvesBaseForNewBranch() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/**` | |',
  ].join('\n'))
  const profilePath = path.join(target, '.harness/policy/profile.json')
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
  fs.writeFileSync(profilePath, `${JSON.stringify({ ...profile, specEnforcement: 'gate' }, null, 2)}\n`)
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => {}\n')
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 확인되지 않은 변경.\n')
  gitCommitAll(planning, '기획 개정')

  // 새 브랜치에서 매핑을 지우고 코드도 바꾼다 — 종전에는 base가 비어 통과했다.
  run('git', ['checkout', '--quiet', '-b', 'feature/x'], { cwd: target })
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
  ].join('\n'))
  fs.writeFileSync(path.join(target, 'src/login.js'), 'export const login = () => null\n')
  gitCommitAll(target, '매핑 제거 + 코드 변경')
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()

  const out = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/feature/x ${sha} refs/heads/feature/x 0000000000000000000000000000000000000000\n` },
    }),
    'a new branch that empties the mapping must not bypass the union defence',
  )
  assert(out.includes('매핑 제거') || out.includes('features/로그인.md'), 'the base mapping must still apply on a new branch')
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

// ── 5차 리뷰 P1-1: gate에서 매핑 0건 + 첫 구현 코드는 판정 없이 통과하면 안 된다 ──
// 커버리지가 "이미 매핑된 영역" 기준이라 매핑 0건이면 검사 자체가 없었다 — 연동+gate+훅까지
// 다 갖춰도 첫 기능 코드가 매핑 없이 push됐다.
function specGateBlocksFirstImplementationWithoutMapping() {
  const { target } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline (매핑 0건)')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()

  // 첫 구현 코드 — 매핑도 판정도 없이 push 시도.
  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, '첫 기능 구현')
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()

  const out = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${sha} refs/heads/master ${remoteSha}\n` },
    }),
    'the first implementation file must not pass the gate without a mapping or judgment',
  )
  assert(out.includes('src/views/login/LoginView.vue'), 'the unjudged implementation file should be named')
  assert(out.includes('매핑 누락'), 'the reason should be the missing mapping/judgment')

  // 매핑을 남기면 통과한다.
  fs.appendFileSync(path.join(target, '.harness/project/spec-map.md'), '\n| `features/로그인.md` | `src/views/login/**` | |\n')
  gitCommitAll(target, '매핑 기록')
  const mappedSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
    cwd: target,
    env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${mappedSha} refs/heads/master ${remoteSha}\n` },
  })
}

// ── 5차 리뷰 P1-2: 같은 spec의 구현 경로 축소로 drift 검사를 우회할 수 없다 ──
function specGateBlocksCodePathShrinkBypass() {
  const { target, planning } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/pay/**` | |',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  fs.mkdirSync(path.join(target, 'src/pay'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/pay/PayView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()

  // 기획이 앞서 나간 상태에서, 행은 남기고 구현 경로만 갈아끼운 채 옛 경로의 코드를 수정한다.
  fs.appendFileSync(path.join(planning, 'features/로그인.md'), '\n- 확인되지 않은 변경.\n')
  gitCommitAll(planning, '기획 개정')
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/new-pay/**` | |',
  ].join('\n'))
  fs.mkdirSync(path.join(target, 'src/new-pay'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/new-pay/PayView.vue'), '<template><div /></template>\n')
  fs.writeFileSync(path.join(target, 'src/pay/PayView.vue'), '<template><span /></template>\n')
  gitCommitAll(target, '경로 축소 + 옛 경로 코드 변경')
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()

  const out = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${sha} refs/heads/master ${remoteSha}\n` },
    }),
    'shrinking a codePath while its code is alive must not bypass the gate',
  )
  assert(out.includes('매핑 축소') || out.includes('기획서 변경'), 'the shrink or the drift must be named')
  assert(out.includes('src/pay/**') || out.includes('features/로그인.md'), 'the affected path or spec should be named')
}

// 정상 정리 흐름은 막지 않는다: 코드가 실제로 이전·삭제됐거나 (사양 없음) 판정으로 넘어간 경우.
function specGateAllowsLegitimateCodePathCleanup() {
  const { target } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/pay/**` | |',
  ].join('\n'))
  specTargetProfile(target, { specEnforcement: 'gate' })
  fs.mkdirSync(path.join(target, 'src/pay'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/pay/PayView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()

  // (a) 코드를 실제로 이전: 옛 경로 파일 삭제 + 새 경로로 이동 + 매핑 갱신 → 통과.
  run('git', ['mv', 'src/pay/PayView.vue', 'src/pay-legacy-view.vue'], { cwd: target, stdio: ['ignore', 'pipe', 'pipe'] })
  fs.rmSync(path.join(target, 'src/pay-legacy-view.vue'))
  fs.mkdirSync(path.join(target, 'src/new-pay'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/new-pay/PayView.vue'), '<template><div /></template>\n')
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/new-pay/**` | 코드 이전 |',
  ].join('\n'))
  gitCommitAll(target, '코드 이전 + 매핑 갱신')
  const movedSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const movedOut = run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
    cwd: target,
    env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${movedSha} refs/heads/master ${remoteSha}\n` },
  })
  assert(!movedOut.includes('매핑 축소'), 'a genuine code move must not be reported as a mapping shrink')

  // (b) 살아 있는 코드를 (사양 없음) 판정으로 넘기는 것도 정상 — 판정이 그 코드를 받는다.
  run('git', ['reset', '--hard', 'origin/master'], { cwd: target, stdio: ['ignore', 'pipe', 'pipe'] })
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| (사양 없음) | `src/pay/**` | 기획 대상에서 제외 판정 |',
  ].join('\n'))
  gitCommitAll(target, '판정 전환')
  const judgedSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const judgedOut = run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
    cwd: target,
    env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${judgedSha} refs/heads/master ${remoteSha}\n` },
  })
  assert(!judgedOut.includes('매핑 축소') && !judgedOut.includes('매핑 제거'), 'moving live code under an explicit judgment must pass')
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

// 재리뷰 P1-5: 작업 트리만 정상으로 만들고 불일치 tip을 push하는 경로를 막는다.
function specPushGateChecksDeclarationConsistencyAtTip() {
  const { target } = setupSpecLinkedTarget()
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  // tip에는 선언 ref를 바꿔 커밋하고(기준과 불일치), push 범위에는 매핑 코드가 없다.
  const sources = JSON.parse(read(target, '.harness/spec-sources.json'))
  sources.sources[0].ref = 'develop'
  writeJson(target, '.harness/spec-sources.json', sources)
  gitCommitAll(target, 'switch planning branch declaration')
  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()

  // 작업 트리는 다시 정상으로 되돌려 커밋 검증을 통과시킨다(우회 시도 재현).
  sources.sources[0].ref = 'master'
  writeJson(target, '.harness/spec-sources.json', sources)

  const blocked = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
      cwd: target,
      env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` },
    }),
    'a declaration/lock mismatch in the pushed tip must block even when the worktree looks clean',
  )
  assert(blocked.includes('연동 설정 불일치'), 'block reason should name the tip-level declaration mismatch')
}

// 프로젝트 소유 문서를 지워도 본체 레지스트리 때문에 매 커밋 경고가 뜨면 안 된다(0.2.102).
// 지울 권리가 있는 파일을 필수처럼 다루는 모순이라, 실제 소비자 업그레이드에서 노이즈로 관측됐다.
function docLinkTreatsDeletedProjectOwnedDocsAsOptional() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  fs.rmSync(path.join(target, '.harness/project/spec-map.md'), { force: true })
  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!out.includes('spec-map.md'), 'a deleted project-owned doc must not be reported as missing or as a broken link')
  assert(out.includes('OK'), 'the check should pass cleanly after a project-owned doc is deleted')

  // 본체 managed 문서는 여전히 없으면 잡아야 한다(면제가 과하게 넓어지지 않았는지).
  fs.rmSync(path.join(target, '.harness/project/portability-guide.md'), { force: true })
  const strictOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(strictOut.includes('portability-guide.md'), 'a deleted managed doc must still be reported')
}

// harnessMode 값 검증(0.2.102): 종전에는 'strict' 문자열 비교뿐이라 오타가 조용히 비-strict로
// 동작했다 — "차단을 켰다고 믿는데 꺼져 있는" 상태. 알 수 없는 값은 필수 조치로 표면화한다.
function guardFlagsInvalidHarnessModeInsteadOfSilentlyDowngrading() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const rel = '.harness/policy/profile.json'
  const profile = JSON.parse(read(target, rel))

  // (1) 값 오류 — fail-closed. 통과시키면 "strict를 켰다고 믿는데 꺼져 있는" 상태가 유지된다.
  writeJson(target, rel, { ...profile, harnessMode: 'strct' })
  const invalidOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target }),
    'invalid harnessMode must fail the check (fail-closed), not just print a note',
  )
  assert(invalidOut.includes('harnessMode 값이 유효하지 않습니다'), 'invalid harnessMode must be surfaced')
  assert(invalidOut.includes('strct'), 'the offending value should be echoed so the typo is obvious')
  assert(invalidOut.includes('차단이 켜지지 않은 상태'), 'the message should warn that strict blocking is not active')

  expectFailure(() => runGuard(target, '--no-cache'), 'harness:check must fail while harnessMode is invalid')

  // (2) JSON 자체가 깨진 경우도 "설정 없음"으로 통과시키지 않는다.
  fs.writeFileSync(path.join(target, rel), '{ broken json\n')
  const malformedOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target }),
    'malformed profile JSON must fail the check',
  )
  assert(malformedOut.includes('JSON으로 읽지 못했습니다'), 'malformed profile must be distinguished from a missing field')

  // (3) 유효 값이면 기존 동작 그대로.
  writeJson(target, rel, { ...profile, harnessMode: 'active' })
  const fixed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!fixed.includes('유효하지 않습니다'), 'a valid harnessMode must not produce the warning')
  assert(fixed.includes('Harness mode: active'), 'valid mode should be reported as-is')

  // (4) 필드가 아예 없으면 bootstrap으로 계약대로 동작한다.
  const withoutMode = { ...profile }
  delete withoutMode.harnessMode
  writeJson(target, rel, withoutMode)
  const defaulted = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(defaulted.includes('Harness mode: bootstrap'), 'a missing harnessMode field defaults to bootstrap')
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
  specTargetProfile(target, { specEnforcement: 'gate' })
  gitCommitAll(target, 'baseline')
  const remote = addOriginRemote(target)
  pushWithoutHooks(target)

  // 신규 파일이 아니라 "기존 미매핑 파일 수정"이다.
  fs.appendFileSync(path.join(target, 'src/views/legacy/OldView.vue'), '<!-- 수정 -->\n')

  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(advisory.includes('src/views/legacy/OldView.vue'), 'modifying an unmapped existing file in a managed area must be surfaced')

  gitCommitAll(target, 'touch legacy view')
  const localSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  const remoteSha = run('git', ['rev-parse', 'origin/master'], { cwd: target }).trim()
  const env = { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${localSha} refs/heads/master ${remoteSha}\n` }
  const blocked = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], { cwd: target, env }),
    'gate must block a modified unmapped file in a managed area',
  )
  assert(blocked.includes('매핑 누락'), 'block reason should name the missing mapping')

  // (사양 없음) 판정을 남기면 통과한다.
  fs.appendFileSync(path.join(target, '.harness/project/spec-map.md'), '\n| (사양 없음) | `src/views/legacy/**` | 폐기 예정 화면 — 기획 대상 아님 |\n')
  gitCommitAll(target, 'declare legacy as out of scope')
  const settledSha = run('git', ['rev-parse', 'HEAD'], { cwd: target }).trim()
  run(nodeBin, [path.join(target, '.harness/bin/spec-push-gate.mjs'), 'origin', remote], {
    cwd: target,
    env: { ...process.env, HARNESS_PUSH_STDIN: `refs/heads/master ${settledSha} refs/heads/master ${remoteSha}\n` },
  })
}

// P1-8(0.2.102 리뷰): 소유(project-owned)와 선택성(optional)은 다른 속성이다.
// project-owned 전부를 optional로 보면 profile/settings 삭제까지 조용해진다.
function docLinkKeepsRequiredProjectOwnedDocsMandatory() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // spec 연동을 쓰지 않으면 없어도 되는 파일 → 허용.
  fs.rmSync(path.join(target, '.harness/project/spec-map.md'), { force: true })
  const optionalOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(optionalOut.includes('OK'), 'an optional project-owned doc may be absent')

  // project-owned이지만 구조적으로 중요한 문서는 계속 필수.
  fs.rmSync(path.join(target, '.harness/project/config-contract.md'), { force: true })
  const requiredOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(requiredOut.includes('config-contract.md'), 'a required project-owned doc must still be reported when deleted')
}

// 레지스트리 회귀 게이트 편입(0.2.96): test:standards-registry / test:template-registry가
// test-init(=pre-commit 게이트) 밖에 있어, 레지스트리 ref 범프로 픽스처가 깨져도 훅이 통과했다
// (2026-08-05 실증 — 파이프에 가린 수동 실행 실패가 그대로 커밋됨). 게이트 안으로 옮긴다.
function approvedRegistryListingsStayConsistent() {
  run(nodeBin, [path.join(repoRoot, 'scripts/test-standards-registry.mjs')])
  run(nodeBin, [path.join(repoRoot, 'scripts/test-template-registry.mjs')])
}

const tests = [
  cleanInstallCreatesExpectedFiles,
  installOutputUsesConditionalNvmAndGitGuidance,
  hooksInstallFailsClearlyOutsideGit,
  nonNodeInstallSkipsPackageJson,
  optInCreatesPackageJsonForGreenfieldNode,
  launcherRunsHarnessWithoutNpm,
  gitHooksRunWithoutNpm,
  sessionOnlyCommitSkipsHeavyCheck,
  stackVerifyRunsRawCommandsWithoutNpm,
  initPatchesEslintConfigForHarnessFiles,
  initAddsHarnessBackupIgnoreWhenNodeOverrideExists,
  reinstallPreservesProjectOwnedFiles,
  reinstallMigratesUnchangedSeedSessionStateToConsumerTemplates,
  reinstallPreservesEditedConsumerSessionState,
  reinstallMigratesManagedRootScriptsIntoHarnessBin,
  forceOverwritesProjectOwnedFiles,
  forceRequiresOverwriteConfirmation,
  dryRunDoesNotWriteFiles,
  noBackupRequiresForce,
  lowProjectNvmrcInstallsInDualRuntimeMode,
  lowProjectNvmrcWithoutNvmStopsInit,
  projectNodeFlagWritesNvmrcWithUserConfirmation,
  missingNvmrcWithLowNodeSignalRequiresInterview,
  enginesFloorDoesNotForceProjectNodeInterview,
  backendWithoutNvmrcSkipsProjectNodeInterview,
  dualNodeShSwitchesHarnessNodeWhenActiveNodeIsLow,
  dualNodeHelpersAreArgSafeUnderSetU,
  dualNodeDoesNotExportDotWhenNodeIsShellFunction,
  guardRejectsHookNodeMismatchingNvmrc,
  guardRunsStackVerifyOnProjectNode,
  existingProjectNvmrcIsPreserved,
  externalHarnessWithoutManifestIsPreserved,
  scanReportSuggestsBridgeCandidates,
  stackApplyMaterializesPresetAsLocalRules,
  stackApplySupportsExternalPresetPath,
  harnessOutdatedDetectsBaseAndStackUpdates,
  sourceMetadataNormalizesSemverSourceRef,
  baseOnlyUpdateDryRunPassesSourceMetadata,
  stackApplySupportsExternalPresetGit,
  stackApplySupportsRulesOnlyPreset,
  templateApplyCreatesBridgeWithoutReplacingActiveStack,
  templateApplyCreatesProjectNvmrcWhenMissing,
  templateApplyStopsWhenRequiredStackDoesNotMatch,
  scanReportSuggestsStylePresetsWhenStyleSourceMissing,
  scanReportDraftsStyleRulesFromConfigFiles,
  workflowWorkstreamChangeDoesNotTriggerCommitPushHookPolicy,
  harnessBaselineDocUpdateDoesNotTriggerSyncGap,
  guardDerivesAppliedStackFromTrackedSnapshotWhenMarkerMissing,
  npmVerifyStagesRequireOptIn,
  guardFailsWhenActiveStackHasNoTrackedSnapshot,
  updateRecordsAndReplaysChangelogDelta,
  existingClaudeSettingsGetsHarnessHooksMerged,
  reinstallPreservesLocallyEditedManagedHarnessFile,
  initExcludesHarnessFromEveryLintSurface,
  harnessCheckReportsManagedFileDrift,
  managedDriftIgnoresMarkerHybridFiles,
  resyncManagedRestoresHarnessFilesButNotProjectOwned,
  consumerGitignoreCoversAllGeneratedSessionArtifacts,
  forceConfirmOverwritesLocallyEditedManagedHarnessFileWithBackup,
  forceAloneStopsWhenManagedHarnessFileWasLocallyEdited,
  newInstallWritesMarkerAndRegionSha,
  markerMergePreservesConsumerAreaAndUpdatesManagedBlock,
  markerMergeRestoresTamperedManagedBlockWithSidecar,
  autoMigrateUnmodifiedLegacyFileToMarkerVersion,
  preserveModifiedLegacyFileWithoutMarkerAndAdvise,
  markerMergeIsIdempotent,
  isIgnorableCodePathClassifiesExamplesAndCiPaths,
  consumerDocLinkCheckIgnoresCiExamplePaths,
  consumerInstallExcludesSeedOnlyDocs,
  consumerInstallExcludesSessionHistoryLogs,
  updateRemovesSeedDistributedHistoryLogWhenUnmodified,
  updatePreservesConsumerOwnedHistoryLog,
  consumerDocLinkCheckHandlesAbsentSeedOnlyDoc,
  reinstallRemovesPreexistingSeedOnlyDocWhenUnmodified,
  reinstallPreservesModifiedSeedOnlyDoc,
  seedModeTargetKeepsSeedOnlyDocs,
  guardCacheHitSkipsRevalidationOnSameTree,
  guardFullCacheSatisfiesFastRequest,
  guardNoCacheForcesRevalidation,
  guardCacheMissAfterTreeChange,
  buildContextMergesProfileAlwaysSources,
  scanValidatesDeclaredProjectSources,
  installReportsExistingAiRuleDocuments,
  scanReportsHeadingOnlyAiRuleDocuments,
  scanReportsIgnoredAiRuleCandidates,
  scanPrefersTrackedAiRuleForRegistrationExample,
  profileProjectSourcesDoNotTriggerInstallSyncGap,
  historyLogPathClassifiesDecisionLogFamily,
  consumerDocLinkCheckSkipsDecisionLogHistoryPaths,
  consumerDocLinkCheckStillFlagsLiveDocDeadPaths,
  docLinkCheckPrintsSingleLineWhenClean,
  guardModeDefaultsToSummaryImpactOutput,
  guardSummaryStillDetailsMustActSyncCandidates,
  guardEscalatesSyncCandidatesOnReversalCommit,
  guardDoesNotEscalateProseWithoutBannerEmoji,
  guardNoticesLogOnlyReversalCommit,
  guardLintsOverrideEntryRebuttalField,
  guardNudgesDecisionLogArchiveWhenOversizedAndTouched,
  promotionReminderAsksExecutableGuardBranch,
  guardExplainsMissingNodeModulesInsteadOfRawToolError,
  hooksInstallHydratesSpecBodiesForFreshClone,
  hooksInstallStaysQuietWithoutSpecLink,
  specSyncFetchRecordsLockAndDetectsChanges,
  broadcastSpeaksMixedAudienceLanguage,
  broadcastDistinguishesJudgedDocsFromUnmapped,
  broadcastWithoutCheckRecordAsksForFetchFirst,
  specStatusSeparatesAxesAndFoldsDetectedCount,
  ciBackstopExampleDelegatesToBroadcast,
  ciBackstopLeaderChecklistCoversLiveSetup,
  releaseNoticeBuildsPayloadFromLatestChangelogSection,
  ciReleaseNoticeYamlParsesAndDelegates,
  newProjectChecklistShipsWithPointers,
  issueAdapterExampleShipsAsSwitchContract,
  specSyncPublicSurfaceStaysLocked,
  guideSyncPolicyKeepsBundledGuideLinked,
  buildContextInjectsRelatedSpecs,
  contextClassifiesPlainKoreanDevelopmentRequest,
  guardShowsSpecAdvisoryForMappedCodeChange,
  specFetchCacheOnlyDoesNotMoveTeamBaseline,
  specFetchAtLockRehydratesCacheAtBaseline,
  specSettleAdvancesOnlyMyScopedDocs,
  specPushGateBlocksDriftThenPassesAfterSettle,
  specPushGateStaysSilentWithoutOptIn,
  specLinkConsistencyCheckFlagsBrokenDeclarations,
  specAtLockRestoresExactMixedBaselineSet,
  specMoveBaselineSourceScopeKeepsOtherSourcesIntact,
  specV1LockReadPathsArePureAndMutatingCommandsPromote,
  specPushGateJudgesTipSnapshotNotWorktree,
  specPushGateScopesNewBranchToTargetRemote,
  specPrePushHookBuffersStdinAndChecksTipLock,
  specGateFailsClosedOnConfigErrors,
  specSourceValidationInvalidatesWholeState,
  specFetchReclonesWhenRepoUrlChanges,
  specSelectorChangeIsFlaggedByConsistency,
  specUninstallRemovesSpecScripts,
  specStatusDoesNotClaimSyncWhenCacheMissing,
  specSettleRefusesPathCollisionsAcrossSources,
  specMappingCoverageIsEnforcedForNewFilesInMappedAreas,
  specMappingCoverageRespectsExemptionsAndScope,
  specCacheHydratesAutomaticallyAndFailsHarmlessly,
  specHydrationDetectsPerDocumentDrift,
  specContextSurfacesChangedAndNewPlanningDocs,
  specSettleRecordsReviewedSnapshotNotLatest,
  specSettleNeverMovesBaselineBackwards,
  specStaleDeleteSnapshotDoesNotRemoveLiveDoc,
  specColdCacheCheckDoesNotLeakLatestIntoBaseline,
  specSettleRefusesNewCollisionAcrossSources,
  specGateBlocksWhenSpecMapMissingAtTip,
  specFailedFreshnessIsNotReplayedAsSuccess,
  specSettleRefusesUnreviewedDocuments,
  specHydrationRefusesSymlinkEscape,
  specCorruptedLockSchemaFailsClosed,
  specGateBlocksSchemaCorruptedLockAtTip,
  specSettleRefusesRollbackToRealPastCommit,
  specSettleRefusesSnapshotCommitMismatch,
  specSettleRefusesSwappedCacheOrigin,
  specSettleRefusesWhenDeclarationDrifted,
  specLockOnlyAndGlobalFailureAreSurfaced,
  specLargeScreenFileEntersBaseline,
  specGateBlocksFirstImplementationWithoutMapping,
  specGateBlocksCodePathShrinkBypass,
  specGateAllowsLegitimateCodePathCleanup,
  specStatusGuidesMappingAtStart,
  specStatusFlagsDocScreenBaselineMismatch,
  specGateAllowsMapCleanupForDeletedSpec,
  specGateResolvesBaseForNewBranch,
  specLatestPruneKeepsRecordAndFilesInSync,
  specSettleRefusesRevivingDeletedDocFromPast,
  specGateBlocksSelfDisablingMapAndLock,
  specUnlinkedScreenIsSurfacedRegardlessOfInclude,
  specGuardNoticesMissingHookInstall,
  specScreenLinkIntegrityIsEnforced,
  specScreenLinkSettlesAtomically,
  specScreenLinkDriftBlocksPushViaRepresentativeMapping,
  specSettleRefusesForgedSnapshotBody,
  specSettleRefusesForgedDeletion,
  specSettleRefusesSnapshotFromAnotherRepo,
  specStorageRootSymlinkIsRefused,
  specContextRefusesSymlinkedSpecBody,
  specCorruptedStateFilesFailClosed,
  specLatestDirectoryIsExactSnapshotSet,
  specFreshnessFailureIsNotMaskedByPastSuccess,
  specContextRefusesUnverifiedBodies,
  specContextSurfacesOpaquelyNamedDocs,
  specPushGateChecksDeclarationConsistencyAtTip,
  docLinkTreatsDeletedProjectOwnedDocsAsOptional,
  docLinkKeepsRequiredProjectOwnedDocsMandatory,
  specMappingCoverageDetectsModifiedExistingFiles,
  guardFlagsInvalidHarnessModeInsteadOfSilentlyDowngrading,
  approvedRegistryListingsStayConsistent,
]

// 인자를 주면 이름에 그 문자열을 포함한 테스트만 돌린다(개발 반복용). 게이트(pre-commit)는 무인자 전체 실행.
const nameFilter = process.argv[2]
const selectedTests = nameFilter ? tests.filter((test) => test.name.includes(nameFilter)) : tests

console.log(nameFilter ? `Init smoke tests (filter: ${nameFilter}, ${selectedTests.length}/${tests.length})` : 'Init smoke tests')

for (const test of selectedTests) {
  test()
  console.log(`  OK ${test.name}`)
}
