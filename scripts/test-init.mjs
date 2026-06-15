#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..')
const nodeBin = process.execPath
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const packageRef = `v${packageVersion}`

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    env: options.env,
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

function runInit(target, ...args) {
  return run(nodeBin, [path.join(repoRoot, 'scripts/init.mjs'), 'init', ...args], { cwd: target })
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

  const claudeInstructions = read(target, 'CLAUDE.md')
  assert(claudeInstructions.includes('하네스 자동 인식 의무'), 'CLAUDE.md should require automatic harness detection')
  assert(claudeInstructions.includes('사용자가 "하네스"를 언급하지 않아도'), 'CLAUDE.md should not depend on explicit harness mention')
  assert(claudeInstructions.includes('사용자가 `커밋` 또는 `커밋하고 푸시`를 요청했고 git hook이 설치되어 있으면 별도 선행 `harness:check`를 돌리지 않고'), 'CLAUDE.md should avoid duplicate manual check before hooked commit')

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
  run('sh', [path.join(target, '.githooks/pre-commit')], { cwd: target })
  run('sh', [path.join(target, '.githooks/pre-push')], { cwd: target })
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

  assert(output.includes('eslint config: eslint.config.js .harness-backup ignore, Node scripts override 추가'), 'init should report eslint harness config patch')
  assert(config.includes("'**/.harness-backup/**'"), 'init should add harness backup ignore')
  assert(config.includes("files: ['.harness/bin/**/*.mjs']"), 'init should add harness bin mjs override')
  assert(config.includes('...globals.node'), 'init should add node globals')
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

  assert(output.includes('eslint config: eslint.config.js .harness-backup ignore 추가'), 'init should report harness backup ignore patch')
  assert(config.includes("'**/.harness-backup/**'"), 'init should add harness backup ignore when node override already exists')
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

  assert(output.includes('project state:'), 'reinstall should report project state migration')
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

  assert(output.includes('install manifest'), 'external harness install should still write manifest')
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
  run('npm', ['run', 'stack:apply', '--', '--preset-path', preset], { cwd: target })

  const localRules = read(target, '.harness/project/stack-preset-rules.md')
  assert(localRules.includes('## 적용된 스택:'), 'stack apply should write applied stack section')
  assert(localRules.includes('External Preset Contract'), 'stack apply should materialize stack instructions as local rules')
  assert(localRules.includes('harness-stack-rules:start'), 'stack local rules should stay inside managed section')

  run('npm', ['run', 'stack:reset'], { cwd: target })

  const resetRules = read(target, '.harness/project/stack-preset-rules.md')
  assert(resetRules.includes('적용된 스택 프리셋이 없습니다.'), 'stack reset should restore previous local rules file')
  const resetProfile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(resetProfile.activeStack === 'none', 'stack reset should restore previous profile')
  const resetLock = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(resetLock.stackHarness === null, 'stack reset should clear stack harness lock')
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
  assert(report.includes('## Style Preset Candidates'), 'scan report should include style preset candidates')
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
  assert(report.includes('## Style Rule Draft'), 'scan report should include style rule draft')
  assert(report.includes('.editorconfig *: indent_style = space'), 'scan report should draft editorconfig style rules')
  assert(report.includes('.eslintrc: quote = single'), 'scan report should draft eslint quote rule')
  assert(report.includes('.eslintrc: semicolon = always'), 'scan report should draft eslint semicolon rule')
  assert(report.includes('.eslintrc: import grouping/order rule is configured'), 'scan report should draft eslint import order rule')
  assert(!report.includes('## Style Preset Candidates'), 'scan report should not suggest presets when style sources exist')
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
  assert(!baselineImpact.includes('SYNC GAP review summary'), 'managed baseline doc update should not trigger sync gap summary')
  assert(!baselineImpact.includes('common.runtime.minimum-node'), 'managed baseline doc update should not trigger runtime policy review')

  fs.appendFileSync(baselinePath, '\n## Local project edit\n- 프로젝트가 직접 수정한 런타임 기준입니다.\n')
  const localImpact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact', '--verbose'], { cwd: target })
  assert(localImpact.includes('common.runtime.minimum-node'), 'local edit to same document should still trigger runtime policy review')
  assert(localImpact.includes('SYNC GAP'), 'local edit to same document should still be reviewed for sync gaps')
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
  fs.rmSync(path.join(target, '.harness/.stack-applied.json'), { force: true })

  const output = run('npm', ['run', 'harness:check', '--', '--no-cache', '--brief'], { cwd: target })
  assert(output.includes('Stack applied state derived from tracked snapshot'), 'guard should derive stack state from tracked snapshot when marker is missing')
  assert(!output.includes('Stack not applied'), 'guard should not silently skip project validations when tracked stack snapshot exists')
  assert(exists(target, 'lint-ran.txt'), 'guard should run lint when stack snapshot exists without local marker')
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

function reinstallPreservesLocallyEditedManagedHarnessFile() {
  // CLAUDE.md/AGENTS.md 같은 managed 파일에 소비자가 직접 섹션을 추가하면
  // base 업데이트가 그 수정을 무경고로 덮어쓰지 않아야 한다(안전망).
  const target = makeTarget()
  runInit(target)

  const original = read(target, 'CLAUDE.md')
  const sentinel = '\n## 모노레포 구조 (#250)\n프로젝트 고유 지침입니다.\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), original + sentinel)

  const output = runInit(target, '--no-scan', '--no-check')

  const after = read(target, 'CLAUDE.md')
  assert(after.includes('모노레포 구조 (#250)'), 'reinstall should preserve consumer additions in managed CLAUDE.md')
  assert(after.includes('프로젝트 고유 지침입니다.'), 'reinstall should preserve consumer sentinel line')
  assert(output.includes('로컬 수정으로 보존된 managed 파일'), 'reinstall should explicitly report preserved locally-modified managed files')
  assert(output.includes('CLAUDE.md'), 'preserved-managed report should name the file')
  assert(!exists(target, 'CLAUDE.md.harness-bak'), 'preservation path should not leave a .harness-bak sidecar')
}

function forceConfirmOverwritesLocallyEditedManagedHarnessFileWithBackup() {
  // 소비자가 위험을 인지하고 --force --confirm-overwrite-project-files를 함께 지정하면
  // 덮어쓰되 소비자본은 같은 디렉터리의 .harness-bak 사이드카로 남겨야 한다.
  const target = makeTarget()
  runInit(target)

  const original = read(target, 'CLAUDE.md')
  const sentinel = '\n## 모노레포 구조 (#250)\n프로젝트 고유 지침입니다.\n'
  const consumerVersion = original + sentinel
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), consumerVersion)

  const output = runInit(target, '--force', '--confirm-overwrite-project-files', '--no-scan', '--no-check')

  const after = read(target, 'CLAUDE.md')
  assert(!after.includes('모노레포 구조 (#250)'), '--force --confirm should replace consumer-modified managed CLAUDE.md')
  assert(exists(target, 'CLAUDE.md.harness-bak'), '--force --confirm should leave a .harness-bak sidecar with consumer content')
  assert(read(target, 'CLAUDE.md.harness-bak') === consumerVersion, '.harness-bak should hold the consumer-modified bytes verbatim')
  assert(output.includes('.harness-bak'), 'post-install report should mention the .harness-bak sidecar')
}

