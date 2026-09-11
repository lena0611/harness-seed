// 설치·재설치·업데이트·마커 머지·백업 회귀. 실행 등록은 scripts/test-init.mjs의 tests 배열이 정본이다.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  repoRoot,
  nodeBin,
  packageVersion,
  packageRef,
  run,
  harnessBin,
  assert,
  exists,
  read,
  writeJson,
  sha256Text,
  sha256File,
  makeBareTarget,
  makeTarget,
  runInit,
  runInitDefaultHooks,
  runGuard,
  readTargetGitConfig,
  hasWrapper,
  NON_MARKER_MANAGED_REL,
  MARKER_START_T,
  MARKER_END_T,
  SEED_ONLY_DOCS,
  SEED_ONLY_DOC,
  SEED_HISTORY_LOG,
  gitCommitAll,
  setupSpecLinkedTarget,
  expectFailure,
} from './helpers.mjs'

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
  // 0.2.131: verify(검증 소유) 개념 자체를 제거했으므로 슬래시 명령도 배포되면 안 된다.
  // 삭제를 잠그는 assert — 되살아나면 "누가 lint/test/build를 돌릴지" 문답이 다시 생긴다.
  assert(!exists(target, '.claude/commands/검증설정.md'), 'verify ownership slash command must not be installed after the 0.2.131 verify removal')
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
  // #15(2026-09-02 실측): 상위 폴더·하위 서비스 폴더로 열면 훅이 0개인데 CLAUDE.md는 도달한다 — 그 채널로 알려야 한다.
  assert(claudeInstructions.includes('세션 주 폴더 확인'), 'CLAUDE.md must tell the agent hooks are off when the primary folder is not the repo root')
  // 0.2.141(멀티사이트 실측): 마커 아래 안내가 "아키텍처 경계…자유롭게"라 규칙 본문이 CLAUDE.md에 쌓였다.
  // 안내는 마커 안(업데이트로 기존 팀에도 전파)과 아래(신규 설치) 양쪽에 "포인터만, 규칙 본문은 룰 문서"로.
  const managedEnd = claudeInstructions.lastIndexOf('<!-- harness-managed:end -->') // 머리 주석 4행에도 같은 단어가 있어 indexOf는 너무 이르다
  assert(managedEnd > 0, 'consumer CLAUDE.md must carry the managed block markers')
  assert(claudeInstructions.slice(0, managedEnd).includes('규칙 본문(아키텍처 경계·도메인·코딩 규약·워크플로우·커밋 규칙)은 룰 문서에'), 'the rule-body guidance must live inside the managed block so updates reach existing consumers')
  assert(claudeInstructions.slice(0, managedEnd).includes('에이전트가 먼저 나서지 않습니다'), 'the guidance must stop agents from volunteering a CLAUDE.md cleanup')
  assert(!claudeInstructions.includes('진입 지침(아키텍처 경계, 읽기 순서 예외, 워크플로우 보충 등)을 자유롭게'), 'the old invitation to write architecture boundaries in CLAUDE.md must be gone')

  const agentInstructions = read(target, 'AGENTS.md')
  assert(agentInstructions.includes('비-Claude 에이전트 필수 동작'), 'AGENTS.md should include non-Claude required behavior')
  assert(agentInstructions.includes('하네스 작업 프로토콜을 자동으로 적용'), 'AGENTS.md should require automatic protocol application')
  assert(agentInstructions.includes('hook이 설치되어 있으면 선행 `harness:check`를 중복 실행하지 않고'), 'AGENTS.md should avoid duplicate manual check before hooked commit')
  assert(agentInstructions.includes('주 작업 폴더가 이 저장소 루트가 아니면'), 'AGENTS.md must carry the primary-folder warning for non-Claude agents')

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
  assert(sessionStartHook.includes('재검토일') && sessionStartHook.includes('nextReviewOn'), 'session start hook should parse the review-date column (clubadm 2026-08-24)')
  assert(sessionStartHook.includes('재검토일 형식 오류'), 'session start hook must fail loud on malformed review dates — typos must not become a hiding path')
  assert(sessionStartHook.includes('유예 '), 'session start hook should print a one-line snooze summary instead of full silence')

  const commitPushRules = read(target, '.harness/project/commit-push-rules.md')
  assert(commitPushRules.includes('## 요청별 검증 경로'), 'commit/push rules should explain request-specific verification paths')
  assert(commitPushRules.includes('hook 설치 여부는 `.harness/bin/harness hooks:status`로 판단'), 'commit/push rules should explain hook installation detection')
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
  assert(commitPushSkill.commands.some((command) => command.includes('harness hooks:status')), 'commit/push finalization skill should check hook installation')
  assert(commitPushSkill.outputs.includes('중복 검증 생략 여부'), 'commit/push finalization skill should report duplicate check avoidance')
  assert(updateSkill, 'consumer skill registry should include harness update flow')
  assert(updateSkill.audience.includes('consumer'), 'harness update flow should be consumer-facing')
  assert(updateSkill.commands.includes('.harness/bin/harness outdated'), 'harness update flow should check outdated state')
  assert(updateSkill.commands.includes('.harness/bin/harness update --base-only'), 'harness update flow should document base-only update')

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
  // 0.2.131: 주입 별칭 0개 — 하네스는 package.json에 쓰지 않는다. 모든 명령은 .harness/bin/harness 런처.
  const harnessAliases = Object.keys(pkg.scripts).filter((name) => /^(harness|hooks|stack|template|standards|templates):/.test(name))
  assert(harnessAliases.length === 0, `clean install should inject zero harness aliases (got ${harnessAliases.join(', ')})`)
  // 은퇴 별칭(25종, harness:*/hooks:install 계열 전부)은 새 설치에 주입하지 않는다(기존 소비자 파일에서는 삭제하지 않음 — add-only).
  for (const retired of [
    'harness:check', 'harness:impact', 'harness:context', 'hooks:install',
    'harness:guide', 'harness:scan', 'harness:handoff', 'harness:check:strict', 'harness:sync',
    'harness:spec:fetch', 'harness:spec:status', 'harness:spec:settle',
    'harness:outdated', 'harness:update', 'harness:changelog', 'harness:uninstall',
    'standards:list', 'templates:list',
    'stack:apply', 'stack:reset', 'stack:status',
    'template:apply', 'template:reset', 'template:status', 'template:gap',
  ]) {
    assert(!pkg.scripts[retired], `clean install should not inject retired alias ${retired}`)
  }
  assert(!pkg.scripts.guard, 'clean install should not add deprecated guard alias')
  assert(!pkg.scripts['stack:list'], 'clean install should not add deprecated stack list alias')
  assert(!pkg.scripts['node:check'], 'clean install should not expose harness internal node check script')
  assert(!pkg.scripts['policy:impact'], 'clean install should not expose harness internal policy script')
  assert(!pkg.scripts['docs:check'], 'clean install should not expose harness internal docs script')
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

  run(harnessBin(target), ['sync'], { cwd: target })
  run(harnessBin(target), ['context', 'context smoke'], { cwd: target })
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

function pruneAliasesRemovesOnlyRecognizedInjectedValues() {
  // 0.2.131: 은퇴 별칭 정리 도구. 안전 원칙 — 하네스가 주입한 형태 그대로일 때만 지우고,
  // 프로젝트가 값을 고친 별칭과 프로젝트 자신의 스크립트는 절대 건드리지 않는다.
  const target = makeTarget()
  writeJson(target, 'package.json', {
    name: 'consumer', private: true,
    scripts: {
      dev: 'vite',
      'harness:check': 'node .harness/bin/check-node-version.mjs && node .harness/bin/guard.mjs',
      'harness:scan': 'npm run node:check --silent && node .harness/bin/scan-project.mjs --write',
      'stack:apply': 'npm run node:check --silent && node scripts/apply-stack.mjs',
      'harness:guide': 'MY_ENV=1 node .harness/bin/harness-guide.mjs',
      'harness:update': 'node .harness/bin/check-node-version.mjs && node .harness/bin/update-harness.mjs && echo done',
    },
  })
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // (1) 미리보기 기본 — 파일을 바꾸지 않는다.
  const preview = run(nodeBin, [path.join(target, '.harness/bin/prune-aliases.mjs')], { cwd: target })
  assert(preview.includes('지울 수 있는 것 3개'), 'preview should classify the 3 pristine aliases (current + 2 legacy forms)')
  assert(preview.includes('보존할 것 2개'), 'customized aliases must be classified as preserved')
  assert(preview.includes('미리보기'), 'default run must be a dry preview')
  const before = JSON.parse(read(target, 'package.json'))
  assert(before.scripts['harness:check'], 'preview must not modify package.json')

  // (2) --write — 인식된 것만 지우고, 백업을 남기고, 나머지는 그대로.
  run(nodeBin, [path.join(target, '.harness/bin/prune-aliases.mjs'), '--write'], { cwd: target })
  const after = JSON.parse(read(target, 'package.json'))
  assert(after.scripts['harness:check'] === undefined, 'pristine current-form alias must be removed')
  assert(after.scripts['harness:scan'] === undefined, 'pristine legacy npm-run form must be removed')
  assert(after.scripts['stack:apply'] === undefined, 'pristine legacy scripts/ form must be removed')
  assert(after.scripts['harness:guide'], 'env-prefixed alias must be preserved (project customized it)')
  assert(after.scripts['harness:update'], 'suffix-appended alias must be preserved (project customized it)')
  assert(after.scripts.dev === 'vite', 'project own scripts must never be touched')
  assert(exists(target, 'package.json.harness-bak'), 'write mode must leave a backup sidecar')

  // (3) 멱등 — 다시 돌리면 지울 게 없다고만 한다.
  const again = run(nodeBin, [path.join(target, '.harness/bin/prune-aliases.mjs'), '--write'], { cwd: target })
  assert(again.includes('보존할 것 2개') || again.includes('자동으로 지울 수 있는 별칭이 없습니다'), 'second run must find nothing new to remove')

  // (4) 본체 저장소 방어 — .harness-seed-mode가 있으면 거부한다(본체 scripts는 원본이다).
  const seedish = makeTarget()
  runInit(seedish, '--no-scan', '--no-handoff', '--no-check')
  fs.writeFileSync(path.join(seedish, '.harness-seed-mode'), '')
  const refusal = expectFailure(
    () => run(nodeBin, [path.join(seedish, '.harness/bin/prune-aliases.mjs')], { cwd: seedish }),
    'seed-mode must refuse the prune tool (exit 1)',
  )
  assert(refusal.includes('본체 저장소'), 'refusal must explain why (body scripts are originals, not injected aliases)')
  assert(JSON.parse(read(seedish, 'package.json')), 'seed-mode refusal must leave package.json intact')

  // (5) 도구의 은퇴 목록이 init.mjs의 RETIRED_CONSUMER_SCRIPTS와 어긋나지 않는지(드리프트 가드).
  const initSrc = fs.readFileSync(path.join(repoRoot, 'scripts/init.mjs'), 'utf8')
  const pruneSrc = fs.readFileSync(path.join(repoRoot, '.harness/bin/prune-aliases.mjs'), 'utf8')
  const extract = (src, name) => {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))
    return m[1].match(/'[^']+'/g).map((x) => x.slice(1, -1)).sort()
  }
  const initList = extract(initSrc, 'RETIRED_CONSUMER_SCRIPTS')
  const pruneList = extract(pruneSrc, 'RETIRED')
  assert(JSON.stringify(initList) === JSON.stringify(pruneList),
    `prune tool retired list drifted from init.mjs: init=${initList.length} prune=${pruneList.length}`)
}

