// 스택·템플릿 적용과 레지스트리 회귀. 실행 등록은 scripts/test-init.mjs의 tests 배열이 정본이다.
import fs from 'node:fs'
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
  makeTarget,
  runInit,
  runGuard,
  makePreset,
  makeRulesOnlyPreset,
  makeScaffoldTemplatePreset,
  makeTaggedHarnessRepo,
  expectFailure,
} from './helpers.mjs'

// 자기 CLAUDE.md만 있던 프로젝트는 설치가 블록을 얹으므로(2026-09-08) 스캔이 더는 브리지 후보로 지목하지 않아야 한다.
// 브리지 후보는 전용 하네스(.harness/ 선존) 보존 경로에만 남는다 — 그 경우는 externalHarnessWithoutManifestIsPreserved가 본다.
function scanReportSuggestsBridgeCandidates() {
  const target = makeTarget()

  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# Personal Rules\n')
  runInit(target)
  run(harnessBin(target), ['scan'], { cwd: target })

  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('## Bridge Section Candidates'), 'scan report should keep the bridge section')
  const section = report.split('## Bridge Section Candidates')[1].split('\n## ')[0]
  assert(!section.includes('- CLAUDE.md'), 'a prepended entrypoint already reads the harness — it must not be a bridge candidate')
  assert(read(target, 'CLAUDE.md').endsWith('# Personal Rules\n'), 'the personal rules survive below the block')
}

