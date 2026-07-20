#!/usr/bin/env node
/**
 * harness-seed init: 기존 프로젝트에 harness를 설치/업데이트한다.
 *
 * 기본 동작:
 *  - 하네스 소유 파일은 업데이트한다.
 *  - 프로젝트 소유 파일은 이미 있으면 보존한다.
 *  - 기존 항목이 있으면 .harness-backup/<timestamp>/ 아래에 먼저 백업한다.
 */

import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
const {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = fs;
import { tmpdir, homedir } from 'os';
import {
  dirname,
  join,
  relative,
  resolve as pathResolve,
} from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUNDLED_SOURCE_ROOT = pathResolve(__dirname, '..');
const TARGET = process.cwd();
const MIN_NODE_MESSAGE = 'harness-seed requires Node.js >=20.19.0.';
const MANIFEST_PATH = '.harness/install-manifest.json';
const LOCK_PATH = '.harness/harness-lock.json';

const CONSUMER_PROJECT_STATE_PATHS = [
  '.harness/session/active-context.md',
  '.harness/session/decision-log.md',
  '.harness/session/developer-input-queue.md',
  '.harness/session/manual-actions.md',
  '.harness/session/next-session-reminder.md',
  '.harness/session/project-memory.md',
];

const INSTALL_ITEMS = [
  '.harness',
  '.claude',
  '.codex',
  '.github/commit-template.txt',
  '.github/copilot-instructions.md',
  '.github/copilot-instructions',
  '.githooks',
  'AGENTS.md',
  'CLAUDE.md',
];

const LEGACY_MANAGED_ROOT_SCRIPTS = [
  'scripts/apply-stack.mjs',
  'scripts/guard.mjs',
  'scripts/sync-context.mjs',
  'scripts/build-context.mjs',
  'scripts/install-hooks.mjs',
  'scripts/policy-harness.mjs',
  'scripts/doc-link-check.mjs',
  'scripts/list-stack-standards.mjs',
  'scripts/list-templates.mjs',
  'scripts/outdated-harness.mjs',
  'scripts/update-harness.mjs',
  'scripts/check-node-version.mjs',
  'scripts/check-seed-mode.mjs',
];

const PROJECT_OWNED_PATHS = new Set([
  '.harness/policy/profile.json',
  '.harness/policy/waivers.json',
  '.harness/project/project-charter.md',
  '.harness/project/scope-contract.md',
  '.harness/project/config-contract.md',
  '.harness/project/local-methodology.md',
  '.harness/project/personal-methodology.local.md',
  '.harness/project/stack-preset-rules.md',
  '.harness/project/template-contract.md',
  '.harness/project/domain-rules.md',
  '.harness/project/architecture-rules.md',
  '.harness/project/workflow-rules.md',
  '.harness/project/commit-push-rules.md',
  '.harness/project/critical-paths.md',
  '.harness/session/active-context.md',
  '.harness/session/decision-log.md',
  '.harness/session/developer-input-queue.md',
  '.harness/session/manual-actions.md',
  '.harness/session/next-session-reminder.md',
  '.harness/session/project-memory.md',
  '.claude/settings.json',
  '.claude/settings.local.json',
  'CLAUDE.local.md',
  '.nvmrc',
]);

const PROJECT_OWNED_PREFIXES = [
  '.harness/maintenance/work-history/',
  '.harness/session/memory/',
  '.harness/session/evolved/',
  '.claude/rules/project/',
  '.claude/skills/project-',
  '.claude/agents/project-',
];

// 본체(seed-mode) 저장소 존재를 알리는 마커. 이 마커가 있는 타깃은 본체 자신이다.
const SEED_MODE_MARKER = '.harness-seed-mode';

// 본체(seed-mode) 전용 문서. 내용이 하네스 본체의 개발/배포/거버넌스 절차라 소비자 프로젝트에는 무의미하다.
// 소비자(마커 없음) 타깃에는 배포하지 않고, 기존 설치본은 정리한다. 본체(마커 있음)에는 그대로 둔다.
// (.harness/bin/doc-link-check.mjs의 seedOnlyDocs와 동기화 — 한쪽을 바꾸면 다른 쪽도 함께 갱신)
const SEED_ONLY_DOC_PATHS = new Set([
  '.harness/project/body-release-checklist.md',
  '.harness/project/body-roadmap.md',
]);

const CONSUMER_SCRIPT_NAMES = [
  'harness:guide',
  'harness:scan',
  'harness:handoff',
  'harness:impact',
  'harness:check',
  'harness:check:strict',
  'harness:sync',
  'harness:context',
  'harness:outdated',
  'harness:update',
  'harness:changelog',
  'harness:uninstall',
  'hooks:install',
  'standards:list',
  'templates:list',
  'stack:status',
  'stack:apply',
  'stack:reset',
  'template:status',
  'template:apply',
  'template:reset',
  'template:gap',
];

function parseNodeVersion(version) {
  const parts = version.split('.').map((part) => Number(part));
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
  };
}

function isSupportedNode(version) {
  if (version.major > 20) return true;
  // minor 미지정(bare-major) .nvmrc '20'은 20.19를 보장하지 못하므로 보수적으로 미지원 처리한다.
  if (version.major === 20) return (version.minor ?? 0) >= 19;
  return false;
}

// 하네스 최소 버전(20.19.0)이 engines.node 같은 SemVer 범위를 만족하는지 평가한다.
// semver 라이브러리 없이 Node engines에서 흔한 표기(>=, >, <=, <, =, ^, ~, x-range, 하이픈, ||)만 다룬다.
// engines는 핀이 아니라 범위이므로, '>=18'처럼 20.19+로 만족되는 floor를 저버전 신호로 오탐하지 않기 위함이다.
function harnessNodeAllowedByRange(range) {
  const V = [20, 19, 0];
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const toNum = (t) => (t === undefined || t === null || /^[xX*]$/.test(t)) ? null : Number(t);
  const parseVer = (s) => {
    const m = String(s).trim().match(/^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/);
    if (!m) return null;
    return [toNum(m[1]), toNum(m[2]), toNum(m[3])];
  };
  const lo = (v) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
  const hiExcl = (v) => {
    if (v[0] === null) return [Infinity, 0, 0];
    if (v[1] === null) return [v[0] + 1, 0, 0];
    if (v[2] === null) return [v[0], v[1] + 1, 0];
    return [v[0], v[1], v[2] + 1];
  };
  const inRange = (v) => cmp(V, lo(v)) >= 0 && cmp(V, hiExcl(v)) < 0;
  const evalToken = (tok) => {
    tok = tok.trim();
    if (!tok) return null;
    if (tok === '*') return true;
    if (tok[0] === '^') {
      const v = parseVer(tok.slice(1));
      if (!v) return null;
      const hi = v[0] !== null && v[0] > 0 ? [v[0] + 1, 0, 0]
        : v[1] !== null ? [0, v[1] + 1, 0]
          : [0, 0, (v[2] ?? 0) + 1];
      return cmp(V, lo(v)) >= 0 && cmp(V, hi) < 0;
    }
    if (tok[0] === '~') {
      const v = parseVer(tok.slice(1));
      if (!v) return null;
      const hi = v[1] !== null ? [v[0], v[1] + 1, 0] : [v[0] + 1, 0, 0];
      return cmp(V, lo(v)) >= 0 && cmp(V, hi) < 0;
    }
    const m = tok.match(/^(>=|<=|>|<|=)\s*(.+)$/);
    if (m) {
      const v = parseVer(m[2]);
      if (!v) return null;
      switch (m[1]) {
        case '>=': return cmp(V, lo(v)) >= 0;
        case '>': return cmp(V, lo(v)) > 0;
        case '<=': return cmp(V, lo(v)) <= 0;
        case '<': return cmp(V, lo(v)) < 0;
        case '=': return inRange(v);
      }
    }
    const bare = parseVer(tok);
    if (bare) return inRange(bare);
    return null;
  };

  for (const orPart of String(range).split('||')) {
    const trimmed = orPart.trim();
    const hyphen = trimmed.match(/^(\S+)\s+-\s+(\S+)$/);
    if (hyphen) {
      const a = parseVer(hyphen[1]);
      const b = parseVer(hyphen[2]);
      if (a && b && cmp(V, lo(a)) >= 0 && cmp(V, hiExcl(b)) < 0) return true;
      continue;
    }
    let andOk = true;
    let sawKnown = false;
    for (const token of trimmed.split(/\s+/).filter(Boolean)) {
      const result = evalToken(token);
      if (result === null) continue; // 알 수 없는 토큰은 제약으로 보지 않는다.
      sawKnown = true;
      if (result === false) { andOk = false; break; }
    }
    if (sawKnown && andOk) return true;
  }
  return false;
}

function checkNodeVersion() {
  const nodeVersion = parseNodeVersion(process.versions.node);
  if (!isSupportedNode(nodeVersion)) {
    console.error('');
    console.error(`${MIN_NODE_MESSAGE} Current: ${process.version}`);
    console.error('');
    console.error('Recommended: nvm install && nvm use');
    console.error('Run init again after switching Node.');
    process.exit(1);
  }
}

function parseNodeContract(raw) {
  const value = String(raw ?? '').trim();
  const match = value.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;

  // minor/patch는 "지정 안 함(null)"과 "0"을 구분한다. '12'는 v12.x 전체와 매칭돼야 한다.
  return {
    raw: value,
    major: Number(match[1]),
    minor: match[2] === undefined ? null : Number(match[2]),
    patch: match[3] === undefined ? null : Number(match[3]),
  };
}

// dual-runtime 진단용 nvm 설치본 해석. 규칙은 .harness/bin/node-env.mjs, dual-node.sh와 같다.
// (init은 npx 단독 실행되는 설치기라 .harness/bin 모듈을 import하지 않고 자체 보유한다.)
const NVM_DIR_PATH = process.env.NVM_DIR || join(homedir(), '.nvm');

function listInstalledNodeVersionsForInit() {
  const versionsDir = join(NVM_DIR_PATH, 'versions', 'node');
  let entries = [];
  try {
    entries = readdirSync(versionsDir);
  } catch {
    return [];
  }
  return entries
    .map((name) => ({ name, parsed: parseNodeContract(name), binDir: join(versionsDir, name, 'bin') }))
    .filter((entry) => entry.parsed && existsSync(join(entry.binDir, 'node')))
    .sort((a, b) => (a.parsed.major - b.parsed.major)
      || ((a.parsed.minor ?? 0) - (b.parsed.minor ?? 0))
      || ((a.parsed.patch ?? 0) - (b.parsed.patch ?? 0)));
}

function diagnoseNodeEnvironment() {
  const installed = listInstalledNodeVersionsForInit();
  const harnessBest = installed.filter((entry) => isSupportedNode(entry.parsed)).at(-1) ?? null;
  const nvmAvailable = existsSync(join(NVM_DIR_PATH, 'nvm.sh')) || existsSync(join(NVM_DIR_PATH, 'versions', 'node'));
  return { nvmDir: NVM_DIR_PATH, nvmAvailable, installed, harnessBest };
}

function findInstalledForSpec(envInfo, parsed) {
  if (!parsed) return null;
  const matches = envInfo.installed.filter((entry) =>
    entry.parsed.major === parsed.major &&
    (parsed.minor === null || entry.parsed.minor === parsed.minor) &&
    (parsed.patch === null || entry.parsed.patch === parsed.patch));
  return matches.at(-1) ?? null;
}