function forceAloneStopsWhenManagedHarnessFileWasLocallyEdited() {
  // 동일한 사고를 막기 위해 --force만 주고 동의 플래그가 없으면 init이 중단되어야 한다.
  const target = makeTarget()
  runInit(target)
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), 'CONSUMER EDIT\n')

  let failed = false
  try {
    runInit(target, '--force')
  } catch (error) {
    failed = error.status === 1
    assert(String(error.stderr).includes('--confirm-overwrite-project-files'), '--force failure should advise the confirmation flag')
  }

  assert(failed, '--force without confirmation should fail when a managed file is locally modified')
  assert(read(target, 'CLAUDE.md') === 'CONSUMER EDIT\n', '--force without confirmation should preserve the modified managed file')
}

// CLAUDE.md 외의 hybrid managed 파일도 동일 분기를 거치지만 0.2.65에서는 CLAUDE.md만 명시 검증했다.
// 0.2.66에서 AGENTS.md(비-Claude 에이전트 진입점)와 .github/copilot-instructions.md(GitHub Copilot 진입점)에도
// 보존/사이드카 보장이 회귀로 잠긴다.
function reinstallPreservesLocallyEditedAgentsMd() {
  const target = makeTarget()
  runInit(target)

  const original = read(target, 'AGENTS.md')
  const sentinel = '\n## 프로젝트 전용 에이전트 룰\nCodex 진입점 보충 지침입니다.\n'
  fs.writeFileSync(path.join(target, 'AGENTS.md'), original + sentinel)

  const output = runInit(target, '--no-scan', '--no-check')

  const after = read(target, 'AGENTS.md')
  assert(after.includes('프로젝트 전용 에이전트 룰'), 'reinstall should preserve consumer additions in managed AGENTS.md')
  assert(output.includes('AGENTS.md'), 'preserved-managed report should name AGENTS.md when modified')
  assert(!exists(target, 'AGENTS.md.harness-bak'), 'preservation path should not leave AGENTS.md.harness-bak')
}