function stackResetDoesNotResurrectDeletedProfileKeys() {
  // score-print 결함 보고(2026-08-28): reset의 profile 복원이 { ...snapshot, ...current }로
  // 스냅샷 전체를 바탕에 깔아, 스택 적용 "이후" 소비자가 지운 키가 재적용마다 부활했다.
  // 스프레드는 없는 키를 삭제 지시로 표현할 수 없다. reset이 되돌릴 것은 apply가 쓰는
  // 스택 소유 3필드(activeStack/available/stackManifest)뿐이다.
  const target = makeTarget()
  const preset = makePreset()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // 적용 "이전" profile에 키를 심어 스냅샷(profileBackup)에 들어가게 한다.
  const rel = '.harness/policy/profile.json'
  const before = JSON.parse(read(target, rel))
  writeJson(target, rel, { ...before, verify: { lint: 'harness' }, consumerKeepMe: 'v1' })

  run(harnessBin(target), ['stack:apply', '--preset-path', preset], { cwd: target })

  // 적용 "이후" 소비자가 verify를 지우고, 다른 키는 값을 바꾼다.
  const applied = JSON.parse(read(target, rel))
  delete applied.verify
  applied.consumerKeepMe = 'v2'
  writeJson(target, rel, applied)

  run(harnessBin(target), ['stack:reset'], { cwd: target })

  const afterReset = JSON.parse(read(target, rel))
  assert(afterReset.verify === undefined, 'reset must not resurrect keys the consumer deleted after apply')
  assert(afterReset.consumerKeepMe === 'v2', 'reset must keep consumer edits made after apply')
  assert(afterReset.activeStack === 'none' || afterReset.activeStack === (before.activeStack ?? 'none'),
    'reset must still revert the stack-owned activeStack field')
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
  run(harnessBin(target), ['stack:apply', '--preset-path', preset], { cwd: target })

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

  run(harnessBin(target), ['stack:reset'], { cwd: target })

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
  run(harnessBin(target), ['stack:apply', '--preset-path', preset], { cwd: target })

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

  const updatePlan = run(harnessBin(target), ['update', '--dry-run'], { cwd: target })
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

  const output = run(harnessBin(target), ['outdated', '--json'], { cwd: target })
  const status = JSON.parse(output)
  assert(status.overall === 'outdated', 'harness outdated should report overall outdated when base is outdated')
  assert(status.targets.baseHarness.outdated === true, 'harness outdated should check base harness by default')
  assert(status.targets.baseHarness.latestVersion === '0.2.49', 'base outdated should stay inside compatible minor range')
  assert(status.targets.baseHarness.updateCommand === '.harness/bin/harness update --base-only', 'base outdated should print base update command')
  assert(status.targets.stackHarness.outdated === false, 'harness outdated should also check stack harness by default')
  assert(status.targets.stackHarness.updateCommand === null, 'up-to-date stack should not require update command')

  const baseOnly = JSON.parse(run(harnessBin(target), ['outdated', '--json', '--base-only'], { cwd: target }))
  assert(baseOnly.checkedTargets.length === 1 && baseOnly.checkedTargets[0] === 'baseHarness', '--base-only should only check base harness')

  const stackOnly = JSON.parse(run(harnessBin(target), ['outdated', '--json', '--stack-only'], { cwd: target }))
  assert(stackOnly.checkedTargets.length === 1 && stackOnly.checkedTargets[0] === 'stackHarness', '--stack-only should only check stack harness')
  assert(stackOnly.overall === 'up-to-date', '--stack-only should report up-to-date when stack has no update')

  let failed = false
  try {
    run(harnessBin(target), ['outdated', '--fail-on-outdated'], { cwd: target })
  } catch (error) {
    failed = error.status === 1
  }
  assert(failed, 'harness outdated --fail-on-outdated should exit 1 when base or stack update is available')

  lock.baseHarness.version = '0.2.49'
  lock.baseHarness.ref = 'v0.2.49'
  lock.stackHarness.version = '1.0.0'
  lock.stackHarness.ref = 'v1.0.0'
  writeJson(target, '.harness/harness-lock.json', lock)

  const stackUpdate = JSON.parse(run(harnessBin(target), ['outdated', '--json'], { cwd: target }))
  assert(stackUpdate.overall === 'outdated', 'harness outdated should report overall outdated when stack is outdated')
  assert(stackUpdate.targets.baseHarness.outdated === false, 'base should be up-to-date after lock update')
  assert(stackUpdate.targets.stackHarness.outdated === true, 'stack outdated should be detected by default')
  assert(stackUpdate.targets.stackHarness.latestVersion === '1.0.1', 'stack outdated should stay inside compatible major range')
  assert(stackUpdate.targets.stackHarness.updateCommand === '.harness/bin/harness update', 'stack outdated should print stack update command')

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

  const recoveredBase = JSON.parse(run(harnessBin(target), ['outdated', '--json', '--base-only'], { cwd: target }))
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
  const recoveredBundledBaseOnly = JSON.parse(run(harnessBin(target), ['outdated', '--json', '--base-only'], { cwd: target, env: envWithDefaultBaseRepo }))
  assert(recoveredBundledBaseOnly.overall === 'up-to-date', 'base-only bundled install should recover the default base repo')
  assert(recoveredBundledBaseOnly.targets.baseHarness.repo === baseRepo, 'base-only bundled install should use the configured default base repo')
  assert(recoveredBundledBaseOnly.targets.baseHarness.currentRef === 'v0.2.49', 'base-only bundled install should infer current ref from installed version')

  const bundledBaseOnlyUpdatePlan = run(harnessBin(target), ['update', '--base-only', '--dry-run'], { cwd: target, env: envWithDefaultBaseRepo })
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

  const recoveredFromStackRequirement = JSON.parse(run(harnessBin(target), ['outdated', '--json'], { cwd: target }))
  assert(recoveredFromStackRequirement.overall === 'up-to-date', 'bundled base metadata should recover repo from stack requiredBaseHarness')
  assert(recoveredFromStackRequirement.targets.baseHarness.status === 'up-to-date', 'recovered bundled base should not be unavailable')
  assert(recoveredFromStackRequirement.targets.baseHarness.repo === baseRepo, 'recovered bundled base should use required base repo')
  assert(recoveredFromStackRequirement.targets.baseHarness.currentRef === 'v0.2.49', 'recovered bundled base should infer current ref from installed version')

  lock.baseHarness.version = '0.2.48'
  writeJson(target, '.harness/harness-lock.json', lock)

  const bundledBaseUpdate = JSON.parse(run(harnessBin(target), ['outdated', '--json', '--base-only'], { cwd: target }))
  assert(bundledBaseUpdate.targets.baseHarness.outdated === true, 'bundled base should still report outdated when a newer base tag exists')
  assert(bundledBaseUpdate.targets.baseHarness.updateCommand === `npx -y git+${stackRepo}#semver:^1.0.1 init`, 'bundled base update should point to stack harness init instead of base-only update')
  assert(bundledBaseUpdate.targets.baseHarness.updateNote.includes('--base-only'), 'bundled base update should explain why base-only update is not valid')
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
  run(harnessBin(target), ['stack:apply', '--preset-git', preset, '--ref', 'main'], { cwd: target })

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
  run(harnessBin(target), ['stack:apply', '--preset-path', preset], { cwd: target })

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
  run(harnessBin(target), ['stack:apply', '--preset-path', stackPreset], { cwd: target })
  run(harnessBin(target), ['template:apply', '--preset-path', templatePreset], { cwd: target })

  assert(exists(target, 'src/App.vue'), 'template apply should copy scaffold files')
  assert(read(target, '.nvmrc') === '20.19.0\n', 'template apply should preserve existing project .nvmrc')
  assert(!exists(target, 'node_modules/ignored/file.txt'), 'template apply should exclude node_modules')
  assert(!exists(target, 'manifest.json'), 'template apply should not copy template manifest to project root')

  const pkg = JSON.parse(read(target, 'package.json'))
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

  const status = run(harnessBin(target), ['template:status'], { cwd: target })
  assert(status.includes('template: demo-template 1.2.3'), 'template status should show template version')
  assert(status.includes('requiredStack: rules-only-demo'), 'template status should show required stack')

  run(harnessBin(target), ['template:reset'], { cwd: target })
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
  run(harnessBin(target), ['stack:apply', '--preset-path', stackPreset], { cwd: target })
  run(harnessBin(target), ['template:apply', '--preset-path', templatePreset], { cwd: target })

  assert(read(target, '.nvmrc') === 'v24.14.0\n', 'template apply should create project .nvmrc when missing')
}

function templateApplyStopsWhenRequiredStackDoesNotMatch() {
  const target = makeTarget()
  const stackPreset = makeRulesOnlyPreset()
  const templatePreset = makeScaffoldTemplatePreset('other-stack')

  runInit(target)
  run(harnessBin(target), ['stack:apply', '--preset-path', stackPreset], { cwd: target })

  let failed = false
  try {
    run(harnessBin(target), ['template:apply', '--preset-path', templatePreset], { cwd: target })
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
  run(harnessBin(target), ['scan'], { cwd: target })

  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('## Code Formatting Preset Candidates'), 'scan report should include code formatting preset candidates')
  assert(report.includes('standard-js'), 'scan report should suggest standard-js preset')
  assert(report.includes('explicit-ts'), 'scan report should suggest explicit-ts preset')
  assert(report.includes('formatter-owned'), 'scan report should suggest formatter-owned preset')
}