// .nvmrc가 없을 때 프로젝트 Node 버전 후보를 감지한다. 확정은 사용자(--project-node)가 한다.
// 각 후보의 low는 "이 신호가 20.19+로는 검증할 수 없는 저버전 프로젝트임을 뜻하는가"이다.
// - 핀 신호(.node-version/Dockerfile/CI): 단일 버전이므로 major < 20이면 low.
// - 범위 신호(engines.node): 20.19.0이 범위를 만족하면 low가 아니다('>=18' 같은 floor 오탐 방지).
function detectProjectNodeCandidates(target) {
  const candidates = [];
  const addPin = (source, value) => {
    const parsed = parseNodeContract(value);
    candidates.push({ source, value, parsed, kind: 'pin', low: Boolean(parsed && parsed.major < 20) });
  };

  const pkg = readJson(join(target, 'package.json'), null);
  const engines = pkg?.engines?.node;
  if (engines) {
    const value = String(engines);
    const match = value.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    candidates.push({
      source: 'package.json engines.node',
      value,
      parsed: match ? parseNodeContract(match[0]) : null,
      kind: 'range',
      low: !harnessNodeAllowedByRange(value),
    });
  }

  const nodeVersionPath = join(target, '.node-version');
  if (existsSync(nodeVersionPath)) {
    addPin('.node-version', readFileSync(nodeVersionPath, 'utf8').trim());
  }

  const dockerfilePath = join(target, 'Dockerfile');
  if (existsSync(dockerfilePath)) {
    const match = readFileSync(dockerfilePath, 'utf8').match(/^\s*from\s+node:v?(\d+(?:\.\d+){0,2})/im);
    if (match) addPin('Dockerfile FROM node', match[1]);
  }

  const workflowsDir = join(target, '.github', 'workflows');
  if (existsSync(workflowsDir)) {
    let workflowFiles = [];
    try {
      workflowFiles = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
    } catch {
      workflowFiles = [];
    }
    for (const file of workflowFiles) {
      const match = readFileSync(join(workflowsDir, file), 'utf8').match(/node-version:\s*['"[]*v?(\d+(?:\.\d+){0,2})/);
      if (match) {
        addPin(`.github/workflows/${file} node-version`, match[1]);
        break;
      }
    }
  }

  return candidates;
}

// 저버전 프로젝트(.nvmrc < 20.19)의 dual-runtime 설치 안내와 환경 진단을 출력한다.
// nvm 자체가 없으면 전환 수단이 없으므로 설치를 중단한다(머신 환경을 바꾸는 nvm 자동 설치는 하지 않는다).
function printDualRuntimeDiagnostics(projectValue, parsedSpec, envInfo) {
  console.log(`project node: .nvmrc ${projectValue}는 하네스 최소 Node 20.19.0 미만 → dual-runtime 모드로 설치합니다.`);
  console.log('  - git hook과 .harness/bin/harness <command>는 nvm 설치본 중 20.19 이상 최신 Node로 자동 전환되어 실행됩니다.');
  console.log('  - 참고: 활성 Node가 낮은 셸에서 `npm run harness:*`는 Node 게이트에서 멈춥니다. 저버전 셸에서는 `.harness/bin/harness <command>`를 쓰거나 먼저 상위 Node로 `nvm use` 하세요.');
  console.log('  - lint/test/build 등 프로젝트 검증은 .nvmrc Node로 실행됩니다. 프로젝트 Node를 올릴 필요가 없습니다.');

  if (!envInfo.nvmAvailable) {
    console.error('');
    console.error('dual-runtime에는 nvm이 필요하지만 nvm을 찾지 못했습니다 (NVM_DIR 또는 ~/.nvm).');
    console.error('nvm 설치 후 다시 실행하세요: https://github.com/nvm-sh/nvm');
    console.error('하네스 설치를 중단합니다.');
    process.exit(1);
  }

  if (envInfo.harnessBest) {
    console.log(`  - 하네스 Node(>=20.19): ${envInfo.harnessBest.name} 설치됨`);
  } else {
    console.warn('  - 하네스 Node(>=20.19): nvm에 없음 → nvm install 20 이상을 설치해야 hook과 하네스 명령이 동작합니다.');
  }

  if (parsedSpec) {
    const projectInstalled = findInstalledForSpec(envInfo, parsedSpec);
    if (projectInstalled) {
      console.log(`  - 프로젝트 Node(${projectValue}): ${projectInstalled.name} 설치됨`);
    } else {
      console.warn(`  - 프로젝트 Node(${projectValue}): nvm에 없음 → nvm install ${projectValue} 후 프로젝트 검증(lint/test/build)이 동작합니다.`);
    }
  } else {
    console.warn(`  - 프로젝트 Node(${projectValue}): 버전 표기를 해석하지 못했습니다. nvm 별칭 대신 숫자 버전 사용을 권장합니다.`);
  }
}

// 0.2.63: 저버전 .nvmrc도 dual-runtime으로 설치를 허용한다(이전에는 설치 중단).
// .nvmrc 없는 Node 프로젝트에서 저버전 신호가 감지되면 추측으로 확정하지 않고
// --project-node 인터뷰(사용자 확인)를 요구한다. 비-Node 프로젝트는 .nvmrc 계약이 원래 없다.
function ensureProjectNodeContract(target, opts) {
  const nvmrcPath = join(target, '.nvmrc');
  const envInfo = diagnoseNodeEnvironment();

  if (existsSync(nvmrcPath)) {
    const value = readFileSync(nvmrcPath, 'utf8').trim();
    const parsed = parseNodeContract(value);
    if (parsed && isSupportedNode(parsed)) {
      console.log(`project node: existing .nvmrc ${value} preserved`);
      return;
    }
    printDualRuntimeDiagnostics(value || '(empty)', parsed, envInfo);
    return;
  }

  if (opts.projectNode) {
    const parsed = parseNodeContract(opts.projectNode);
    if (!parsed) {
      console.error(`--project-node '${opts.projectNode}'를 버전으로 해석하지 못했습니다. 예: --project-node 12 또는 --project-node 12.18.4`);
      process.exit(1);
    }
    if (opts.dryRun) {
      console.log(`project node: .nvmrc ${opts.projectNode} 생성 예정 (--project-node)`);
    } else {
      writeFileSync(nvmrcPath, `${opts.projectNode}\n`);
      console.log(`project node: .nvmrc ${opts.projectNode} 생성 (--project-node 사용자 확인 기반)`);
    }
    if (!isSupportedNode(parsed)) {
      printDualRuntimeDiagnostics(opts.projectNode, parsed, envInfo);
    }
    return;
  }

  const hasPackageJson = existsSync(join(target, 'package.json'));
  if (!hasPackageJson) {
    // 비-Node 프로젝트: 프로젝트 Node 계약이 없는 것이 정상. 도구용 Node만 진단한다.
    if (envInfo.nvmAvailable && !envInfo.harnessBest) {
      console.warn('project node: 비-Node 프로젝트. nvm에 하네스용 Node(>=20.19)가 없습니다 → nvm install 20 이상을 권장합니다.');
    }
    return;
  }

  const candidates = detectProjectNodeCandidates(target);
  // engines는 20.19+로 만족 가능한 floor('>=18' 등)면 트리거하지 않는다. 핀만 major<20일 때 트리거한다.
  const low = candidates.find((candidate) => candidate.low);
  if (low) {
    console.error('project node: .nvmrc가 없지만 저버전 Node 신호를 감지했습니다.');
    for (const candidate of candidates) {
      console.error(`  - ${candidate.source}: ${candidate.value}${candidate.low ? '' : ' (20.19+로 만족 가능 — 비저버전 신호)'}`);
    }
    console.error('');
    console.error('이 프로젝트의 검증(lint/test/build)을 어떤 Node로 실행할지 확정해야 dual-runtime이 동작합니다.');
    console.error('프로젝트 Node 버전을 확인한 뒤 같은 init 명령에 --project-node를 붙여 다시 실행하세요.');
    console.error(`  예: init --project-node ${low.parsed ? low.parsed.major : 12}`);
    console.error('(.nvmrc를 직접 만들어도 됩니다. 하네스는 프로젝트 Node 버전을 추측으로 확정하지 않습니다.)');
    process.exit(1);
  }

  const hint = candidates.length > 0 ? ` (감지된 후보: ${candidates.map((candidate) => `${candidate.source}=${candidate.value}`).join(', ')})` : '';
  console.log(`project node: .nvmrc 없음 — 프로젝트 Node 계약을 명시하려면 --project-node <version> 또는 .nvmrc 추가를 권장합니다.${hint}`);
}

function printUsageAndExit(code = 0) {
  console.log(`Usage:
  npx -y git+<seed-repo-url>#<tag> init [options]

Options:
  --dry-run              변경 없이 설치 계획만 출력합니다.
  --force                프로젝트 소유 파일까지 덮어씁니다.
  --confirm-overwrite-project-files
                         --force로 프로젝트 소유/출처 미확인 파일을 덮어쓰는 위험을 인지했음을 명시합니다.
  --no-backup            백업을 만들지 않습니다. 기존 항목이 있으면 --force가 필요합니다.
  --no-scan              설치 후 프로젝트 스캔 리포트를 자동 생성하지 않습니다.
  --no-handoff           설치/업데이트 인수인계 요약을 자동 생성하지 않습니다.
  --no-check             설치 후 하네스 기본 검사를 자동 실행하지 않습니다.
  --embedded             스택 하네스 설치 흐름 내부에서 호출될 때 중간 안내를 줄입니다.
  --verbose              설치 내부 명령과 진단 출력을 자세히 표시합니다.
  --with-package-json    package.json이 없을 때도 새로 만들어 harness npm 별칭을 주입합니다(기본은 비-Node 프로젝트로 보고 생성하지 않음).
  --project-node <ver>   .nvmrc가 없을 때 프로젝트 Node 버전을 사용자 확인 기반으로 .nvmrc에 기록합니다(예: 12, 12.18.4).
                         20.19 미만 버전은 dual-runtime 모드(하네스 Node와 프로젝트 Node 분리)로 동작합니다.
  --from-git <repo-url>  동봉본 대신 git 저장소에서 소스를 가져옵니다.
  --ref <ref>            --from-git과 함께 사용할 branch/tag/sha입니다. 기본값: main
  --source-repo <url>    설치 메타데이터에 기록할 공통 하네스 저장소입니다.
  --source-ref <ref>     설치 메타데이터에 기록할 공통 하네스 ref입니다.
  --source-commit <sha>  설치 메타데이터에 기록할 공통 하네스 commit입니다.
  -h, --help             도움말을 출력합니다.

기존 프로젝트 루트에서 실행하세요. 기존 업무 코드는 덮어쓰지 않습니다.
`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    command: argv[2],
    dryRun: false,
    force: false,
    confirmOverwriteProjectFiles: process.env.AI_STANDARD_CONFIRM_OVERWRITE_PROJECT_FILES === '1',
    noBackup: false,
    noScan: false,
    noHandoff: false,
    noCheck: false,
    embedded: false,
    verbose: false,
    withPackageJson: false,
    projectNode: null,
    fromGit: null,
    ref: 'main',
    sourceRepo: null,
    sourceRef: null,
    sourceCommit: null,
  };

  const args = argv.slice(3);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '-h':
      case '--help':
        printUsageAndExit(0);
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '--confirm-overwrite-project-files':
      case '--confirm-overwrite-project-state':
        opts.confirmOverwriteProjectFiles = true;
        break;
      case '--no-backup':
        opts.noBackup = true;
        break;
      case '--no-scan':
        opts.noScan = true;
        break;
      case '--no-handoff':
        opts.noHandoff = true;
        break;
      case '--no-check':
        opts.noCheck = true;
        break;
      case '--embedded':
        opts.embedded = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--with-package-json':
        opts.withPackageJson = true;
        break;
      case '--project-node': {
        const version = args[++i];
        if (!version || version.startsWith('-')) {
          console.error('--project-node에는 Node 버전이 필요합니다. 예: --project-node 12');
          process.exit(1);
        }
        opts.projectNode = version;
        break;
      }
      case '--from-git': {
        const repo = args[++i];
        if (!repo || repo.startsWith('-')) {
          console.error('--from-git에는 git repository URL이 필요합니다.');
          process.exit(1);
        }
        opts.fromGit = repo;
        break;
      }
      case '--ref': {
        const ref = args[++i];
        if (!ref || ref.startsWith('-')) {
          console.error('--ref에는 branch/tag/sha가 필요합니다.');
          process.exit(1);
        }
        opts.ref = ref;
        break;
      }
      case '--source-repo': {
        const repo = args[++i];
        if (!repo || repo.startsWith('-')) {
          console.error('--source-repo에는 repository URL이 필요합니다.');
          process.exit(1);
        }
        opts.sourceRepo = repo;
        break;
      }
      case '--source-ref': {
        const ref = args[++i];
        if (!ref || ref.startsWith('-')) {
          console.error('--source-ref에는 branch/tag/sha가 필요합니다.');
          process.exit(1);
        }
        opts.sourceRef = ref;
        break;
      }
      case '--source-commit': {
        const commit = args[++i];
        if (!commit || commit.startsWith('-')) {
          console.error('--source-commit에는 commit sha가 필요합니다.');
          process.exit(1);
        }
        opts.sourceCommit = commit;
        break;
      }
      default:
        console.error(`알 수 없는 옵션: ${arg}`);
        printUsageAndExit(1);
    }
  }

  return opts;
}