function forceConfirmOverwritesAgentsMdWithBackup() {
  const target = makeTarget()
  runInit(target)

  const consumerVersion = `${read(target, 'AGENTS.md')}\n## CONSUMER\n`
  fs.writeFileSync(path.join(target, 'AGENTS.md'), consumerVersion)

  runInit(target, '--force', '--confirm-overwrite-project-files', '--no-scan', '--no-check')

  assert(!read(target, 'AGENTS.md').includes('## CONSUMER'), '--force --confirm should replace AGENTS.md')
  assert(exists(target, 'AGENTS.md.harness-bak'), '--force --confirm should leave AGENTS.md.harness-bak')
  assert(read(target, 'AGENTS.md.harness-bak') === consumerVersion, 'AGENTS.md.harness-bak should hold the consumer bytes verbatim')
}

function reinstallPreservesLocallyEditedCopilotInstructions() {
  const target = makeTarget()
  runInit(target)

  const rel = '.github/copilot-instructions.md'
  const original = read(target, rel)
  const consumerVersion = `${original}\n## PaceLAB 전용 모노레포 안내\n`
  fs.writeFileSync(path.join(target, rel), consumerVersion)

  const output = runInit(target, '--no-scan', '--no-check')

  const after = read(target, rel)
  assert(after.includes('PaceLAB 전용 모노레포 안내'), 'reinstall should preserve consumer additions in copilot-instructions.md')
  assert(output.includes('copilot-instructions.md'), 'preserved-managed report should name copilot-instructions.md')
  assert(!exists(target, `${rel}.harness-bak`), 'preservation path should not leave copilot-instructions.md.harness-bak')
}