function guardDerivesAppliedStackFromTrackedSnapshotWhenMarkerMissing() {
  const target = makeTarget()
  const preset = makeRulesOnlyPreset()

  writeJson(target, 'package.json', {
    name: 'stack-derived-check-target',
    private: true,
    type: 'module',
    scripts: {},
  })

  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run(harnessBin(target), ['stack:apply', '--preset-path', preset], { cwd: target })
  fs.rmSync(path.join(target, '.harness/.stack-applied.json'), { force: true })

  const output = run(harnessBin(target), ['check', '--no-cache', '--brief'], { cwd: target })
  assert(output.includes('Stack applied state derived from tracked snapshot'), 'guard should derive stack state from tracked snapshot when marker is missing')
  // 0.2.131 이전에는 "profile.verify 옵트인 lint가 실제로 돌았는가"로 이 파생을 증명했다.
  // verify 제거 후에는 스택 상태 파생 자체(= 스킵 안내가 나오지 않음)가 계약이다.
  assert(!output.includes('Stack not applied'), 'guard should not silently skip stack-derived checks when a tracked stack snapshot exists')
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

// 0.2.136 — 백엔드 첫 적용 리포트 ①(사용자 결정: "없다고 해서 잡음은 내면 안 된다"):
// 스택 미적용은 정상 상태 — 한 줄 사실 표기만 하고 "적용하세요"를 조르지 않는다.
function stackAbsenceIsQuietNormalState() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const out = runGuard(target)
  assert(out.includes('스택 기준: 미적용 (정상 상태'), 'stack absence must be stated as a normal single line')
  assert(!out.includes('적용하세요') && !out.includes('Stack not applied'), 'stack absence must not nag or alarm')
}

// 0.2.142: 스택 작성 가이드는 설치본에서 빼되(만드는 사람용 257줄), **만들려는 사람이 닿는 길**은
// 설치본에 있어야 한다. 실측: PHP 백엔드가 스택 하네스를 만들려는 순간 "스택" 요청은 선택 스킬로만
// 가고, 배포 문서의 안내는 다른 저장소의 경로만 적어 가져오는 방법이 없었다. 길은 둘로 잠근다 —
// 배포되는 stacks/README에 lock의 본체 주소·태그로 가져오는 한 줄, 그리고 "스택 만들어줘"를 그 길로
// 보내는 소비자 스킬.
function stackAuthoringGuideStaysReachableAfterExclusion() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  assert(!exists(target, '.harness/stacks/authoring-guide.md'), 'the author guide itself must not ship (precondition)')
  const readme = read(target, '.harness/stacks/README.md')
  assert(readme.includes('authoring-guide.md'), 'the shipped stacks README must still name the guide')
  assert(readme.includes('baseHarness.version') && readme.includes('git clone'), 'the README must show how to fetch the guide at the installed body version')
  // 실측(설치본 16곳): `baseHarness.repo`는 bundled base 설치에서 null이라 그때 이 한 줄이
  // `fatal: repository 'null' does not exist`로 죽었다. `version`은 16곳 전부에 기록돼 있다.
  assert(!readme.includes('baseHarness.repo'), 'the fetch path must not depend on baseHarness.repo — it is null on bundled-base installs')

  const registry = JSON.parse(read(target, '.harness/skills/registry.json'))
  const authoring = registry.skills.find((skill) => skill.id === 'harness.stack-authoring')
  assert(authoring, 'a stack-authoring skill must ship so "스택 만들어줘" routes to the guide path')
  assert(authoring.audience.includes('consumer'), 'the authoring skill must be consumer-facing — the author is a consumer team')
  assert(authoring.triggers.some((t) => t.includes('스택 만들')), 'the skill must trigger on a plain "스택 만들" request')
  assert(authoring.read.includes('.harness/stacks/README.md'), 'the skill must read the shipped README that carries the fetch path')
  assert(authoring.commands.some((c) => c.includes('authoring-guide.md') && c.includes('git clone')), 'the skill must carry the fetch command itself')
}

