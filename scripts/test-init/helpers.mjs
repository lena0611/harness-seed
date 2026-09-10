// 설치기 회귀 스위트의 공용 픽스처·단언·실행 헬퍼. 테스트 본문은 같은 폴더의 영역별 모듈에 있다.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '../..')
const nodeBin = process.execPath
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const packageRef = `v${packageVersion}`

// git hook 아래서 스위트가 돌 때(pre-commit) git이 hook에 내보낸 GIT_DIR/GIT_INDEX_FILE 등이
// 자식 git 명령에 누수되면, 임시 픽스처 저장소 대신 바깥 저장소를 조작한다(워크트리에서 실측 —
// 픽스처 git init이 바깥 공유 config를 bare=true로 재초기화). 테스트 자식은 항상 cwd 저장소만 본다.
function withoutCallerGitEnv(env) {
  const clean = {}
  for (const [key, value] of Object.entries(env ?? process.env)) {
    if (key.startsWith('GIT_')) continue
    clean[key] = value
  }
  // CI 러너(GitHub Actions)에는 전역 git 신원이 없어 픽스처 안의 `git commit`이
  // "empty ident name"으로 죽었다 — 0.2.136부터 매 push가 빨간불이었는데 로컬은 전역 설정
  // 덕에 통과해 아무도 못 봤다(2026-09-02 발견). 스위트가 실행 환경의 git 설정에 좌우되지
  // 않도록 신원 기본값을 항상 넣는다(저장소 로컬 user.* 설정이 있으면 그쪽이 우선하지 않고
  // 환경변수가 이기지만, 테스트는 작성자 값을 단언하지 않는다).
  clean.GIT_AUTHOR_NAME = 'Harness Test'
  clean.GIT_AUTHOR_EMAIL = 'test@example.com'
  clean.GIT_COMMITTER_NAME = 'Harness Test'
  clean.GIT_COMMITTER_EMAIL = 'test@example.com'
  return clean
}

// 자식이 PATH에서 `node`를 찾을 때(설치본 guard의 내부 호출, 런처, 훅) 셸의 nvm 상태와
// 무관하게 이 스위트를 실행한 Node가 잡히도록 PATH 머리에 박는다. 실측(2026-08-31):
// 셸 기본 node가 v12로 바뀌자 대상 프로젝트 guard가 ESM 크래시 — 테스트가 코드가 아니라
// 실행 셸 상태에 좌우되면 안 된다.
const nodeBinDir = path.dirname(process.execPath)

function withSuiteNodeFirst(env) {
  return { ...env, PATH: `${nodeBinDir}:${env.PATH ?? ''}` }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    // input은 stdio[0]이 'ignore'면 전달되지 않는다(실측) — input이 있으면 pipe로 연다.
    stdio: options.stdio ?? (options.input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']),
    env: withSuiteNodeFirst(withoutCallerGitEnv(options.env)),
    input: options.input,
  })
}

// 0.2.131: 소비자 npm 별칭은 0개 — 모든 명령은 harness 런처로 호출한다.
function harnessBin(target) {
  return path.join(target, '.harness/bin/harness')
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
  // 0.2.131: 최초 설치는 기본으로 git hook을 자동 활성화한다(결정 94). 대다수 기존 테스트는
  // 훅 상태와 무관하고 install-hooks 반복 실행은 러너만 느리게 하므로 여기서는 끈다.
  // 자동 활성화의 실제 기본 경로는 freshInstallAutoActivatesGitHooks가 전용으로 검증한다.
  return run(nodeBin, [path.join(repoRoot, 'scripts/init.mjs'), 'init', '--no-hooks', ...args], { cwd: target })
}

// 자동 활성화 기본 경로 검증용 — --no-hooks를 붙이지 않는 원형 호출.
function runInitDefaultHooks(target, ...args) {
  return run(nodeBin, [path.join(repoRoot, 'scripts/init.mjs'), 'init', ...args], { cwd: target })
}

function runGuard(target, ...args) {
  // 마지막 인자가 객체면 run() 옵션(env 등)으로 넘긴다 — 나머지는 guard CLI 인자.
  const options = typeof args.at(-1) === 'object' && args.at(-1) !== null ? args.pop() : {}
  return run(nodeBin, [path.join(target, '.harness/bin/guard.mjs'), ...args], { cwd: target, ...options })
}