function assertSafeTarget(target) {
  const forbidden = new Set(
    [
      '/',
      '/etc',
      '/usr',
      '/var',
      '/bin',
      '/sbin',
      '/System',
      '/Library',
      homedir(),
    ].map((p) => pathResolve(p)),
  );

  const normalized = pathResolve(target);
  if (forbidden.has(normalized)) {
    console.error(`보호된 경로에는 설치할 수 없습니다: ${normalized}`);
    process.exit(1);
  }

  if (!existsSync(normalized) || !statSync(normalized).isDirectory()) {
    console.error(`타깃은 존재하는 디렉토리여야 합니다: ${normalized}`);
    process.exit(1);
  }
}

function toPosix(filePath) {
  return filePath.split('\\').join('/');
}

function walkFiles(root) {
  const out = [];
  if (!existsSync(root)) return out;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }

  return out;
}

function collectInstallFiles(sourceRoot) {
  const files = [];

  for (const item of INSTALL_ITEMS) {
    const abs = join(sourceRoot, item);
    if (!existsSync(abs)) continue;

    if (statSync(abs).isDirectory()) {
      for (const file of walkFiles(abs)) {
        const rel = toPosix(relative(sourceRoot, file));
        if (shouldIncludeInstallFile(rel)) {
          files.push(rel);
        }
      }
      continue;
    }

    const rel = toPosix(item);
    if (shouldIncludeInstallFile(rel)) {
      files.push(rel);
    }
  }

  return [...new Set(files)].filter((file) => !file.endsWith('scripts/init.mjs'));
}

function shouldIncludeInstallFile(relPath) {
  const rel = toPosix(relPath);
  return !(
    rel.startsWith('.harness/generated/') ||
    rel.startsWith('.harness/stacks/.applied/') ||
    rel.startsWith('.harness/templates/.applied/') ||
    CONSUMER_PROJECT_STATE_PATHS.includes(rel) ||
    [
      '.harness/session/project-scan-report.md',
      '.harness/session/handoff.md',
      '.harness/session/template-gap-report.md',
      '.harness/session/task-context.md',
      '.harness/install-manifest.json',
      '.harness/harness-lock.json',
      '.harness/.stack-applied.json',
      '.harness/.template-applied.json',
    ].includes(rel)
  );
}