// 2026-09-07 결정 105: 언어별 스택 작성 가이드는 만들지 않는다. 공용 가이드 하나가 Node가 아닌
// 스택도 같은 순서로 안내해야 한다. 실측: PHP 백엔드가 "어떻게 구성을 가져가야 할지 가이드가 없다"고
// 했을 때 가이드는 package.json 모양의 호환성 예시와, 본체가 요구하지 않는 policies 모양
// (summary/severity/evidence)을 담고 있었다. 런타임별 표와 본체가 실제로 읽는 모양이 빠지면
// 다시 Node 전용 문서가 된다.
function stackAuthoringGuideSpeaksEveryRuntime() {
  const guide = fs.readFileSync(path.join(repoRoot, '.harness/stacks/authoring-guide.md'), 'utf8')
  for (const file of ['composer.json', 'pom.xml', 'build.gradle', 'pyproject.toml', 'go.mod']) {
    assert(guide.includes(file), `the guide must name ${file} so a non-Node author finds their runtime row`)
  }
  assert(guide.includes('`compatibility`를 읽지 않'), 'the guide must say the body does not read compatibility — the check is the installer\'s own code')
  assert(guide.includes('"ownedAreas"') && guide.includes('"documents"'), 'the policies example must use the shape the body validates (documents + ownedAreas)')
  assert(!guide.includes('"severity"') && !guide.includes('"evidence"'), 'the old policies shape the body never validated must be gone')
  assert(guide.includes('package.json 병합'), 'the guide must warn non-Node stacks off the package.json merge section')

  // 가벼운 길 둘을 앞에서 먼저 제시해야 한다(2026-09-07 사용자 피드백: 가이드가 복잡해 보인다).
  // 실측으로 둘 다 동작을 확인했다 — ① `.harness/project/*` md 하나(프로젝트 소유라 업데이트가
  // 덮지 않는다) ② 저장소 안 폴더 4개 파일 + `stack:apply --preset-path`(설치기·package.json 불필요).
  // 저장소가 하나면 태그 운영은 값이 없다.
  assert(guide.includes('--preset-path'), 'the guide must offer the in-repo asset route before the full repo route')
  assert(guide.includes('.harness/project/domain-rules.md'), 'the guide must offer the md-only route for a single repository')

  // 견본을 실제로 복사해 만들어 보고 걸린 세 가지(2026-09-07). 셋 다 첫 실행을 막거나
  // 조용히 잘못된 단언을 남기는 종류라 가이드에 남아 있어야 한다.
  assert(guide.includes('HARNESS_SEED_PATH'), 'the guide must say how to point the sample regression at a local body checkout')
  assert(guide.includes('stackManifest.stackHarness.repo'), 'the guide must warn that the sample asserts its own repo URL as a literal')

  // 스택 운영자가 본체 릴리스마다 base ref를 손으로 올려야 하는지가 운영 부담을 정한다.
  // 본체는 `semver:` 범위 source ref를 이미 받아 설치 기록에 구체 버전으로 정규화한다
  // (sourceMetadataNormalizesSemverSourceRef). 그 선택지가 가이드에 없으면 작성자는
  // 태그를 박는 예시만 보고 매 릴리스 수동 갱신을 떠안는다.
  assert(guide.includes('minVersion'), 'the guide must keep the floor separate from the pin')

  // 견본에 닿는 길은 있어야 하지만 **주소를 문서에 박아서는 안 된다**(외부 리뷰 2026-09-07 P2:
  // 처음 판은 이 회귀가 오히려 하드코딩을 강제했다 — 같은 날 그룹 이전에서 그 주소가 낡았다).
  // 정본은 목록 명령의 출력이다.
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const catalog = JSON.parse(read(target, '.harness/stacks/registry.json')).stacks
  for (const entry of catalog) {
    assert(!guide.includes(entry.repo),
      `the guide must not hardcode a catalog repo address (${entry.id}) — it went stale the day that repo moved`)
  }
  assert(/standards:list[\s\S]{0,400}git clone/.test(guide),
    'the guide must send the author to standards:list and then clone what it printed')

  // 범위 표기는 되돌렸다(외부 리뷰 P1): 릴리스 시점 검증이 그 이후에 나올 본체를 보장하지 못한다.
  assert(!guide.includes('"ref": "semver:'), 'the guide must not recommend a semver range for baseHarness.ref')
  assert(guide.includes('검증된 정확한 태그'), 'the guide must say the base ref is a verified exact tag')
}