// 0.2.65 안전망은 본질적으로 단일 파일 분기지만, PaceLAB류 소비자는 보통 CLAUDE.md/AGENTS.md/copilot을
// 동시에 손댄다. 한 번의 update에서 모두 보존되고 후처리 리포트가 모두를 명시하는지 잠근다.
function reinstallPreservesAllHybridManagedFilesSimultaneously() {
  const target = makeTarget()
  runInit(target)

  const claude = `${read(target, 'CLAUDE.md')}\n## 모노레포 구조 (#250)\n`
  const agents = `${read(target, 'AGENTS.md')}\n## 프로젝트 전용 에이전트 룰\n`
  const copilot = `${read(target, '.github/copilot-instructions.md')}\n## PaceLAB 전용 모노레포 안내\n`
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), claude)
  fs.writeFileSync(path.join(target, 'AGENTS.md'), agents)
  fs.writeFileSync(path.join(target, '.github/copilot-instructions.md'), copilot)

  const output = runInit(target, '--no-scan', '--no-check')

  assert(read(target, 'CLAUDE.md') === claude, 'CLAUDE.md preserved in multi-file scenario')
  assert(read(target, 'AGENTS.md') === agents, 'AGENTS.md preserved in multi-file scenario')
  assert(read(target, '.github/copilot-instructions.md') === copilot, 'copilot-instructions.md preserved in multi-file scenario')
  assert(output.includes('로컬 수정으로 보존된 managed 파일'), 'multi-file scenario should print preserved-managed report')
  // 세 파일이 모두 리포트에 등장해야 한다 — 조용한 손실 차단의 핵심.
  assert(output.includes('CLAUDE.md'), 'report should name CLAUDE.md')
  assert(output.includes('AGENTS.md'), 'report should name AGENTS.md')
  assert(output.includes('copilot-instructions.md'), 'report should name copilot-instructions.md')
}

function forceConfirmOverwriteLeavesSidecarsForAllHybridManagedFiles() {
  const target = makeTarget()
  runInit(target)

  const consumerClaude = `${read(target, 'CLAUDE.md')}\n## CONSUMER CLAUDE\n`
  const consumerAgents = `${read(target, 'AGENTS.md')}\n## CONSUMER AGENTS\n`
  const consumerCopilot = `${read(target, '.github/copilot-instructions.md')}\n## CONSUMER COPILOT\n`
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), consumerClaude)
  fs.writeFileSync(path.join(target, 'AGENTS.md'), consumerAgents)
  fs.writeFileSync(path.join(target, '.github/copilot-instructions.md'), consumerCopilot)

  runInit(target, '--force', '--confirm-overwrite-project-files', '--no-scan', '--no-check')

  assert(read(target, 'CLAUDE.md.harness-bak') === consumerClaude, 'CLAUDE.md sidecar holds consumer bytes')
  assert(read(target, 'AGENTS.md.harness-bak') === consumerAgents, 'AGENTS.md sidecar holds consumer bytes')
  assert(read(target, '.github/copilot-instructions.md.harness-bak') === consumerCopilot, 'copilot sidecar holds consumer bytes')
  // 본체로 갱신은 셋 다 일어났는지 확인 (sidecar는 직전 소비자본, 디스크는 새 본체)
  assert(!read(target, 'CLAUDE.md').includes('## CONSUMER CLAUDE'), 'CLAUDE.md replaced by harness')
  assert(!read(target, 'AGENTS.md').includes('## CONSUMER AGENTS'), 'AGENTS.md replaced by harness')
  assert(!read(target, '.github/copilot-instructions.md').includes('## CONSUMER COPILOT'), 'copilot replaced by harness')
}

const tests = [
  cleanInstallCreatesExpectedFiles,
  nonNodeInstallSkipsPackageJson,
  optInCreatesPackageJsonForGreenfieldNode,
  launcherRunsHarnessWithoutNpm,
  gitHooksRunWithoutNpm,
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
  guardFailsWhenActiveStackHasNoTrackedSnapshot,
  updateRecordsAndReplaysChangelogDelta,
  existingClaudeSettingsGetsHarnessHooksMerged,
  reinstallPreservesLocallyEditedManagedHarnessFile,
  forceConfirmOverwritesLocallyEditedManagedHarnessFileWithBackup,
  forceAloneStopsWhenManagedHarnessFileWasLocallyEdited,
  reinstallPreservesLocallyEditedAgentsMd,
  forceConfirmOverwritesAgentsMdWithBackup,
  reinstallPreservesLocallyEditedCopilotInstructions,
  reinstallPreservesAllHybridManagedFilesSimultaneously,
  forceConfirmOverwriteLeavesSidecarsForAllHybridManagedFiles,
]

console.log('Init smoke tests')

for (const test of tests) {
  test()
  console.log(`  OK ${test.name}`)
}