function isProjectOwned(relPath) {
  const rel = toPosix(relPath);
  if (rel === MANIFEST_PATH) return false;
  return PROJECT_OWNED_PATHS.has(rel) || PROJECT_OWNED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function isManagedByManifest(manifest, relPath) {
  return Boolean(manifest && manifest.managedFiles && manifest.managedFiles[toPosix(relPath)]);
}

// 마커 기반 managed 영역 (옵션 A, 0.2.67).
// CLAUDE.md/AGENTS.md/.github/copilot-instructions.md는 본체 보일러플레이트와 소비자 지침이
// 한 파일에 공존한다. 마커 안(start~end)은 본체 소유로 자동 갱신하고, 마커 밖은 소비자 소유로 보존한다.
const MARKER_START = '<!-- harness-managed:start -->';
const MARKER_END = '<!-- harness-managed:end -->';
const MARKER_MANAGED_FILES = new Set(['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']);

function isMarkerManaged(relPath) {
  return MARKER_MANAGED_FILES.has(toPosix(relPath));
}

// 마커 블록(마커 라인 포함)을 반환한다. 마커 쌍이 없거나 순서가 어긋나면 null.
function extractManagedBlock(content) {
  const s = content.indexOf(MARKER_START);
  const e = content.indexOf(MARKER_END);
  if (s === -1 || e === -1 || e < s) return null;
  return content.slice(s, e + MARKER_END.length);
}

// 마커 안 내용(마커 라인 제외)을 반환한다. 영역 해시 비교용. 마커 쌍이 없으면 null.
function extractManagedRegion(content) {
  const block = extractManagedBlock(content);
  if (block === null) return null;
  return block.slice(MARKER_START.length, block.length - MARKER_END.length);
}

// 소비자 파일의 마커 블록을 본체 마커 블록으로 교체하고 마커 밖(소비자 영역)은 보존한다.
// 본체나 소비자 어느 한쪽에 마커가 없으면 null(머지 불가)을 반환한다.
function mergeMarkerManaged(harnessContent, consumerContent) {
  const harnessBlock = extractManagedBlock(harnessContent);
  if (harnessBlock === null) return null;
  const s = consumerContent.indexOf(MARKER_START);
  const e = consumerContent.indexOf(MARKER_END);
  if (s === -1 || e === -1 || e < s) return null;
  const before = consumerContent.slice(0, s);
  const after = consumerContent.slice(e + MARKER_END.length);
  return `${before}${harnessBlock}${after}`;
}

// managed 파일이 manifest 기록 시점 이후 소비자에 의해 수정됐는지 판별한다.
// CLAUDE.md/AGENTS.md처럼 본체 보일러플레이트 + 소비자 지침이 한 파일에 섞일 수 있는
// 하이브리드 managed 파일이 base 업데이트 때 무경고로 덮여 소비자 내용이 영구 소실되는 사고를
// 막기 위한 안전망의 1차 판단 함수다.
function isLocallyModifiedManagedFile(target, relPath, manifest) {
  const rel = toPosix(relPath);
  // 마커 관리 파일은 마커 머지 경로(installFiles)로 처리되므로 통짜 보존/force 가드 대상에서 제외한다.
  if (isMarkerManaged(rel)) return false;
  const expected = manifest?.managedFiles?.[rel]?.sha256;
  if (!expected) return false;
  const abs = join(target, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) return false;
  return sha256(abs) !== expected;
}

function collectLegacyManagedRootScripts(target, manifest) {
  if (!manifest) return [];

  return LEGACY_MANAGED_ROOT_SCRIPTS.filter((rel) => (
    isManagedByManifest(manifest, rel) &&
    existsSync(join(target, rel))
  ));
}

function removeLegacyManagedRootScripts(target, files, opts) {
  if (files.length === 0) return { removed: 0, files: [] };
  if (opts.dryRun) return { removed: 0, files };

  const removed = [];
  for (const rel of files) {
    rmSync(join(target, rel), { force: true });
    removed.push(rel);
  }

  const scriptsDir = join(target, 'scripts');
  if (existsSync(scriptsDir)) {
    try {
      if (readdirSync(scriptsDir).length === 0) {
        rmSync(scriptsDir, { recursive: true, force: true });
      }
    } catch {
      // 정리 실패는 설치 실패로 보지 않는다.
    }
  }

  return { removed: removed.length, files: removed };
}

function hasHarnessLikeFiles(target) {
  return [
    '.harness',
    '.claude',
    '.github/copilot-instructions.md',
    'CLAUDE.md',
    'AGENTS.md',
  ].some((rel) => existsSync(join(target, rel)));
}

function detectBridgeCandidates(target, skippedFiles) {
  const candidates = []

  for (const rel of ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']) {
    if (!skippedFiles.includes(rel) || !existsSync(join(target, rel))) {
      continue
    }

    const content = readFileSync(join(target, rel), 'utf8')
    if (!content.includes('.harness/project/local-methodology.md')) {
      candidates.push(rel)
    }
  }

  return candidates
}

function sha256(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function sha256Text(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupExisting(target, files, dryRun) {
  const existing = files.filter((rel) => existsSync(join(target, rel)));
  if (existing.length === 0) {
    return { dir: null, count: 0 };
  }

  const dir = join(target, '.harness-backup', isoStamp());
  if (dryRun) {
    return { dir, count: existing.length };
  }

  mkdirSync(dir, { recursive: true });
  for (const rel of existing) {
    const src = join(target, rel);
    const dst = join(dir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true, dereference: false });
  }

  return { dir, count: existing.length };
}

function installFiles(sourceRoot, target, files, opts, manifest) {
  const stats = { added: 0, updated: 0, skipped: 0 };
  const skippedFiles = [];
  const copiedFiles = [];
  // 안전망: 로컬 수정 감지된 managed 파일은 기본적으로 보존하고, --force --confirm-overwrite-project-files
  // 동의가 있을 때만 .harness-bak 백업 후 덮어쓴다. 둘 다 후처리에서 명시적으로 보고한다.
  const preservedLocallyModified = [];
  const overwroteLocallyModified = [];
  // 마커 머지(옵션 A, 0.2.67) 후처리 분류.
  const mergedMarkerFiles = [];        // 마커 머지: 마커 밖(소비자) 보존 + 마커 안(본체) 갱신
  const overwroteManagedRegion = [];   // 머지 중 소비자가 회사 영역(마커 안)을 수정해 사이드카로 백업한 파일
  const autoMigratedMarkerFiles = [];  // 마커 없던 미수정 파일을 마커 버전으로 자동 이전
  const needsMarkerMigration = [];     // 마커 없는 수정본 → 보존 + 수동 이전 안내
  // seed-only 문서(0.2.69): 본체 전용 문서는 소비자 타깃에 배포하지 않는다.
  const seedModeTarget = existsSync(join(target, SEED_MODE_MARKER));
  const skippedSeedOnlyDocs = [];

  for (const rel of files) {
    const src = join(sourceRoot, rel);
    const dest = join(target, rel);
    const exists = existsSync(dest);
    const projectOwned = isProjectOwned(rel);
    const managed = isManagedByManifest(manifest, rel);

    // seed-only 문서는 소비자(마커 없음) 타깃에 배포하지 않는다. 기존 설치본 제거는 removeSeedOnlyDocs가 담당.
    // 본체(마커 있음) 타깃에는 그대로 복사한다(본체 개발에 필요).
    if (!seedModeTarget && SEED_ONLY_DOC_PATHS.has(toPosix(rel))) {
      if (opts.dryRun) {
        console.log(`[dry-run] skip(seed-only) ${rel}`);
      }
      skippedSeedOnlyDocs.push(rel);
      continue;
    }

    // 마커 관리 파일(CLAUDE.md/AGENTS.md/copilot): 마커 안은 본체 갱신, 마커 밖은 소비자 보존.
    // 첫 설치(!exists)나 미등록(!managed)은 아래 일반 경로에서 본체(마커 포함)를 그대로 복사한다.
    if (exists && managed && isMarkerManaged(rel)) {
      const consumerContent = readFileSync(dest, 'utf8');
      const consumerRegion = extractManagedRegion(consumerContent);
      const recorded = manifest?.managedFiles?.[toPosix(rel)] ?? {};

      if (consumerRegion !== null) {
        // 소비자에 마커 있음 → 머지: 마커 밖 보존 + 마커 안 본체로 교체.
        const harnessContent = readFileSync(src, 'utf8');
        const merged = mergeMarkerManaged(harnessContent, consumerContent);
        // 소비자가 회사 영역(마커 안)까지 수정했으면 머지로 그 수정이 사라지므로 사이드카 백업 + 리포트.
        const regionModified = Boolean(
          recorded.managedRegionSha256 && sha256Text(consumerRegion) !== recorded.managedRegionSha256,
        );
        const backupRel = regionModified ? `${rel}.harness-bak` : null;

        if (opts.dryRun) {
          console.log(`[dry-run] merge(marker) ${rel}${backupRel ? ` [backup → ${backupRel}]` : ''}`);
        } else {
          if (backupRel) copyFileSync(dest, join(target, backupRel));
          writeFileSync(dest, merged);
        }
        stats.updated++;
        copiedFiles.push(rel);
        mergedMarkerFiles.push(rel);
        if (backupRel) overwroteManagedRegion.push({ rel, backup: backupRel });
        continue;
      }

      // 소비자에 마커 없음 → 옛 버전. 마이그레이션 판정.
      const unmodified = Boolean(recorded.sha256 && sha256(dest) === recorded.sha256);
      if (unmodified) {
        // 소비자가 파일을 전혀 안 건드림 → 마커 버전(본체)으로 통째 교체(자동 마이그레이션).
        if (opts.dryRun) {
          console.log(`[dry-run] migrate(marker) ${rel}`);
        } else {
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(src, dest);
        }
        stats.updated++;
        copiedFiles.push(rel);
        autoMigratedMarkerFiles.push(rel);
        continue;
      }

      // 마커 없는 수정본 → 어디까지가 회사/소비자인지 모름 → 보존 + 수동 이전 안내.
      if (opts.dryRun) {
        console.log(`[dry-run] preserve(needs-marker-migration) ${rel}`);
      }
      stats.skipped++;
      skippedFiles.push(rel);
      needsMarkerMigration.push(rel);
      continue;
    }

    let shouldCopy = !exists || opts.force || (!projectOwned && managed);

    let preservedByGuard = false;
    let backupRel = null;

    if (exists && managed && !projectOwned && isLocallyModifiedManagedFile(target, rel, manifest)) {
      if (!opts.force) {
        // 기본 흐름: --force 없으면 로컬 수정본을 보존한다.
        shouldCopy = false;
        preservedByGuard = true;
      } else if (opts.confirmOverwriteProjectFiles) {
        // 명시적 동의가 있으면 덮어쓴다. .harness-bak 사이드카로 직전 소비자본을 같은 디렉터리에 남긴다.
        backupRel = `${rel}.harness-bak`;
        if (!opts.dryRun) {
          copyFileSync(dest, join(target, backupRel));
        }
      }
      // --force만 있고 --confirm 미동의면 collectForceOverwriteTargets 가드가 차단한다.
    }

    if (opts.dryRun) {
      const action = !exists
        ? 'add'
        : preservedByGuard
          ? 'preserve(locally-modified-managed)'
          : shouldCopy
            ? 'update'
            : 'preserve';
      const suffix = backupRel ? ` [backup → ${backupRel}]` : '';
      console.log(`[dry-run] ${action} ${rel}${suffix}`);
    } else if (shouldCopy) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }

    if (preservedByGuard) {
      stats.skipped++;
      skippedFiles.push(rel);
      preservedLocallyModified.push(rel);
    } else if (!exists) {
      stats.added++;
      copiedFiles.push(rel);
    } else if (shouldCopy) {
      stats.updated++;
      copiedFiles.push(rel);
      if (backupRel) {
        overwroteLocallyModified.push({ rel, backup: backupRel });
      }
    } else {
      stats.skipped++;
      skippedFiles.push(rel);
    }
  }

  return {
    ...stats,
    skippedFiles,
    copiedFiles,
    preservedLocallyModified,
    overwroteLocallyModified,
    mergedMarkerFiles,
    overwroteManagedRegion,
    autoMigratedMarkerFiles,
    needsMarkerMigration,
    skippedSeedOnlyDocs,
  };
}

// 소비자(마커 없음) 타깃에서 이미 설치된 seed-only 문서를 정리한다.
// manifest에 managed로 기록되고 미수정(sha 일치)이면 제거하고, 소비자가 수정했으면 보존 + 리포트한다.
// 본체(마커 있음) 타깃은 건드리지 않는다.
function removeSeedOnlyDocs(target, manifest, opts) {
  const result = { removed: [], preservedModified: [] };

  if (existsSync(join(target, SEED_MODE_MARKER))) {
    return result;
  }

  for (const rel of SEED_ONLY_DOC_PATHS) {
    const abs = join(target, rel);
    if (!existsSync(abs)) {
      continue;
    }

    const recordedSha = manifest?.managedFiles?.[toPosix(rel)]?.sha256;
    const unmodified = recordedSha && sha256(abs) === recordedSha;

    if (!recordedSha) {
      // 출처를 확인할 수 없는(외부에서 만든) 파일은 건드리지 않는다.
      result.preservedModified.push(rel);
      continue;
    }

    if (!unmodified) {
      // 소비자가 수정한 흔적이 있으면 조용히 지우지 않고 보존 + 안내.
      result.preservedModified.push(rel);
      continue;
    }

    if (!opts.dryRun) {
      rmSync(abs, { force: true });
    }
    result.removed.push(rel);
  }

  return result;
}

function consumerProjectStateTemplate(rel, context) {
  const generatedAt = context.generatedAt;
  const packageVersion = context.packageVersion;

  switch (rel) {
    case '.harness/session/active-context.md':
      return `# 현재 컨텍스트

이 문서는 이 프로젝트에서 최근 작업 상태와 다음 작업을 짧게 이어받기 위한 소비자 프로젝트 전용 문서입니다.

> 하네스 본체의 개발 기록이 아닙니다. 설치된 프로젝트의 현재 작업 맥락만 기록합니다.

## 현재 상태
- generatedAt: ${generatedAt}
- baseHarness: ${packageVersion}
- activeStack: \`.harness/policy/profile.json\` 참고
- harnessMode: \`.harness/policy/profile.json\` 참고

## 최근 작업
- 하네스가 설치되었거나 업데이트되었습니다.
- 프로젝트 구조 분석 결과는 \`.harness/session/project-scan-report.md\`를 확인합니다.
- 설치/업데이트 직후 요약은 \`.harness/session/handoff.md\`를 확인합니다.

## 기준 포인터
- 에이전트 진입과 항상 읽는 기준: \`CLAUDE.md\`
- 개발/검증/운영 흐름 규칙: \`.harness/project/workflow-rules.md\`
- 커밋/푸시 hook 운영 기준: \`.harness/project/commit-push-rules.md\`
- 프로젝트 도메인/구조 규칙: \`.harness/project/domain-rules.md\`, \`.harness/project/architecture-rules.md\`

## 확인할 일
- 에이전트는 사용자가 "하네스"를 언급하지 않아도 루트의 \`.harness/\`를 감지하면 하네스 작업 프로토콜을 적용해야 합니다.
- \`.harness/project/project-charter.md\`의 TBD 항목을 프로젝트 상황에 맞게 채웁니다.
- 큰 작업이나 낯선 영역이면 에이전트가 \`npm run harness:context -- "<작업 설명>"\`으로 판단 컨텍스트를 만듭니다.
- 작업 후 \`npm run harness:check\`로 기준, 링크, 검증 상태를 확인합니다.

## 슬림 유지 원칙
- 이 문서는 프로젝트 고정 사실, 최신 작업 상태, 다음 핸드오프만 짧게 남깁니다.
- 운영 규칙 본문은 복사하지 않고 \`.harness/project/*\`와 \`CLAUDE.md\`를 단일 출처로 가리킵니다.
`;

    case '.harness/session/decision-log.md':
      return `# 결정 로그

이 문서는 이 프로젝트에서 내린 중요한 판단과 선택 이유를 남기는 소비자 프로젝트 전용 로그입니다.

> 하네스 본체의 변경 이력이나 릴리스 노트가 아닙니다. 하네스 본체 변경 기록은 하네스 저장소의 \`CHANGELOG.md\` 또는 릴리스 태그를 확인합니다.

## 기록 원칙
- 프로젝트 기준, 스택 기준, 템플릿 계약, 개인 기준이 충돌할 때 선택 이유를 남깁니다.
- 테스트 전략, 예외 허용, 아키텍처 경계, 운영 절차처럼 이후 작업에 영향을 주는 판단을 남깁니다.
- 단순 작업 로그나 일회성 구현 세부사항은 남기지 않습니다.
- 사용자가 하네스를 직접 언급하지 않았더라도, 하네스 설치 후 반복 규칙으로 굳어진 결정은 이 문서와 \`.harness/project/*\`에 남깁니다.
- 임시 예외는 가능하면 \`.harness/policy/waivers.json\`에 범위와 만료 조건을 함께 남깁니다.
- 결정이 \`.harness/project/*\` 규칙으로 굳으면 기존 항목 본문은 \`→ <대상 문서> 참조\` 포인터로 축약합니다.
- 오래된 결정은 날짜별 \`decision-log-YYYYH1.md\`, \`decision-log-YYYYH2.md\`, \`thread-handoff-YYYY-MM-DD.md\` 같은 스냅샷으로 아카이브하고, 현재 파일은 최근/유효 결정만 유지합니다.
- append-only로만 늘리지 말고 갱신 전 supersede된 항목을 먼저 정리합니다.

## ${generatedAt.slice(0, 10)} - 하네스 초기 설치 또는 업데이트
- baseHarness: ${packageVersion}
- 이 프로젝트의 구체적인 판단은 아직 기록되지 않았습니다.
- 설치 직후 분석은 \`.harness/session/project-scan-report.md\`와 \`.harness/session/handoff.md\`를 확인합니다.
`;

    case '.harness/session/developer-input-queue.md':
      return `# 개발자 입력 큐

개발자 정보 부족 때문에 확정하지 못한 질문을 관리합니다.

## 상태 정의
- \`open\`: 다음 작업 전에 다시 확인해야 함
- \`deferred\`: 개발자가 이번 세션에서 답변을 유보함
- \`answered\`: 답변을 받아 반영함
- \`obsolete\`: 더 이상 필요하지 않음

## 현재 오픈 항목
| id | status | 질문 | 왜 필요한가 | 개발자 선택 |
| --- | --- | --- | --- | --- |
| charter-status | open | 이 프로젝트는 신규 구축, 유지보수, 마이그레이션, 운영 개선 중 어디에 가까운가? | 프로젝트 헌장 질문을 상황에 맞게 줄이기 위해 필요 | 미정 |
| charter-scope | open | 이 저장소가 현재 책임지는 범위와 책임지지 않는 범위는 무엇인가? | 프로젝트 하네스가 과도한 규칙을 만들지 않기 위해 필요 | 미정 |
| charter-success | open | 현재 가장 중요한 성공 기준은 무엇인가? | 완료 판단과 범위 통제를 위해 필요 | 미정 |
| charter-risk | open | 변경하면 특히 위험한 영역이나 반복 회귀 지점은 무엇인가? | 유지보수와 에이전트 작업의 검증 기준을 정하기 위해 필요 | 미정 |

## 운영 원칙
- 답변을 받으면 관련 문서(\`project-charter.md\`, \`active-context.md\`, \`decision-log.md\`)를 함께 갱신합니다.
- 유보된 질문은 삭제하지 않고 \`deferred\`로 남깁니다.
- \`answered\` 또는 \`obsolete\` 항목은 관련 문서 반영을 확인한 뒤 큐에서 제거하거나 날짜별 아카이브로 옮깁니다.
- 상시 로드되는 큐에는 \`open\`과 \`deferred\` 항목만 유지합니다.
- 에이전트는 구현 중 추측이 필요한 반복 규칙을 만나면 사용자에게 인터뷰하거나 이 큐에 \`open\` 항목을 추가합니다.
`;

    case '.harness/session/manual-actions.md':
      return `# Manual Actions

에이전트나 하네스가 직접 처리할 수 없어 사용자가 직접 확인해야 하는 작업 목록입니다.

> 하네스 본체의 운영 목록이 아닙니다. 이 프로젝트의 외부 콘솔, secret, capability, Pages/배포 설정 같은 수동 조치만 남깁니다.

## Open

| 상태 | 항목 | 필요한 사용자 조치 | 관련 작업 |
| --- | --- | --- | --- |
| TBD | 예: 외부 서비스 secret 등록 | 콘솔에서 값을 등록하고 결과를 알려주세요. | TBD |

## 작성 기준

- Supabase secret, GitHub/GitLab Pages 설정, Apple capability, 인증서, 스토어/클라우드 콘솔 설정처럼 로컬 코드 수정만으로 끝나지 않는 일을 기록합니다.
- 완료되면 상태를 \`done\`으로 바꾸고, 확인한 날짜와 근거를 관련 작업 칸에 남깁니다.
- 수동 조치가 구현 방향에 영향을 주면 \`decision-log.md\`에도 결정 근거를 남깁니다.
`;

    case '.harness/session/next-session-reminder.md':
      return `# 다음 세션 리마인더

새 세션에서 바로 이어받기 위한 소비자 프로젝트 전용 메모입니다.

## 먼저 확인할 것
1. \`git --no-pager status --short\`
2. \`.harness/session/handoff.md\`
3. \`.harness/session/project-scan-report.md\`
4. \`.harness/session/developer-input-queue.md\`
5. 사용자가 하네스를 언급하지 않아도 \`.harness/\`가 있으면 하네스 작업 프로토콜을 적용할 것

## 권위 문서 포인터
- 항상 읽는 기준: \`CLAUDE.md\`
- 작업 흐름/검증/완료 승인: \`.harness/project/workflow-rules.md\`
- 커밋/푸시 기준: \`.harness/project/commit-push-rules.md\`
- 도메인/구조 규칙: \`.harness/project/domain-rules.md\`, \`.harness/project/architecture-rules.md\`

## 다음 작업
- 프로젝트 헌장 TBD 항목을 확인합니다.
- 이번 작업 설명이 있으면 \`npm run harness:context -- "<작업 설명>"\`으로 읽을 기준을 좁힙니다.
- 작업 후 \`npm run harness:check\`를 실행합니다.

## 슬림 유지 원칙
- 이 문서는 부트스트랩 체크리스트와 다음 세션 미결 항목만 남깁니다.
- \`.harness/project/*\` 규칙 본문을 복사하지 않고 위 포인터로 가리킵니다.
- 갱신할 때는 append-only로 늘리지 말고, 오래된 규칙 본문을 포인터로 축약한 뒤 새 항목을 추가합니다.
`;

    case '.harness/session/project-memory.md':
      return `# 프로젝트 메모리

세션이 바뀌어도 유지되는 이 프로젝트의 안정적인 사실을 기록합니다.

> 하네스 본체 저장소의 설계 메모리가 아닙니다. 이 프로젝트의 도메인, 운영 방식, 반복되는 검증 기준만 남깁니다.

## 프로젝트 성격
- 프로젝트/서비스 이름: \`TBD\`
- 소유 팀 또는 담당 주체: \`TBD\`
- 주된 작업 유형: \`TBD\`
- 활성 스택: \`.harness/policy/profile.json\` 참고

## 반복해서 참고할 사실
- 아직 기록된 프로젝트 고유 사실이 없습니다.

## 기록 원칙
- 한 번뿐인 구현 세부사항은 기록하지 않습니다.
- 반복되는 도메인 규칙, 아키텍처 경계, 검증 기준만 남깁니다.
- 오래된 사실을 바꿀 때는 \`decision-log.md\`에 변경 이유를 남깁니다.
- 한 항목은 한 줄로 유지하고, 같은 사실은 새 항목으로 추가하지 말고 기존 항목을 업데이트합니다.
- 틀렸거나 supersede된 기억은 현재 파일에 남겨두지 말고 삭제하거나 유효한 사실로 교체합니다.
`;

    default:
      throw new Error(`Unknown consumer project state template: ${rel}`);
  }
}

function isUnchangedManagedProjectState(target, rel, manifest) {
  const abs = join(target, rel);
  if (!existsSync(abs) || !manifest?.managedFiles?.[rel]?.sha256) {
    return false;
  }

  return sha256(abs) === manifest.managedFiles[rel].sha256;
}

function writeConsumerProjectStateFiles(target, opts, manifest, sourcePkg) {
  const result = { added: 0, updated: 0, preserved: 0, planned: 0, files: [] };
  const context = {
    generatedAt: new Date().toISOString(),
    packageVersion: sourcePkg.version || '0.0.0',
  };

  for (const rel of CONSUMER_PROJECT_STATE_PATHS) {
    const abs = join(target, rel);
    const exists = existsSync(abs);
    const template = consumerProjectStateTemplate(rel, context);
    const unchangedManaged = isUnchangedManagedProjectState(target, rel, manifest);
    const shouldWrite = !exists || opts.force || unchangedManaged;

    if (opts.dryRun) {
      if (shouldWrite) {
        console.log(`[dry-run] ${!exists ? 'add' : 'replace'} consumer project state ${rel}`);
        result.planned++;
      }
      continue;
    }

    if (!shouldWrite) {
      result.preserved++;
      continue;
    }

    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, template);
    result.files.push(rel);
    if (exists) {
      result.updated++;
    } else {
      result.added++;
    }
  }

  return result;
}