// 외부 리뷰 2026-09-07 2차 P1: `source.packageMerge`가 임의 파일 이름을 가리키면
// adapterLocal이 그 파일을 **일반 scaffold 파일로 먼저 복사**해 대상 package.json을 덮어쓴 뒤,
// 그 덮어쓴 파일을 원본으로 삼아 병합했다. 병합이 아니라 교체가 되고, 복원 스냅샷도 덮어쓴
// 뒤에 만들어져 reset으로 원래 파일을 되돌리지 못할 수 있었다. adapterTiged에는 있던 필터가
// adapterLocal에만 없었고 하드코딩된 `package.merge.json` 이름만 예외였다.
function templatePackageMergeAddsWithoutReplacingTheProjectFile() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run(harnessBin(target), ['stack:apply', '--preset-path', makeRulesOnlyPreset('1.0.0')], { cwd: target })

  // 대상 프로젝트가 이미 갖고 있는 package.json — 이름·자기 script·자기 의존성이 살아야 한다.
  fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({
    name: 'the-real-project',
    version: '9.9.9',
    private: true,
    scripts: { 'my-own': 'echo mine' },
    dependencies: { 'my-own-dep': '^1.0.0' },
  }, null, 2)}\n`)

  const preset = makeScaffoldTemplatePreset('rules-only-demo', '1.0.0')
  // 임의 이름의 병합 파일 — 하드코딩 예외(`package.merge.json`)에 걸리지 않는 이름이어야 한다.
  fs.writeFileSync(path.join(preset, 'merge-me.json'), `${JSON.stringify({
    scripts: { 'from-template': 'vite build' },
    dependencies: { 'from-template-dep': '^2.0.0' },
  }, null, 2)}\n`)
  const manifest = JSON.parse(fs.readFileSync(path.join(preset, 'manifest.json'), 'utf8'))
  manifest.source.packageMerge = 'merge-me.json'
  manifest.source.exclude = [...(manifest.source.exclude ?? []), 'package.json']
  fs.writeFileSync(path.join(preset, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  run(harnessBin(target), ['template:apply', '--preset-path', preset], { cwd: target })

  const pkg = JSON.parse(read(target, 'package.json'))
  assert(pkg.name === 'the-real-project', `병합이 대상 package.json을 교체했습니다: name=${pkg.name}`)
  assert(pkg.version === '9.9.9', `병합이 대상 버전을 덮어썼습니다: ${pkg.version}`)
  assert(pkg.scripts['my-own'] === 'echo mine', '대상의 기존 script가 사라졌습니다')
  assert(pkg.dependencies['my-own-dep'] === '^1.0.0', '대상의 기존 의존성이 사라졌습니다')
  assert(pkg.scripts['from-template'] === 'vite build', '템플릿 script가 추가되지 않았습니다')
  assert(pkg.dependencies['from-template-dep'] === '^2.0.0', '템플릿 의존성이 추가되지 않았습니다')
  assert(!exists(target, 'merge-me.json'), '병합 파일 자체가 대상에 복사됐습니다')

  // reset이 적용 전 package.json을 되돌릴 수 있어야 한다(스냅샷이 덮어쓴 뒤 만들어지면 못 한다).
  run(harnessBin(target), ['template:reset'], { cwd: target })
  const restored = JSON.parse(read(target, 'package.json'))
  assert(restored.name === 'the-real-project' && restored.scripts['my-own'] === 'echo mine',
    'reset 이후에도 프로젝트 소유 package.json이 살아 있어야 합니다')
  assert(restored.scripts['from-template'] === undefined, 'reset이 템플릿 항목을 걷어내야 합니다')
}

// 제품 템플릿 작성 가이드(2026-09-07 신설). 스택 가이드와 같은 취급이다 — 만드는 사람용이라
// 설치본에는 배포하지 않고, 닿는 길은 배포되는 문서와 스킬이 갖는다. 템플릿만의 계약
// (contractChecks의 필수 조건, 두 적용 방식)이 빠지면 작성자가 invalid 항목을 만든다.
function templateAuthoringGuideStaysReachableAndCarriesItsContract() {
  const guide = fs.readFileSync(path.join(repoRoot, '.harness/templates/authoring-guide.md'), 'utf8')

  assert(guide.includes('contractChecks'), 'the template guide must cover the contract-check declaration')
  assert(guide.includes('pathsAll') && guide.includes('pathsAny')
    && guide.includes('dependenciesAll') && guide.includes('scriptsAll'),
    'it must list every expectation field the body actually evaluates')
  assert(guide.includes('invalid'), 'it must explain the invalid verdict — that one is the author\'s own mistake')
  assert(guide.includes('--contract-only'), 'it must cover the second application mode, not just scaffold')
  assert(guide.includes('recommended'), 'it must warn that severity defaults to required unless that exact word is used')
  assert(guide.includes('scaffold-template'), 'it must name the kind value the body uses to tell assets apart')
  assert(!/git clone https:\/\/git\.smartscore\.kr/.test(guide),
    'the template guide must not hardcode a repo address either — templates:list is the source')

  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(!exists(target, '.harness/templates/authoring-guide.md'), 'the author guide itself must not ship')
  const shipped = read(target, '.harness/stacks/README.md')
  assert(shipped.includes('templates/authoring-guide.md'), 'the shipped doc must name the template guide too')

  const registry = JSON.parse(read(target, '.harness/skills/registry.json'))
  const authoring = registry.skills.find((skill) => skill.id === 'harness.stack-authoring')
  assert(authoring.triggers.some((t) => t.includes('템플릿 만들')), 'a plain "템플릿 만들" request must route here')
  assert(authoring.commands.some((c) => c.includes('templates:list')), 'the skill must offer the template catalog command')
  // 신규 가이드는 seed-only라 소비자 설치본에 없다. 트리거만 넓히고 가져오는 명령이 없으면
  // 에이전트가 템플릿 요청을 받아도 그 문서를 읽을 수 없다(외부 리뷰 2026-09-07 2차 P2).
  assert(authoring.commands.some((c) => c.includes('templates/authoring-guide.md')),
    'the skill must carry a command that actually fetches the template guide, not just the stack one')
  assert(authoring.outputs.some((o) => o.includes('contractChecks')),
    'and its outputs must name the template-only artifact so the agent knows what to produce')
}

// 외부 리뷰 2026-09-07 P2: 템플릿의 requiredStackHarness.minVersion 검사가 **판정 불능을
// 조용히 통과**시켰다. 레거시 lock이라 스택 버전이 없으면 비교가 false를 반환해 성공 처리됐고,
// 정규식에 끝 경계가 없어 `1.2.3-beta`가 정식 `1.2.3`으로 판정됐다. "최소 버전이 집행된다"고
// 믿게 만든 검사의 목적을 무너뜨리는 구멍이라, 판정할 수 없으면 복구 안내와 함께 막는다.
function templateMinStackVersionBlocksLowAndUnjudgeable() {
  const cases = [
    { label: '낮음', stackVersion: '1.0.0', minVersion: '2.0.0', blocked: true, expect: '요구하는 스택 하네스 버전보다 낮습니다' },
    { label: '같음', stackVersion: '2.0.0', minVersion: '2.0.0', blocked: false },
    { label: '높음', stackVersion: '2.1.0', minVersion: '2.0.0', blocked: false },
    { label: '설치 버전 없음', stackVersion: null, minVersion: '2.0.0', blocked: true, expect: '확인할 수 없어' },
    { label: 'prerelease', stackVersion: '2.0.0-beta', minVersion: '2.0.0', blocked: true, expect: '확인할 수 없어' },
    { label: 'minVersion 형식 오류', stackVersion: '2.0.0', minVersion: 'semver:^2.0.0', blocked: true, expect: '완전한 SemVer가 아닙니다' },
    { label: 'minVersion 미선언', stackVersion: null, minVersion: null, blocked: false },
  ]

  for (const item of cases) {
    const target = makeTarget()
    runInit(target, '--no-scan', '--no-handoff', '--no-check')
    run(harnessBin(target), ['stack:apply', '--preset-path', makeRulesOnlyPreset(item.stackVersion)], { cwd: target })
    const templatePreset = makeScaffoldTemplatePreset('rules-only-demo', item.minVersion)

    const appliedMarker = '.harness/templates/.applied/demo-template/manifest.json'
    if (!item.blocked) {
      run(harnessBin(target), ['template:apply', '--preset-path', templatePreset], { cwd: target })
      assert(exists(target, appliedMarker), `${item.label}: 통과해야 하는데 템플릿이 적용되지 않았습니다`)
      continue
    }

    const output = expectFailure(
      () => run(harnessBin(target), ['template:apply', '--preset-path', templatePreset], { cwd: target }),
      `${item.label}: 템플릿 적용이 차단돼야 합니다`,
    )
    assert(output.includes(item.expect), `${item.label}: 안내가 원인을 짚어야 합니다 (기대: ${item.expect})`)
    // template-contract.md는 설치가 자리표시자로 배포하므로 존재 여부로 판정할 수 없다.
    // 적용 흔적은 스냅샷 manifest다.
    assert(!exists(target, appliedMarker), `${item.label}: 차단됐는데 템플릿이 적용됐습니다`)
    assert(!exists(target, 'src/App.vue'), `${item.label}: 차단됐는데 scaffold 파일이 복사됐습니다`)
  }
}

// 결정 108(2026-09-07): 본체가 관리하는 것은 harness-seed·CLI·docs뿐이고, 스택·scaffold는
// 누구나 만들고 운영한다. 그 원칙을 어기던 자리 넷을 걷어냈고, 되돌아가면 실패해야 한다.
//   ① 버전 그물이 형제 저장소를 이름으로 알던 것 ② 배포 카탈로그가 남의 버전을 고정하던 것
//   ③ 릴리스 절차가 위성 동반 범프를 요구하던 것 ④ 아무도 안 켠 옵션
function bodyDoesNotTrackForeignStacksOrTemplates() {
  const net = fs.readFileSync(path.join(repoRoot, 'scripts/sync-version-net.mjs'), 'utf8')
  assert(!net.includes('vue3-vite-pinia-router') && !net.includes('cloud-front-admin-template'),
    'the body version net must not know sibling repos by name — a third-party stack is not in that directory')
  assert(!net.includes("resolve(repoRoot, '..'"), 'the body version net must not reach outside its own repo')
  assert(net.includes('CHANGELOG'), 'it must still check the body version against its own CHANGELOG')

  // 새로 만든 테스트를 아무도 돌리지 않는 상태가 되지 않게 한다(2026-09-07 실측: 카탈로그
  // 계약 테스트 둘이 npm 스크립트로만 있어 검사기도 CI도 돌리지 않았고, 외부 리뷰를 고친
  // 회귀도 그 안에 있어 실행되지 않았다). 본체 관문이 그 둘을 부르는지 확인한다.
  const guardSource = fs.readFileSync(path.join(repoRoot, '.harness/bin/guard.mjs'), 'utf8')
  for (const script of ['scripts/test-init.mjs', 'scripts/test-standards-registry.mjs', 'scripts/test-template-registry.mjs']) {
    assert(guardSource.includes(script), `the body gate must actually run ${script} — an npm script nobody calls is not a check`)
  }

  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  // 카탈로그의 `ref`는 **검증된 구체 태그**다. 잠시 제거했다가 되돌렸다(외부 리뷰 2026-09-07):
  // `#semver:*`는 zsh에서 glob으로 죽고, 템플릿은 적용에 git ref가 필요해 자리표시자로는 못 쓴다.
  // 본체가 이 값을 갱신하는 시점은 **그 저장소 소유자가 새 태그를 알려올 때**이고, 본체 릴리스
  // 절차에는 들어 있지 않다(그 분리는 체크리스트 문구와 version-net으로 잠근다).
  for (const [rel, key] of [['.harness/stacks/registry.json', 'stacks'], ['.harness/templates/registry.json', 'templates']]) {
    for (const entry of JSON.parse(read(target, rel))[key]) {
      assert(entry.repo, `a catalog entry needs the repo address (${rel}: ${entry.id})`)
      assert(/^v\d+\.\d+\.\d+$/.test(entry.ref ?? ''),
        `a catalog ref must be a concrete verified tag (${rel}: ${entry.id}: ${entry.ref}) — glob forms die in zsh`)
    }
  }

  const checklist = fs.readFileSync(path.join(repoRoot, '.harness/project/body-release-checklist.md'), 'utf8')
  // 특정 스택이 건너뛸 번호는 그 저장소 것이다. "결번"이라는 낱말이 아니라 **번호**가
  // 본체 문서에 남아 있는지를 본다(포인터 문장에서 그 주제를 언급하는 것은 정상이다).
  assert(!/v0\.2\.2[56]/.test(checklist),
    'the specific versions a stack must skip belong to that stack repo, not the body checklist')
  assert(checklist.includes('본체 릴리스마다 위성을 따라 올리지는 않습니다'),
    'the checklist must say the body does not bump satellites on its own release')
  assert(checklist.includes('위성 소유자가 검증한 새 태그의 카탈로그 반영을 요청하면'),
    'and it must say who asks for a catalog ref update — the two sentences are a contract pair (외부 리뷰 2026-09-07 2차 P2)')

  // 카탈로그가 태그를 고정하는 동안 **현행 문서가 반대로 말하지 못하게** 한다. 코드는 되돌렸는데
  // 문서는 "고정하지 않는다"로 남아 정반대를 말하던 것이 그 리뷰의 지적이다. 이력 문서는 제외한다.
  const pinsInCatalog = JSON.parse(read(target, '.harness/stacks/registry.json')).stacks
    .every((entry) => /^v\d+\.\d+\.\d+$/.test(entry.ref ?? ''))
  if (pinsInCatalog) {
    for (const rel of ['.harness/project/body-release-checklist.md', '.harness/templates/authoring-guide.md', '.harness/stacks/authoring-guide.md']) {
      const abs = path.join(repoRoot, rel)
      if (!fs.existsSync(abs)) continue
      const text = fs.readFileSync(abs, 'utf8')
      assert(!/카탈로그[^\n]{0,40}버전을 고정하지 않/.test(text),
        `catalog pins a tag but ${rel} still says it does not — pick one`)
    }
  }

  // 은퇴 판정은 **현행 트리 전역**으로 확인한다(외부 리뷰 2026-09-07 P2: 배포 문서 한 곳만
  // 보고 "제거했다"고 적었는데 guard·scan 런타임 분기와 README 권고가 살아 있었다).
  // 이력 문서(CHANGELOG·decision-log·리마인더)는 사실 기록이므로 제외한다.
  const retiredOption = 'exactRefRequired'
  const liveFiles = [
    '.harness/bin/guard.mjs', '.harness/bin/scan-project.mjs', '.harness/bin/apply-stack.mjs',
    '.harness/project/stack-preset-rules.md', '.harness/project/portability-guide.md',
    '.harness/stacks/README.md', '.harness/stacks/authoring-guide.md',
  ]
  for (const rel of liveFiles) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue
    const text = fs.readFileSync(abs, 'utf8')
    const live = text.split('\n').filter((line) => line.includes(retiredOption) && !line.trimStart().startsWith('//'))
    assert(live.length === 0, `retired option still live in ${rel}: ${live[0]?.trim()}`)
  }
  assert(!fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8').includes(retiredOption),
    'the body README must not recommend the retired option')

  // 설치 안내의 예시 주소도 특정 스택을 이름으로 들고 있으면 그 저장소가 옮겨지거나
  // 사라질 때 낡는다(2026-09-07 그룹 이전에서 실제로 낡았다). 주소의 정본은 목록 명령이다.
  for (const rel of ['.harness/stacks/README.md', '.harness/bin/handoff.mjs']) {
    assert(!read(target, rel).includes('vue3-vite-pinia-router.git'),
      `install guidance must not hardcode one stack's address (${rel}) — standards:list is the source`)
  }

  // `baseHarness.ref`는 **검증한 정확한 태그**만 쓴다(범위 표기는 되돌렸다 — 릴리스 시점 검증이
  // 그 뒤에 나올 본체를 보장하지 못한다). 정본(작성 가이드 둘)만 고치고 운영 문서를 놔두면
  // 다음 작성자가 README·체크리스트·결정 로그를 읽고 폐기된 쪽을 고른다(외부 리뷰 2026-09-07 3차 P2).
  // 검사 대상은 **현행 운영 문서**로 한정하고, 이력(CHANGELOG·아카이브·리마인더)은 사실 기록이라 뺀다.
  // `stackHarness.range`와 `harness:update --strategy compatible`의 범위는 **다른 개념**이라
  // 여기서 걸리지 않는다 — 판별자에 `baseHarness`/`requiredStackHarness`를 함께 요구한다.
  const rangeTokens = [/semver:\s*[\^~<>=]/, /semver:<range>/, /범위 표기/, /semver 범위/]
  const policyReversed = [/쓰지 않습니다/, /쓰지 마세요/, /⛔/, /되돌/, /폐기/]
  for (const rel of [
    '.harness/project/body-release-checklist.md', '.harness/project/portability-guide.md',
    '.harness/project/stack-preset-rules.md', '.harness/stacks/README.md',
    '.harness/stacks/authoring-guide.md', '.harness/templates/authoring-guide.md',
    '.harness/session/decision-log.md',
  ]) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) continue
    for (const line of fs.readFileSync(abs, 'utf8').split('\n')) {
      const aboutBaseRef = line.includes('baseHarness') || line.includes('requiredStackHarness')
      if (!aboutBaseRef || !rangeTokens.some((token) => token.test(line))) continue
      assert(policyReversed.some((mark) => mark.test(line)),
        `${rel} still offers a semver range for baseHarness.ref without marking it retired: ${line.trim().slice(0, 120)}`)
    }
  }
}