function staleVerifyDeclarationGetsNoticed() {
  // score-print 요청(2026-08-28): verify 폐지 후 "게이트가 비었다"는 신호가 없었다.
  // 과거에 검증을 하네스에 맡겼던 프로젝트(profile.verify 잔존)에만 안내 한 줄을 띄운다 —
  // 새 프로젝트는 키가 없어 침묵. 검사 실패로 만들지 않는다(길라잡이).
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const rel = '.harness/policy/profile.json'
  const profile = JSON.parse(read(target, rel))
  writeJson(target, rel, { ...profile, verify: { lint: 'harness', test: 'harness', build: 'harness' } })

  const withKey = runGuard(target, '--no-cache')
  assert(withKey.includes('verify 선언이 남아 있으나'), 'stale verify declaration must be surfaced')
  assert(withKey.includes('검증게이트설치'), 'notice must point at the migration path')
  assert(withKey.includes('결과: 통과'), 'the notice must stay informational, not a failure')

  writeJson(target, rel, profile)
  const withoutKey = runGuard(target, '--no-cache')
  assert(!withoutKey.includes('verify 선언'), 'projects without the key must hear nothing')
}

function retiredInitFlagsStayAcceptedForSiblingHarnesses() {
  // 2026-08-27 실측 사고: 0.2.131이 --with-package-json을 제거했는데 스택 하네스의
  // buildSeedArgs가 그 플래그를 본체 init에 넘겨(공개 계약, 결정 83) 스택 설치가 exit 1로
  // 전면 실패했다. 이미 배포된 스택 태그는 계속 그 플래그를 넘기므로 본체는 영구 수용한다.
  // 은퇴 플래그를 지우려면 그것을 넘기는 형제 저장소의 모든 배포 태그가 사라진 뒤여야 한다.
  const target = makeTarget()
  const out = runInit(target, '--with-package-json', '--no-scan', '--no-handoff', '--no-check')

  assert(exists(target, '.harness/policy/profile.json'), 'retired flag must not abort the install')
  assert(out.includes('은퇴') || out.includes('retired') || true, 'notice is optional but install must succeed')

  // 스택 하네스가 실제로 넘기는 인자 조합 그대로도 설치가 성공해야 한다.
  const stackLike = makeTarget()
  runInit(stackLike, '--no-scan', '--no-handoff', '--no-check', '--embedded', '--with-package-json')
  assert(exists(stackLike, '.harness/policy/profile.json'), 'stack-style arg set must install cleanly')

  // 은퇴 플래그가 실제로 무동작이어야 한다 — package.json을 만들거나 별칭을 넣지 않는다.
  const bare = makeBareTarget()
  runInit(bare, '--with-package-json', '--no-scan', '--no-handoff', '--no-check')
  assert(!exists(bare, 'package.json'), 'retired --with-package-json must stay a no-op (no package.json creation)')
}

function installExcludesSessionWorktrees() {
  // 에이전트 세션이 본체 체크아웃에 만드는 .claude/worktrees/* 는 저장소 상태이지 배포물이 아니다.
  // 유출되면 소비자 설치본의 .claude/** 정책(visible-trace)이 무관한 변경에 깨어난다(2026-08-26 실측).
  // 본체에 워크트리가 없을 때도 검사가 공허해지지 않도록 탐침을 직접 만들었다 지운다.
  const probeDir = path.join(repoRoot, '.claude/worktrees/__regression-probe__')
  fs.mkdirSync(probeDir, { recursive: true })
  fs.writeFileSync(path.join(probeDir, 'probe.md'), 'install exclusion probe\n')

  try {
    const target = makeTarget()
    runInit(target, '--no-scan', '--no-handoff', '--no-check')

    assert(!exists(target, '.claude/worktrees'), 'session worktrees must not ship to consumers')
    const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
    const leaked = Object.keys(manifest.managedFiles).filter((rel) => rel.startsWith('.claude/worktrees/'))
    assert(leaked.length === 0, `session worktrees must not enter the install manifest: ${leaked.join(', ')}`)
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true })
  }
}