function ensureCurrentWorkHistoryYear(target, opts) {
  const year = String(new Date().getFullYear());
  const rel = `.harness/maintenance/work-history/${year}/.gitkeep`;
  const abs = join(target, rel);

  if (opts.dryRun) {
    console.log(`[dry-run] ensure work history year folder ${rel}`);
    return { rel, created: !existsSync(abs) };
  }

  if (!existsSync(abs)) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '');
    return { rel, created: true };
  }

  return { rel, created: false };
}

function hasProjectNvmrc(target = TARGET) {
  return existsSync(join(target, '.nvmrc'));
}

function isGitRepository(target = TARGET) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: target,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function renderNodeStep(target = TARGET) {
  if (hasProjectNvmrc(target)) {
    return `  0) 새 터미널이면 프로젝트 루트에서 Node 버전 적용
       nvm use`;
  }

  return `  0) 프로젝트 .nvmrc 없음
       Node 버전 적용 단계는 건너뜁니다. Node 계약을 정하려면 .nvmrc를 추가하거나 init --project-node <version>을 사용하세요.`;
}

function renderHookStep(target = TARGET, index = 7) {
  if (isGitRepository(target)) {
    return `  ${index}) git hook 활성화
       npm run hooks:install
       이후 사용자가 승인한 git commit/push 전에 npm run harness:check가 자동 실행됩니다.`;
  }

  return `  ${index}) git hook 활성화
       현재 git 저장소가 아니므로 건너뜁니다. 필요하면 git init 후 npm run hooks:install을 실행하세요.`;
}

function printConsumerCommandGuide(target = TARGET) {
  const hookGuide = isGitRepository(target)
    ? `  - git commit/push 전 자동 검증 연결
       npm run hooks:install`
    : `  - git hook 연결
       현재 git 저장소가 아니면 먼저 git init 후 npm run hooks:install`

  console.log(`
::: 소비자 명령 빠른 안내 :::
  - 현재 상태 가이드 열기
       npm run harness:guide -- --open
  - 프로젝트 구조와 로컬룰 후보 다시 스캔
       npm run harness:scan
  - 설치/업데이트 후 인수인계 요약 다시 생성
       npm run harness:handoff
  - 큰 작업 전 읽을 문서와 스킬 좁히기
       npm run harness:context -- "<작업 설명>"
  - 작업 완료 전 검증
       npm run harness:check
  - 업데이트 후보 확인 및 적용
       npm run harness:outdated
       npm run harness:update
  - 마지막 업데이트로 바뀐 공통 하네스 변경 내역 다시 보기
       npm run harness:changelog
  - 설치 제거 계획 확인 및 제거
       npm run harness:uninstall
       npm run harness:uninstall -- --confirm
${hookGuide}
`);
}

function collectForceOverwriteTargets(target, files, manifest) {
  return [...new Set([...files, ...CONSUMER_PROJECT_STATE_PATHS])]
    .filter((rel) => existsSync(join(target, rel)))
    .filter((rel) => (
      CONSUMER_PROJECT_STATE_PATHS.includes(rel) ||
      isProjectOwned(rel) ||
      !isManagedByManifest(manifest, rel) ||
      // 로컬에서 수정된 managed 파일도 같은 가드에 포함한다.
      // (CLAUDE.md/AGENTS.md처럼 본체 보일러플레이트 + 소비자 지침이 섞일 수 있는 파일)
      isLocallyModifiedManagedFile(target, rel, manifest)
    ))
    .sort();
}

function assertForceOverwriteConfirmed(opts, targets) {
  if (!opts.force || opts.dryRun || targets.length === 0 || opts.confirmOverwriteProjectFiles) {
    return;
  }

  console.error('--force는 프로젝트 소유 파일, 출처를 확인할 수 없는 기존 파일, 또는 로컬 수정된 managed 파일(CLAUDE.md 등)을 덮어쓸 수 있어 중단합니다.');
  console.error('');
  console.error('덮어쓰기 위험 대상 예시:');
  for (const rel of targets.slice(0, 20)) {
    console.error(`  - ${rel}`);
  }
  if (targets.length > 20) {
    console.error(`  ... 외 ${targets.length - 20}건`);
  }
  console.error('');
  console.error('먼저 변경 계획만 보려면:');
  console.error('  init --dry-run --force');
  console.error('');
  console.error('정말 덮어쓰려면 다음 옵션을 함께 사용하세요:');
  console.error('  --force --confirm-overwrite-project-files');
  console.error('');
  console.error('자동화 환경에서는 AI_STANDARD_CONFIRM_OVERWRITE_PROJECT_FILES=1 을 사용할 수 있습니다.');
  process.exit(1);
}

function buildInstallManifest(sourceRoot, target, files, copiedFiles, opts, previousManifest = null) {
  const seedPkg = readJson(join(sourceRoot, 'package.json'), {})
  const managedFiles = {}
  const projectOwnedFiles = [...new Set([
    ...files.filter((rel) => isProjectOwned(rel)),
    ...CONSUMER_PROJECT_STATE_PATHS,
  ])].sort()
  const source = buildSourceMetadata(sourceRoot, opts, seedPkg)

  for (const [rel, entry] of Object.entries(previousManifest?.managedFiles ?? {})) {
    const normalized = toPosix(rel)
    const abs = join(target, normalized)
    if (!isProjectOwned(normalized) && existsSync(abs) && statSync(abs).isFile()) {
      managedFiles[normalized] = entry
    }
  }

  for (const rel of copiedFiles) {
    const abs = join(target, rel)
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      continue
    }

    const entry = { sha256: sha256(abs) }
    // 마커 관리 파일은 마커 안(회사 영역) 해시를 따로 기록한다. 다음 업데이트에서 소비자가
    // 회사 영역을 수정했는지(머지 시 사이드카 백업 필요 여부) 판정하는 기준이 된다.
    if (isMarkerManaged(rel)) {
      const region = extractManagedRegion(readFileSync(abs, 'utf8'))
      if (region !== null) {
        entry.managedRegionSha256 = sha256Text(region)
      }
    }
    managedFiles[rel] = entry
  }

  return {
    tool: 'harness-seed',
    version: seedPkg.version || '0.0.0',
    installedAt: new Date().toISOString(),
    source,
    manifestVersion: 3,
    managedFiles,
    projectOwnedFiles: projectOwnedFiles.sort(),
  }
}

function gitOutput(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  return result.status === 0 ? result.stdout.trim() : null
}

function buildSourceMetadata(sourceRoot, opts, seedPkg) {
  const repo = opts.fromGit ?? opts.sourceRepo ?? null
  const rawRef = opts.fromGit ? opts.ref : opts.sourceRef
  const commit = opts.sourceCommit ?? (opts.fromGit ? gitOutput(sourceRoot, ['rev-parse', 'HEAD']) : null)
  const packageVersion = seedPkg.version || '0.0.0'
  const ref = normalizeSourceRef(rawRef, repo, packageVersion)

  return {
    type: repo ? 'git' : 'bundled',
    repo,
    ref: ref ?? null,
    commit,
    packageVersion,
    spec: repo ? `${repo}${ref ? `#${ref}` : ''}` : 'bundled',
  }
}

function normalizeSourceRef(ref, repo, packageVersion) {
  if (!repo) return null
  if (!ref || String(ref).startsWith('semver:')) {
    return packageVersion ? `v${packageVersion}` : null
  }
  return ref
}