// 2026-09-07: 사내 GitLab 그룹을 역할대로 정리했다 — 스택 하네스는 `ai-standard/stacks`, 제품
// scaffold 템플릿은 `ai-standard/scaffolds`, 본체만 `ai-standard/harnesses`에 남는다. 옛 배치
// (스택이 harnesses에, 템플릿이 stacks에)로 되돌아가면 조회 기본 그룹과 배포 레지스트리가 서로
// 다른 곳을 가리키고, 그 불일치는 `--remote` 조회에서만 드러나 한참 뒤에 발견된다.
function stackAndTemplateRegistriesLiveUnderTheirOwnGroups() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const stacks = JSON.parse(read(target, '.harness/stacks/registry.json')).stacks
  const templates = JSON.parse(read(target, '.harness/templates/registry.json')).templates
  assert(stacks.length > 0 && templates.length > 0, 'both registries must ship at least one candidate (precondition)')
  for (const stack of stacks) {
    assert(stack.repo.includes('/ai-standard/stacks/'), `stack '${stack.id}' must live in the stack group, not ${stack.repo}`)
  }
  for (const template of templates) {
    assert(template.repo.includes('/ai-standard/scaffolds/'), `template '${template.id}' must live in the scaffold group, not ${template.repo}`)
  }

  assert(read(target, '.harness/bin/list-stack-standards.mjs').includes("'ai-standard/stacks'"),
    'the stack lookup default group must match the group the stack registry points at')
  assert(read(target, '.harness/bin/list-templates.mjs').includes("'ai-standard/scaffolds'"),
    'the template lookup default group must match the group the template registry points at')
  assert(read(target, '.harness/stacks/README.md').includes('- `scaffolds`:'),
    'the shipped stacks README must document the scaffold group in its group layout')
}