// 회귀(0.2.131): uninstall이 managed 파일(.githooks 포함)을 지우면서 git 설정을 남겨두면
// core.hooksPath/commit.template이 삭제된 경로를 계속 가리킨다. 설치 전 설정이 없던 프로젝트
// (legacy .git/hooks 파일만 있던 경우의 '.git/hooks' 마커 포함)는 해제가 곧 복원이다.
function uninstallUnsetsHarnessGitConfigWhenNothingPreceded() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  // 설치 전: core.hooksPath 없이 legacy .git/hooks 파일만 있는 프로젝트.
  fs.writeFileSync(path.join(target, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n')
  fs.chmodSync(path.join(target, '.git/hooks/pre-commit'), 0o755)
  run(nodeBin, [path.join(target, '.harness/bin/install-hooks.mjs')], { cwd: target })
  assert(readTargetGitConfig(target, 'core.hooksPath') === '', 'precondition: wrapper mode leaves core.hooksPath unset')
  assert(readTargetGitConfig(target, 'harness.previousHooksPath') === '.git/hooks/harness-prev', 'precondition: the parked legacy hook is chained from the harness-prev dir')
  assert(hasWrapper(target, 'pre-commit') && exists(target, '.git/hooks/harness-prev/pre-commit'), 'the legacy hook file must be parked, not overwritten')

  // dry-run(무 --confirm)은 복원 계획만 보여주고 설정을 건드리지 않는다.
  const planOut = run(nodeBin, [path.join(target, '.harness/bin/uninstall-harness.mjs')], { cwd: target })
  assert(planOut.includes('복원할 git 설정'), 'dry-run must announce the git config restore plan')
  assert(hasWrapper(target, 'pre-commit'), 'dry-run must not remove the wrappers')

  run(nodeBin, [path.join(target, '.harness/bin/uninstall-harness.mjs'), '--confirm'], { cwd: target })
  assert(readTargetGitConfig(target, 'core.hooksPath') === '', "a parked-dir chain means no previous hooksPath config existed — uninstall must leave core.hooksPath unset")
  assert(!hasWrapper(target, 'pre-commit') && !exists(target, '.git/hooks/harness-prev/pre-commit'), 'uninstall must remove the wrapper and move the parked hook back')
  assert(readTargetGitConfig(target, 'commit.template') === '', 'uninstall must unset the harness commit.template when none preceded it')
  assert(readTargetGitConfig(target, 'harness.previousHooksPath') === '', 'uninstall must clean up its own bookkeeping key')
  assert(exists(target, '.git/hooks/pre-commit'), 'legacy default-dir hooks must survive uninstall and become active again')
  // 복원 후 git commit이 실제로 동작한다 — 결함의 증상(제거 후 커밋 경로 파손) 기준 검증.
  fs.writeFileSync(path.join(target, 'after-uninstall.txt'), 'ok\n')
  gitCommitAll(target, 'after uninstall')
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

// 스택 manifest의 raw verify(lint/test) 실행 회귀(P4, 2026-06-09)와 그 픽스처 프리셋
// (makeVerifyPreset / makeNodeVersionVerifyPreset)은 0.2.131 verify 제거와 함께 삭제했다.
// 스택은 더 이상 검증 명령을 선언하지 않는다.

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

// 0.2.131: 주입 별칭 0개여도, pre-0.2.131 소비자가 이미 가진 은퇴 별칭은 add-only로 보존하고
// 남아 있다는 사실만 알린다(삭제하거나 새로 주입하지 않는다).
function retiredAliasNoticeSurvivesZeroInjection() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // pre-0.2.131 소비자를 재현: 은퇴 별칭 2개가 이미 package.json에 있다.
  const pkg = JSON.parse(read(target, 'package.json'))
  pkg.scripts['harness:check'] = 'node .harness/bin/check-node-version.mjs && node .harness/bin/guard.mjs'
  pkg.scripts['harness:guide'] = 'node .harness/bin/check-node-version.mjs && node .harness/bin/harness-guide.mjs'
  writeJson(target, 'package.json', pkg)

  const output = runInit(target, '--no-scan', '--no-handoff', '--no-check')

  assert(output.includes('은퇴한 하네스 npm 별칭 2개가 package.json에 남아 있습니다'), 'reinstall should report the count of retired aliases still present')
  assert(output.includes('계속 동작합니다'), 'retired alias notice should reassure the alias still works')

  const finalPkg = JSON.parse(read(target, 'package.json'))
  assert(finalPkg.scripts['harness:check'], 'add-only contract should keep the pre-existing retired alias')
  assert(finalPkg.scripts['harness:guide'], 'add-only contract should keep the pre-existing retired alias')
  const harnessAliases = Object.keys(finalPkg.scripts).filter((name) => /^(harness|hooks|stack|template|standards|templates):/.test(name))
  assert(harnessAliases.length === 2, `reinstall should not inject any new alias beyond the pre-existing 2 (got ${harnessAliases.join(', ')})`)
}

// 은퇴 별칭이 하나도 없는 소비자에게는 정리 안내 자체가 나오면 안 된다(있지도 않은 것을 알리는 노이즈).
function retiredAliasNoticeOmittedWhenNoneExist() {
  const target = makeTarget()
  const output = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(!output.includes('은퇴한 하네스 npm 별칭'), 'a fresh install without legacy scripts should not print the retired alias notice')
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

  const output = run(harnessBin(target), ['update', '--base-only', '--dry-run'], { cwd: target })
  assert(output.includes(`--source-repo ${baseRepo}`), 'base-only update should pass source repo into init')
  assert(output.includes(`--source-ref semver:^${packageVersion}`), 'base-only update should pass selected semver ref into init')
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

// 결정 86의 npm verify 옵트인 회귀(npmVerifyStagesRequireOptIn)는 0.2.131에서 삭제했다.
// "옵트인하면 하네스가 lint를 돌린다"는 계약 자체가 사라져, profile.verify 값이 무엇이든
// 하네스는 프로젝트 스크립트를 실행하지 않는다 — harnessNeverRunsProjectQualityScripts가 잠근다.

// 0.2.131 핵심 계약: 하네스는 프로젝트 품질 스크립트(lint/test/build)를 절대 실행하지 않는다.
// 옵트인도, "감지했지만 안 돌립니다" 안내도 없다 — 안내가 남으면 "누가 돌리나" 문답이 되살아난다.
// 실행 여부는 마커 파일로, 안내 여부는 출력 문자열로, 관문 검사 통과 여부는 요약으로 각각 잠근다.
function harnessNeverRunsProjectQualityScripts() {
  const target = makeTarget()
  writeJson(target, 'package.json', {
    name: 'quality-scripts-target',
    private: true,
    type: 'module',
    scripts: {
      lint: "node -e \"require('fs').writeFileSync('lint-ran.txt', 'yes')\"",
      test: "node -e \"require('fs').writeFileSync('test-ran.txt', 'yes')\"",
      build: "node -e \"require('fs').writeFileSync('build-ran.txt', 'yes')\"",
    },
  })
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  let output = ''
  let failed = false
  try {
    output = runGuard(target, '--no-cache')
  } catch (error) {
    failed = true
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }

  // (a) 프로젝트가 선언한 품질 스크립트는 하나도 실행되지 않는다.
  for (const stage of ['lint', 'test', 'build']) {
    assert(!exists(target, `${stage}-ran.txt`), `harness must never run the project ${stage} script`)
  }

  // (b) 제거된 verify 개념의 흔적(옵트인 안내·위임 표기·스테이지 이름)이 출력에 남으면 안 된다.
  const removedTraces = [
    '하네스는 실행하지 않습니다',
    'external 위임',
    'Stack verify',
    'verify:lint',
    'verify:test',
    'verify:build',
    'profile.verify',
    '검증설정',
  ]
  for (const trace of removedTraces) {
    assert(!output.includes(trace), `check output must not carry removed verify guidance (${trace}): ${output}`)
  }

  // (c) 그럼에도 하네스 자신의 관문 검사는 그대로 실행되고 통과한다 — 제거가 검사 약화가 아님을 잠근다.
  assert(!failed, `harness gate check must pass on a project that owns lint/test/build: ${output}`)
  assert(output.includes('Harness check summary'), 'harness gate check must still report a summary')
  assert(!output.includes('결과: 실패'), `harness gate check must not report failure: ${output}`)
  assert(output.includes('관문 검사: 실행'), '--no-cache must actually execute the gate check instead of reusing a cache')
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
    // 결정 98: 토큰 파일은 반드시 무시 목록에 — 견본 문서의 ".gitignore 등록됨" 약속을 코드가 지킨다.
    '.issue-adapter.env',
  ]) {
    assert(gitignore.includes(rel), `consumer .gitignore must cover ${rel}`)
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

// 마커 없는 옛 파일을 소비자가 수정(sha 불일치) → 0.2.142까지는 "자동 분리 불가"로 보존 + 수동 이전 안내였다.
// 2026-09-08부터는 하네스 블록을 **위에 얹는다**(내용 보존). 어디까지가 회사/소비자인지 모르는 건 사실이지만,
// 마커 설계상 답은 정해져 있다 — 위 = 본체, 아래 = 프로젝트. 안내를 받은 개발자가 할 수 있는 일이 정확히 그것이었다.
function prependHarnessBlockOntoModifiedLegacyFileWithoutMarker() {
  const target = makeTarget()
  runInit(target)

  const legacyModified = '# CLAUDE\n\n옛 버전인데 소비자가 수정함. 마커 없음.\n## 내 메모\n중요\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), legacyModified)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles['CLAUDE.md'] = { sha256: sha256Text('# CLAUDE\n\n옛 정본(소비자 수정 전).\n') }
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-check')

  const merged = read(target, 'CLAUDE.md')
  assert(merged.startsWith(MARKER_START_T), 'the harness block must be prepended')
  assert(merged.endsWith(legacyModified), 'the consumer\'s modified content must survive byte-for-byte below the block')
  assert(output.includes('위에 하네스 읽기 순서 블록을 얹었습니다'), 'the report must say the block was prepended')
  assert(!output.includes('수동 이전 필요'), 'no more vague manual-migration advice')
  assert(!exists(target, 'CLAUDE.md.harness-bak'), 'nothing was lost, so no sidecar backup')
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

function consumerInstallExcludesSeedOnlyDocs() {
  const target = makeTarget()
  runInit(target)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  for (const docPath of SEED_ONLY_DOCS) {
    assert(!exists(target, docPath), 'seed-only doc must not be installed to a consumer project')
    assert(!manifest.managedFiles[docPath], 'seed-only doc must not appear in consumer install manifest')
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

// 은퇴 관리 파일 정리(0.2.134, score-print 보고): 예전 버전이 배포한 파일을 본체가 삭제하면
// 업데이트가 소비자 디스크에서도 정리해야 한다 — 안 지우면 파일이 유령으로 남아
// doc-link-check가 매 검사마다 고아로 신고한다(실측: /검증설정 명령 문서,
// 0.2.126 배포 → 0.2.131 본체 삭제 → 0.2.133 소비자 잔존).
function updateRemovesRetiredManagedCommandDoc() {
  const retiredRel = '.claude/commands/검증설정.md'
  const staleBody = '# /검증설정 — verify 소유 전환 안내 (0.2.126 배포본)\n'

  // (a) 미수정 잔존본: 제거 + manifest 이탈 + 고아 경고 소멸
  const target = makeTarget()
  runInit(target)
  fs.writeFileSync(path.join(target, retiredRel), staleBody)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles[retiredRel] = { sha256: sha256Text(staleBody) }
  writeJson(target, '.harness/install-manifest.json', manifest)

  const output = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(!exists(target, retiredRel), 'unmodified retired managed file must be removed on update')
  const after = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!after.managedFiles[retiredRel], 'removed retired file must leave managed entries')
  assert(output.includes('은퇴한 하네스 파일'), 'update must report the retired-file cleanup')
  const doc = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!doc.includes(retiredRel), 'doc-link-check must stop flagging the removed retired file')

  // (b) 소비자 수정본: 보존 + managed 이탈(소비자 소유 재분류) + 안내
  const target2 = makeTarget()
  runInit(target2)
  fs.writeFileSync(path.join(target2, retiredRel), '# 소비자가 고쳐 쓰던 내용\n')
  const manifest2 = JSON.parse(read(target2, '.harness/install-manifest.json'))
  manifest2.managedFiles[retiredRel] = { sha256: sha256Text(staleBody) }
  writeJson(target2, '.harness/install-manifest.json', manifest2)

  const output2 = runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  assert(exists(target2, retiredRel), 'consumer-modified retired file must be preserved')
  const after2 = JSON.parse(read(target2, '.harness/install-manifest.json'))
  assert(!after2.managedFiles[retiredRel], 'preserved retired file must be reclassified as consumer-owned (out of managed entries)')
  assert(output2.includes('로컬 수정 흔적이 있어 보존'), 'update must report the preserved retired file')
}

// 외부 리뷰 P2-3: 예전 방식은 .githooks/의 어떤 이름이든 실행했다. 래퍼가 고정 8개만 덮으면 post-rewrite 같은 기존 팀 훅이
// 업데이트 뒤 조용히 꺼진다. 클라이언트 훅 전부를 덮어야 한다.
// #29(multisite 0.2.146 업데이트 리포트) ①: legacy 판정 문구가 환경과 무관하게 "hooks:install 로 갱신하세요"라고
// 사람에게 명령을 시켜, "다음 세션에서 자동으로 바뀝니다"라는 같은 릴리스의 공지와 갈렸다. 상태만 보려고 치는 명령이
// 지시를 주는데 그 지시가 공지와 다르면 지금 뭘 해야 하는지 갈린다. 세션 시작 훅이 실제로 배선돼 있으면 자동 갱신을
// 안내하고, 배선이 없으면(터미널만 쓰는 PC·어댑터 미설치·등록 누락) 종전 문구를 낸다 — 판정은 사람 안내 쪽으로 닫는다.
// #29 참고 표시: previousHooksPath는 선언값과 해석값이 같으면 한 번만 찍는다.
// 0.2.149 — 훅 미설치 안내가 "새 대화창을 열면 저절로 켜진다"까지 말한다 (PHP 백엔드 실측 2026-09-10).
// pull 로 하네스가 들어온 **이미 열려 있던** 세션에서 이 안내가 떴는데 명령만 건넸다 — 그 창은 스스로 켤 수
// 없고 다음 세션은 켜므로, 둘 다 말해야 개발자가 지금 칠지 기다릴지 고른다. 배선이 없는 clone 에서는 거짓이라
// 말하지 않는 것까지 함께 잠근다(#29 ① 의 교훈: 같은 사실을 말하는 채널이 둘이면 한쪽만 고치면 안 된다).
// 0.2.149 — 세션 시작이 "못 갖춘 조건"만 표로 보여준다(사용자 지시 2026-09-10). 사람과 에이전트가
// 같은 줄을 읽는 자리라 채널을 하나로 둔다. 핵심은 **모름을 꺼짐으로 단정하지 않는 것**이다 — 실측에서
// node 가 없자 훅이 멀쩡히 켜져 있는데도 "꺼져 있는데 켜지 못했습니다"라고 알렸고, 처방으로 준
// hooks:install 도 같은 이유로 실패할 명령이었다.
// 0.2.149 — pull(post-merge)도 같은 준비 상태 표를 낸다(사용자 지시 2026-09-10). Claude 를 안 쓰는
// 개발자(터미널·Codex 전용 PC)에게 닿는 유일한 채널이라 넣었다. 판정 본문은 preflight.sh 한 곳이
// 소유하므로, 두 훅이 **같은 문장**을 내는지까지 함께 잠근다 — 사본이 갈리면 한쪽만 고치게 된다.
// 0.2.149 — 훅 상태 **조회 실패**를 어느 채널도 "꺼짐"으로 단정하지 않는다. 세션 시작·pull·check 를
// 고치고도 프롬프트 주입 채널(inject-context.sh)만 옛 폴백으로 남아 있었다(사용자 지적 2026-09-10).
// 같은 결함을 한 자리씩 고치다 다섯 번째로 남은 자리라, 채널 전부를 한 회귀로 함께 잠근다.
// 0.2.149 — 프롬프트 채널도 같은 준비 상태 표를 내되 **세션당 한 번만** 찍는다(사용자 결정 2026-09-10).
// 세션 도중에 환경이 깨지면(Node 제거·버전 교체·PATH 변경) 세션 시작 표는 이미 지나갔고 pull 도 없으면
// 알려 줄 채널이 없다. 다만 매 프롬프트에 같은 줄이 쌓이면 잡음이 신호를 죽이므로 세션 id 로 한 번만 낸다.
// 0.2.150 — 백업은 git 이 못 되돌리는 것만, 세트는 최근 2개만. 종전에는 설치할 때마다 전부 복사하고
// 정리 코드가 없어 `.harness-backup` 이 무한정 쌓였다(멀티사이트 30세트 75MB, 실제 하네스의 4.4배).
function backupSkipsWhatGitCanRestoreAndRotatesSets() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run('git', ['add', '-A'], { cwd: target })
  run('git', ['commit', '-q', '-m', 'install'], { cwd: target })

  // ① 전부 커밋된 상태로 다시 설치하면 백업을 아예 만들지 않는다.
  const clean = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(clean.includes('git 이 되돌릴 수 있습니다'), `a clean tree must skip the backup entirely (got: ${clean})`)
  // 안내하는 명령이 실제로 돌아가야 한다. `HEAD:<경로>` 는 저장소 루트 기준이라 하위 폴더 설치에서 실패한다 — `./` 형태만 양쪽에서 된다.
  assert(clean.includes('git show HEAD:./'), `the restore hint must use the cwd-relative form that also works in a subdirectory (got: ${clean})`)
  assert(!exists(target, '.harness-backup'), 'no backup directory may be created when git can restore every file')

  // ② 관리 파일 하나를 고치면 **그 하나만** 백업한다. 나머지는 git 이 들고 있다.
  fs.appendFileSync(path.join(target, '.harness/session/active-context.md'), '\n로컬 수정\n')
  const dirty = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(/backup: .*\(1개 기존 파일/.test(dirty), `only the file git cannot restore may be copied (got: ${dirty})`)
  assert(dirty.includes('생략'), 'the message must say how many files were skipped because git has them')

  // ③ 오래된 세트는 최근 2개만 남기고 정리한다. 지운 것은 반드시 보고한다.
  for (const stamp of ['2026-01-01T00-00-00-000Z', '2026-02-01T00-00-00-000Z', '2026-03-01T00-00-00-000Z']) {
    fs.mkdirSync(path.join(target, '.harness-backup', stamp), { recursive: true })
    fs.writeFileSync(path.join(target, '.harness-backup', stamp, 'blob'), 'x'.repeat(1024))
  }
  fs.appendFileSync(path.join(target, '.harness/session/active-context.md'), '\n또 수정\n')
  const rotated = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(/오래된 세트 \d+개 정리/.test(rotated), `pruning must be reported, never silent (got: ${rotated})`)
  const sets = fs.readdirSync(path.join(target, '.harness-backup')).filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
  assert(sets.length === 2, `only the newest two sets may remain (got: ${sets.join(', ')})`)

  // ④ 우리 형식이 아닌 폴더는 건드리지 않는다 — 사람이 손으로 둔 것일 수 있다.
  fs.mkdirSync(path.join(target, '.harness-backup', 'my-notes'), { recursive: true })
  fs.appendFileSync(path.join(target, '.harness/session/active-context.md'), '\n세 번째 수정\n')
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(exists(target, '.harness-backup/my-notes'), 'a folder that is not one of our timestamp sets must be left alone')

  // ⑤ --keep-all-backups 는 정리를 끈다.
  for (const stamp of ['2026-04-01T00-00-00-000Z', '2026-05-01T00-00-00-000Z']) {
    fs.mkdirSync(path.join(target, '.harness-backup', stamp), { recursive: true })
  }
  fs.appendFileSync(path.join(target, '.harness/session/active-context.md'), '\n네 번째 수정\n')
  const kept = runInit(target, '--keep-all-backups', '--no-scan', '--no-handoff', '--no-check')
  assert(!kept.includes('오래된 세트'), 'the opt-out flag must disable pruning')
  const after = fs.readdirSync(path.join(target, '.harness-backup')).filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
  assert(after.length > 2, `with the opt-out flag every set must survive (got: ${after.join(', ')})`)

  // ⑥ 타깃이 저장소의 **하위 폴더**여도(모노레포 안 한 서비스) 판정이 맞아야 한다. `git ls-files` 는 cwd 기준,
  // `git status --porcelain` 은 저장소 루트 기준이라 기준을 안 맞추면 고친 파일이 "깨끗하다"로 읽혀 백업에서
  // 빠진다 — 되돌릴 수단이 없는데 있다고 말하는 쪽이라 조용한 손실이다.
  const repoRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-init-subdir-'))
  run('git', ['init', '--quiet'], { cwd: repoRootDir })
  const nested = path.join(repoRootDir, 'services', 'app')
  fs.mkdirSync(nested, { recursive: true })
  writeJson(nested, 'package.json', { name: 'nested-target', private: true, type: 'module', scripts: {} })
  runInit(nested, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(repoRootDir, 'install into a subdirectory')

  const nestedManaged = '.harness/session/active-context.md'
  fs.appendFileSync(path.join(nested, nestedManaged), '\n하위 폴더 로컬 수정\n')
  const nestedOut = runInit(nested, '--no-scan', '--no-handoff', '--no-check')
  assert(/backup: .*\(1개 기존 파일/.test(nestedOut), `a subdirectory target must still back up what git cannot restore (got: ${nestedOut})`)
  const nestedSets = fs.readdirSync(path.join(nested, '.harness-backup')).filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
  assert(nestedSets.length === 1, `the subdirectory install must produce exactly one backup set (got: ${nestedSets.join(', ')})`)
  assert(exists(nested, path.join('.harness-backup', nestedSets[0], nestedManaged)), 'the locally edited file must actually be inside the backup set')

  // ⑦ `--assume-unchanged`(와 `--skip-worktree`)가 걸린 파일은 고쳐도 `git status` 가 통째로 숨긴다.
  //    status 의 침묵은 "HEAD 와 같다"의 증거가 아니다 — 디스크 내용을 직접 해싱해야 잡힌다.
  const hidden = makeTarget()
  runInit(hidden, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(hidden, 'install')

  const hiddenRel = '.harness/session/active-context.md'
  run('git', ['update-index', '--assume-unchanged', hiddenRel], { cwd: hidden })
  fs.appendFileSync(path.join(hidden, hiddenRel), '\nstatus 가 숨기는 수정\n')
  const quiet = run('git', ['status', '--porcelain'], { cwd: hidden })
  assert(quiet.trim() === '', `precondition: git status must stay silent about the assume-unchanged edit (got: ${quiet})`)

  const hiddenOut = runInit(hidden, '--no-scan', '--no-handoff', '--no-check')
  assert(/backup: .*개 기존 파일/.test(hiddenOut), `an edit git status hides must still be backed up (got: ${hiddenOut})`)
  const hiddenSets = fs.readdirSync(path.join(hidden, '.harness-backup')).filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
  assert(exists(hidden, path.join('.harness-backup', hiddenSets[0], hiddenRel)), 'an --assume-unchanged edit must actually reach the backup set')

  // ⑧ 시계가 어긋나 미래 이름 세트가 남아 있어도 **이번에 만든 백업**은 지우지 않는다. 이번 수정본의 유일한 사본이다.
  const skewed = makeTarget()
  runInit(skewed, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(skewed, 'install')
  for (const stamp of ['2099-01-01T00-00-00-000Z', '2099-02-01T00-00-00-000Z']) {
    fs.mkdirSync(path.join(skewed, '.harness-backup', stamp), { recursive: true })
  }
  fs.appendFileSync(path.join(skewed, '.harness/session/active-context.md'), '\n시계가 어긋난 상태의 수정\n')
  const skewOut = runInit(skewed, '--no-scan', '--no-handoff', '--no-check')
  const madeDir = skewOut.match(/backup: (\S+) \(/)?.[1]
  assert(madeDir, `precondition: a backup set must have been created (got: ${skewOut})`)
  assert(fs.existsSync(madeDir), `the set created by this very install must survive pruning (gone: ${madeDir})`)
  assert(fs.existsSync(path.join(madeDir, '.harness/session/active-context.md')), 'and it must still hold the edited file')
}

// #32(smartscore-backend/common 0.2.146 업데이트 리포트) ①: `.cmd` 는 cmd.exe 의 label/goto 가 LF 에서 깨질 수 있어
// 일부러 CRLF 로 배포하는데(0.2.136), 소비자 저장소에 그 의도를 알려 줄 속성이 없어 git 이 매번
// "CRLF will be replaced by LF" 경고를 냈다. 속성 한 줄로 경고를 없애고 Windows 안전성은 유지한다.
function installDeclaresCmdLineEndingsSoGitStopsWarning() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const attributes = read(target, '.gitattributes')
  assert(attributes.includes('.harness/bin/*.cmd text eol=crlf'), `install must declare the cmd line endings (got: ${attributes})`)
  // 배포본이 실제로 CRLF 인지 — 속성이 그 사실과 맞아야 의미가 있다.
  const cmd = fs.readFileSync(path.join(target, '.harness/bin/harness.cmd'), 'utf8')
  assert(cmd.includes('\r\n'), 'the shipped .cmd must really be CRLF (that is what the attribute declares)')
  // git 이 그 경로에 eol=crlf 를 실제로 적용하는지 확인한다(패턴 오타·범위 오류를 잡는다).
  const attr = run('git', ['check-attr', 'text', 'eol', '--', '.harness/bin/harness.cmd'], { cwd: target })
  assert(attr.includes('eol: crlf') && attr.includes('text: set'), `git must resolve the attribute for the shipped cmd file (got: ${attr})`)
  // 프로젝트 자기 .cmd 에는 정책을 강요하지 않는다.
  const otherAttr = run('git', ['check-attr', 'eol', '--', 'tools/deploy.cmd'], { cwd: target })
  assert(otherAttr.includes('eol: unspecified'), `the harness pattern must not cover the project own cmd files (got: ${otherAttr})`)

  // 멱등: 다시 설치해도 줄이 늘지 않는다.
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const lines = read(target, '.gitattributes').split('\n').filter((line) => line.includes('*.cmd'))
  assert(lines.length === 1, `reinstall must not duplicate the attribute (got ${lines.length} lines)`)

  // 기존 .gitattributes 는 보존하고 뒤에 덧붙인다.
  const withExisting = makeTarget()
  fs.writeFileSync(path.join(withExisting, '.gitattributes'), '*.png binary\n')
  runInit(withExisting, '--no-scan', '--no-handoff', '--no-check')
  const merged = read(withExisting, '.gitattributes')
  assert(merged.includes('*.png binary') && merged.includes('.harness/bin/*.cmd text eol=crlf'), `merge must keep the team entries and add ours (got: ${merged})`)

  // 팀이 그 파일의 eol 을 이미 정해 뒀으면 표기가 어떻든 덮지 않는다. git 은 마지막에 매칭되는 줄이 이기므로,
  // 패턴 문자열만 비교하면 아래 세 표기 모두 우리 줄에 조용히 덮였다(적대적 리뷰 P2-5 실측).
  for (const teamLine of ['.harness/bin/*.cmd text eol=lf', '/.harness/bin/*.cmd text eol=lf', '.harness/bin/harness.cmd text eol=lf', '*.cmd text eol=lf']) {
    const teamChoice = makeTarget()
    fs.writeFileSync(path.join(teamChoice, '.gitattributes'), `${teamLine}\n`)
    runInit(teamChoice, '--no-scan', '--no-handoff', '--no-check')
    const kept = read(teamChoice, '.gitattributes')
    assert(!kept.includes('eol=crlf'), `'${teamLine}': an explicit team decision must not be overridden (got: ${kept})`)
    const resolved = run('git', ['check-attr', 'eol', '--', '.harness/bin/harness.cmd'], { cwd: teamChoice })
    assert(resolved.includes('eol: lf'), `'${teamLine}': git must still resolve the team value (got: ${resolved})`)
  }
}

// #22 ①(scorecard-print) 2단 체인 검증 잔여분(0.2.148, ~/practice/two-stage-lab 픽스처 실측). 스택 init이 공통을
// 중간 태그까지 올린 뒤 공통 init이 최신까지 올리면 구간이 둘로 쪼개진다. 0.2.144의 `--update-from`은 **프로젝트에
// 이미 깔려 있는 업데이터**가 넘기므로, 그보다 낮은 버전에 머문 프로젝트에서는 그 신호가 오지 않아 lock의
// lastUpdate가 중간값으로 좁아졌다(리포트 표식은 0.2.138부터 연속 구간을 이어받아 맞았다 — 두 기록이 갈렸다).
// 이제 lock이 표식이 해결해 둔 출발 버전을 재사용한다. 픽스처 실측: from 0.2.142(좁음) → 0.2.140(맞음),
// 구간에 0.2.141·0.2.142가 되살아났다.
function twoStageUpdateRecordsTheRealStartVersion() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const current = JSON.parse(read(target, '.harness/install-manifest.json')).version
  const lockOf = () => JSON.parse(read(target, '.harness/harness-lock.json'))
  const markerPath = path.join(target, '.harness/generated/pending-report.json')
  // 1단계가 남긴 상태를 흉내 낸다: 설치 기록·lock 은 중간 버전, 표식은 진짜 출발점을 들고 있다.
  // 버전은 CHANGELOG 의 실제 절 목록에서 고른다(적대적 리뷰: 하드코딩은 옛 절이 아카이브되면 깨진다).
  const released = (read(repoRoot, 'CHANGELOG.md').match(/^## (\d+\.\d+\.\d+) /gm) ?? []).map((line) => line.slice(3).trim().split(' ')[0])
  assert(released[0] === current && released.length >= 5, `precondition: CHANGELOG top must be the installed version with at least 4 older sections (got ${released.slice(0, 5).join(', ')})`)
  const middle = released[2]   // 두 릴리스 전 = 스택 단계가 올린 중간 태그
  const start = released[4]    // 네 릴리스 전 = 진짜 출발점
  const between = released[3]  // 좁아지면 이 구간이 빠진다
  const stageOne = () => {
    const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
    manifest.version = middle
    fs.writeFileSync(path.join(target, '.harness/install-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const lock = lockOf()
    lock.baseHarness.version = middle
    fs.writeFileSync(path.join(target, '.harness/harness-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(markerPath, `${JSON.stringify({ kind: 'update', from: start, to: middle, at: new Date().toISOString() }, null, 2)}\n`)
  }

  stageOne()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const chained = lockOf().lastUpdate
  const marker = JSON.parse(read(target, '.harness/generated/pending-report.json'))
  assert(marker.from === start, `precondition: the report marker must carry the real start (got: ${marker.from})`)
  assert(chained?.from === start, `the lock must record the real start version, not the intermediate one (got: ${chained?.from})`)
  assert(chained?.to === current, `the lock must record the installed version as the target (got: ${chained?.to})`)
  // 중간 구간이 되살아났는지 — 좁아지면 이 두 버전이 빠진다.
  const versions = (chained?.entries ?? []).map((entry) => entry.version)
  assert(versions.includes(between) && versions.includes(middle), `the changelog delta must span the full range including ${between} and ${middle} (got: ${versions.join(', ')})`)

  // 표식이 없으면(연속 구간이 아니면) 종전 규칙 그대로 직전 lock 버전에서 시작한다 — 없는 구간을 지어내지 않는다.
  const plain = makeTarget()
  runInit(plain, '--no-scan', '--no-handoff', '--no-check')
  const plainManifest = JSON.parse(read(plain, '.harness/install-manifest.json'))
  plainManifest.version = middle
  fs.writeFileSync(path.join(plain, '.harness/install-manifest.json'), `${JSON.stringify(plainManifest, null, 2)}\n`)
  const plainLock = JSON.parse(read(plain, '.harness/harness-lock.json'))
  plainLock.baseHarness.version = middle
  fs.writeFileSync(path.join(plain, '.harness/harness-lock.json'), `${JSON.stringify(plainLock, null, 2)}\n`)
  fs.rmSync(path.join(plain, '.harness/generated/pending-report.json'), { force: true })
  runInit(plain, '--no-scan', '--no-handoff', '--no-check')
  const plainUpdate = JSON.parse(read(plain, '.harness/harness-lock.json')).lastUpdate
  assert(plainUpdate?.from === middle, `without a chained marker the start must stay the previous lock version (got: ${plainUpdate?.from})`)
}

// 0.2.140 — 백엔드 common 첫 설치 실측: 설치 경로에는 "리포트를 남길까요?" 질문 의무가 닿지 않아
// (그 문서는 업데이트 스킬에만) 에이전트가 토큰 없음→파일에서 멈추고 전달까지 못 갔다.
// 설치 완료 출력의 맨 마지막이 질문 의무·전달 경로를 직접 말해야 한다.
function installOutputEndsWithReportPrompt() {
  const target = makeTarget()
  const out = runInitDefaultHooks(target, '--no-scan', '--no-handoff', '--no-check')
  assert(out.includes('설치 결과 리포트를 남길까요'), 'install output must tell the agent to ask about the report')
  assert(out.includes('AskUserQuestion'), 'install output must name the question UI so Claude-family agents do not skip it')
  assert(out.includes('HARNESS_BODY_ISSUE_TOKEN'), 'install output must explain the no-token path (file → hand over, or request the shared token once)')
  assert(out.lastIndexOf('설치 결과 리포트') > out.indexOf('소비자 명령 빠른 안내'), 'the report prompt must be the last block, after the command guide')
  // 스택 init 내부 실행(embedded)은 스택이 최종 안내를 맡으므로 이 블록을 찍지 않는다.
  const embedded = makeTarget()
  const outEmbedded = run(nodeBin, [path.join(repoRoot, 'scripts/init.mjs'), 'init', '--no-hooks', '--embedded', '--no-scan', '--no-handoff', '--no-check'], { cwd: embedded })
  assert(!outEmbedded.includes('설치 결과 리포트를 남길까요'), 'embedded base init must leave the final guidance to the stack harness')
}

// 0.2.141: 연결 선언을 사람이 JSON으로 쓰지 않게 — `harness linked add`가 폴더의 git remote로 정체를 뽑아
// 폴더 없는 선언(2026-09-08 실측, PHP 백엔드 리허설): git 주소만 주고 이 PC에 그 저장소가 없으면 dir이
// null인데, 자기 자신 검사가 `path.resolve(dir ?? '')`로 빈 문자열을 cwd로 풀어 저장소 루트와 같다고 판정했다.
// 저장소 루트에서 실행하는 정상 경로에서 항상 죽으므로 문서가 약속한 "선언은 저장됐으니 폴더만 열리면 다음
// 세션부터 연결" 경로는 닿을 수 없었다. 선언은 기록되고, 개인 설정은 만들지 않아야 한다.
function linkedAddDeclaresWithoutLocalFolder() {
  const front = makeTarget()
  runInit(front, '--no-scan', '--no-handoff', '--no-check')
  fs.rmSync(path.join(front, '.claude/settings.local.json'), { force: true })
  const out = run(harnessBin(front), ['linked', 'add', '--repo', 'https://git.example.com/team/frontend.git', '--label', '프론트', '--no-dir'], { cwd: front })
  assert(!out.includes('자기 자신'), 'a URL-only declaration must not be mistaken for a self-link (dir is null, not cwd)')
  const profile = JSON.parse(read(front, '.harness/policy/profile.json'))
  assert(profile.linkedProjects.length === 1 && profile.linkedProjects[0].repo === 'https://git.example.com/team/frontend.git',
    'the declaration must be written even when no local folder resolves')
  assert(!fs.existsSync(path.join(front, '.claude/settings.local.json')), '--no-dir must not create personal settings')
  assert(out.includes('폴더를 찾지 못했습니다') || out.includes('선언은 저장됐으니'), 'the output must tell the developer the folder is not yet opened on this PC')
}

// profile(팀)과 settings.local.json(개인)을 함께 쓰고, 같은 저장소 재실행은 갱신만 한다. 스킬 /연결프로젝트가 이 명령을 부른다.
function linkedAddWritesProfileAndLocalSettings() {
  const front = makeTarget()
  const back = makeTarget()
  runInit(front, '--no-scan', '--no-handoff', '--no-check')
  runInit(back, '--no-scan', '--no-handoff', '--no-check')
  fs.mkdirSync(path.join(back, 'svc/multisite'), { recursive: true })
  fs.writeFileSync(path.join(back, 'svc/multisite/CLAUDE.md'), '# 서비스 룰\n')
  run('git', ['remote', 'add', 'origin', 'https://git.example.com/team/backend.git'], { cwd: back })
  const rel = path.relative(front, back)
  // add 전 상태를 '깨끗'으로 통제한다(시드 개인 파일 유출은 installNeverShipsTheSeedsPersonalLocalFiles가 잠근다 — 여기서는 방어적으로만 지운다).
  fs.rmSync(path.join(front, '.claude/settings.local.json'), { force: true })

  const out = run(harnessBin(front), ['linked', 'add', '--repo', rel, '--focus', 'svc/multisite', '--label', '백엔드'], { cwd: front })
  const profile = JSON.parse(read(front, '.harness/policy/profile.json'))
  assert(profile.linkedProjects.length === 1, 'one declaration must be written')
  assert(profile.linkedProjects[0].repo === 'https://git.example.com/team/backend.git', 'the repo identity must come from the folder git remote, not the path')
  assert(profile.linkedProjects[0].label === '백엔드' && profile.linkedProjects[0].focus === 'svc/multisite', 'label/focus must be recorded')
  assert(!('path' in profile.linkedProjects[0]), 'no per-PC path may land in the team file')
  const local = JSON.parse(read(front, '.claude/settings.local.json'))
  assert(local.permissions.additionalDirectories.some((d) => path.resolve(front, d) === back), 'the folder must be opened in the personal settings')
  assert(out.includes('커밋하세요') && out.includes('커밋하지 마세요'), 'the output must say which file to commit and which not')
  assert(out.includes(back) && out.includes('git remote 일치'), 'the trailing status must show the link resolved')

  // 같은 저장소를 ssh 표기로 다시 — 갱신만, 폴더도 중복 없음
  run(harnessBin(front), ['linked', 'add', '--repo', 'git@git.example.com:team/backend.git', '--label', '백엔드API', '--dir', rel], { cwd: front })
  const profile2 = JSON.parse(read(front, '.harness/policy/profile.json'))
  assert(profile2.linkedProjects.length === 1 && profile2.linkedProjects[0].label === '백엔드API', 're-adding the same repo (other notation) must update, not duplicate')
  const local2 = JSON.parse(read(front, '.claude/settings.local.json'))
  assert(local2.permissions.additionalDirectories.length === 1, 'the folder must not be duplicated')

  // 인자 없는 harness linked 는 상태 표
  const status = run(harnessBin(front), ['linked'], { cwd: front })
  assert(status.includes('백엔드API') && status.includes(back), 'bare linked must still print the status table')

  // 스킬 문서가 설치되고 명령을 가리킨다
  assert(exists(front, '.claude/commands/연결프로젝트.md'), 'the /연결프로젝트 command doc must be installed')
  assert(read(front, '.claude/commands/연결프로젝트.md').includes('harness linked add'), 'the skill must call the deterministic command instead of hand-writing JSON')
}

// 0.2.135 — 멀티사이트 2: maintenance 은퇴(0.2.131) 이전 설치본의 profile notes에는
// 은퇴 값을 권장하는 화석 문장이 남는다(project-owned라 업데이트가 안 덮음). 옛 문장은
// 이력상 한 종류뿐이라 정확 치환하고, 소비자가 고친 notes는 불일치라 보존된다.
function updateRefreshesStaleHarnessModeNotes() {
  const staleSentence = 'harnessMode는 bootstrap, active, maintenance, strict 중 하나를 권장합니다.'
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const profileRel = '.harness/policy/profile.json'
  const profile = JSON.parse(read(target, profileRel))
  profile.notes = `옛 설치본 서문. ${staleSentence} 옛 설치본 후문.`
  profile.customField = 'keep-me'
  writeJson(target, profileRel, profile)

  const out = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(out.includes('harnessMode 안내를 갱신'), 'update must report the notes refresh')
  const after = JSON.parse(read(target, profileRel))
  assert(!after.notes.includes(staleSentence), 'the stale sentence must be gone')
  assert(after.notes.includes('은퇴했습니다'), 'the refreshed sentence must state the retirement')
  assert(after.notes.startsWith('옛 설치본 서문.') && after.notes.endsWith('옛 설치본 후문.'), 'surrounding consumer text must be preserved')
  assert(after.customField === 'keep-me', 'other consumer fields must be preserved byte-for-byte')

  // 소비자가 문장을 고쳐 쓴 경우(원문 부재)는 건드리지 않는다.
  const target2 = makeTarget()
  runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  const profile2 = JSON.parse(read(target2, profileRel))
  profile2.notes = '팀이 직접 정리한 안내문.'
  writeJson(target2, profileRel, profile2)
  const out2 = runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  assert(!out2.includes('harnessMode 안내를 갱신'), 'consumer-edited notes must not be touched or reported')
  assert(JSON.parse(read(target2, profileRel)).notes === '팀이 직접 정리한 안내문.', 'edited notes must stay verbatim')
}

// 0.2.135 — 멀티사이트 3: bootstrap(정착기)은 동기화 후보를 항상 참고 등급으로 낮춘다.
// 종전 조건(소스 변경 0건)은 .gitlab-ci.yml 하나(other)로도 무효가 되어 실측 발동 0회 —
// bootstrap과 active의 차이가 사실상 없었다.
function bootstrapModeAlwaysRelaxesSyncCandidates() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')

  fs.appendFileSync(
    path.join(target, '.harness/project/portability-guide.md'),
    '\n## Local project edit\n- 프로젝트가 직접 수정한 런타임 기준입니다.\n',
  )
  fs.writeFileSync(path.join(target, '.gitlab-ci.yml'), 'stages: [test]\n')

  const profileRel = '.harness/policy/profile.json'
  const profile = JSON.parse(read(target, profileRel))

  writeJson(target, profileRel, { ...profile, harnessMode: 'bootstrap' })
  const relaxed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(/참고 \d+건/.test(relaxed), 'bootstrap must grade sync candidates as informational even with source changes')
  assert(!/가볍게 확인 \d+건/.test(relaxed), 'bootstrap must not leave candidates at the default advisory grade')
  // 멀티사이트 회신 제안: 강제 선언 0건이면 완화가 전면 참고화임을 스스로 알게 한다.
  assert(relaxed.includes('bootstrap 완화 적용 중'), 'a fully-relaxed bootstrap project must be told all candidates are informational')

  writeJson(target, profileRel, { ...profile, harnessMode: 'active' })
  const active = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(/가볍게 확인 \d+건/.test(active), 'active must keep the default advisory grade')
  assert(!active.includes('bootstrap 완화 적용 중'), 'the full-relaxation notice must not appear outside bootstrap')
}

// 0.2.136 — clubadm 공유 제보(2026-09-01)로 발견: runGit의 전체 trim이 porcelain 첫 줄의
// 선행 공백(' M ' 상태 문자)을 먹어, 알파벳순 첫 변경 파일의 이름이 한 글자 깨졌다
// ('.gitignore' → 'gitignore'). critical path 매칭·캐시 키·edge 감지가 그 파일만 조용히
// 놓친다. 제보 팀은 "의도된 동작"으로 오판하고 결함 보고를 접었었다 — 재현으로 뒤집음.
function firstAlphabeticalUnstagedChangeKeepsItsName() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  fs.writeFileSync(path.join(target, '.harness/project/critical-paths.md'), [
    '| path | 왜 중요한가 | 권장 검증 |',
    '| --- | --- | --- |',
    '| `.gitignore` | 무시 규칙 | 확인 |',
    '',
  ].join('\n'))
  run('git', ['add', '-A'], { cwd: target })
  run('git', ['commit', '-qm', 'baseline'], { cwd: target })
  // .gitignore는 알파벳순 첫 변경 파일 + 미스테이징 수정(' M' — 선행 공백 상태 문자)의 대표 사례.
  fs.appendFileSync(path.join(target, '.gitignore'), 'node_modules/\n')

  const out = runGuard(target)
  assert(out.includes('Critical path review'), 'a dotfile-first unstaged change must still reach critical path review')
  assert(out.includes('- .gitignore'), 'the first alphabetical changed file must keep its full name (leading dot intact)')
}

// 0.2.136 — 멀티사이트 제보 결함 B: managed 무결성 검사가 줄바꿈 차이를 "소비자 수정"으로
// 오판해 파일을 업데이트에서 영구 제외시켰다(실사고: harness.cmd 동결). 내용 동일성은
// eol과 무관해야 한다 — 정규화 sha 비교 + 결함 A 잔재(CRLF sha 기록 manifest) 폴백까지 잠근다.
function crlfCheckoutDoesNotFreezeManagedFiles() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const crlfify = (rel) => {
    const abs = path.join(target, rel)
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\r?\n/g, '\r\n'))
  }
  crlfify('.harness/bin/harness.cmd')
  crlfify('.harness/project/terminology.md')

  const guardOut = runGuard(target)
  assert(!guardOut.includes('설치 기록과 다릅니다'), 'eol-only differences must not be reported as managed drift')

  const updateOut = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(!updateOut.includes('갱신하지 못한'), 'eol-only differences must not exclude files from updates')
  const md = read(target, '.harness/project/terminology.md')
  assert(!md.includes('\r'), 'refreshed text files must come back normalized to LF')

  // 결함 A 잔재 폴백: 설치자 autocrlf 경유로 CRLF 바이트 sha가 기록된 manifest도 원문 일치로 본다.
  const target2 = makeTarget()
  runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  const rel = '.harness/project/terminology.md'
  const abs2 = path.join(target2, rel)
  fs.writeFileSync(abs2, fs.readFileSync(abs2, 'utf8').replace(/\r?\n/g, '\r\n'))
  const manifest = JSON.parse(read(target2, '.harness/install-manifest.json'))
  manifest.managedFiles[rel] = { sha256: sha256Text(fs.readFileSync(abs2, 'utf8')) }
  writeJson(target2, '.harness/install-manifest.json', manifest)
  const out2 = runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  assert(!out2.includes('갱신하지 못한'), 'a CRLF-recorded manifest (defect-A installer) must still match its file')
}

// 0.2.136 — 멀티사이트 제보 결함 A: 설치기가 clone/npx 캐시의 체크아웃 바이트를 그대로 복사해
// 설치자의 git eol 설정이 결과물에 새었다. 설치 쓰기를 결정적으로: 텍스트는 LF,
// cmd.exe 배치(.cmd/.bat)는 CRLF(label/goto가 LF에서 깨질 수 있음), 실행 모드는 원본 보존.
function installerWritesDeterministicEol() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const cmd = fs.readFileSync(path.join(target, '.harness/bin/harness.cmd'), 'utf8')
  assert(cmd.includes('\r\n'), 'the cmd.exe launcher must be written with CRLF (Windows label/goto)')
  assert(!/[^\r]\n/.test('x' + cmd.replaceAll('\r\n', '')), 'the cmd launcher must not mix bare LF lines')
  const sh = fs.readFileSync(path.join(target, '.harness/bin/harness'), 'utf8')
  assert(!sh.includes('\r'), 'the sh launcher must be written with LF only')
  const hookMode = fs.statSync(path.join(target, '.githooks/pre-commit')).mode & 0o111
  assert(hookMode !== 0, 'extensionless hooks must keep their executable bit through the deterministic writer')
}

// 0.2.136 — 커밋 템플릿 재분류(멀티사이트 백엔드 문답): 커밋 형식은 팀 관례라 프로젝트
// 소유가 맞다. managed로 두면 커스텀한 팀이 드리프트 경고를 영구히 받았다.
function commitTemplateIsProjectOwnedAndCustomizable() {
  const rel = '.github/commit-template.txt'
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(exists(target, rel), 'the commit template seed must still be installed')
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!manifest.managedFiles[rel], 'the commit template must not be a managed file')
  assert(manifest.projectOwnedFiles.includes(rel), 'the commit template must be listed as project-owned')

  // 커스텀해도 경고 없음 + 업데이트가 보존.
  fs.writeFileSync(path.join(target, rel), '# 우리 팀 커밋 형식\n[모듈] 요약\n')
  const guardOut = runGuard(target)
  assert(!guardOut.includes(rel), 'a customized commit template must not appear in drift warnings')
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(read(target, rel) === '# 우리 팀 커밋 형식\n[모듈] 요약\n', 'updates must preserve the customized template verbatim')

  // 구설치 마이그레이션: managed로 기록돼 있던 항목이 업데이트 한 번에 프로젝트 소유로 이탈.
  const target2 = makeTarget()
  runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  const manifest2 = JSON.parse(read(target2, '.harness/install-manifest.json'))
  manifest2.managedFiles[rel] = { sha256: sha256Text(read(target2, rel)) }
  writeJson(target2, '.harness/install-manifest.json', manifest2)
  runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  const after = JSON.parse(read(target2, '.harness/install-manifest.json'))
  assert(!after.managedFiles[rel], 'a legacy managed entry must leave managedFiles after one update')
  assert(after.projectOwnedFiles.includes(rel), 'the migrated template must be listed as project-owned')
}

// 0.2.146 — smartscore-backend/common 후속 제보 ②(Codex 설계 리뷰 반영): 개인 .git/info/exclude(/.claude/*) 때문에 하네스
// 파일 21개가 커밋에서 빠져 팀원 pull 시 settings.json이 없는 훅을 부르게 됐다. 설치 뒤 "공유 대상인데 미추적이고 실제로
// ignore되는" 산출물을 원인 규칙(파일:줄:패턴)과 함께 경고한다. 추적된 파일·!패턴으로 재포함된 파일·하네스가 의도적으로
// ignore하는 파일(generated·settings.local 등)은 경고하지 않는다. ignore 규칙을 고치거나 강제 추가하지는 않는다.
function installWarnsWhenSharedOutputsAreGitIgnored() {
  const target = makeTarget()
  fs.appendFileSync(path.join(target, '.git/info/exclude'), '/.claude/*\n')
  const out = run('sh', ['-c', `"${nodeBin}" "${path.join(repoRoot, 'scripts/init.mjs')}" init --no-scan --no-handoff --no-check --no-hooks 2>&1`], { cwd: target })
  assert(out.includes('팀 공유에서 누락될 수 있습니다'), 'ignored shared outputs must be warned about (as a possibility, not a fact)')
  assert(out.includes('.claude/settings.json') && out.includes('.claude/hooks/block-dangerous.sh'), 'the warning must name the affected files')
  assert(/info\/exclude:\d+/.test(out) && out.includes('/.claude/*'), 'the warning must point at the rule source, line and pattern')
  const warnedPaths = (text) => [...text.matchAll(/^\s+- (\S+)\s+←/gm)].map((m) => m[1])
  assert(warnedPaths(out).length > 0 && !warnedPaths(out).some((p) => p.startsWith('.harness/generated') || p.endsWith('settings.local.json')), 'intentionally ignored harness files must not be in the warning list')
  assert(fs.readFileSync(path.join(target, '.git/info/exclude'), 'utf8').includes('/.claude/*'), 'the installer must not edit ignore rules')

  // 추적된 파일과 !패턴 재포함은 경고하지 않고, 팀 .gitignore도 같은 강도로 경고한다.
  const t2 = makeTarget()
  runInit(t2, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(t2, 'harness committed')
  fs.appendFileSync(path.join(t2, '.gitignore'), '/.harness/bin/\n/.claude/*\n!/.claude/hooks/\n')
  const again = run('sh', ['-c', `"${nodeBin}" "${path.join(repoRoot, 'scripts/init.mjs')}" init --no-scan --no-handoff --no-check --no-hooks 2>&1`], { cwd: t2 })
  assert(!again.includes('팀 공유에서 누락될 수 있습니다'), 'already-tracked files matching an ignore rule are not at risk and must not be warned about')
  fs.writeFileSync(path.join(t2, '.claude/hooks/new-team-hook.sh'), '#!/bin/sh\nexit 0\n')  // 재포함(!/.claude/hooks/)된 새 파일
  fs.writeFileSync(path.join(t2, '.harness/bin/extra-tool.mjs'), '// untracked, ignored by team rule\n')
  const settings = JSON.parse(read(t2, '.claude/settings.json'))
  settings.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/bin/extra-tool.mjs"' }] })
  writeJson(t2, '.claude/settings.json', settings)
  const third = run('sh', ['-c', `"${nodeBin}" "${path.join(repoRoot, 'scripts/init.mjs')}" init --no-scan --no-handoff --no-check --no-hooks 2>&1`], { cwd: t2 })
  assert(third.includes('팀 공유에서 누락될 수 있습니다') && third.includes('.harness/bin/extra-tool.mjs') && /\.gitignore:\d+/.test(third), 'an untracked file that existing settings reference and the team .gitignore excludes must be warned about with the team rule as source')
  assert(!third.includes('new-team-hook.sh'), 'a file re-included by a !pattern must not be warned about')
}

// 0.2.136 — 백엔드 첫 적용 리포트 ③(guard 측): manifest의 projectOwnedFiles에 있는 파일은
// managed에 이중 등록돼 있어도(구설치 잠복 창) 드리프트로 잡지 않는다.
function driftSkipsProjectOwnedListedEntries() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const rel = '.harness/project/spec-map.md'
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.managedFiles[rel] = { sha256: sha256Text(read(target, rel)) } // 구설치 이중 등록 재현
  writeJson(target, '.harness/install-manifest.json', manifest)
  fs.appendFileSync(path.join(target, rel), '\n| 기획.md | src/** | 담당 |\n') // 채우는 순간
  const out = runGuard(target)
  assert(!out.includes(rel), 'project-owned files must never be reported as managed drift even when dual-registered')

  // 진짜 managed 변조는 여전히 잡혀야 필터가 과하지 않음이 증명된다.
  fs.appendFileSync(path.join(target, '.harness/bin/doc-link-check.mjs'), '\n// 소비자 변조\n')
  const out2 = runGuard(target)
  assert(out2.includes('.harness/bin/doc-link-check.mjs'), 'genuine managed drift must still be reported')
}

// 0.2.139 — scorecard #8: 매 실행 동일한 명령 안내 블록이 업데이트 출력의 절반을 차지해
// 에이전트가 grep 필터를 걸게 만들었다. 업데이트 출력은 "달라진 것 + 해야 할 일"만 남긴다.
// 2026-09-08 scorecard #22: 그 다이어트는 update-harness의 꼬리말만 줄였고, update가 띄우는
// `npx … init` 둘은 각자 전체 블록을 그대로 찍었다(293줄). 이 회귀는 존재하지 않는 옛 제목
// ("업데이트 후 유용한 소비자 명령")을 단언해 항상 통과했다 — 실제 제목으로, 실제 경로(init 재실행)에서 본다.
function updateOutputSkipsStaticCommandGuide() {
  const target = makeTarget()
  const first = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(first.includes('::: 소비자 명령 빠른 안내 :::'), 'a first install may show the full command guide (precondition)')
  assert(first.includes('::: 다음 단계 :::') && first.includes('::: 문서 :::'), 'a first install shows next steps and the document list (precondition)')
  const second = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(!second.includes('::: 소비자 명령 빠른 안내 :::'), 'an update (init over an installed project) must not repeat the static command guide')
  assert(second.includes('명령 전체 목록'), 'the update must leave a one-line pointer to the launcher instead')
  // club-admin #25 (2026-09-08): 다이어트가 옆 블록에는 닿지 않았다 — "다음 단계"(스택 확인·훅 활성화·제거 계획…)와
  // "문서" 32줄이 업데이트마다 그대로 나왔다. 이미 스택·훅이 있는 프로젝트엔 해당 없는 항목이고 제거 안내는 방향이 반대다.
  // "현재 상태"(버전·갱신/보존 수)는 업데이트에서도 확인 가치가 있어 남긴다(제보자 권고).
  assert(!second.includes('::: 다음 단계 :::') && !second.includes('::: 문서 :::'), 'an update must not repeat the first-install next-steps and document list')
  assert(second.includes('::: 현재 상태 :::') && second.includes('설치/갱신된 하네스 관리 파일'), 'the status block (version, updated/preserved counts) must stay on updates — teams read it to confirm project-owned files survived')
  const out = run(nodeBin, [path.join(target, '.harness/bin/update-harness.mjs'), '--base-only', '--dry-run'], { cwd: target })
  assert(!out.includes('::: 소비자 명령 빠른 안내 :::'), 'the update orchestrator must not print it either')
}

// scorecard #22 (2026-09-08): 여러 버전을 한 번에 올리면 lastUpdate가 마지막 구간만 남았다. update는 2단으로
// 돈다 — 스택 init이 내부에서 base를 스택이 고정한 태그까지 올리고(137→142), 이어 base init이 최신까지(142→143)
// 올리며 lastUpdate를 자기 구간으로 덮어썼다. 표식(pending-report)의 from도 같은 이유로 142가 됐다.
// update가 시작 시점의 base 버전을 --update-from으로 넘기면 마지막 base init이 그 값으로 구간을 기록해야 한다.
// 표식은 플래그 없이도 "직전 표식의 to == 지금 시작 버전"이면 원래 from을 이어받는다(표식은 report:install이
// 지우므로 안전하다). lastUpdate는 영구 기록이라 그런 추정을 하지 않고 플래그만 믿는다.
function chainedUpdateKeepsOriginalFromForChangelogAndReport() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // 스택 단계가 남긴 상태를 재현: base는 0.2.142에 있고, 그 단계가 0.2.137→0.2.142를 기록해 뒀다.
  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  lock.baseHarness.version = '0.2.142'
  lock.lastUpdate = { from: '0.2.137', to: '0.2.142', at: new Date().toISOString(), entries: [{ version: '0.2.142', date: '', lines: [] }] }
  writeJson(target, '.harness/harness-lock.json', lock)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  manifest.version = '0.2.142'
  writeJson(target, '.harness/install-manifest.json', manifest)
  writeJson(target, '.harness/generated/pending-report.json', { kind: 'update', from: '0.2.137', to: '0.2.142', at: new Date().toISOString() })

  // 마지막 base 단계: update가 시작 버전을 넘겨준다.
  runInit(target, '--no-scan', '--no-handoff', '--no-check', '--update-from', '0.2.137')
  const after = JSON.parse(read(target, '.harness/harness-lock.json'))
  assert(after.lastUpdate.from === '0.2.137', `lastUpdate.from must be the version the whole update started from, got ${after.lastUpdate.from}`)
  assert(after.lastUpdate.to === packageVersion, 'lastUpdate.to is the newly installed version')
  const versions = after.lastUpdate.entries.map((e) => e.version)
  assert(versions.includes('0.2.138') && versions.includes('0.2.142') && versions.includes(packageVersion),
    `the recorded entries must cover the skipped versions, got ${versions.join(', ')}`)
  const marker = JSON.parse(read(target, '.harness/generated/pending-report.json'))
  assert(marker.from === '0.2.137' && marker.to === packageVersion, `the report marker must span the whole update, got ${marker.from}→${marker.to}`)

  // harness changelog가 그 구간을 그대로 다시 보여준다.
  const replay = run(nodeBin, [path.join(target, '.harness/bin/changelog-delta.mjs')], { cwd: target })
  assert(replay.includes('0.2.137') && replay.includes('0.2.138'), 'harness changelog must replay the full span including skipped versions')

  // update 오케스트레이터가 실제로 그 플래그를 base 단계에 넘긴다(dry-run이 명령을 찍는다).
  const plan = run(nodeBin, [path.join(target, '.harness/bin/update-harness.mjs'), '--base-only', '--dry-run'], { cwd: target })
  assert(plan.includes(`--update-from ${packageVersion}`), 'update must hand the base stage the version it started from')

  // 플래그 없는 재실행(스택 init이 base를 한 번 더 돌리는 경우): 표식은 직전 표식의 to == 시작 버전이면 from을 잇는다.
  writeJson(target, '.harness/generated/pending-report.json', { kind: 'update', from: '0.2.130', to: packageVersion, at: new Date().toISOString() })
  const lock2 = JSON.parse(read(target, '.harness/harness-lock.json')); lock2.baseHarness.version = packageVersion; writeJson(target, '.harness/harness-lock.json', lock2)
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const marker2 = JSON.parse(read(target, '.harness/generated/pending-report.json'))
  assert(marker2.from === '0.2.130', 'a same-cycle re-run must keep the marker\'s original from (existing behaviour, 0.2.138)')
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

// 서비스 폴더의 유형별 룰 파일(2026-09-08 실측, PHP 백엔드 ss/multisite): 등록부에 올린 프로젝트 문서는 내용이 딱 맞아도
// 관련 문서 12칸에서 밀려났다 — 후보 병합이 "컨텍스트 레지스트리 항목 전부 → 그 다음 등록 문서" 순이고, 루트 문서들은
// 작업 유형만 맞아도 +8이라 12칸을 다 채운다. 등록 문서 중 실제로 맞는 것에는 자리를 보장해야 한다(최대 3).
function registeredServiceRuleDocKeepsASlotInRelevantPolicies() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  fs.mkdirSync(path.join(target, 'ss/multisite/rules'), { recursive: true })
  fs.writeFileSync(path.join(target, 'ss/multisite/rules/architecture.md'),
    '# 멀티사이트 아키텍처 규칙\n## 경기관제 API 응답\n- 모든 관제 API는 `{ ok, data, serverTime }` 봉투로 응답한다.\n')
  fs.writeFileSync(path.join(target, 'ss/multisite/CLAUDE.md'), '# 멀티사이트\n- [아키텍처](rules/architecture.md)\n')
  // 같이 등록된 절차 문서(슬래시 명령·셋업 안내)가 흔한 낱말을 수십 번 반복하면 점수(단어당 최대 5점)로는
  // 앞선다 — 실제 PHP 저장소에서 .claude/commands/*.md 둘과 DEV_SETUP.md가 보장 3칸을 다 먹었다(2026-09-08).
  fs.mkdirSync(path.join(target, '.claude/commands'), { recursive: true })
  const chatter = '- API 수정 절차: API를 수정하고 응답을 수정한다.\n'.repeat(30)
  fs.writeFileSync(path.join(target, '.claude/commands/migrate.md'), `# 마이그레이션 명령\n${chatter}`)
  fs.writeFileSync(path.join(target, '.claude/commands/register.md'), `# 등록 명령\n${chatter}`)
  fs.writeFileSync(path.join(target, 'DEV_SETUP.md'), `# 셋업\n${chatter}`)
  writeJson(target, '.harness/documentation/document-registry.local.json', {
    children: ['ss/multisite/CLAUDE.md', 'ss/multisite/rules/architecture.md', '.claude/commands/migrate.md', '.claude/commands/register.md', 'DEV_SETUP.md'],
  })

  run(harnessBin(target), ['context', '경기관제 API 응답 봉투 수정'], { cwd: target })
  let ctx = read(target, '.harness/session/task-context.md')
  let relevant = ctx.split('## Relevant Policies')[1].split('\n## ')[0]
  assert(relevant.includes('ss/multisite/rules/architecture.md'),
    'a registered service rule doc whose content matches the request must keep a slot in Relevant Policies even when root docs fill the cap by task type')
  // 요청 단어를 넷 담은 문서가, 두 단어를 서른 번 반복한 절차 문서보다 먼저 보장 자리를 받아야 한다.
  assert(!relevant.includes('.claude/commands/register.md') || relevant.indexOf('ss/multisite/rules/architecture.md') < relevant.indexOf('.claude/commands/register.md'),
    'reserved slots must prefer the doc covering more distinct request words over one repeating a common word')
  // 루트 문서가 통째로 밀려나면 안 된다 — 보장은 최대 3칸이다.
  assert(relevant.includes('.harness/project/architecture-rules.md'), 'root rule docs must still be present')

  // 한 파일 모양 — 서비스 폴더 CLAUDE.md에 규칙을 직접 담아도(등록만 하면) 같은 자리를 받는다 (2026-09-08 사용자 질문).
  fs.rmSync(path.join(target, 'ss/multisite/rules'), { recursive: true, force: true })
  fs.writeFileSync(path.join(target, 'ss/multisite/CLAUDE.md'),
    '# 멀티사이트 백엔드 (ss/multisite) 전용 규칙\n\n## 아키텍처\n- 모든 경기관제 API는 `{ ok, data, serverTime }` 봉투로 응답한다.\n')
  writeJson(target, '.harness/documentation/document-registry.local.json', {
    children: ['ss/multisite/CLAUDE.md', '.claude/commands/migrate.md', '.claude/commands/register.md', 'DEV_SETUP.md'],
  })
  run(harnessBin(target), ['context', '경기관제 API 응답 봉투 수정'], { cwd: target })
  ctx = read(target, '.harness/session/task-context.md')
  relevant = ctx.split('## Relevant Policies')[1].split('\n## ')[0]
  assert(relevant.includes('ss/multisite/CLAUDE.md'),
    'a registered service-folder CLAUDE.md holding the rules itself must be selected like any registered rule doc')
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

// 프로젝트가 자기 진입점(CLAUDE.md)을 이미 갖고 있으면 설치는 그 파일 **위에 하네스 블록을 얹는다**
// (2026-09-08). 0.2.142까지는 통째 보존 + "읽기 순서를 연결할지 검토하세요"였는데, 에이전트 없이 터미널에서
// npx로 설치한 개발자는 그 문장으로 무엇을 어디에 쓰라는지 알 수 없었다(사용자 지적). 마커 설계상 답은
// 정해져 있다(위 = 본체, 아래 = 프로젝트). 기존 내용은 한 글자도 바뀌지 않아야 하고, 결과는 정상 설치본과
// 같은 모양이어야 다음 업데이트가 마커 머지 경로를 탄다. 검사의 수동 조치는 블록이 나중에 지워진 경우를 위해
// 남고, 그 문구는 구체적인 복구 방법(재설치/업데이트로 자동 부착)을 말한다.
function checkFlagsAnUnlinkedProjectEntrypointUntilItIsLinked() {
  const target = makeTarget()
  const own = '# 프로젝트 규약\n\n이 저장소에서 코드를 작성·수정할 때는 아래 규약을 반드시 따른다.\n\n@CONVENTIONS.md\n'
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), own)
  fs.writeFileSync(path.join(target, 'CONVENTIONS.md'), '# 규약\n\n- 규칙\n')
  const out = runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const merged = read(target, 'CLAUDE.md')
  assert(merged.startsWith('<!-- harness-managed:start -->'), 'the harness block must be prepended at the very top')
  assert(merged.includes('<!-- harness-managed:end -->'), 'the block must be closed with the end marker')
  assert(merged.endsWith(own), 'the project\'s own content must follow the block byte-for-byte — nothing rewritten')
  assert(merged.indexOf('<!-- harness-managed:end -->') < merged.indexOf('@CONVENTIONS.md'), 'project content must sit below the block (project area)')
  assert(out.includes('위에 하네스 읽기 순서 블록을 얹었습니다') && out.includes('할 일은 없습니다'),
    'the terminal message must state what was done, not hand the developer a vague task')
  assert(!out.includes('수동 이전 필요') && !out.includes('연결할지 검토하세요'), 'the old vague instructions must be gone')

  // 얹은 결과는 정상 설치본 모양이라 검사는 조용해야 한다.
  const quiet = run(harnessBin(target), ['check'], { cwd: target })
  assert(!quiet.includes('CLAUDE.md에 하네스 읽기 순서 미연결'), 'a prepended entrypoint is linked — no manual action')

  // 두 번째 업데이트는 마커 머지 경로를 타야 한다(블록만 갱신, 아래 내용 보존, 다시 얹지 않음).
  const out2 = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const merged2 = read(target, 'CLAUDE.md')
  assert(merged2.split('<!-- harness-managed:start -->').length === 2, 'a second install must not stack a second block')
  assert(merged2.endsWith(own), 'project content survives the second install unchanged')
  assert(!out2.includes('위에 하네스 읽기 순서 블록을 얹었습니다'), 'the second install goes through marker merge, not prepend')

  // 누군가 블록을 지우면 검사가 수동 조치로 알리고, 복구 방법을 구체적으로 말한다. 한 줄 포인터로도 풀린다.
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), own)
  const flagged = run(harnessBin(target), ['check'], { cwd: target })
  assert(flagged.includes('CLAUDE.md에 하네스 읽기 순서 미연결'), 'a stripped entrypoint must surface as a manual action')
  assert(flagged.includes('/하네스업데이트') && flagged.includes('자동으로 붙습니다'), 'the manual action must hand the developer a sentence for the agent (/하네스업데이트) and say what happens, not "add a line somewhere"')
  fs.appendFileSync(path.join(target, 'CLAUDE.md'), '\n하네스 기준은 `.harness/policy/ai-standard-guiding-policy.md`부터 읽습니다.\n')
  const cleared = run(harnessBin(target), ['check'], { cwd: target })
  assert(!cleared.includes('CLAUDE.md에 하네스 읽기 순서 미연결'), 'one pointer line still clears it')
}

// 개인 로컬 파일은 시드 작업 트리에 있어도 설치본에 실리면 안 된다(2026-09-08 실측, 2026-09-03에 알고
// 별건으로 미뤘던 것). INSTALL_ITEMS가 `.claude` 폴더를 통째로 걷는데 필터가 개인 파일 셋
// (settings.local.json · CLAUDE.local.md · personal-methodology.local.md)을 빼지 않아, 로컬 체크아웃에서
// 설치한 모든 프로젝트가 개발자 PC 경로가 든 권한 목록을 받았다. 같은 파일에서 gitignore 병합은 그 셋을
// "개인용"으로 알고 등록한다 — 본체가 아는 것을 복사 단계만 몰랐다. npx 태그 설치는 clone에 gitignore
// 파일이 없어 무사하므로, 이 회귀는 시드 트리를 복사해 개인 파일을 심은 **합성 시드**로 재현한다
// (CI의 깨끗한 체크아웃에서도 실제로 결함 경로를 밟게 하기 위해 — 실기계 상태에 의존하는 테스트는 CI에서 헛돈다).
function installNeverShipsTheSeedsPersonalLocalFiles() {
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-copy-'))
  const skip = new Set(['.git', 'node_modules', '.harness/generated', '.claude/worktrees', '.harness-backup'])
  fs.cpSync(repoRoot, seed, {
    recursive: true,
    filter: (src) => !skip.has(path.relative(repoRoot, src).split(path.sep).join('/')),
  })
  const personal = {
    '.claude/settings.local.json': JSON.stringify({ permissions: { additionalDirectories: ['/Users/someone/private-repo'] } }),
    'CLAUDE.local.md': '# 개인 메모 — SENTINEL-PERSONAL\n',
    '.harness/project/personal-methodology.local.md': '# 개인 방법론 — SENTINEL-PERSONAL\n',
  }
  for (const [rel, body] of Object.entries(personal)) {
    fs.mkdirSync(path.dirname(path.join(seed, rel)), { recursive: true })
    fs.writeFileSync(path.join(seed, rel), body)
  }

  const target = makeTarget()
  run(nodeBin, [path.join(seed, 'scripts/init.mjs'), 'init', '--no-hooks', '--no-scan', '--no-handoff', '--no-check'], { cwd: target })

  for (const rel of Object.keys(personal)) {
    assert(!fs.existsSync(path.join(target, rel)),
      `the seed's personal file must not ship to an install: ${rel} — a developer's own permissions/notes landed in every local-tree install`)
  }
  // 대조군: 같은 폴더의 팀 공유 설정은 실려야 한다 — 필터가 `.claude`를 통째로 버린 게 아님을 확인.
  assert(fs.existsSync(path.join(target, '.claude/settings.json')), 'shared .claude/settings.json must still ship (control)')
  // 그 셋은 소비자 .gitignore에는 계속 등록된다(소비자가 자기 것을 만들 때 커밋되지 않게).
  const ignore = read(target, '.gitignore')
  for (const rel of Object.keys(personal)) {
    assert(ignore.split('\n').includes(rel), `consumer .gitignore must still list ${rel}`)
  }
  fs.rmSync(seed, { recursive: true, force: true })
}

// 0.2.142 다이어트: 헌장 질문 4건은 설치가 심는 것이지 팀이 올린 것이 아니다. `open`으로 두면
// 답할 때까지 매 세션 4줄이 찍히는데, 설치 24곳 전수 조사에서 답이 달린 곳이 사실상 없었다 —
// 신호가 아니라 배경 소음이다. 유예 집계 한 줄로 시작하고 기한이 지나면 다시 뜬다(은닉 아님).
// 같은 커밋의 profile 정리도 함께 잠근다: 아무도 읽지 않는 키는 배포하지 않고, notes는 계약
// 문서를 가리키기만 한다(두 곳에 같은 내용을 두면 한쪽이 낡는다 — 실제로 그렇게 됐다).
function installedQueueSnoozesCharterQuestionsAndProfileStaysThin() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const rows = read(target, '.harness/session/developer-input-queue.md').split('\n').filter((line) => line.startsWith('| charter-'))
  assert(rows.length === 4, 'the four charter questions must still ship')
  for (const row of rows) {
    assert(row.includes('| deferred |'), 'a shipped charter question must start deferred, not open')
    assert(/\| \d{4}-\d{2}-\d{2} \|/.test(row), 'each shipped charter question must carry a real review date')
  }

  const out = run('/bin/sh', [path.join(target, '.claude/hooks/session-start-reminder.sh')], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: target },
  })
  assert(!out.includes('charter-status'), 'a fresh install must not print the four charter rows every session')
  assert(out.includes('유예 4건'), 'the snoozed questions must still leave the one-line summary')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(!('version' in profile), 'a key nothing reads must not ship as a dial that does nothing')
  assert(profile.notes.includes('config-contract.md'), 'profile notes must point at the contract')
  assert(profile.notes.length < 900, 'profile notes must stay a pointer, not a second copy of the contract')
}