function readTargetGitConfig(target, key) {
  // git config --get은 키가 없으면 비0 종료라 run()이 던진다 — 부재를 빈 문자열로 정규화한다.
  try {
    return run('git', ['config', '--get', key], { cwd: target }).trim()
  } catch {
    return ''
  }
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

// 0.2.146: 훅 "켜짐"은 core.hooksPath 값이 아니라 git 기본 훅 폴더의 하네스 래퍼로 판정한다.
function hooksState(target) {
  return run(nodeBin, [path.join(target, '.harness/bin/hooks-state.mjs')], { cwd: target }).trim()
}

function hasWrapper(target, name) {
  const file = path.join(target, '.git/hooks', name)
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('harness-hook-wrapper')
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

function makeRulesOnlyPreset(stackVersion = null) {
  const preset = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-seed-rules-only-preset-test-'))

  fs.mkdirSync(path.join(preset, 'instructions'), { recursive: true })
  fs.mkdirSync(path.join(preset, '.idea'), { recursive: true })
  fs.writeFileSync(path.join(preset, 'instructions/rules.md'), '# Rules Only\n\nApply stack instructions without copying scaffold files.\n')
  fs.writeFileSync(path.join(preset, '.idea/workspace.xml'), '<project />\n')
  fs.writeFileSync(path.join(preset, 'manifest.json'), JSON.stringify({
    id: 'rules-only-demo',
    title: 'Rules Only Demo',
    ...(stackVersion ? { version: stackVersion } : {}),
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
  // 스택 버전은 프리셋의 package.json에서 읽힌다(manifest.version은 스택 경로에서 읽지 않는다 —
  // 2026-09-07 실측). 버전 없이 --preset-path로 붙인 스택은 lock에 버전이 안 남고, 그러면
  // 템플릿의 minVersion 검사가 '판정 불능'으로 차단한다.
  if (stackVersion) {
    fs.writeFileSync(path.join(preset, 'package.json'), JSON.stringify({
      name: 'rules-only-demo', version: stackVersion, private: true,
    }, null, 2))
  }

  return preset
}

function makeScaffoldTemplatePreset(requiredStackId = 'rules-only-demo', requiredStackMinVersion = null) {
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
      ...(requiredStackMinVersion ? { minVersion: requiredStackMinVersion } : {}),
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

// 통짜 안전망(0.2.65)은 마커 비대상 managed 파일에 적용된다. 마커 대상(CLAUDE.md 등)은 0.2.67 마커 머지로
// 별도 처리되므로, 여기서는 hook 스크립트 같은 마커 비대상 managed 파일로 통짜 보존/사이드카/중단을 검증한다.
const NON_MARKER_MANAGED_REL = '.claude/hooks/enforce-check.sh'

// 옵션 A(0.2.67): CLAUDE.md/AGENTS.md/.github/copilot-instructions.md는 마커 머지로 처리된다.
// 마커 밖(소비자 영역)은 보존하고 마커 안(회사 영역)은 본체로 갱신한다. 위의 통짜 안전망 3개 테스트는
// 마커 비대상 managed 파일(hook 스크립트 등)에만 적용되고, 아래는 마커 융합 동작을 잠근다.
const MARKER_START_T = '<!-- harness-managed:start -->'

const MARKER_END_T = '<!-- harness-managed:end -->'

// seed-only 문서(0.2.69+): 본체 전용 문서는 소비자에 배포하지 않는다.
const SEED_ONLY_DOCS = [
  '.harness/project/body-release-checklist.md',
  '.harness/project/body-roadmap.md',
  '.harness/project/standards-adoption-roadmap.md',
  // 0.2.142: 스택 하네스를 만드는 사람의 문서 257줄이 모든 소비자에게 배포되고 있었다.
  '.harness/stacks/authoring-guide.md',
]

const SEED_ONLY_DOC = SEED_ONLY_DOCS[0]

// 세션 이력 아카이브 배포 차단(0.2.95): 본체의 decision-log 아카이브가 소비자에 복사되던 회귀(clubadm 보고).
const SEED_HISTORY_LOG = '.harness/session/decision-log-2026H1.md'

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
  // 이 픽스처군은 기본 등급(가볍게 확인)의 표시·승격 거동을 검증한다. 설치 기본값
  // bootstrap은 0.2.135부터 기본 등급을 참고로 완화하므로, 여기서는 active로 고정한다
  // (bootstrap 완화 자체는 bootstrapModeAlwaysRelaxesSyncCandidates가 전용 검증).
  const profileRel = '.harness/policy/profile.json'
  writeJson(target, profileRel, { ...JSON.parse(read(target, profileRel)), harnessMode: 'active' })
  run(harnessBin(target), ['stack:apply', '--preset-path', preset], { cwd: target })
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/contract.md'), '# 계약 문서\n')
  gitCommitAll(target, 'baseline')

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')
  return target
}

// 의존성 미설치 진단(0.2.97) 회귀는 0.2.131에서 삭제했다. 그 진단은 하네스가 프로젝트 lint를
// 대신 실행하던 verify 경로에서만 나오던 실패(`run-s: command not found`)를 해설하는 장치였고,
// verify 제거로 실행 지점 자체가 사라졌다. "하네스는 프로젝트 품질 스크립트를 실행하지 않는다"는
// harnessNeverRunsProjectQualityScripts가 대신 잠근다.

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

export {
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
  makeNoGitTarget,
  runInit,
  runInitDefaultHooks,
  runGuard,
  readTargetGitConfig,
  runInitWithEnv,
  makeFakeNvmDir,
  hooksState,
  hasWrapper,
  makePreset,
  makeRulesOnlyPreset,
  makeScaffoldTemplatePreset,
  makeTaggedHarnessRepo,
  NON_MARKER_MANAGED_REL,
  MARKER_START_T,
  MARKER_END_T,
  SEED_ONLY_DOCS,
  SEED_ONLY_DOC,
  SEED_HISTORY_LOG,
  gitCommitAll,
  makeSyncHookPreset,
  makeSyncReviewPreset,
  setupSyncReviewTarget,
  makePlanningRepo,
  setupSpecLinkedTarget,
  specTargetProfile,
  addOriginRemote,
  pushWithoutHooks,
  makePlanningRepoWithFiles,
  makePlanningRepoRaw,
  specSyncCli,
  expectFailure,
}