// score-print 결함(2026-08-24): --resync-managed(공통 하네스 전용 플래그)가 스택 CLI에도
// 전달돼 기본 경로(stack→base)에서 항상 중단, base resync가 시작조차 못 했다. 본체 자신은
// activeStack=none이라 이 경로를 겪을 수 없다 — 본체가 못 겪는 경로는 픽스처가 대신 겪는다.
function updateSkipsStackForBaseOnlyFlags() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const lockPath = path.join(target, '.harness/harness-lock.json')
  const lock = JSON.parse(read(target, '.harness/harness-lock.json'))
  lock.stackHarness = { id: 'stack-fixture', version: '0.1.0', repo: 'https://example.invalid/stack-fixture.git', ref: 'v0.1.0' }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2))
  const updater = path.join(target, '.harness/bin/update-harness.mjs')

  const out = run(nodeBin, [updater, '--dry-run', '--resync-managed'], { cwd: target })
  assert(out.includes('공통 하네스 전용입니다 — 스택 하네스 단계는 건너뜁니다'), 'base-only flag must skip the stack step and say so')
  assert(!out.includes('target: 스택 하네스'), 'stack plan must not be built when a base-only flag is present')
  assert(out.includes('target: 공통 하네스') && out.includes('--resync-managed'), 'base plan must still carry the base-only flag')

  const plain = run(nodeBin, [updater, '--dry-run'], { cwd: target })
  assert(plain.includes('target: 스택 하네스') && plain.includes('target: 공통 하네스'), 'default path must keep stack then base')
  assert(!plain.includes('공통 하네스 전용입니다'), 'no base-only skip note without base-only flags')

  let rejected = false
  try {
    run(nodeBin, [updater, '--stack-only', '--resync-managed'], { cwd: target })
  } catch (error) {
    rejected = true
    assert(String(error.stderr ?? error.message).includes('--stack-only와 함께 쓸 수 없습니다'), 'contradictory combo must be rejected with a clear message')
  }
  assert(rejected, 'stack-only + base-only flag must exit nonzero')
}

