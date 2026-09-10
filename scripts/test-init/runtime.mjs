// dual-runtime(nvm)·런처·플랫폼 shim 회귀. 실행 등록은 scripts/test-init.mjs의 tests 배열이 정본이다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  repoRoot,
  run,
  harnessBin,
  assert,
  exists,
  read,
  writeJson,
  makeBareTarget,
  makeTarget,
  makeNoGitTarget,
  runInit,
  runInitWithEnv,
  makeFakeNvmDir,
} from './helpers.mjs'

function installOutputUsesConditionalNvmAndGitGuidance() {
  const gitTarget = makeTarget()
  const gitOutput = runInit(gitTarget, '--no-scan', '--no-handoff', '--no-check')

  assert(gitOutput.includes('프로젝트 .nvmrc 없음'), 'install output should say when .nvmrc is absent')
  assert(!gitOutput.includes('\n       nvm use\n'), 'install output should not tell users to run nvm use when .nvmrc is absent')
  assert(gitOutput.includes('git commit/push 전 자동 검증 연결'), 'git project should still suggest hook installation')

  const noGitTarget = makeNoGitTarget()
  const noGitOutput = runInit(noGitTarget, '--no-scan', '--no-handoff', '--no-check')

  assert(noGitOutput.includes('현재 git 저장소가 아니므로 건너뜁니다'), 'non-git install output should not present hook install as an immediate step')
  assert(noGitOutput.includes('git init 후 .harness/bin/harness hooks:install'), 'non-git install output should explain how to enable hooks later')
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

  // 드리프트 가드: 은퇴 별칭(과거 npm script)이 호출하던 .harness/bin/*.mjs를 sh 런처와 .cmd shim이
  // 모두 커버해야 한다. 0.2.131부터 주입 별칭은 0개지만, 은퇴 목록이 가리키던 명령은 런처로 계속
  // 도달해야 한다(기존 소비자 package.json에 남은 별칭도 계속 동작해야 하므로).
  const launcherText = read(target, launcherRel)
  const seedPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const initSrc = fs.readFileSync(path.join(repoRoot, 'scripts/init.mjs'), 'utf8')
  const retiredBlock = initSrc.match(/const RETIRED_CONSUMER_SCRIPTS = \[([\s\S]*?)\]/)
  assert(retiredBlock, 'test should locate RETIRED_CONSUMER_SCRIPTS in init.mjs')
  const consumerNames = [...retiredBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert(consumerNames.length === 25, `test should locate all 25 retired consumer script names (got ${consumerNames.length})`)
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
  // 0.2.149: 진단 문구가 이미 없어진 기능을 약속하지 않는지 잠근다. verify 제거(0.2.131) 뒤에도
  // "nvm install 후 프로젝트 검증(lint/test/build)이 동작합니다"가 남아 있었다 — 설치하는 사람이 읽는
  // 자리라 "하네스가 내 빌드를 돌린다"는 오해를 그대로 심었다(결정 110의 "거짓 안내" 부류).
  assert(!output.includes('프로젝트 검증(lint/test/build)이 동작'), 'install diagnostics must not promise project verification the harness no longer runs')
  assert(!output.includes('lint/test/build는 .nvmrc Node로 실행합니다'), 'the dual-runtime line must not claim the harness runs project build tools')
  assert(output.includes('하네스는 lint/test/build를 실행하지 않'), 'the dual-runtime line must state who actually owns code quality checks')
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

// 0.2.63 dual-runtime 계약은 verify(0.2.131 제거)를 유일 소비처로 삼고 있었다. 훅의 nvm 전환
// (.githooks/* 가 부르는 .harness/bin/dual-node.sh, .harness/bin/check-node-version.mjs)은 별개
// 장치로 남아 있으며 그쪽 회귀가 하네스 자신의 저버전 Node 보호를 계속 잠근다.
// 여기 있던 guardRejectsHookNodeMismatchingNvmrc / guardRunsStackVerifyOnProjectNode는 guard가
// HARNESS_PROJECT_NODE_BIN을 해석해 프로젝트 검증을 프로젝트 Node로 되돌리던 경로를 잠그던
// 회귀라, 그 소비처가 사라진 지금은 재현할 대상이 없어 함께 삭제했다.

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

// 0.2.142 다이어트: 런처 서브커맨드 27개 중 6개는 "파일이 있는가"만 확인하고 **한 번도 실행해
// 보지 않았다**. 배포하는 명령이 소비자 환경에서 실제로 도는지 아무도 몰랐다는 뜻이다.
// 스택 미적용·기획 미연동 프로젝트에서도 깨끗이 끝나야 하는 명령들이라 한 번에 훑는다.
function launcherSubcommandsWithoutRegressionsRunClean() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  for (const command of ['handoff', 'guide', 'standards:list', 'templates:list', 'stack:status', 'template:gap']) {
    run(harnessBin(target), [command], { cwd: target })
  }

  assert(exists(target, '.harness/session/handoff.md'), 'handoff must write the summary it promises')
  assert(exists(target, '.harness/documentation/guide/index.html'), 'guide must leave a dashboard to open')
}

export {
  installOutputUsesConditionalNvmAndGitGuidance,
  launcherRunsHarnessWithoutNpm,
  lowProjectNvmrcInstallsInDualRuntimeMode,
  lowProjectNvmrcWithoutNvmStopsInit,
  projectNodeFlagWritesNvmrcWithUserConfirmation,
  missingNvmrcWithLowNodeSignalRequiresInterview,
  enginesFloorDoesNotForceProjectNodeInterview,
  dualNodeHelpersAreArgSafeUnderSetU,
  dualNodeDoesNotExportDotWhenNodeIsShellFunction,
  backendWithoutNvmrcSkipsProjectNodeInterview,
  dualNodeShSwitchesHarnessNodeWhenActiveNodeIsLow,
  existingProjectNvmrcIsPreserved,
  launcherSubcommandsWithoutRegressionsRunClean,
}