function writeInstallManifest(sourceRoot, target, files, copiedFiles, opts, previousManifest = null) {
  if (opts.dryRun) return null

  const manifest = buildInstallManifest(sourceRoot, target, files, copiedFiles, opts, previousManifest)
  const manifestAbs = join(target, MANIFEST_PATH)
  mkdirSync(dirname(manifestAbs), { recursive: true })
  writeFileSync(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function parseSemverLoose(value) {
  const m = String(value ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), version: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` }
}

function compareSemverLoose(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] > b[key]) return 1
    if (a[key] < b[key]) return -1
  }
  return 0
}

function trimBlankLines(lines) {
  const out = [...lines]
  while (out.length && !out[0].trim()) out.shift()
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out
}

// 새로 설치되는 공통 하네스 패키지의 CHANGELOG.md에서 (이전버전, 새버전] 구간 항목을 뽑는다.
// 소비자 프로젝트에는 CHANGELOG.md를 복사하지 않으므로, 이 구간 정보는 업데이트 시점에만
// 얻을 수 있어 lock의 lastUpdate에 보존한다.
function computeChangelogDelta(sourceRoot, fromVersion, toVersion) {
  const from = parseSemverLoose(fromVersion)
  const to = parseSemverLoose(toVersion)
  if (!from || !to || compareSemverLoose(to, from) <= 0) return null

  const changelogPath = join(sourceRoot, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) return null

  let text
  try {
    text = readFileSync(changelogPath, 'utf8')
  } catch {
    return null
  }

  const sections = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*(?:[-–]\s*(.*))?$/)
    if (m) {
      current = { version: m[1], date: (m[2] || '').trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }

  const entries = sections
    .map((s) => ({ version: s.version, date: s.date, lines: trimBlankLines(s.lines) }))
    .filter((s) => {
      const v = parseSemverLoose(s.version)
      return v && compareSemverLoose(v, from) > 0 && compareSemverLoose(v, to) <= 0
    })

  return entries.length ? { from: from.version, to: to.version, entries } : null
}

function writeHarnessLock(sourceRoot, target, installManifest, opts) {
  if (opts.dryRun) return null

  const lockAbs = join(target, LOCK_PATH)
  const previous = readJson(lockAbs, {})
  const source = installManifest.source ?? {}
  const delta = computeChangelogDelta(sourceRoot, previous?.baseHarness?.version, installManifest.version)
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    baseHarness: {
      id: 'harness-seed',
      version: installManifest.version,
      repo: source.repo ?? null,
      ref: source.ref ?? null,
      commit: source.commit ?? null,
      source,
    },
    stackHarness: previous.stackHarness ?? null,
    lastUpdate: delta
      ? { from: delta.from, to: delta.to, at: new Date().toISOString(), entries: delta.entries }
      : (previous.lastUpdate ?? null),
  }

  mkdirSync(dirname(lockAbs), { recursive: true })
  writeFileSync(lockAbs, `${JSON.stringify(next, null, 2)}\n`)
  return { lock: next, changelog: delta }
}

function readJson(absPath, fallback) {
  if (!existsSync(absPath)) return fallback;
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (error) {
    throw new Error(`${absPath} JSON 손상: ${error.message}`);
  }
}

function mergePackageJson(sourceRoot, target, opts) {
  const pkgPath = join(target, 'package.json');
  const exists = existsSync(pkgPath);

  // P1(2026-06-09): package.json을 새로 만들지 않는다. 핵심 규칙은 "감지"가 아니라 "존재"다.
  // 이미 있을 때만 harness npm 별칭을 머지하고, 없으면 비-Node 프로젝트로 보고 조용히 스킵한다
  // (package.json 부재 자체가 신호 — 백엔드 매니페스트 감지 없이도 성립, 오탐 없음).
  // 드문 greenfield Node 케이스는 --with-package-json opt-in으로만 새로 생성한다.
  // 기존 소비자는 package.json이 이미 있어 동일 경로를 타므로 거동이 바뀌지 않는다.
  if (!exists && !opts.withPackageJson) {
    return { added: 0, skipped: [], created: false, skippedCreation: true };
  }

  let userPkg;
  let created = false;

  if (!exists) {
    created = true;
    userPkg = { name: 'my-project', private: true, type: 'module', scripts: {} };
  } else {
    userPkg = readJson(pkgPath, {});
  }

  const seedPkg = readJson(join(sourceRoot, 'package.json'), { scripts: {} });
  const before = JSON.stringify(userPkg, null, 2);
  userPkg.scripts = userPkg.scripts || {};

  let added = 0;
  const skipped = [];
  for (const [key, value] of Object.entries(buildConsumerScripts(seedPkg.scripts || {}))) {
    if (userPkg.scripts[key] !== undefined) {
      if (userPkg.scripts[key] !== value) skipped.push(key);
      continue;
    }
    userPkg.scripts[key] = value;
    added++;
  }

  const after = JSON.stringify(userPkg, null, 2);
  if (!opts.dryRun && (created || before !== after)) {
    writeFileSync(pkgPath, `${after}\n`);
  }

  return { added, skipped, created, skippedCreation: false };
}

function buildConsumerScripts(seedScripts) {
  const scripts = {};

  for (const name of CONSUMER_SCRIPT_NAMES) {
    if (!seedScripts[name]) continue;

    scripts[name] = seedScripts[name].replace(
      /^npm run node:check --silent && /,
      'node .harness/bin/check-node-version.mjs && ',
    );
  }

  return scripts;
}

// 소비자가 이미 .claude/settings.json을 갖고 있으면 그 파일은 project-owned로 보존된다.
// 그 결과 하네스 훅 스크립트는 복사되지만 그것을 wiring하는 settings.json은 적용되지 않아
// 에이전트 안전 훅(회사 공통 필수 차단 기준)이 실제로 동작하지 않는 문제가 있었다.
// 이 함수는 소비자 설정을 파괴하지 않고 하네스의 안전 표면(hooks, permissions.deny/allow,
// env, statusLine)을 멱등하게 병합한다. (package.json scripts 병합과 같은 패턴)
function mergeClaudeSettings(sourceRoot, target, opts) {
  const rel = '.claude/settings.json';
  const result = { changed: false, hooksAdded: 0, denyAdded: 0, allowAdded: 0, envAdded: 0, statusLineSet: false, skipped: null };
  const srcAbs = join(sourceRoot, rel);
  const destAbs = join(target, rel);

  const readSafe = (p) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  };

  if (!existsSync(srcAbs)) return result;
  const harness = readSafe(srcAbs);
  if (!harness) return result;

  // 소비자 파일이 없으면 installFiles가 하네스 것을 그대로 복사하므로 병합 불필요.
  if (!existsSync(destAbs)) return result;

  const user = readSafe(destAbs);
  if (!user) {
    // 소비자 settings.json이 깨졌으면 덮어쓰지 않고 건너뛴다(수동 확인 안내).
    result.skipped = 'parse-error';
    return result;
  }

  const sig = (e) => `${e?.matcher ?? ''}::${(e?.hooks ?? []).map((h) => h?.command).sort().join('|')}`;

  if (harness.hooks && typeof harness.hooks === 'object') {
    if (!user.hooks || typeof user.hooks !== 'object') user.hooks = {};
    for (const [event, hEntries] of Object.entries(harness.hooks)) {
      if (!Array.isArray(hEntries)) continue;
      const uEntries = Array.isArray(user.hooks[event]) ? user.hooks[event] : [];
      const seen = new Set(uEntries.map(sig));
      for (const entry of hEntries) {
        const s = sig(entry);
        if (seen.has(s)) continue;
        uEntries.push(entry);
        seen.add(s);
        result.hooksAdded += 1;
      }
      user.hooks[event] = uEntries;
    }
  }

  if (harness.permissions && typeof harness.permissions === 'object') {
    if (!user.permissions || typeof user.permissions !== 'object') user.permissions = {};
    for (const key of ['allow', 'deny']) {
      const hArr = Array.isArray(harness.permissions[key]) ? harness.permissions[key] : [];
      if (hArr.length === 0) continue;
      const uArr = Array.isArray(user.permissions[key]) ? user.permissions[key] : [];
      const set = new Set(uArr);
      let added = 0;
      for (const item of hArr) {
        if (set.has(item)) continue;
        uArr.push(item); set.add(item); added += 1;
      }
      user.permissions[key] = uArr;
      if (key === 'allow') result.allowAdded = added; else result.denyAdded = added;
    }
  }

  if (harness.env && typeof harness.env === 'object') {
    if (!user.env || typeof user.env !== 'object') user.env = {};
    for (const [k, v] of Object.entries(harness.env)) {
      if (!(k in user.env)) { user.env[k] = v; result.envAdded += 1; }
    }
  }

  if (harness.statusLine && !user.statusLine) {
    user.statusLine = harness.statusLine;
    result.statusLineSet = true;
  }

  result.changed = (result.hooksAdded + result.denyAdded + result.allowAdded + result.envAdded) > 0 || result.statusLineSet;
  if (result.changed && !opts.dryRun) {
    writeFileSync(destAbs, `${JSON.stringify(user, null, 2)}\n`);
  }
  return result;
}

function mergeGitignore(target, opts) {
  const gitignorePath = join(target, '.gitignore');
  // P5(2026-06-09): node_modules/dist는 Node 프로젝트 전용 항목이므로 package.json이 있을 때만 주입한다.
  // (mergePackageJson이 먼저 실행되므로 --with-package-json 생성분도 여기서 감지된다.)
  // 비-Node 프로젝트(PHP/Java 등)의 .gitignore를 프론트 항목으로 오염시키지 않는다.
  const isNodeProject = existsSync(join(target, 'package.json'));
  const entries = [
    ...(isNodeProject ? ['node_modules/', 'dist/'] : []),
    '.env',
    '.env.local',
    '.env.*.local',
    '.node-version.cache',
    '.package-json.hash',
    '.harness/.stack-applied.json',
    '.harness/generated/',
    '.harness/session/project-scan-report.md',
    '.harness/session/handoff.md',
    '.harness/session/template-gap-report.md',
    '.harness-backup/',
    'CLAUDE.local.md',
    '.harness/project/personal-methodology.local.md',
    '.claude/settings.local.json',
  ];

  let current = '';
  if (existsSync(gitignorePath)) {
    current = readFileSync(gitignorePath, 'utf8');
  }

  const lines = current.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return 0;

  if (!opts.dryRun) {
    const prefix = current.trim() ? `${current.replace(/\s*$/, '')}\n\n` : '';
    writeFileSync(gitignorePath, `${prefix}# harness-seed generated artifacts\n${missing.join('\n')}\n`);
  }

  return missing.length;
}

function findEslintConfig(target) {
  for (const rel of ['eslint.config.js', 'eslint.config.mjs']) {
    if (existsSync(join(target, rel))) {
      return rel;
    }
  }

  return null;
}

function hasGlobalsImport(content) {
  return /import\s+globals\s+from\s+['"]globals['"]/.test(content);
}

function hasNodeScriptsOverride(content) {
  return content.includes('.harness/bin/**/*.mjs') && content.includes('globals.node');
}

function hasHarnessBackupIgnore(content) {
  return content.includes('.harness-backup');
}

function insertHarnessBackupIgnore(content) {
  const pattern = /globalIgnores\(\s*\[([\s\S]*?)\]\s*\)/m;

  if (!pattern.test(content)) {
    return null;
  }

  return content.replace(pattern, (full, entries) => {
    if (entries.includes('.harness-backup')) {
      return full;
    }

    if (!entries.includes('\n')) {
      const separator = entries.trim() ? ', ' : '';
      return `globalIgnores([${entries}${separator}'**/.harness-backup/**'])`;
    }

    const trimmed = entries.replace(/\s*$/, '');
    return `globalIgnores([${trimmed},\n  '**/.harness-backup/**',\n])`;
  });
}

function insertNodeScriptsOverride(content) {
  const block = `  {
    files: ['.harness/bin/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
`;
  const lines = content.split('\n');
  const preferredIndex = lines.findIndex((line) => /^\s*js\.configs\.recommended,?\s*$/.test(line));
  const defineConfigIndex = lines.findIndex((line) => line.includes('defineConfig(['));
  const insertIndex = preferredIndex >= 0 ? preferredIndex : defineConfigIndex >= 0 ? defineConfigIndex + 1 : -1;

  if (insertIndex < 0) {
    return null;
  }

  lines.splice(insertIndex, 0, block.replace(/\n$/, ''));
  return lines.join('\n');
}

function patchEslintConfigForHarness(target, opts) {
  const rel = findEslintConfig(target);
  if (!rel) {
    return { status: 'none', message: '대상 없음' };
  }

  const abs = join(target, rel);
  const content = readFileSync(abs, 'utf8');
  let next = content;
  const applied = [];
  const already = [];
  const manual = [];

  if (hasHarnessBackupIgnore(next)) {
    already.push('.harness-backup ignore');
  } else {
    const withBackupIgnore = insertHarnessBackupIgnore(next);
    if (withBackupIgnore) {
      next = withBackupIgnore;
      applied.push('.harness-backup ignore');
    } else {
      manual.push('.harness-backup ignore');
    }
  }

  if (hasNodeScriptsOverride(next)) {
    already.push('Node scripts override');
  } else if (!hasGlobalsImport(next)) {
    manual.push('Node scripts override');
  } else {
    const withNodeScriptsOverride = insertNodeScriptsOverride(next);
    if (withNodeScriptsOverride && withNodeScriptsOverride !== next) {
      next = withNodeScriptsOverride;
      applied.push('Node scripts override');
    } else {
      manual.push('Node scripts override');
    }
  }

  if (next !== content && !opts.dryRun) {
    writeFileSync(abs, next);
  }

  if (manual.length > 0 && applied.length === 0) {
    return { status: 'manual', message: `${rel} ${manual.join(', ')} 수동 확인 필요` };
  }

  if (manual.length > 0) {
    return {
      status: 'partial',
      message: `${rel} ${applied.join(', ')} ${opts.dryRun ? '추가 예정' : '추가'}, ${manual.join(', ')} 수동 확인 필요`,
    };
  }

  if (applied.length > 0) {
    return {
      status: opts.dryRun ? 'dry-run' : 'updated',
      message: `${rel} ${applied.join(', ')} ${opts.dryRun ? '추가 예정' : '추가'}`,
    };
  }

  return {
    status: 'already',
    message: `${rel} 이미 ${already.join(' 및 ')} 있음`,
  };
}

function ensureExecutable(target, opts) {
  if (opts.dryRun) return;
  for (const dir of [join(target, '.githooks'), join(target, '.claude', 'hooks'), join(target, '.harness', 'bin')]) {
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir)) {
      // 확장자 스크립트와 무확장자 `harness` 런처(P2)를 실행 가능하게 만든다.
      if (/\.(sh|mjs|js|py)$/.test(file) || /(^|\/)harness$/.test(file)) {
        try {
          chmodSync(file, 0o755);
        } catch {
          // 권한 보정 실패는 치명적이지 않다.
        }
      }
    }
  }
}