export {
  scanReportSuggestsBridgeCandidates,
  stackResetDoesNotResurrectDeletedProfileKeys,
  stackApplyMaterializesPresetAsLocalRules,
  stackApplySupportsExternalPresetPath,
  harnessOutdatedDetectsBaseAndStackUpdates,
  stackApplySupportsExternalPresetGit,
  stackApplySupportsRulesOnlyPreset,
  templateApplyCreatesBridgeWithoutReplacingActiveStack,
  templateApplyCreatesProjectNvmrcWhenMissing,
  templateApplyStopsWhenRequiredStackDoesNotMatch,
  scanReportSuggestsStylePresetsWhenStyleSourceMissing,
  guardDerivesAppliedStackFromTrackedSnapshotWhenMarkerMissing,
  guardFailsWhenActiveStackHasNoTrackedSnapshot,
  stackAbsenceIsQuietNormalState,
  stackAuthoringGuideStaysReachableAfterExclusion,
  stackAuthoringGuideSpeaksEveryRuntime,
  templatePackageMergeAddsWithoutReplacingTheProjectFile,
  templateAuthoringGuideStaysReachableAndCarriesItsContract,
  templateMinStackVersionBlocksLowAndUnjudgeable,
  bodyDoesNotTrackForeignStacksOrTemplates,
  stackAndTemplateRegistriesLiveUnderTheirOwnGroups,
  updateSkipsStackForBaseOnlyFlags,
}