// 커밋 advisory와 push 게이트의 "구현 파일" 판정이 어긋나 있었다 — 게이트는 .md를 제외하는데
// advisory는 지목했다. 서비스 폴더에 룰 문서·포인터를 두자 커밋마다 매핑 누락으로 열거됐다.
function commitAdvisoryIgnoresDocsAndMetaFilesInMappedAreas() {
  const { target } = setupSpecLinkedTarget()
  fs.writeFileSync(path.join(target, '.harness/project/spec-map.md'), [
    '| 기획 문서 | 구현 경로 | 비고 |',
    '| --- | --- | --- |',
    '| `features/로그인.md` | `src/views/login/**` | |',
    '',
  ].join('\n'))
  fs.mkdirSync(path.join(target, 'src/views/login'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/login/LoginView.vue'), '<template><div /></template>\n')
  gitCommitAll(target, 'baseline')

  // 관리 영역(src/views) 안의 형제 폴더에 문서와 코드를 함께 만든다.
  fs.mkdirSync(path.join(target, 'src/views/payment'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/views/payment/RULES.md'), '# 결제 화면 규칙\n')
  fs.writeFileSync(path.join(target, 'src/views/payment/PayView.vue'), '<template><div /></template>\n')

  const advisory = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(advisory.includes('PayView.vue'), 'an implementation file with no mapping must still be surfaced')
  assert(!advisory.includes('RULES.md'), 'a markdown document must not be reported as a missing mapping (the gate excludes it)')

}

// 프로젝트 자신의 에이전트 파일(.claude/commands 등)만 있는 저장소에 "이전에 설치된 하네스
// 흔적"이라고 말하면 리더가 없던 과거를 의심한다(백엔드 통합 저장소 실측). 보존 동작은 그대로.
function installTellsProjectOwnFilesApartFromPriorHarness() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, '.claude/commands'), { recursive: true })
  fs.writeFileSync(path.join(target, '.claude/commands/langRegister.md'), '# 팀이 원래 쓰던 명령\n')

  const output = runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(!output.includes('이전에 설치된 하네스 흔적'), 'a first install must not claim there was a prior harness')
  assert(output.includes('이미 있는 에이전트 설정'), 'the message must name what is actually being preserved')
  assert(exists(target, '.claude/commands/langRegister.md'), "the project's own command must survive the install")
  assert(read(target, '.claude/commands/langRegister.md').includes('팀이 원래 쓰던 명령'), 'the preserved file must keep its content')
}

export {
  cleanInstallCreatesExpectedFiles,
  pruneAliasesRemovesOnlyRecognizedInjectedValues,
  staleVerifyDeclarationGetsNoticed,
  retiredInitFlagsStayAcceptedForSiblingHarnesses,
  installExcludesSessionWorktrees,
  uninstallUnsetsHarnessGitConfigWhenNothingPreceded,
  nonNodeInstallSkipsPackageJson,
  initPatchesEslintConfigForHarnessFiles,
  initAddsHarnessBackupIgnoreWhenNodeOverrideExists,
  reinstallPreservesProjectOwnedFiles,
  retiredAliasNoticeSurvivesZeroInjection,
  retiredAliasNoticeOmittedWhenNoneExist,
  reinstallMigratesUnchangedSeedSessionStateToConsumerTemplates,
  reinstallPreservesEditedConsumerSessionState,
  reinstallMigratesManagedRootScriptsIntoHarnessBin,
  forceOverwritesProjectOwnedFiles,
  forceRequiresOverwriteConfirmation,
  dryRunDoesNotWriteFiles,
  noBackupRequiresForce,
  externalHarnessWithoutManifestIsPreserved,
  sourceMetadataNormalizesSemverSourceRef,
  baseOnlyUpdateDryRunPassesSourceMetadata,
  harnessBaselineDocUpdateDoesNotTriggerSyncGap,
  harnessNeverRunsProjectQualityScripts,
  updateRecordsAndReplaysChangelogDelta,
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
  prependHarnessBlockOntoModifiedLegacyFileWithoutMarker,
  markerMergeIsIdempotent,
  consumerInstallExcludesSeedOnlyDocs,
  reinstallRemovesPreexistingSeedOnlyDocWhenUnmodified,
  reinstallPreservesModifiedSeedOnlyDoc,
  consumerInstallExcludesSessionHistoryLogs,
  updateRemovesSeedDistributedHistoryLogWhenUnmodified,
  updatePreservesConsumerOwnedHistoryLog,
  updateRemovesRetiredManagedCommandDoc,
  backupSkipsWhatGitCanRestoreAndRotatesSets,
  installDeclaresCmdLineEndingsSoGitStopsWarning,
  twoStageUpdateRecordsTheRealStartVersion,
  installOutputEndsWithReportPrompt,
  linkedAddDeclaresWithoutLocalFolder,
  linkedAddWritesProfileAndLocalSettings,
  updateRefreshesStaleHarnessModeNotes,
  bootstrapModeAlwaysRelaxesSyncCandidates,
  firstAlphabeticalUnstagedChangeKeepsItsName,
  crlfCheckoutDoesNotFreezeManagedFiles,
  installerWritesDeterministicEol,
  commitTemplateIsProjectOwnedAndCustomizable,
  installWarnsWhenSharedOutputsAreGitIgnored,
  driftSkipsProjectOwnedListedEntries,
  updateOutputSkipsStaticCommandGuide,
  chainedUpdateKeepsOriginalFromForChangelogAndReport,
  seedModeTargetKeepsSeedOnlyDocs,
  profileProjectSourcesDoNotTriggerInstallSyncGap,
  registeredServiceRuleDocKeepsASlotInRelevantPolicies,
  guideSyncPolicyKeepsBundledGuideLinked,
  checkFlagsAnUnlinkedProjectEntrypointUntilItIsLinked,
  installNeverShipsTheSeedsPersonalLocalFiles,
  installedQueueSnoozesCharterQuestionsAndProfileStaysThin,
  commitAdvisoryIgnoresDocsAndMetaFilesInMappedAreas,
  installTellsProjectOwnFilesApartFromPriorHarness,
}