function readScanSectionLines(target, title) {
  const rel = '.harness/session/project-scan-report.md';
  const abs = join(target, rel);
  if (!existsSync(abs)) return [];

  const content = readFileSync(abs, 'utf8');
  const markerRe = new RegExp(`(?:^|\\n)#{2,3} ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`);
  const marker = markerRe.exec(content);
  if (!marker) return [];

  const afterMarker = content.slice(marker.index + marker[0].length);
  const next = afterMarker.search(/\n#{2,3} /);
  const section = (next >= 0 ? afterMarker.slice(0, next) : afterMarker).trim();

  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && !line.includes('감지 없음'));
}

function readExistingAiRuleCandidates(target) {
  return readScanSectionLines(target, 'Existing AI Rule Document Candidates');
}

function readHarnessEffectSummary(target) {
  return readScanSectionLines(target, 'Harness Effect Summary');
}

function readDeveloperWorkflowChanges(target) {
  return readScanSectionLines(target, 'What Changes For Developers');
}

function runPostInstallStep(target, title, commandArgs, opts) {
  if (opts.verbose) {
    console.log('');
    console.log(title);
    console.log(`$ ${commandArgs.join(' ')}`);

    const verboseResult = spawnSync(commandArgs[0], commandArgs.slice(1), {
      cwd: target,
      stdio: 'inherit',
    });

    return verboseResult.status === 0;
  }

  process.stdout.write(`- ${title}... `);
  const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
    cwd: target,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    console.log('완료');
    return true;
  }

  console.log('실패');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) {
    console.log(output);
  }
  return false;
}

function runPostInstallDiagnostics(target, opts) {
  if (opts.dryRun) {
    return { scan: 'skipped', handoff: 'skipped', check: 'skipped' };
  }

  const result = { scan: 'skipped', handoff: 'skipped', check: 'skipped' };

  if (!opts.noScan) {
    result.scan = runPostInstallStep(
      target,
      '프로젝트 스캔 리포트 생성',
      [process.execPath, '.harness/bin/scan-project.mjs', '--write'],
      opts,
    ) ? 'ok' : 'failed';
  }

  if (!opts.noHandoff) {
    result.handoff = runPostInstallStep(
      target,
      '프로젝트 인수인계 요약 생성',
      [process.execPath, '.harness/bin/handoff.mjs', '--write'],
      opts,
    ) ? 'ok' : 'failed';
  }

  if (!opts.noCheck) {
    result.check = runPostInstallStep(
      target,
      '하네스 기준 검사',
      [process.execPath, '.harness/bin/guard.mjs'],
      opts,
    ) ? 'ok' : 'failed';
  }

  return result;
}

function fetchFromGit(repoUrl, ref) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'harness-seed-init-'));
  const args = ['clone', '--depth=1', '--branch', ref, repoUrl, tmpRoot];
  const result = spawnSync('git', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`git clone 실패: ${repoUrl}#${ref}`);
    process.exit(1);
  }
  return tmpRoot;
}

function cleanupSource(sourceRoot, isTemp) {
  if (!isTemp) return;
  rmSync(sourceRoot, { recursive: true, force: true });
}

function main() {
  checkNodeVersion();
  const opts = parseArgs(process.argv);

  if (!opts.command) printUsageAndExit(0);
  if (opts.command !== 'init') {
    console.error(`알 수 없는 명령: ${opts.command}`);
    printUsageAndExit(1);
  }

  assertSafeTarget(TARGET);

  if (opts.noBackup && !opts.force) {
    console.error('--no-backup은 기존 항목 보호를 위해 --force와 함께만 사용할 수 있습니다.');
    process.exit(1);
  }

  if (!existsSync(join(TARGET, '.git'))) {
    console.warn('.git이 없습니다. git 저장소에서 사용하길 권장합니다.\n');
  }

  ensureProjectNodeContract(TARGET, opts);

  const sourceRoot = opts.fromGit ? fetchFromGit(opts.fromGit, opts.ref) : BUNDLED_SOURCE_ROOT;
  const sourceIsTemp = Boolean(opts.fromGit);

  try {
    if (opts.verbose || opts.dryRun) {
      console.log(`harness-seed: harness 설치 시작 -> ${TARGET}`);
      console.log(`source: ${opts.fromGit ? `${opts.fromGit}#${opts.ref}` : 'bundled'}`);
      if (opts.dryRun) console.log('mode: dry-run');
      console.log('');
    } else {
      console.log('::: 공통 하네스 설치 :::');
      console.log(`프로젝트: ${TARGET}`);
    }

    const files = collectInstallFiles(sourceRoot);
    const sourcePkg = readJson(join(sourceRoot, 'package.json'), {});
    const existingManifest = readJson(join(TARGET, MANIFEST_PATH), null);
    const recognizedManifest = existingManifest && existingManifest.tool === 'harness-seed' ? existingManifest : null;
    const legacyManagedRootScripts = collectLegacyManagedRootScripts(TARGET, recognizedManifest);
    const externalHarnessMode = !recognizedManifest && hasHarnessLikeFiles(TARGET);
    const forceOverwriteTargets = collectForceOverwriteTargets(TARGET, files, recognizedManifest);

    if (externalHarnessMode) {
      console.log('이전에 설치된 하네스 흔적이 있어 기존 파일은 보존하고 누락된 공통 기준만 보강합니다.');
      console.log('기존 파일을 덮어쓰지 않습니다. 의도적으로 교체하려면 --force를 사용하세요.');
      console.log('');
    }

    assertForceOverwriteConfirmed(opts, forceOverwriteTargets);

    if (opts.force && opts.confirmOverwriteProjectFiles && forceOverwriteTargets.length > 0) {
      console.warn('force overwrite confirmed: 프로젝트 소유/출처 미확인 파일 덮어쓰기를 명시적으로 허용했습니다.');
      console.warn(`force overwrite targets: ${forceOverwriteTargets.length}개`);
      for (const rel of forceOverwriteTargets.slice(0, 15)) {
        console.warn(`  - ${rel}`);
      }
      if (forceOverwriteTargets.length > 15) {
        console.warn(`  ... 외 ${forceOverwriteTargets.length - 15}건`);
      }
      console.warn('');
    }

    if (!opts.noBackup) {
      const backup = backupExisting(TARGET, [...files, ...CONSUMER_PROJECT_STATE_PATHS, ...legacyManagedRootScripts], opts.dryRun);
      if (backup.count > 0) {
        console.log(`backup: ${backup.dir} (${backup.count}개 기존 파일)`);
      } else if (opts.verbose || opts.dryRun) {
        console.log('backup: 기존 하네스 파일 없음');
      }
      if (backup.count > 0 || opts.verbose || opts.dryRun) {
        console.log('');
      }
    }

    const installed = installFiles(sourceRoot, TARGET, files, opts, recognizedManifest);
    const projectState = writeConsumerProjectStateFiles(TARGET, opts, recognizedManifest, sourcePkg);
    const workHistoryYear = ensureCurrentWorkHistoryYear(TARGET, opts);
    const migration = removeLegacyManagedRootScripts(TARGET, legacyManagedRootScripts, opts);
    const seedOnlyCleanup = removeSeedOnlyDocs(TARGET, recognizedManifest, opts);
    const pkg = mergePackageJson(sourceRoot, TARGET, opts);
    const claudeSettings = mergeClaudeSettings(sourceRoot, TARGET, opts);
    const gitignoreAdded = mergeGitignore(TARGET, opts);
    const eslintPatch = patchEslintConfigForHarness(TARGET, opts);
    ensureExecutable(TARGET, opts);
    const writtenManifest = writeInstallManifest(sourceRoot, TARGET, files, installed.copiedFiles, opts, recognizedManifest);
    const lockResult = writtenManifest ? writeHarnessLock(sourceRoot, TARGET, writtenManifest, opts) : null;
    const writtenLock = lockResult?.lock ?? null;
    const diagnostics = runPostInstallDiagnostics(TARGET, opts);
    const existingAiRuleCandidates = readExistingAiRuleCandidates(TARGET);
    const harnessEffectSummary = readHarnessEffectSummary(TARGET);
    const developerWorkflowChanges = readDeveloperWorkflowChanges(TARGET);

    if (opts.verbose || opts.dryRun) {
      console.log('');
      console.log(`files: ${installed.added}개 추가, ${installed.updated}개 갱신, ${installed.skipped}개 보존`);
      console.log(
        `project state: ${opts.dryRun ? `${projectState.planned}개 생성/교체 예정` : `${projectState.added}개 추가, ${projectState.updated}개 교체, ${projectState.preserved}개 보존`}`,
      );
      if (pkg.skippedCreation) {
        console.log('package.json: 없음 → 생성하지 않음 (비-Node 프로젝트로 간주). 강제로 만들려면 --with-package-json');
      } else {
        console.log(
          `package.json: ${pkg.created ? '신규 생성, ' : ''}scripts ${pkg.added}개 추가` +
            (pkg.skipped.length ? `, 기존 scripts 보존 ${pkg.skipped.length}개 (${pkg.skipped.join(', ')})` : ''),
        );
      }
      console.log(`.gitignore: harness entry ${gitignoreAdded}개 추가`);
      if (claudeSettings.skipped === 'parse-error') {
        console.log('.claude/settings.json: 파싱 실패로 하네스 훅 병합을 건너뜀 (수동 확인 필요)');
      } else if (claudeSettings.changed) {
        console.log(`.claude/settings.json: 기존 설정 보존하고 하네스 안전 표면 병합 (hooks ${claudeSettings.hooksAdded}, deny ${claudeSettings.denyAdded}, allow ${claudeSettings.allowAdded}, env ${claudeSettings.envAdded}${claudeSettings.statusLineSet ? ', statusLine' : ''})`);
      } else {
        console.log('.claude/settings.json: 하네스 안전 표면 이미 반영됨 (변경 없음)');
      }
      console.log(`eslint config: ${eslintPatch.message}`);
      console.log(`legacy root scripts: ${opts.dryRun ? `${legacyManagedRootScripts.length}개 제거 예정` : `${migration.removed}개 제거`}`);
      console.log(`work history: ${workHistoryYear.rel}${workHistoryYear.created ? ' 생성' : ' 준비됨'}`);
      console.log(`install manifest: ${opts.dryRun ? 'dry-run' : `${Object.keys(writtenManifest.managedFiles).length}개 managed file 기록`}`);
      console.log(`harness lock: ${opts.dryRun ? 'dry-run' : `${writtenLock.baseHarness.version} (${writtenLock.baseHarness.ref ?? writtenLock.baseHarness.source.type})`}`);
      console.log(`scan: ${diagnostics.scan}`);
      console.log(`handoff: ${diagnostics.handoff}`);
      console.log(`check: ${diagnostics.check}`);
    } else {
      console.log('');
      console.log('::: 설치 결과 요약 :::');
      console.log(`  - 공통 하네스 v${writtenLock.baseHarness.version}를 설치/갱신했습니다.`);
      console.log(`  - 하네스 기준 파일: ${installed.added}개 추가, ${installed.updated}개 갱신, ${installed.skipped}개 보존`);
      console.log(`  - 프로젝트 상태 문서: ${projectState.added}개 준비, ${projectState.updated}개 갱신, ${projectState.preserved}개 보존`);
      if (pkg.skippedCreation) {
        console.log('  - package.json: 없음 → 생성하지 않음. 비-Node 프로젝트는 .harness/bin/harness 명령을 사용합니다.');
      }
      if (['updated', 'partial', 'manual'].includes(eslintPatch.status)) {
        console.log(`  - eslint config: ${eslintPatch.message}`);
      }
      if (claudeSettings.skipped === 'parse-error') {
        console.log('  - .claude/settings.json JSON 손상으로 하네스 안전 훅 병합을 건너뛰었습니다. 파일을 고친 뒤 init/update를 다시 실행하세요.');
      }
      if (migration.removed > 0) {
        console.log(`  - legacy root scripts: ${migration.removed}개 제거`);
      }
      console.log(`  - 프로젝트 스캔 리포트와 인수인계 요약을 생성했습니다. (scan ${diagnostics.scan}, handoff ${diagnostics.handoff})`);
      console.log(`  - 하네스 기준 검사를 실행했습니다. (check ${diagnostics.check})`);
      if (harnessEffectSummary.length > 0) {
        console.log('');
        console.log('::: 하네스가 바로 확인한 것 :::');
        for (const line of harnessEffectSummary.slice(0, 5)) {
          console.log(`  - ${line.replace(/^-\s+/, '')}`);
        }
        console.log('    자세한 기준과 다음 행동은 .harness/session/project-scan-report.md 와 .harness/session/handoff.md 에 있습니다.');
      }
      if (developerWorkflowChanges.length > 0) {
        console.log('');
        console.log('::: 다음 작업에서 달라지는 점 :::');
        for (const line of developerWorkflowChanges.slice(0, 4)) {
          console.log(`  - ${line.replace(/^-\s+/, '')}`);
        }
      }
      if (existingAiRuleCandidates.length > 0) {
        console.log(`  - 기존 AI 작업 룰 후보 ${existingAiRuleCandidates.length}건을 감지했습니다. 하네스는 삭제/병합하지 않고 보존합니다.`);
        console.log('    팀 기준 등록과 개인용 gitignore/tracked 처리 기준은 .harness/session/project-scan-report.md 와 .harness/session/handoff.md 에 기록했습니다.');
      }
    }

    if (!opts.dryRun && lockResult?.changelog?.entries?.length) {
      const cl = lockResult.changelog;
      console.log('');
      console.log(`이번 업데이트로 반영된 공통 하네스 변경 (${cl.from} → ${cl.to}):`);
      for (const entry of cl.entries) {
        console.log('');
        console.log(`  ## ${entry.version}${entry.date ? ` - ${entry.date}` : ''}`);
        for (const line of entry.lines) {
          console.log(`  ${line}`);
        }
      }
      console.log('');
      console.log('이 내역은 나중에 npm run harness:changelog 로 다시 볼 수 있습니다.');
    }

    if (installed.skippedFiles.length > 0) {
      console.log('');
      console.log('보존된 프로젝트 소유 파일:');
      for (const rel of installed.skippedFiles.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.skippedFiles.length > 15) {
        console.log(`  ... 외 ${installed.skippedFiles.length - 15}건`);
      }
      console.log('모두 덮어쓰려면 --force를 사용하세요.');
    }

    // 안전망 후처리 리포트: 로컬 수정 감지된 managed 파일을 명시적으로 보고한다.
    // CLAUDE.md/AGENTS.md를 비롯한 하이브리드 managed 파일이 base 업데이트로 조용히 사라지지 않도록
    // 매번 표면에 띄우는 것이 안전망의 핵심이다.
    if (installed.preservedLocallyModified && installed.preservedLocallyModified.length > 0) {
      console.log('');
      console.log('로컬 수정으로 보존된 managed 파일 (안전망 작동):');
      for (const rel of installed.preservedLocallyModified.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.preservedLocallyModified.length > 15) {
        console.log(`  ... 외 ${installed.preservedLocallyModified.length - 15}건`);
      }
      console.log('이 파일들은 manifest 기록 이후 변경된 흔적이 있어 본체로 덮지 않았습니다.');
      console.log('덮어쓰려면 위험을 인지한 뒤 다음 옵션을 함께 사용하세요:');
      console.log('  npm run harness:update -- --force --confirm-overwrite-project-files');
      console.log('이 경우 각 파일은 같은 디렉터리에 <파일>.harness-bak 사이드카로 백업됩니다.');
    }

    if (installed.overwroteLocallyModified && installed.overwroteLocallyModified.length > 0) {
      console.log('');
      console.log('로컬 수정 상태에서 .harness-bak 백업 후 덮어쓴 managed 파일:');
      for (const entry of installed.overwroteLocallyModified.slice(0, 15)) {
        console.log(`  - ${entry.rel} → 백업 ${entry.backup}`);
      }
      if (installed.overwroteLocallyModified.length > 15) {
        console.log(`  ... 외 ${installed.overwroteLocallyModified.length - 15}건`);
      }
      console.log('소비자가 보존하려던 내용이 사이드카에 남아 있으니 필요한 부분을 다시 머지하세요.');
    }

    // 마커 머지(옵션 A, 0.2.67) 후처리 리포트.
    if (installed.mergedMarkerFiles && installed.mergedMarkerFiles.length > 0) {
      console.log('');
      console.log('마커 머지된 managed 파일 (마커 밖 소비자 영역 보존 + 마커 안 본체 갱신):');
      for (const rel of installed.mergedMarkerFiles.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.mergedMarkerFiles.length > 15) {
        console.log(`  ... 외 ${installed.mergedMarkerFiles.length - 15}건`);
      }
    }

    if (installed.overwroteManagedRegion && installed.overwroteManagedRegion.length > 0) {
      console.log('');
      console.log('머지 중 소비자가 수정한 회사 영역(마커 안)을 .harness-bak로 백업한 파일:');
      for (const entry of installed.overwroteManagedRegion.slice(0, 15)) {
        console.log(`  - ${entry.rel} → 백업 ${entry.backup}`);
      }
      if (installed.overwroteManagedRegion.length > 15) {
        console.log(`  ... 외 ${installed.overwroteManagedRegion.length - 15}건`);
      }
      console.log('마커 안은 본체 소유라 정본으로 교체했습니다. 그 안에 두려던 내용은 마커 밖(소비자 영역)으로 옮기세요.');
    }

    if (installed.autoMigratedMarkerFiles && installed.autoMigratedMarkerFiles.length > 0) {
      console.log('');
      console.log('마커 도입으로 자동 이전된 managed 파일 (수정 흔적 없어 안전하게 마커 버전으로 교체):');
      for (const rel of installed.autoMigratedMarkerFiles.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.autoMigratedMarkerFiles.length > 15) {
        console.log(`  ... 외 ${installed.autoMigratedMarkerFiles.length - 15}건`);
      }
    }

    if (installed.needsMarkerMigration && installed.needsMarkerMigration.length > 0) {
      console.log('');
      console.log('마커 도입 수동 이전 필요 (소비자가 수정했는데 마커가 없어 자동 분리 불가 — 보존함):');
      for (const rel of installed.needsMarkerMigration.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.needsMarkerMigration.length > 15) {
        console.log(`  ... 외 ${installed.needsMarkerMigration.length - 15}건`);
      }
      console.log('조치: 각 파일에서 프로젝트 고유 내용을 harness-managed:end 마커 아래로 옮기고, 본체 영역에 harness-managed:start/end 마커를 두른 뒤 다시 업데이트하면 이후로는 자동 머지됩니다.');
    }

    // seed-only 문서(0.2.69) 후처리 리포트.
    if ((opts.verbose || opts.dryRun) && installed.skippedSeedOnlyDocs && installed.skippedSeedOnlyDocs.length > 0) {
      console.log('');
      console.log('소비자 배포 제외된 본체 전용(seed-only) 문서:');
      for (const rel of installed.skippedSeedOnlyDocs) {
        console.log(`  - ${rel}`);
      }
      console.log('이 문서들은 하네스 본체 개발/배포 전용이라 소비자 프로젝트에는 설치하지 않습니다.');
    }

    if (seedOnlyCleanup.removed.length > 0) {
      console.log('');
      console.log('기존 설치본에서 정리된 본체 전용(seed-only) 문서:');
      for (const rel of seedOnlyCleanup.removed) {
        console.log(`  - ${rel}`);
      }
    }

    if (seedOnlyCleanup.preservedModified.length > 0) {
      console.log('');
      console.log('본체 전용(seed-only) 문서지만 로컬 수정/출처 불명이라 보존한 파일:');
      for (const rel of seedOnlyCleanup.preservedModified) {
        console.log(`  - ${rel}`);
      }
      console.log('내용을 확인하고 불필요하면 직접 삭제하세요(본체 전용 문서라 소비자 프로젝트에는 의미가 없습니다).');
    }

    const bridgeCandidates = detectBridgeCandidates(TARGET, installed.skippedFiles);
    if (bridgeCandidates.length > 0) {
      console.log('');
      console.log('브리지 섹션 추가 후보:');
      for (const rel of bridgeCandidates) {
        console.log(`  - ${rel}`);
      }
      console.log('기존 개인/전용 룰을 보존했기 때문에, 위 파일에 .harness 읽기 순서를 연결할지 검토하세요.');
      console.log('기준 계층과 충돌 후보는 npm run harness:scan 결과를 확인하세요.');
    }

    if (pkg.skippedCreation) {
      console.log('');
      console.log('비-Node 프로젝트 안내:');
      console.log('  - package.json이 없어 harness npm 별칭을 주입하지 않았습니다(프로젝트 매니페스트 오염 방지).');
      console.log('  - 하네스 명령은 npm 없이 harness 런처로 실행하세요:');
      console.log('      .harness/bin/harness check          # 통합 검사 (harness:check)');
      console.log('      .harness/bin/harness impact         # 정책 영향 분석');
      console.log('      .harness/bin/harness scan           # 프로젝트 스캔');
      console.log('      .harness/bin/harness hooks:install  # git hook/커밋 템플릿 연결');
      console.log('      .harness/bin/harness --help         # 전체 명령 보기');
      console.log('  - Windows cmd/PowerShell에서는 .harness\\bin\\harness.cmd <command> 를 사용합니다 (Git Bash에서는 위 sh 런처 그대로).');
      console.log('  - 개별 스크립트를 직접 부르려면 node .harness/bin/<script>.mjs 도 됩니다.');
    }

    if (opts.embedded) {
      console.log(`
공통 하네스 설치 완료

스택 하네스 설치 흐름 내부에서 실행되었습니다.
최종 안내는 스택 하네스 설치 완료 후 한 번만 표시됩니다.
`);
      return;
    }

    console.log(`
::: 공통 하네스 설치 완료 :::

::: 현재 상태 :::
  - 이번 선택: 공통 하네스만 설치했습니다.
  - 설치 버전: 공통 하네스 v${writtenLock?.baseHarness?.version ?? sourcePkg.version ?? 'dry-run'}
  - 설치/갱신된 하네스 관리 파일: ${installed.added + installed.updated}개
  - 보존된 프로젝트 소유/로컬 수정 파일: ${installed.skipped + projectState.preserved}개
  - package.json에 연결된 하네스 명령: ${pkg.added}개 추가${pkg.skipped.length ? `, 기존 명령 ${pkg.skipped.length}개 보존` : ''}
  - 스택 기준은 나중에 추가할 수 있습니다.
  - 단순 운영 건이면 지금 상태로 작업을 시작해도 됩니다.

::: 다음 단계 :::
${renderNodeStep(TARGET)}
  1) 현재 상태를 브라우저로 확인
       npm run harness:guide -- --open
  2) 자동 생성된 프로젝트 스캔/인수인계 확인
       .harness/session/project-scan-report.md
       .harness/session/handoff.md
  3) 필요하면 현재 프로젝트에 맞는 스택 기준 확인
       npm run standards:list
       npm run stack:status
  4) 맞는 스택 기준이 있으면 해당 스택 하네스의 init 명령을 실행
       예: npx -y git+https://git.smartscore.kr/ai-standard/harnesses/vue3-vite-pinia-router.git#<tag> init
  5) 팀 기준으로 남길 판단이 생기면 기록
       .harness/session/decision-log.md
       또는 판단이 필요하면 .harness/session/developer-input-queue.md
  6) 필요하면 scaffold 템플릿 후보 조회 후 적용
       npm run templates:list
       npm run template:apply -- --preset-git <repo-url> --ref <tag-or-branch>
${renderHookStep(TARGET, 7)}
  8) 작업 완료 전 검증
       npm run harness:check
  9) 설치를 되돌려야 하면 먼저 제거 계획 확인
       npm run harness:uninstall

::: 문서 :::
  - CLAUDE.md
  - AGENTS.md
  - .claude/README.md
  - .github/copilot-instructions.md
  - .harness/project/bootstrap.md
`);
    printConsumerCommandGuide(TARGET);
  } finally {
    cleanupSource(sourceRoot, sourceIsTemp);
  }
}

main();
