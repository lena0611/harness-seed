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

// 개인 로컬 파일(2026-09-08): 개발자 PC마다 다른 권한·메모·방법론. 시드 작업 트리에 있어도 설치본에
// 실리면 안 되고(로컬 체크아웃 설치가 개발자 경로를 모든 설치본에 복사했던 실측), 소비자 .gitignore에는
// 등록돼야 한다(소비자가 자기 것을 만들 때 커밋되지 않게). 두 자리가 같은 목록을 써야 한쪽만 낡지 않는다.
const PERSONAL_LOCAL_PATHS = [
  '.claude/settings.local.json',
  'CLAUDE.local.md',
  '.harness/project/personal-methodology.local.md',
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
  // 커밋 템플릿(0.2.136 재분류, 멀티사이트 백엔드 문답): 커밋 형식은 팀 관례라 하네스가 주는 건
  // 빈손 방지용 초기 견본이다. managed로 두면 커스텀한 팀이 매 검사마다 드리프트 경고를 영구히
  // 받는다(harness.cmd 동결과 같은 클래스). 기존 설치본은 다음 업데이트의 manifest 승계 제외로
  // 자동 재분류된다(이력 아카이브 0.2.95와 같은 메커니즘) — 파일 바이트는 건드리지 않는다.
  '.github/commit-template.txt',
  // 프로젝트 문서 등록 지점(0.2.131, score-print 수용). managed registry는 본체 골격만 담고,
  // 프로젝트가 만든 문서는 이 파일에 등록한다 — 업데이트가 덮지 않으므로 매 업데이트마다
  // resync→재등록 한 바퀴가 필요 없어진다.
  '.harness/documentation/document-registry.local.json',
  // 프로젝트 정책 등록 지점(0.2.147, scorecard-print #31 수용). 문서 등록부와 같은 이유다: 프로젝트가 자기 정책을
  // 관리 파일(policy-registry.json)에 직접 넣으면 그 파일이 갱신 대상에서 빠져 공통 정책이 조용히 얼어붙는다.
  '.harness/policy/policy-registry.local.json',
  '.harness/project/project-charter.md',
  '.harness/project/scope-contract.md',
  '.harness/project/config-contract.md',
  '.harness/project/local-methodology.md',
  '.harness/project/personal-methodology.local.md',
  '.harness/project/stack-preset-rules.md',
  '.harness/project/template-contract.md',
  '.harness/project/domain-rules.md',
  '.harness/project/architecture-rules.md',
  '.harness/project/coding-conventions.md',
  '.harness/project/workflow-rules.md',
  '.harness/project/commit-push-rules.md',
  '.harness/project/critical-paths.md',
  // 기획 문서 연동(0.2.99): 연결 선언·기준 시점·매핑은 프로젝트가 소유한다. 업데이트가 덮어쓰지 않는다.
  '.harness/project/spec-map.md',
  '.harness/spec-sources.json',
  '.harness/spec-lock.json',
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
  '.harness/project/standards-adoption-roadmap.md',
  // 스택 하네스를 **만드는 사람**의 문서다(0.2.142). 스택을 갖다 쓰는 소비자에게는 쓸 일이
  // 없는데 257줄이 모든 설치에 배포되고 있었다 — 소비자 문서 더미를 그만큼 키운다.
  '.harness/stacks/authoring-guide.md',
  '.harness/templates/authoring-guide.md',
]);

// 은퇴한 관리 파일(0.2.134, score-print 보고): 예전 버전이 배포했지만 본체가 삭제·개명해
// 더 이상 배포하지 않는 파일. 업데이트가 지우지 않으면 소비자 디스크에 영원히 남고,
// 레지스트리(정상)가 모르는 유령 파일이 되어 doc-link-check가 매 검사마다 고아로 신고한다.
// 규칙은 세션 이력 아카이브(0.2.95)와 동일: manifest sha 일치(미수정)면 제거, 소비자가
// 수정했으면 보존+안내, manifest 기록이 없으면(출처 불명) 건드리지도 보고하지도 않는다.
// manifest 승계에서도 제외해, 보존된 파일은 소비자 소유로 재분류된다.
const RETIRED_MANAGED_PATHS = new Set([
  '.claude/commands/검증설정.md', // 0.2.131 verify 제거와 함께 삭제된 명령 문서
  '.claude/commands/harness-absorb.md', // 0.2.25에서 harness-scan.md로 개명되기 전 이름
  '.harness/bin/spec-push-gate.mjs', // 0.2.142 push 차단 모드 제거와 함께 삭제된 게이트
]);

// 세션 이력 아카이브(0.2.95): decision-log 2계층 관례(0.2.92)로 본체 자신의 아카이브
// (decision-log-2026H1.md 등)가 생기면서, 어떤 제외 목록에도 없어 일반 managed 파일로
// 소비자에 복사되는 회귀가 발생했다(clubadm 보고 — "하네스 팀 회의록 458줄").
// 파일명이 동적이라 열거로는 재발을 못 막으므로 패턴으로 차단한다.
// 현행 decision-log.md는 CONSUMER_PROJECT_STATE_PATHS가 소비자 템플릿으로 대체하므로 제외.
// (.harness/bin/doc-link-check.mjs isHistoryLogPath와 같은 계열)
const SESSION_HISTORY_LOG_PATTERN = /^\.harness\/session\/(?:decision-log-[^/]+|thread-handoff-[^/]+)\.md$/;

function isSessionHistoryLog(rel) {
  return SESSION_HISTORY_LOG_PATTERN.test(rel);
}

// 0.2.131: 주입 별칭 0개 — 하네스는 package.json에 쓰지 않는다(은퇴 별칭 감지를 위해 읽기만 한다).
// 모든 명령은 .harness/bin/harness 런처. 기존 소비자에 남은 별칭은 add-only 계약으로 삭제하지 않으며
// 계속 동작한다.
const RETIRED_CONSUMER_SCRIPTS = [
  'harness:check',
  'harness:impact',
  'harness:context',
  'hooks:install',
  'harness:guide',
  'harness:scan',
  'harness:handoff',
  'harness:check:strict',
  'harness:sync',
  'harness:spec:fetch',
  'harness:spec:status',
  'harness:spec:settle',
  'harness:outdated',
  'harness:update',
  'harness:changelog',
  'harness:uninstall',
  'standards:list',
  'templates:list',
  'stack:apply',
  'stack:reset',
  'stack:status',
  'template:apply',
  'template:reset',
  'template:status',
  'template:gap',
];

const RETIRED_SCRIPTS_NOTICE_SUFFIX =
  ' — **계속 동작합니다**. 정리는 선택입니다: .harness/bin/harness prune:aliases (미리보기 후 --write, 하네스가 주입한 그대로인 것만 지웁니다)';

function renderRetiredScriptsNotice(retired) {
  if (!retired || retired.length === 0) return null;
  return `은퇴한 하네스 npm 별칭 ${retired.length}개가 package.json에 남아 있습니다${RETIRED_SCRIPTS_NOTICE_SUFFIX}`;
}

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
                         (--confirm-overwrite-project-state 는 같은 뜻의 별칭입니다 — update가 이 이름으로 전달합니다)
  --resync-managed       설치 기록과 달라진 하네스 파일(managed)만 본체 원본으로 되돌립니다.
                         프로젝트 소유 파일은 건드리지 않습니다. lint/formatter가 .harness/를 고쳐
                         업데이트에서 제외된 파일을 복구할 때 씁니다.
  --no-backup            백업을 만들지 않습니다. 기존 항목이 있으면 --force가 필요합니다.
  --no-scan              설치 후 프로젝트 스캔 리포트를 자동 생성하지 않습니다.
  --no-handoff           설치/업데이트 인수인계 요약을 자동 생성하지 않습니다.
  --no-check             설치 후 하네스 기본 검사를 자동 실행하지 않습니다.
  --no-hooks             최초 설치 시 git hook 자동 활성화를 건너뜁니다. (업데이트는 원래 재배선하지 않습니다)
  --replace-hook <이름>  같은 이름의 기존 .claude/hooks 훅이 하네스 원본과 다를 때: 원본으로 교체하고 기존 파일은 <경로>.harness-bak에 보관 (반복 가능)
  --keep-hook <이름>     같은 상황에서 기존 파일을 유지(팀 settings.json이 그 파일을 실행 — 프로젝트 책임). 기록·재보고됩니다 (반복 가능)
  --replace-file <경로>  하네스가 배포하는 파일 하나를 원본으로 교체하고 기존 파일은 <경로>.harness-bak에 보관 (반복 가능). 관리 밖으로 나간(보존된) 파일과 로컬 수정된 관리 파일 둘 다 대상. 프로젝트 소유 파일·마커 진입점(CLAUDE.md 등)은 거절합니다
  --with-package-json    은퇴(0.2.131) — 받아들이지만 아무 동작도 하지 않습니다. 하네스는 package.json을 만들거나 쓰지 않습니다.
  --embedded             스택 하네스 설치 흐름 내부에서 호출될 때 중간 안내를 줄입니다.
  --verbose              설치 내부 명령과 진단 출력을 자세히 표시합니다.
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
    noHooks: false,
    embedded: false,
    verbose: false,
    projectNode: null,
    fromGit: null,
    ref: 'main',
    sourceRepo: null,
    sourceRef: null,
    updateFrom: null,
    sourceCommit: null,
  };

  const retiredFlagsUsed = [];
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
      case '--resync-managed':
        opts.resyncManaged = true;
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
      case '--no-hooks':
        opts.noHooks = true;
        break;
      // 훅 이름 충돌 해결(0.2.146, common 후속 ①): 훅별로 명시된 결정만 실행한다. 전체 --force로 풀게 하지 않는다.
      case '--replace-hook':
      case '--keep-hook': {
        const value = args[++i];
        if (!value || value.startsWith('-')) {
          console.error(`${arg}에는 훅 이름이 필요합니다. 예: ${arg} block-dangerous`);
          process.exit(1);
        }
        const bucket = arg === '--replace-hook' ? (opts.replaceHooks ??= new Set()) : (opts.keepHooks ??= new Set());
        bucket.add(hookBaseName(value));
        break;
      }
      // 보존된(관리 밖) 하네스 파일을 원본으로 되돌리는 명시 결정(0.2.148, scorecard-print #34). 훅 교체와 같은 모양이다.
      case '--replace-file': {
        const value = args[++i];
        if (!value || value.startsWith('-')) {
          console.error(`${arg}에는 저장소 기준 경로가 필요합니다. 예: ${arg} .harness/policy/policy-registry.json`);
          process.exit(1);
        }
        (opts.replaceFiles ??= new Set()).add(toPosix(value).replace(/^\.\//, ''));
        break;
      }
      // 은퇴 플래그: 받아들이지만 아무것도 하지 않는다. 0.2.131에서 별칭 주입이 0개가 되어
      // 용도가 사라졌으나, 스택 하네스의 buildSeedArgs가 이 플래그를 본체 init에 넘긴다
      // (공개 계약 — 결정 83). 거부하면 구버전 스택 하네스의 설치가 전면 실패한다(실측 exit 1).
      // 스택 하네스가 전달을 멈춘 뒤에도 이미 배포된 태그가 남아 있으므로 계속 수용한다.
      case '--with-package-json':
        retiredFlagsUsed.push(arg);
        break;
      case '--embedded':
        opts.embedded = true;
        break;
      case '--verbose':
        opts.verbose = true;
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
      case '--update-from': {
        // update-harness(0.2.144)가 넘긴다: 이번 업데이트가 시작된 공통 하네스 버전. 2단(스택 init → base init)
        // 업데이트에서 마지막 base init이 자기 구간(직전 lock 버전 → 새 버전)만 기록해 첫 구간이 사라지던
        // 결함(scorecard #22)을 막는다. 직전 lock 버전보다 낮을 때만 인정한다(높거나 같으면 무시).
        const version = args[++i];
        if (!version || version.startsWith('-')) {
          console.error('--update-from에는 시작 버전(예: 0.2.137)이 필요합니다.');
          process.exit(1);
        }
        opts.updateFrom = version;
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

  if (retiredFlagsUsed.length > 0) {
    opts.retiredFlagsUsed = retiredFlagsUsed;
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
    // 에이전트 세션이 만드는 격리 워크트리는 본체 저장소 상태다. 로컬 체크아웃에서
    // 설치/테스트할 때 딸려 나가 소비자 쪽 .claude/** 정책(visible-trace)을 오발시킨다.
    rel.startsWith('.claude/worktrees/') ||
    // 개인 로컬 파일은 시드에 있어도 배포하지 않는다 — 목록은 PERSONAL_LOCAL_PATHS 한 곳.
    PERSONAL_LOCAL_PATHS.includes(rel) ||
    CONSUMER_PROJECT_STATE_PATHS.includes(rel) ||
    [
      '.harness/session/project-scan-report.md',
      '.harness/session/handoff.md',
      '.harness/session/template-gap-report.md',
      '.harness/session/task-context.md',
      // 이슈 어댑터 실물은 프로젝트 상태다(결정 82: 실물을 배포하면 전 프로젝트에서 켜진다).
      // 본체 저장소 자신도 실물을 가질 수 있으므로(관문 이슈 조회) 배포에서 항상 제외한다.
      '.harness/project/issue-adapter.md',
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
  // 세션 이력 아카이브(0.2.95, clubadm 요청 2): decision-log.md가 project-owned인 것과 동일하게
  // 그 아카이브도 project-owned로 분류한다. 관례(decision-log-YYYYH1.md)를 따르는 소비자 아카이브가
  // managed 복원 대상과 경로 충돌해 본체 이력으로 덮어써지는 유실 경로를 계약으로 차단한다.
  return PROJECT_OWNED_PATHS.has(rel) || PROJECT_OWNED_PREFIXES.some((prefix) => rel.startsWith(prefix)) || isSessionHistoryLog(rel);
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
  return !matchesRecordedSha(abs, expected);
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

// managed 무결성 판정의 eol 정규화(0.2.136, 멀티사이트 제보): managed 파일은 git 체크아웃을
// 거치며 머신마다 줄바꿈이 바뀔 수 있다(autocrlf, .gitattributes). 바이트 정확 sha는 그 차이를
// "소비자 수정"으로 오판해 파일을 업데이트에서 영구 제외시켰다(실사고: harness.cmd 동결,
// autocrlf=true 설치자 경유 97건 일괄 드리프트). 내용 동일성은 줄바꿈과 무관해야 하므로,
// 텍스트(NUL 없음) 파일은 CRLF→LF 정규화 바이트로 기록·비교한다. 기존 manifest 기록은
// 전부 LF 배포본 기준이라 정규화 값과 동일 — 마이그레이션 불필요.
function normalizeEolForHash(buffer) {
  if (buffer.includes(0)) return buffer; // 바이너리는 건드리지 않는다
  let text = buffer.toString('utf8');
  if (!text.includes('\r\n')) return buffer;
  return Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8');
}

function sha256(absPath) {
  return createHash('sha256').update(normalizeEolForHash(readFileSync(absPath))).digest('hex');
}

function sha256RawBytes(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

// 과도기 폴백: 결함 A(설치자 autocrlf 경유)로 CRLF 바이트의 sha가 기록된 manifest도
// 원문 일치로 인정한다. 다음 업데이트가 manifest를 정규화 sha로 다시 쓰며 자연 수렴한다.
function matchesRecordedSha(absPath, recordedSha) {
  if (!recordedSha) return false;
  return sha256(absPath) === recordedSha || sha256RawBytes(absPath) === recordedSha;
}

// 설치 쓰기 정규화(0.2.136, 멀티사이트 결함 A): 설치기가 npx 캐시/clone의 체크아웃 바이트를
// 그대로 복사하면 설치자의 git eol 설정이 결과물에 새어 들어가 "개발자마다 다른 바이트"가 깔린다.
// 텍스트는 LF로 통일하되, cmd.exe 배치(.cmd/.bat)는 label/goto가 LF에서 깨질 수 있어 CRLF로 쓴다
// (sha는 위 정규화 덕에 줄바꿈과 무관). 바이너리는 그대로 복사한다.
function writeInstalledFile(src, dest, rel) {
  // 방어선(사용자 결정 A): 호출자가 걸러야 하지만, 어떤 경로로 링크가 여기까지 오면 쓰지 않는다 — 링크 너머를 덮는 일은 없어야 한다.
  if (isSymlinkPath(dest)) {
    console.warn(`'${rel}' 자리가 심볼릭 링크라 쓰지 않습니다 — 하네스는 링크 너머를 쓰지 않습니다.`);
    return false;
  }
  const buffer = readFileSync(src);
  if (buffer.includes(0)) {
    copyFileSync(src, dest);
    return true;
  }
  let text = buffer.toString('utf8').replaceAll('\r\n', '\n');
  if (/\.(cmd|bat)$/i.test(rel)) {
    text = text.replaceAll('\n', '\r\n');
  }
  writeFileSync(dest, text);
  // copyFileSync는 원본 모드를 보존하지만 writeFileSync는 아니다 — 무확장자 훅
  // (.githooks/pre-commit 등)은 chmod 보정 목록에 없어 여기서 모드를 이어줘야 한다.
  try {
    chmodSync(dest, statSync(src).mode & 0o777);
  } catch {
    // 권한 보정 실패는 치명적이지 않다(ensureExecutable과 같은 태도).
  }
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

// ── 훅 이름 충돌(0.2.146, smartscore-backend/common 후속 제보 ①, Codex 설계 리뷰) ─────────────────────────────
// .claude/hooks/<이름>.sh 는 팀 .claude/settings.json 이 **이름으로 부르는 계약**이다. 같은 이름의 파일이 하네스 원본과
// 다른 내용으로 이미 있으면(개인 훅 등) 예전 설치기는 파일을 보존만 하고 settings.json 에는 그 경로를 등록해 "팀 설정이
// 개인 훅을 실행"하는 섞임을 만들었고, manifest 어디에도 기록하지 않아 관리 밖이 됐다(제보). 이제 파일 복사·설정 병합
// 전에 충돌을 찾아 멈추고, 훅별로 명시된 결정(--replace-hook / --keep-hook)만 실행한다. 출처 미확인 파일을 사용자 동의
// 없이 교체하지 않는다 — 기존 파일에 프로젝트 고유의 보호 규칙이 들어 있을 수 있다.
function hookBaseName(value) {
  return String(value).replace(/^\.claude\/hooks\//, '').replace(/\.sh$/, '');
}

function filesEqual(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

// "하네스 원본과 같은 내용"인지 — 줄바꿈 차이는 같은 것으로 본다(managed 무결성 판정 normalizeEolForHash 와 같은 규칙,
// 0.2.148 적대적 리뷰 P2). 원시 바이트로 비교하면 설치기 자신이 CRLF 로 쓰는 .cmd 가 영원히 "다른 파일"이 되고(설치 기록을
// 잃은 뒤 재편입 불가), CRLF 체크아웃(Windows)에서는 손대지 않은 파일이 전부 외래로 잡힌다. 바이트 동일 ⊂ 정규화 동일이라
// 이 완화는 "더 많이 같다고 보는" 방향으로만 움직인다 — 잘못 다르다고 보는 경우가 사라질 뿐이다.
// 대상이 일반 파일인지(심볼릭 링크·디렉터리 아님). 링크 너머를 덮거나 링크를 관리 대상으로 들이지 않기 위한 판정(Codex 1R #1).
// 경로 자체가 심볼릭 링크인가(끊어진 링크 포함). existsSync 는 링크를 따라가 끊어진 링크를 "없음"으로 보기 때문에 따로 본다(Codex 3R #1).
function isSymlinkPath(abs) {
  try {
    return fs.lstatSync(abs).isSymbolicLink();
  } catch {
    return false;
  }
}

// 백업 목적지(<rel>.harness-bak)가 심볼릭 링크(끊어진 것 포함)면 쓰지 않는다 — copyFileSync 는 링크를 따라 밖의 파일을 덮는다(Codex 4R #2).
function backupTargetBlocked(target, backupRel) {
  return isSymlinkPath(join(target, backupRel));
}

function isRegularFile(abs) {
  try {
    return !fs.lstatSync(abs).isSymbolicLink() && statSync(abs).isFile();
  } catch {
    return false;
  }
}

function filesEquivalent(a, b) {
  try {
    return normalizeEolForHash(readFileSync(a)).equals(normalizeEolForHash(readFileSync(b)));
  } catch {
    return false;
  }
}

function detectHookConflicts(sourceRoot, target, files, manifest) {
  const conflicts = [];
  for (const rel of files) {
    if (!rel.startsWith('.claude/hooks/') || !rel.endsWith('.sh')) continue;
    const src = join(sourceRoot, rel);
    const dest = join(target, rel);
    if (!existsSync(src) || !existsSync(dest)) continue;
    try {
      if (!statSync(dest).isFile()) continue;
    } catch {
      continue;
    }
    if (filesEqual(src, dest)) continue; // 내용이 같으면 충돌이 아니다(#28: 팀 훅 3개가 cmp 동일)
    // 하네스가 설치한 기록이 있는 파일(정상 업데이트·로컬 수정 managed)은 기존 흐름이 다룬다.
    if (manifest?.managedFiles?.[toPosix(rel)]) continue;
    conflicts.push({ rel, name: hookBaseName(rel) });
  }
  return conflicts;
}

// 결정은 플래그뿐 아니라 환경변수 HARNESS_HOOK_DECISIONS="replace:<이름>,keep:<이름>" 로도 받는다(0.2.146, 리뷰 P2-2):
// 0.2.145 이하의 updater 는 새 플래그를 "알 수 없는 옵션"으로 거절하지만 환경변수는 그대로 자식 init 에 전달되므로,
// 충돌 뒤 기존 `harness update` 명령으로 복구할 수 있다.
function mergeHookDecisionsFromEnv(opts) {
  const raw = process.env.HARNESS_HOOK_DECISIONS;
  if (!raw) return;
  for (const item of raw.split(',').map((v) => v.trim()).filter(Boolean)) {
    const m = item.match(/^(replace|keep):(.+)$/);
    if (!m) {
      console.error(`HARNESS_HOOK_DECISIONS 항목을 이해할 수 없습니다: '${item}' (형식: replace:<이름> 또는 keep:<이름>)`);
      process.exit(1);
    }
    (m[1] === 'replace' ? (opts.replaceHooks ??= new Set()) : (opts.keepHooks ??= new Set())).add(hookBaseName(m[2]));
  }
}

function assertHookDecisionsConsistent(opts) {
  const both = [...(opts.replaceHooks ?? [])].filter((name) => opts.keepHooks?.has(name));
  if (both.length > 0) {
    console.error(`같은 훅에 교체(--replace-hook)와 유지(--keep-hook)를 함께 지정했습니다: ${both.join(', ')} — 하나만 남기고 다시 실행하세요.`);
    process.exit(1);
  }
}

function resolveHookConflicts(conflicts, opts) {
  mergeHookDecisionsFromEnv(opts);
  assertHookDecisionsConsistent(opts);
  const replace = [];
  const keep = [];
  const unresolved = [];
  for (const conflict of conflicts) {
    if (opts.replaceHooks?.has(conflict.name)) replace.push(conflict);
    else if (opts.keepHooks?.has(conflict.name)) keep.push(conflict);
    else unresolved.push(conflict);
  }
  return { replace, keep, unresolved };
}

function printHookConflictsAndExit(unresolved) {
  console.error('');
  console.error(`⚠ 같은 이름의 기존 훅 ${unresolved.length}개가 하네스 원본과 내용이 다릅니다 — 설치를 멈췄습니다 (파일·설정은 건드리지 않았습니다).`);
  for (const c of unresolved) console.error(`  - ${c.rel}`);
  console.error('왜 멈추나: 팀 .claude/settings.json 은 이 경로들을 이름으로 부릅니다. 그대로 두면 팀 설정이 하네스가 아닌 이 파일을 실행합니다(섞임).');
  console.error('훅마다 정하세요 — 같은 명령에 플래그를 붙여 다시 실행합니다:');
  console.error('  --replace-hook <이름>   하네스 원본으로 교체하고 기존 파일은 <경로>.harness-bak 에 보관합니다.');
  console.error('  --keep-hook <이름>      기존 파일을 유지합니다(팀 설정이 이 파일을 실행 — 프로젝트 책임). manifest에 기록되고 업데이트마다 다시 알립니다.');
  console.error('  개인 훅으로 계속 쓰려면: 파일을 <이름>.local.sh 로 바꾸고 .claude/settings.local.json 에 등록한 뒤 --replace-hook <이름> 으로 원본을 받으세요.');
  console.error(`  예: … init ${unresolved.map((c) => `--replace-hook ${c.name}`).join(' ')}`);
  console.error('업데이트 중이라면(harness update 가 이 설치를 불렀다면): 기존 updater 가 새 플래그를 모를 수 있으니 결정을 환경변수로 넘겨 같은 명령을 다시 실행하세요 —');
  console.error(`  HARNESS_HOOK_DECISIONS="${unresolved.map((c) => `replace:${c.name}`).join(',')}" .harness/bin/harness update    (유지할 훅은 keep:<이름>)`);
  console.error('  설치 출처·버전은 기존 설정(.harness/harness-lock.json)에서 그대로 읽으므로 따로 적을 것이 없습니다.');
  console.error('에이전트(Claude)라면: 훅별로 사용자에게 물어(AskUserQuestion) 결정을 받은 뒤 플래그(또는 환경변수)를 붙여 다시 실행하세요. 임의로 정하지 마세요.');
  process.exit(1);
}

// ── 설치 산출물이 git ignore 규칙에 걸리는지(0.2.146, 후속 제보 ②) ────────────────────────────────────────────────
// 개인 .git/info/exclude(/.claude/*) 때문에 하네스 파일 21개가 커밋에서 빠져, 팀원이 pull 하면 settings.json 이 없는 훅을
// 부르게 됐다(제보). "공유 대상인데 미추적이고 실제로 ignore 되는" 파일만 경고한다 — 이미 추적된 파일은 ignore 규칙과
// 무관하고, !패턴으로 재포함된 파일은 무시되지 않으며, 하네스가 스스로 ignore 에 넣는 파일은 의도된 것이다.
// 규칙 소유자(개인·팀·전역)와 무관하게 같은 강도로 알리되, ignore 를 고치거나 강제 추가하지는 않는다(fail-open).
const INTENTIONALLY_IGNORED_OUTPUTS = [
  '.env', '.env.local', '.issue-adapter.env', '.node-version.cache', '.package-json.hash',
  '.harness/.stack-applied.json', '.harness/generated/',
  '.harness/session/project-scan-report.md', '.harness/session/handoff.md', '.harness/session/task-context.md',
];

function collectSettingsReferencedPaths(target) {
  const file = join(target, '.claude/settings.json');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const found = new Set();
  // settings.json 은 JSON 이라 명령 안의 따옴표가 \" 로 이스케이프돼 있다 — 역슬래시에서 끊어야 경로 끝에 \ 가 붙지 않는다.
  for (const m of text.matchAll(/\$CLAUDE_PROJECT_DIR\/([^"'\s\\]+)/g)) found.add(m[1]);
  return [...found];
}

function warnIgnoredSharedOutputs(target, installed, previousManifest) {
  const isRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: target, encoding: 'utf8' });
  if (isRepo.status !== 0) return [];
  const candidates = new Set([
    ...(installed.copiedFiles ?? []),
    ...Object.keys(previousManifest?.managedFiles ?? {}),
    ...collectSettingsReferencedPaths(target),
  ]);
  const shared = [...candidates].filter((rel) => {
    if (!existsSync(join(target, rel))) return false;
    if (PERSONAL_LOCAL_PATHS.includes(rel) || rel.endsWith('.harness-bak')) return false;
    return !INTENTIONALLY_IGNORED_OUTPUTS.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)));
  }).sort();
  if (shared.length === 0) return [];
  const ls = spawnSync('git', ['ls-files', '-z', '--', ...shared], { cwd: target, encoding: 'utf8' });
  const tracked = new Set((ls.stdout ?? '').split('\0').filter(Boolean));
  const untracked = shared.filter((rel) => !tracked.has(rel));
  if (untracked.length === 0) return [];
  const chk = spawnSync('git', ['check-ignore', '-v', '--stdin'], { cwd: target, encoding: 'utf8', input: `${untracked.join('\n')}\n` });
  const hits = [];
  for (const line of (chk.stdout ?? '').split('\n')) {
    const m = line.match(/^(.*?):(\d+):(.*?)\t(.*)$/);
    if (!m) continue;
    if (m[3].startsWith('!')) continue; // 재포함 규칙 — 무시되지 않는다
    hits.push({ rel: m[4], source: m[1], line: m[2], pattern: m[3] });
  }
  if (hits.length === 0) return [];
  console.warn('');
  console.warn(`⚠ 설치 산출물 ${hits.length}개가 현재 상태로는 팀 공유에서 누락될 수 있습니다 — git에 추적되지 않았고 ignore 규칙에 걸립니다:`);
  for (const h of hits.slice(0, 25)) console.warn(`  - ${h.rel}  ← ${h.source}:${h.line}  '${h.pattern}'`);
  if (hits.length > 25) console.warn(`  ... 외 ${hits.length - 25}건`);
  console.warn('  팀원이 pull 하면 .claude/settings.json 이 부르는 훅·하네스 파일이 없을 수 있습니다.');
  console.warn('  규칙이 개인용(.git/info/exclude·전역 ignore)이면 개인 파일만 명시하도록 좁히고, 팀 .gitignore 면 팀과 상의하세요.');
  console.warn('  하네스는 ignore 규칙을 고치거나 파일을 강제로 추가하지 않습니다.');
  return hits;
}

// installFiles 가 마지막으로 계산한 "하네스 원본과 다른 동명 파일" 목록 — manifest 의 현황 기록(preservedForeignFiles)에
// 쓰인다. 소유권 표시가 아니다: 하네스가 이 파일을 덮어쓰거나 지울 수 있다는 뜻이 아니라 "여기 있다"는 기록이다.
let lastPreservedForeignFiles = [];

function installFiles(sourceRoot, target, files, opts, manifest) {
  const stats = { added: 0, updated: 0, skipped: 0 };
  const skippedFiles = [];
  const copiedFiles = [];
  // 안전망: 로컬 수정 감지된 managed 파일은 기본적으로 보존하고, --force --confirm-overwrite-project-files
  // 동의가 있을 때만 .harness-bak 백업 후 덮어쓴다. 둘 다 후처리에서 명시적으로 보고한다.
  const preservedLocallyModified = [];
  const replacedHooks = [];            // --replace-hook 으로 교체한 훅(기존 파일은 .harness-bak)
  const replacedFiles = [];            // --replace-file 로 원본으로 교체한 파일(기존 파일은 .harness-bak) — 0.2.148, #34
  const readoptedFiles = [];           // 하네스 원본과 같은 내용이 되어 다시 관리 대상으로 들인 파일 — 0.2.148, #34
  const nonRegularSkipped = [];        // 심볼릭 링크·디렉터리·끊어진 링크라 어떤 경로로도 쓰지 않은 대상 — Codex 3R #1·#2·#3
  const preservedForeignFiles = [];    // 하네스 원본과 다른 동명 파일을 보존한 것(현황 기록)
  const overwroteLocallyModified = [];
  const resyncedManaged = [];       // --resync-managed로 본체 원본에 맞춘 파일
  // 마커 머지(옵션 A, 0.2.67) 후처리 분류.
  const mergedMarkerFiles = [];        // 마커 머지: 마커 밖(소비자) 보존 + 마커 안(본체) 갱신
  const overwroteManagedRegion = [];   // 머지 중 소비자가 회사 영역(마커 안)을 수정해 사이드카로 백업한 파일
  const autoMigratedMarkerFiles = [];  // 마커 없던 미수정 파일을 마커 버전으로 자동 이전
  const prependedMarkerFiles = [];     // 마커 없는 프로젝트 자체 파일 → 하네스 블록을 위에 얹음(내용 보존)
  // 전용(외부) 하네스 판정은 루프 **전에** 한다 — 루프가 .harness/**를 먼저 복사하므로 CLAUDE.md 차례엔 항상 존재한다.
  // 우리 manifest 없이 .harness/가 이미 있으면 그 프로젝트의 진입점은 자기 하네스를 가리키고 있을 가능성이 크다 →
  // 얹지 않고 보존 + 브리지 후보 안내(사람이 판단). CLAUDE.md만 있는 경우(대다수 팀)는 얹는다.
  const foreignHarnessDir = !manifest && existsSync(join(target, '.harness'));
  // seed-only 문서(0.2.69): 본체 전용 문서는 소비자 타깃에 배포하지 않는다.
  const seedModeTarget = existsSync(join(target, SEED_MODE_MARKER));
  const skippedSeedOnlyDocs = [];

  for (const rel of files) {
    const src = join(sourceRoot, rel);
    const dest = join(target, rel);
    const exists = existsSync(dest);
    const projectOwned = isProjectOwned(rel);
    const managed = isManagedByManifest(manifest, rel);

    // 원칙을 한 곳에서 닫는다(Codex 3R #1·4R #1·#3, 사용자 결정 A): 설치 대상 자리가 심볼릭 링크면 — 살아 있든 끊어졌든 —
    // 어떤 경로로도 쓰지 않는다. existsSync 는 링크를 따라가 끊어진 링크를 "없음", 살아 있는 링크를 "있음"으로 보므로 lstat 로
    // 링크 자체를 본다. 마커 병합·일반 복사·교체·--resync-managed·--force 가 모두 이 아래에 있어 여기서 멈추면 전부 멈춘다.
    // 자리별로 막던 코드(isRegularFile 등)는 디렉터리 같은 나머지 비정규 케이스를 위해 남는다.
    if (isSymlinkPath(dest)) {
      const dangling = !exists;
      console.warn(`'${rel}' 자리가 ${dangling ? '끊어진 심볼릭 링크' : '심볼릭 링크'}라 건너뜁니다 — 하네스는 링크 너머를 쓰지 않습니다. 링크를 정리한 뒤 다시 실행하세요.`);
      if (opts.dryRun) console.log(`[dry-run] skip ${rel} (${dangling ? '끊어진 심볼릭 링크' : '심볼릭 링크'})`);
      stats.skipped++;
      skippedFiles.push(rel);
      nonRegularSkipped.push(rel);
      continue;
    }

    // seed-only 문서와 본체 세션 이력 아카이브는 소비자(마커 없음) 타깃에 배포하지 않는다.
    // 기존 설치본 제거는 removeSeedOnlyDocs가 담당. 본체(마커 있음) 타깃에는 그대로 복사한다(본체 개발에 필요).
    if (!seedModeTarget && (SEED_ONLY_DOC_PATHS.has(toPosix(rel)) || isSessionHistoryLog(toPosix(rel)))) {
      if (opts.dryRun) {
        console.log(`[dry-run] skip(seed-only) ${rel}`);
      }
      skippedSeedOnlyDocs.push(rel);
      continue;
    }

    // 마커 관리 파일(CLAUDE.md/AGENTS.md/copilot): 마커 안은 본체 갱신, 마커 밖은 소비자 보존.
    // 첫 설치(!exists)는 아래 일반 경로에서 본체(마커 포함)를 그대로 복사한다.
    // 파일은 있는데 manifest에 없는 경우(= 프로젝트가 하네스 전부터 갖고 있던 자기 진입점, 2026-09-08 실측:
    // 첫 설치엔 manifest가 없고 보존된 파일은 기록되지도 않아 매 설치마다 조용히 보존됐다)도 이 분기로 들어와
    // 마커가 있으면 머지, 없으면 하네스 블록을 위에 얹는다. --force는 미등록 파일에 대해 예전처럼 일반 경로의
    // 통째 덮어쓰기(동의 가드 포함)를 유지한다.
    if (exists && isMarkerManaged(rel) && (managed || (!opts.force && !foreignHarnessDir))) {
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

        // 백업 자리 차단은 dry-run 앞에서 판정한다(Codex 5R #2): else 안에 두면 dry-run 이 merge·백업 예정을 출력하고
        // updated/copied 로 집계해 실제 실행(skipped)과 어긋났다. 판정·집계는 공통, 쓰기만 실제 실행 분기에.
        if (backupRel && backupTargetBlocked(target, backupRel)) {
          // 회사 영역 수정을 백업 없이 덮지 않는다 — 백업 자리가 링크면 병합 자체를 건너뛴다(사용자 결정 A).
          console.warn(`'${backupRel}' 자리가 심볼릭 링크라 '${rel}' 병합을 건너뜁니다 — 백업 없이 회사 영역 수정을 덮지 않습니다.`);
          if (opts.dryRun) console.log(`[dry-run] skip ${rel} (백업 자리가 심볼릭 링크)`);
          stats.skipped++;
          skippedFiles.push(rel);
          nonRegularSkipped.push(rel);
          continue;
        }
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
      const unmodified = Boolean(recorded.sha256) && matchesRecordedSha(dest, recorded.sha256);
      if (unmodified) {
        // 소비자가 파일을 전혀 안 건드림 → 마커 버전(본체)으로 통째 교체(자동 마이그레이션).
        if (opts.dryRun) {
          console.log(`[dry-run] migrate(marker) ${rel}`);
        } else {
          mkdirSync(dirname(dest), { recursive: true });
          writeInstalledFile(src, dest, rel);
        }
        stats.updated++;
        copiedFiles.push(rel);
        autoMigratedMarkerFiles.push(rel);
        continue;
      }

      // 마커 없는 프로젝트 자체 파일(예: 하네스 전부터 있던 CLAUDE.md) → 하네스 블록을 **위에 얹고**
      // 기존 내용은 한 글자도 바꾸지 않고 아래에 둔다. 결과는 정상 설치본과 같은 모양(마커 안 = 본체,
      // 마커 밖 = 프로젝트 영역)이 되어 다음 업데이트부터 마커 머지 경로를 탄다.
      // 0.2.142까지는 통째 보존 + "읽기 순서를 연결할지 검토하세요"였다 — 에이전트 없이 터미널에서
      // npx로 설치한 개발자는 그 문장을 읽고 무엇을 어디에 쓰라는지 알 수 없었다(2026-09-08 사용자 지적).
      // 마커 설계상 답은 정해져 있으므로(위 = 본체, 아래 = 프로젝트) 설치기가 직접 한다.
      const harnessContentForPrepend = readFileSync(src, 'utf8');
      if (extractManagedBlock(harnessContentForPrepend) === null) {
        // 본체 원본에 마커가 없으면 얹을 블록이 없다 — 있을 수 없는 상태지만 통째 덮지 않고 보존한다.
        stats.skipped++;
        skippedFiles.push(rel);
        continue;
      }
      const prepended = `${harnessContentForPrepend.trimEnd()}\n\n${consumerContent}`;
      if (opts.dryRun) {
        console.log(`[dry-run] prepend(marker) ${rel}`);
      } else {
        writeFileSync(dest, prepended);
      }
      stats.updated++;
      copiedFiles.push(rel);
      prependedMarkerFiles.push(rel);
      continue;
    }

    let shouldCopy = !exists || opts.force || (!projectOwned && managed);

    let preservedByGuard = false;
    let backupRel = null;
    let replacedHook = false;
    let replacedFile = false;
    let nonRegularTarget = false;   // 명시 교체 대상이 심볼릭 링크·디렉터리 — 이 판정은 최종이다(Codex 2R #1·#2)

    // 훅 충돌 해결(0.2.146): 유지(--keep-hook) 결정은 --force 보다 우선한다 — "다른 파일은 강제 갱신, 이 훅은 유지"라는
    // 구체적 선택이 결과에 반영돼야 한다(리뷰 P2-1). 교체(--replace-hook) 결정만 원본으로 바꾸고 기존 파일을 옆에 보관한다.
    if (exists && opts.keepHookRels?.has(rel)) {
      shouldCopy = false;
    }
    if (exists && opts.replaceHookRels?.has(rel)) {
      if (!isRegularFile(dest)) {
        // 충돌 판정(detectHookConflicts)은 statSync 라 링크 너머를 일반 파일로 보지만, 교체는 링크 너머를 덮는 일이다(Codex 2R #2).
        console.warn(`--replace-hook 대상 '${rel}'은 일반 파일이 아니라(디렉터리·심볼릭 링크) 건너뜁니다.`);
        shouldCopy = false;
        nonRegularTarget = true;
        nonRegularSkipped.push(rel);
      } else if (backupTargetBlocked(target, `${rel}.harness-bak`)) {
        console.warn(`'${rel}.harness-bak' 자리가 심볼릭 링크라 교체를 건너뜁니다 — 백업을 링크 너머에 쓰지 않습니다. 링크를 정리한 뒤 다시 실행하세요.`);
        shouldCopy = false;
        nonRegularTarget = true;
        nonRegularSkipped.push(rel);
      } else {
        backupRel = `${rel}.harness-bak`;
        if (!opts.dryRun) copyFileSync(dest, join(target, backupRel));
        shouldCopy = true;
        replacedHook = true;
      }
    }
    // --replace-file(0.2.148, #34): 보존돼 관리 밖으로 나간 파일(또는 로컬 수정된 managed 파일 하나)을 원본으로 되돌린다.
    if (exists && !projectOwned && opts.replaceFiles?.has(rel) && !opts.replaceHookRels?.has(rel)) {
      if (!isRegularFile(dest)) {
        // 심볼릭 링크를 따라 저장소 밖 파일을 덮는 사고를 막는다(적대적 리뷰 P3). 경고만 하고 두면 managed 파일은
        // 일반 복사 경로(1337의 shouldCopy)가 그대로 링크 너머를 쓴다 — 경고가 거짓이 된다(Codex 1R #1). 복사도 끈다.
        console.warn(`--replace-file 대상 '${rel}'은 일반 파일이 아니라(디렉터리·심볼릭 링크) 건너뜁니다.`);
        shouldCopy = false;
        nonRegularTarget = true;
        nonRegularSkipped.push(rel);
      } else if (backupTargetBlocked(target, `${rel}.harness-bak`)) {
        console.warn(`'${rel}.harness-bak' 자리가 심볼릭 링크라 교체를 건너뜁니다 — 백업을 링크 너머에 쓰지 않습니다. 링크를 정리한 뒤 다시 실행하세요.`);
        shouldCopy = false;
        nonRegularTarget = true;
        nonRegularSkipped.push(rel);
      } else {
        backupRel = `${rel}.harness-bak`;
        if (!opts.dryRun) copyFileSync(dest, join(target, backupRel));
        shouldCopy = true;
        replacedFile = true;
      }
    }

    // 비정규 대상 판정은 최종이다(Codex 2R #1): 아래 로컬 수정 가드는 --resync-managed 로 shouldCopy 를 다시 켤 수 있는데,
    // isLocallyModifiedManagedFile 은 링크를 따라 해시를 비교하므로 링크 너머를 "수정된 managed" 로 보고 덮었다.
    if (exists && managed && !projectOwned && !replacedFile && !nonRegularTarget && isLocallyModifiedManagedFile(target, rel, manifest)) {
      if (opts.resyncManaged) {
        // 설치 기록과 달라진 managed 파일을 본체 원본으로 되돌린다. 대상은 managed이면서 프로젝트 소유가
        // 아닌 파일뿐이라 spec-map.md·profile.json 같은 소비자 산출물은 사정거리 밖이다(--force와 다른 점).
        shouldCopy = true;
        resyncedManaged.push(rel);
      } else if (!opts.force) {
        // 기본 흐름: --force 없으면 로컬 수정본을 보존한다.
        shouldCopy = false;
        preservedByGuard = true;
      } else if (opts.confirmOverwriteProjectFiles) {
        // 명시적 동의가 있으면 덮어쓴다. .harness-bak 사이드카로 직전 소비자본을 같은 디렉터리에 남긴다.
        if (backupTargetBlocked(target, `${rel}.harness-bak`)) {
          console.warn(`'${rel}.harness-bak' 자리가 심볼릭 링크라 '${rel}' 덮어쓰기를 건너뜁니다 — 백업 없이 덮지 않습니다.`);
          shouldCopy = false;
          nonRegularTarget = true;
          nonRegularSkipped.push(rel);
        } else {
          backupRel = `${rel}.harness-bak`;
          if (!opts.dryRun) {
            copyFileSync(dest, join(target, backupRel));
          }
        }
      }
      // --force만 있고 --confirm 미동의면 collectForceOverwriteTargets 가드가 차단한다.
    }

    if (opts.dryRun) {
      const action = !exists
        ? 'add'
        : nonRegularTarget
          ? 'skip(non-regular: 심볼릭 링크·디렉터리)'
          : preservedByGuard
            ? 'preserve(locally-modified-managed)'
            : shouldCopy
              ? 'update'
              : 'preserve';
      const suffix = backupRel ? ` [backup → ${backupRel}]` : '';
      console.log(`[dry-run] ${action} ${rel}${suffix}`);
    } else if (shouldCopy) {
      mkdirSync(dirname(dest), { recursive: true });
      writeInstalledFile(src, dest, rel);
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
      if (replacedHook) {
        replacedHooks.push({ rel, backup: backupRel });
      } else if (replacedFile) {
        replacedFiles.push({ rel, backup: backupRel });
      } else if (backupRel) {
        overwroteLocallyModified.push({ rel, backup: backupRel });
      }
    } else {
      stats.skipped++;
      skippedFiles.push(rel);
      // 유지(--keep-hook) 결정된 파일은 재편입하지 않는다(Codex 1R #2): 충돌 판정은 원시 바이트라 줄바꿈만 다른 훅을 충돌로
      // 보고 사용자가 "유지"를 골랐는데, 재편입은 정규화 동치라 같은 파일을 관리 대상으로 들여 다음 업데이트가 덮었다 —
      // 사람의 결정이 자동 판정 위에 있어야 한다(유지 > 강제 규칙과 같다). 충돌 판정을 정규화로 통일하는 것은 의도적으로 보류:
      // 셸 훅은 CRLF 면 실제로 깨지는 파일이라 "줄바꿈만 다름"이 무해하지 않고, 충돌로 잡아 원본으로 바꿀 기회를 주는 쪽이 안전하다.
      if (exists && !managed && !projectOwned && !isMarkerManaged(rel)) {
        // 유지 결정은 재편입만 막는다 — 보존 현황(preservedForeignFiles) 기록은 남아야 한다(Codex 2R #3: 바깥 조건에
        // 두면 유지한 훅의 현황이 manifest 에서 사라지고 후처리도 일반 보존 목록으로 분류했다).
        if (!opts.keepHookRels?.has(rel) && isRegularFile(dest) && filesEquivalent(src, dest)) {
          // 하네스 원본과 **같은** 동명 파일은 관리 대상으로 들인다(0.2.148, scorecard-print #34): 보존됐던 파일을 손으로
          // 원본으로 되돌려도 종전에는 copiedFiles 에도 승계에도 없어 영원히 관리 밖이었다 — 다음 릴리스에 다시 얼어붙는다.
          // 바이트가 같으니 디스크는 그대로고 기록(manifest)만 바뀐다.
          copiedFiles.push(rel);
          readoptedFiles.push(rel);
        } else if (!nonRegularTarget) {
          // 하네스 원본과 내용이 다른 동명 파일(출처 미확인)은 현황으로 기록한다 — 소유권 표시가 아니다.
          // 비정규 차단 대상은 여기 넣지 않는다(Codex 3R #3): 넣으면 훅 화살표 문구가 "--keep-hook 으로 유지"라고 잘못 보고한다.
          preservedForeignFiles.push(rel);
        }
      }
    }
  }
  lastPreservedForeignFiles = preservedForeignFiles;

  return {
    ...stats,
    skippedFiles,
    copiedFiles,
    replacedHooks,
    replacedFiles,
    readoptedFiles,
    nonRegularSkipped,
    preservedForeignFiles,
    preservedLocallyModified,
    overwroteLocallyModified,
    resyncedManaged,
    mergedMarkerFiles,
    overwroteManagedRegion,
    autoMigratedMarkerFiles,
    prependedMarkerFiles,
    skippedSeedOnlyDocs,
  };
}

// 소비자(마커 없음) 타깃에서 이미 설치된 seed-only 문서를 정리한다.
// manifest에 managed로 기록되고 미수정(sha 일치)이면 제거하고, 소비자가 수정했으면 보존 + 리포트한다.
// 본체(마커 있음) 타깃은 건드리지 않는다.
// 화석 notes 마이그레이션(0.2.135, 멀티사이트 보고): profile.json은 프로젝트 소유라
// 업데이트가 덮지 않는데, notes의 harnessMode 안내문은 하네스가 최초 설치 때 써준 문장이다.
// maintenance 은퇴(0.2.131) 이전 설치본에는 은퇴 값을 권장하는 옛 문장이 화석으로 남아,
// 그대로 따르면 값 검증이 차단한다("자기 안내 → 자기 차단"). 옛 문장은 이력상 한 종류뿐이라
// 정확 문자열 치환이 안전하고, 소비자가 문장을 고쳐 썼다면 불일치라 자동 보존된다.
// JSON 재직렬화 없이 원문 바이트 치환만 해 소비자의 다른 필드·서식을 건드리지 않는다.
const STALE_HARNESS_MODE_NOTE = 'harnessMode는 bootstrap, active, maintenance, strict 중 하나를 권장합니다.'
const CURRENT_HARNESS_MODE_NOTE = 'harnessMode는 기준 동기화 신호의 등급을 조절하는 3단 다이얼입니다: bootstrap(정착기 — 기본 등급 동기화 후보를 참고로 완화, 명시 강제 선언은 유지), active(기본), strict(확인 필수 항목을 커밋 차단으로 승격). maintenance는 0.2.131에서 은퇴했습니다.'

function migrateStaleProfileNotes(target, opts) {
  const profilePath = join(target, '.harness/policy/profile.json')
  if (isSymlinkPath(profilePath)) {
    console.warn(`'.harness/policy/profile.json' 자리가 심볼릭 링크라 안내문 정정을 건너뜁니다 — 하네스는 링크 너머를 쓰지 않습니다.`)
    return false
  }
  if (!existsSync(profilePath)) {
    return false
  }

  const raw = readFileSync(profilePath, 'utf8')
  if (!raw.includes(STALE_HARNESS_MODE_NOTE)) {
    return false
  }

  if (!opts.dryRun) {
    writeFileSync(profilePath, raw.replace(STALE_HARNESS_MODE_NOTE, CURRENT_HARNESS_MODE_NOTE))
  }
  return true
}

function removeSeedOnlyDocs(target, manifest, opts) {
  const result = { removed: [], preservedModified: [], retiredRemoved: [], retiredPreserved: [] };

  if (existsSync(join(target, SEED_MODE_MARKER))) {
    return result;
  }

  for (const rel of SEED_ONLY_DOC_PATHS) {
    const abs = join(target, rel);
    if (!existsSync(abs)) {
      continue;
    }

    const recordedSha = manifest?.managedFiles?.[toPosix(rel)]?.sha256;
    const unmodified = matchesRecordedSha(abs, recordedSha);

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

  // 동적 이름의 세션 이력 아카이브(0.2.95)도 같은 규칙으로 정리한다. 이전 버전이 배포한
  // 미수정본(manifest sha 일치)만 제거하고, 소비자가 자기 아카이브로 덮어쓴 경우는 보존 + 안내한다.
  // manifest에 기록이 없는 파일은 소비자 자신의 정상 산출물이므로 건드리지도, 보고하지도 않는다.
  const sessionDir = join(target, '.harness/session');
  if (existsSync(sessionDir)) {
    for (const name of readdirSync(sessionDir)) {
      const rel = `.harness/session/${name}`;
      if (!isSessionHistoryLog(rel)) {
        continue;
      }

      const abs = join(target, rel);
      if (!statSync(abs).isFile()) {
        continue;
      }

      const recordedSha = manifest?.managedFiles?.[rel]?.sha256;
      if (!recordedSha) {
        continue;
      }

      if (!matchesRecordedSha(abs, recordedSha)) {
        result.preservedModified.push(rel);
        continue;
      }

      if (!opts.dryRun) {
        rmSync(abs, { force: true });
      }
      result.removed.push(rel);
    }
  }

  // 은퇴한 관리 파일도 같은 규칙으로 정리한다(0.2.134). 세션 이력 아카이브와 같은 계열:
  // manifest 기록이 없는 파일은 소비자 자신의 파일일 수 있으므로 건드리지도, 보고하지도 않는다.
  for (const rel of RETIRED_MANAGED_PATHS) {
    const abs = join(target, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      continue;
    }

    const recordedSha = manifest?.managedFiles?.[toPosix(rel)]?.sha256;
    if (!recordedSha) {
      continue;
    }

    if (!matchesRecordedSha(abs, recordedSha)) {
      result.retiredPreserved.push(rel);
      continue;
    }

    if (!opts.dryRun) {
      rmSync(abs, { force: true });
    }
    result.retiredRemoved.push(rel);
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
- 코딩 규약(언어·서식·네이밍): \`.harness/project/coding-conventions.md\`

## 확인할 일
- 에이전트는 사용자가 "하네스"를 언급하지 않아도 루트의 \`.harness/\`를 감지하면 하네스 작업 프로토콜을 적용해야 합니다.
- \`.harness/project/project-charter.md\`의 TBD 항목을 프로젝트 상황에 맞게 채웁니다.
- 큰 작업이나 낯선 영역이면 에이전트가 \`.harness/bin/harness context "<작업 설명>"\`으로 판단 컨텍스트를 만듭니다.
- 작업 후 \`.harness/bin/harness check\`로 기준, 링크, 검증 상태를 확인합니다.

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

    case '.harness/session/developer-input-queue.md': {
      // 헌장 질문 4건은 설치가 심는 것이지 팀이 올린 것이 아니다. `open`으로 두면 답할 때까지
      // 매 세션 4줄이 찍히는데, 실사용 조사(설치 24곳)에서 답이 달린 곳이 사실상 없었다 —
      // 신호가 아니라 배경 소음이 된다. 설치 시점 + 2주의 재검토일을 붙여 유예 집계 한 줄로
      // 시작하고, 기한이 지나면 다시 뜬다(영구 은닉 아님 — 큐의 기존 계약 그대로).
      const charterReviewDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      return `# 개발자 입력 큐

개발자 정보 부족 때문에 확정하지 못한 질문을 관리합니다.

## 상태 정의
- \`open\`: 다음 작업 전에 다시 확인해야 함
- \`deferred\`: 개발자가 답변을 유보함 — 얼마나 유보하는지는 상태가 아니라 재검토일이 표현합니다
- \`answered\`: 답변을 받아 반영함
- \`obsolete\`: 더 이상 필요하지 않음

## 현재 오픈 항목
| id | status | 질문 | 왜 필요한가 | 개발자 선택 | 재검토일 |
| --- | --- | --- | --- | --- | --- |
| charter-status | deferred | 이 프로젝트는 신규 구축, 유지보수, 마이그레이션, 운영 개선 중 어디에 가까운가? | 프로젝트 헌장 질문을 상황에 맞게 줄이기 위해 필요 | 미정 | ${charterReviewDate} |
| charter-scope | deferred | 이 저장소가 현재 책임지는 범위와 책임지지 않는 범위는 무엇인가? | 프로젝트 하네스가 과도한 규칙을 만들지 않기 위해 필요 | 미정 | ${charterReviewDate} |
| charter-success | deferred | 현재 가장 중요한 성공 기준은 무엇인가? | 완료 판단과 범위 통제를 위해 필요 | 미정 | ${charterReviewDate} |
| charter-risk | deferred | 변경하면 특히 위험한 영역이나 반복 회귀 지점은 무엇인가? | 유지보수와 에이전트 작업의 검증 기준을 정하기 위해 필요 | 미정 | ${charterReviewDate} |

## 운영 원칙
- 답변을 받으면 관련 문서(\`project-charter.md\`, \`active-context.md\`, \`decision-log.md\`)를 함께 갱신합니다.
- 유보된 질문은 삭제하지 않고 \`deferred\`로 남깁니다.
- **재검토일**(YYYY-MM-DD)을 적으면 그 날짜까지 세션 시작 알림에서 유예됩니다(집계 한 줄로만 표시). 비워두면 종전대로 매 세션 출력됩니다 — 장기 보류(정책·담당자 부재형)는 날짜를 적어 신호 희석을 막고, 지금 답이 필요한 질문은 비워둡니다. 기한이 지나면 다시 출력되므로 영구 은닉은 되지 않습니다.
- \`answered\` 또는 \`obsolete\` 항목은 관련 문서 반영을 확인한 뒤 큐에서 제거하거나 날짜별 아카이브로 옮깁니다.
- 상시 로드되는 큐에는 \`open\`과 \`deferred\` 항목만 유지합니다.
- 에이전트는 구현 중 추측이 필요한 반복 규칙을 만나면 사용자에게 인터뷰하거나 이 큐에 \`open\` 항목을 추가합니다.
- 설치가 심어 둔 \`charter-*\` 4건은 재검토일까지 유예 상태입니다. 헌장을 채울 준비가 되면 \`open\`으로 올리거나 바로 답하고, 이 프로젝트에 필요 없으면 \`obsolete\`로 지웁니다.
`;
    }

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
- 코딩 규약(언어·서식·네이밍): \`.harness/project/coding-conventions.md\`

## 다음 작업
- 프로젝트 헌장 TBD 항목을 확인합니다.
- 이번 작업 설명이 있으면 \`.harness/bin/harness context "<작업 설명>"\`으로 읽을 기준을 좁힙니다.
- 작업 후 \`.harness/bin/harness check\`를 실행합니다.

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

  return matchesRecordedSha(abs, manifest.managedFiles[rel].sha256);
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

  // 링크 자리에는 쓰지 않는다(Codex 4R #1, 사용자 결정 A): 루프에서 걸러도 이 후처리는 existsSync 만 보고 끊어진 링크 너머에 파일을 만들었다.
  if (isSymlinkPath(abs)) {
    console.warn(`'${rel}' 자리가 심볼릭 링크라 건너뜁니다 — 하네스는 링크 너머를 쓰지 않습니다.`);
    return { rel, created: false, skipped: 'symlink' };
  }

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

function renderHookStep(target = TARGET, index = 7, hooksResult = 'skipped') {
  if (hooksResult === 'ok') {
    return `  ${index}) git hook 활성화 — 이번 설치에서 자동으로 완료됨 (이 clone 기준)
       사용자가 승인한 git commit/push 전에 .harness/bin/harness check가 자동 실행됩니다.
       훅 설정은 clone으로 공유되지 않지만, 새로 clone한 팀원이 세션을 열면 하네스가 자동으로 켜고 한 줄 알려줍니다(0.2.131+) — 손으로 hooks:install을 칠 필요가 없습니다.
       npm 프로젝트는 package.json의 prepare(또는 husky 공존 시 postprepare)에 걸어 자동화할 수 있습니다 — .harness/project/hook-coexistence.md 참고.`;
  }

  if (isGitRepository(target)) {
    return `  ${index}) git hook 활성화
       .harness/bin/harness hooks:install
       이후 사용자가 승인한 git commit/push 전에 .harness/bin/harness check가 자동 실행됩니다.`;
  }

  return `  ${index}) git hook 활성화
       현재 git 저장소가 아니므로 건너뜁니다. 필요하면 git init 후 .harness/bin/harness hooks:install을 실행하세요.`;
}

// 설치 결과 리포트 — 출력의 맨 마지막(0.2.140, 백엔드 common 첫 설치 실측). 설치 경로에는 /하네스업데이트
// 스킬의 "결과 리포트를 남길까요?" 질문 의무가 닿지 않아(그 문서는 업데이트 때만 읽힘) 에이전트가
// 토큰 없음 → 파일로 남김에서 멈추고 전달까지 가지 않았다. 마지막 줄에서 질문 의무와 전달 경로를
// 직접 말한다. 절차 본문은 한 곳(하네스업데이트.md 마무리 절)에 두고 여기서는 가리킨다(결정 88).
function printInstallReportPrompt() {
  console.log(`
::: 설치 결과 리포트 (에이전트: 조용히 끝내지 마세요) :::
  설치가 끝났으니 사용자에게 반드시 물어봅니다 — "설치 결과 리포트를 남길까요?" (등록 / 파일로만 / 생략)
  Claude 계열은 질문 UI(AskUserQuestion)로 묻고, 답을 받기 전에 턴을 끝내지 않습니다.
  - 등록:  .harness/bin/harness report:install        (표식 값으로 실행 — 인자 불필요, 리더 승인 후)
  - 토큰이 없으면 파일(.harness/generated/install-report-*.md)로만 남습니다. 그 파일을 리더가 본체 팀에 전달하거나,
    공용 토큰을 하네스 본체 개발자에게 DM으로 요청해 ~/.config/ai-standard/report.env 에
    HARNESS_BODY_ISSUE_TOKEN=<값> 한 줄(개발자당 1회)을 두면 이후 모든 프로젝트에서 바로 등록됩니다.
  - 생략을 택했으면 표식 .harness/generated/pending-report.json 을 지웁니다(안 지우면 다음 커밋 검사가 계속 상기).
  절차 전문(전달 사항 양식·승인): .claude/commands/하네스업데이트.md 의 "마무리 — 결과 리포트 등록" 절`);
}

function printConsumerCommandGuide(target = TARGET) {
  const hookGuide = isGitRepository(target)
    ? `  - git commit/push 전 자동 검증 연결
       .harness/bin/harness hooks:install`
    : `  - git hook 연결
       현재 git 저장소가 아니면 먼저 git init 후 .harness/bin/harness hooks:install`

  console.log(`
::: 소비자 명령 빠른 안내 :::
  (npm 별칭은 주입하지 않습니다. 모든 명령은 .harness/bin/harness 런처로 실행하세요. --help로 전체 목록을 봅니다.)
  - 큰 작업 전 읽을 문서와 스킬 좁히기
       .harness/bin/harness context "<작업 설명>"
  - 정책 영향 범위 확인
       .harness/bin/harness impact
  - 작업 완료 전 검증
       .harness/bin/harness check
  - 현재 상태 가이드 열기
       .harness/bin/harness guide --open
  - 프로젝트 구조와 로컬룰 후보 다시 스캔
       .harness/bin/harness scan
  - 설치/업데이트 후 인수인계 요약 다시 생성
       .harness/bin/harness handoff
  - 업데이트 후보 확인 및 적용
       .harness/bin/harness outdated
       .harness/bin/harness update
  - 마지막 업데이트로 바뀐 공통 하네스 변경 내역 다시 보기
       .harness/bin/harness changelog
  - 설치 제거 계획 확인 및 제거
       .harness/bin/harness uninstall
       .harness/bin/harness uninstall --confirm
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

  // 세션 이력 아카이브(0.2.95)는 isProjectOwned가 project-owned로 분류하므로 아래 승계 조건에서
  // 자동 제외된다 — (1) 소비자가 자기 아카이브로 덮어쓴 파일이 영구히 "로컬 수정 managed"로 잡히는 것과
  // (2) 수동 삭제된 파일의 stale 엔트리가 함께 정리된다.
  for (const [rel, entry] of Object.entries(previousManifest?.managedFiles ?? {})) {
    const normalized = toPosix(rel)
    const abs = join(target, normalized)
    // 은퇴한 관리 파일은 승계하지 않는다(0.2.134) — 제거되면 엔트리도 함께 사라지고,
    // 수정 흔적으로 보존된 파일은 managed에서 이탈해 소비자 소유로 재분류된다.
    // 링크 자리는 managed 로 이어받지 않는다(Codex 4R #3): 이어받으면 다음 일반 업데이트가 링크 너머를 쓴다 — 루프 게이트가
    // 막긴 하지만 기록도 사실과 맞아야 한다(링크는 하네스가 관리하는 파일이 아니다).
    if (!isProjectOwned(normalized) && !RETIRED_MANAGED_PATHS.has(normalized) && existsSync(abs) && statSync(abs).isFile() && !isSymlinkPath(abs)) {
      managedFiles[normalized] = entry
    }
  }

  for (const rel of copiedFiles) {
    // 프로젝트 소유 파일은 managed 기록을 만들지 않는다(0.2.136). 종전에는 최초 설치 때
    // 복사된 프로젝트 소유 파일(커밋 템플릿, domain-rules 등)이 여기서 managed로 기록되어,
    // 첫 업데이트 전까지 편집 시 드리프트 경고가 뜨는 잠복 창이 있었다(승계 제외는 다음
    // 업데이트에야 도달). 소유 판정은 기록 시점부터 일관되게.
    if (isProjectOwned(rel)) {
      continue
    }
    const abs = join(target, rel)
    if (!existsSync(abs) || !statSync(abs).isFile() || isSymlinkPath(abs)) {
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
    // 현황 기록(0.2.146): 하네스 원본과 다른 동명 파일을 보존한 것. 소유권 표시가 아니며 하네스가 덮어쓰거나 지우지 않는다.
    preservedForeignFiles: [...lastPreservedForeignFiles].sort(),
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
  // 보고 대기 표식(0.2.137, 결정 98 후속): 설치/업데이트가 끝나면 "결과 리포트가 아직 없다"는
  // 상태를 로컬 표식으로 남긴다. report:install이 지우고, 매 check가 남아 있으면 한 줄 상기한다 —
  // 절차 문서를 건너뛰는 에이전트가 있어도(실측) 다음 커밋이 알려준다. generated/라 git 미추적,
  // 업데이트를 실행한 그 PC에서만 뜬다. 보고를 생략하려면 파일을 지우면 된다(자발성 유지).
  if (!opts.dryRun) {
    try {
      const pendingPath = join(target, '.harness/generated/pending-report.json')
      mkdirSync(dirname(pendingPath), { recursive: true })
      // 같은 목표 버전으로 재기록될 때는 from을 보존한다(0.2.138, 멀티사이트 리포트 #6):
      // 스택 init이 내부에서 base init을 한 번 더 돌리면 두 번째 기록의 previousManifest가
      // 이미 새 버전이라 from이 to와 같아졌다(실측: 0.2.133→0.2.137 업데이트가 0.2.137→0.2.137로).
      let from = pickUpdateFrom(opts, previousManifest?.version ?? null)
      let kind = previousManifest ? 'update' : 'install'
      try {
        const existing = JSON.parse(readFileSync(pendingPath, 'utf8'))
        // 연속 구간(0.2.144, scorecard #22): 직전 표식이 "…→X"로 끝났고 이번이 X에서 시작하면 한 업데이트의
        // 다음 단계다(스택 init이 base를 중간 태그까지 올린 뒤 base init이 최신까지). 원래 from을 이어받는다.
        // 표식은 report:install이 지우므로, 남아 있는 표식은 아직 보고되지 않은 구간 — 잇는 것이 맞다.
        if (!opts.updateFrom && existing.from && existing.to && existing.to === (previousManifest?.version ?? null) && existing.to !== manifest.version) {
          kind = existing.kind ?? kind
          from = existing.from
        }
        if (existing.to === manifest.version) {
          // 같은 사이클의 재기록(스택 init의 base 재실행 등): 사이클 성격(kind)과
          // 진짜 출발 버전(from)은 첫 기록이 안다 — 재실행 시점의 previousManifest는
          // 이미 새 버전이라 from이 to와 같아진다(멀티사이트 #6 실측).
          kind = existing.kind ?? kind
          if (existing.from) from = existing.from
        }
      } catch {}
      if (from === manifest.version) from = null // 자기 자신으로의 "업데이트"는 무의미
      writeFileSync(pendingPath, JSON.stringify({
        kind,
        from,
        to: manifest.version,
        at: manifest.installedAt,
      }, null, 2))
    } catch {
      // 표식 실패는 설치를 막지 않는다.
    }
  }
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

// 이번 업데이트의 시작 버전. update-harness가 --update-from으로 넘긴 값이 있고 그것이 직전 lock 버전보다
// 낮으면 그 값이 진짜 출발점이다(2단 업데이트에서 직전 lock은 이미 중간 단계까지 올라가 있다 — scorecard #22).
// 그 외에는 직전 lock 버전. lastUpdate는 영구 기록이라 여기서는 추정하지 않는다.
function pickUpdateFrom(opts, previousVersion) {
  const requested = parseSemverLoose(opts?.updateFrom)
  const previous = parseSemverLoose(previousVersion)
  if (requested && previous && compareSemverLoose(requested, previous) < 0) return requested.version
  if (requested && !previous) return requested.version
  return previousVersion
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

// 보고 표식이 이미 해결해 둔 출발 버전(연속 구간 이어받기 포함)을 읽는다. 표식은 이 함수보다 먼저
// 기록되므로(writeInstallManifest → writeHarnessLock) 여기서는 완성된 값이다. 추정이 아니라 재사용이다.
function readResolvedUpdateFrom(target, toVersion) {
  try {
    const marker = JSON.parse(readFileSync(join(target, '.harness/generated/pending-report.json'), 'utf8'))
    if (marker?.to === toVersion && typeof marker.from === 'string' && marker.from) return marker.from
  } catch {
    // 표식이 없거나 깨졌으면 폴백 없음 — 아래에서 종전 규칙을 쓴다.
  }
  return null
}

// 두 후보 중 **더 낮은** 버전이 진짜 출발점이다(0.2.148, 2단 체인 픽스처 실측). 2단 업데이트에서는
// 직전 lock이 이미 중간 단계까지 올라가 있어 그 값만 보면 구간이 잘린다. `--update-from`은 0.2.144부터
// 업데이터가 넘기므로, 그보다 낮은 버전에 머문 프로젝트에서는 그 신호가 아예 오지 않았다 —
// 그때도 표식(0.2.138부터)이 진짜 출발점을 들고 있어 리포트만 맞고 lock 기록은 좁아졌다.
function lowerVersion(left, right) {
  if (!left) return right ?? null
  if (!right) return left
  const a = parseSemverLoose(left)
  const b = parseSemverLoose(right)
  if (!a) return right
  if (!b) return left
  return compareSemverLoose(a, b) <= 0 ? left : right
}

function writeHarnessLock(sourceRoot, target, installManifest, opts) {
  if (opts.dryRun) return null

  const lockAbs = join(target, LOCK_PATH)
  const previous = readJson(lockAbs, {})
  const source = installManifest.source ?? {}
  const startVersion = lowerVersion(
    pickUpdateFrom(opts, previous?.baseHarness?.version),
    readResolvedUpdateFrom(target, installManifest.version),
  )
  const delta = computeChangelogDelta(sourceRoot, startVersion, installManifest.version)
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

// 0.2.131: 주입 별칭 0개. package.json에는 아무것도 쓰지 않는다 — 이미 있으면 읽어서
// 은퇴 별칭(RETIRED_CONSUMER_SCRIPTS) 잔존 여부만 감지해 정리 안내에 쓴다(add-only 계약,
// 기존 소비자 파일은 삭제하지 않는다). package.json이 없으면 비-Node 프로젝트로 보고
// 생성하지 않는다.
function mergePackageJson(target) {
  const pkgPath = join(target, 'package.json');
  if (!existsSync(pkgPath)) {
    return { retired: [], skippedCreation: true };
  }

  const userPkg = readJson(pkgPath, {});
  const scripts = userPkg.scripts || {};
  const retired = RETIRED_CONSUMER_SCRIPTS.filter((name) => scripts[name] !== undefined);

  return { retired, skippedCreation: false };
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

  // 링크 자리에는 쓰지 않는다(Codex 5R #1, 결정 A): 루프는 이 파일(프로젝트 소유)을 건드리지 않지만 이 병합은 따로 쓴다.
  if (isSymlinkPath(destAbs)) {
    console.warn(`'${rel}' 자리가 심볼릭 링크라 하네스 설정 병합을 건너뜁니다 — 하네스는 링크 너머를 쓰지 않습니다. 링크를 정리한 뒤 다시 실행하세요.`);
    return { ...result, skipped: 'symlink' };
  }
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
  if (isSymlinkPath(gitignorePath)) {
    console.warn(`'.gitignore' 자리가 심볼릭 링크라 하네스 항목 병합을 건너뜁니다 — 하네스는 링크 너머를 쓰지 않습니다.`);
    return 0;
  }
  // P5(2026-06-09): node_modules/dist는 Node 프로젝트 전용 항목이므로 package.json이 있을 때만 주입한다.
  // 비-Node 프로젝트(PHP/Java 등)의 .gitignore를 프론트 항목으로 오염시키지 않는다.
  const isNodeProject = existsSync(join(target, 'package.json'));
  const entries = [
    ...(isNodeProject ? ['node_modules/', 'dist/'] : []),
    '.env',
    '.env.local',
    '.env.*.local',
    // 이슈 어댑터·리포트 토큰 파일(결정 98). 견본 문서가 ".gitignore 등록됨"이라 약속하는데
    // 정작 소비자 목록에 없었다(본체에만 있던 것) — 토큰 유출 방지로 반드시 등록한다.
    '.issue-adapter.env',
    '.node-version.cache',
    '.package-json.hash',
    '.harness/.stack-applied.json',
    '.harness/generated/',
    '.harness/session/project-scan-report.md',
    '.harness/session/handoff.md',
    // task-context.md도 재생성 산출물이다. 형제 3건만 배포하고 이것만 빠져 있어 소비자 저장소에서
    // untracked로 떠다니며 커밋에 딸려 들어갔다(2026-08-11 multisite). 목록은 누락분만 덧붙이므로
    // 기존 설치본도 다음 업데이트에서 자동 보정된다.
    '.harness/session/task-context.md',
    '.harness/session/template-gap-report.md',
    '.harness-backup/',
    // prune:aliases와 managed 파일 덮어쓰기가 남기는 사이드카 백업. 커밋에 딸려 들어가지 않게 한다.
    '*.harness-bak',
    ...PERSONAL_LOCAL_PATHS,
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

// .cmd/.bat 는 cmd.exe 의 label/goto 가 LF 에서 깨질 수 있어 **의도적으로 CRLF 로 배포한다**(0.2.136, writeInstalledFile).
// 그런데 소비자 저장소에 그 의도를 알려 줄 속성이 없어, git 이 매번 "CRLF will be replaced by LF" 경고를 냈다
// (smartscore-backend/common #32, macOS). 속성 한 줄이면 git 이 인덱스에는 LF, 작업본에는 CRLF 로 다루어 경고가 사라지고
// Windows 안전성도 그대로다. 패턴은 하네스 경로로 좁힌다 — 프로젝트가 가진 자기 .cmd 파일에 정책을 강요하지 않는다.
const HARNESS_GITATTRIBUTES_ENTRIES = ['.harness/bin/*.cmd text eol=crlf'];

// 이 속성이 실제로 필요한 파일들 — 패턴이 아니라 **파일**로 판정한다. git 은 마지막에 매칭되는 줄이 이기므로,
// 패턴 문자열만 비교하면 팀이 `*.cmd text eol=lf` 처럼 다른 모양으로 정해 둔 선택을 우리 줄이 조용히 덮는다
// (적대적 리뷰 P2-5: 문자열 비교로는 세 가지 팀 표기 중 셋 다 덮였다). git 에게 해석 결과를 물어 판정한다.
const HARNESS_CRLF_SAMPLE_FILES = ['.harness/bin/harness.cmd'];

function resolvedEolAttribute(target, rel) {
  const result = spawnSync('git', ['check-attr', 'eol', '--', rel], {
    cwd: target,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // git 이 없거나 저장소가 아니면 판정 불가 → null 을 내고 문자열 비교 폴백으로 떨어진다.
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  const match = result.stdout.trim().match(/eol:\s*(\S+)$/);
  return match ? match[1] : null;
}

function mergeGitattributes(target, opts) {
  const gitattributesPath = join(target, '.gitattributes');
  if (isSymlinkPath(gitattributesPath)) {
    console.warn(`'.gitattributes' 자리가 심볼릭 링크라 줄바꿈 속성 병합을 건너뜁니다 — 하네스는 링크 너머를 쓰지 않습니다.`);
    return 0;
  }
  let current = '';
  if (existsSync(gitattributesPath)) {
    current = readFileSync(gitattributesPath, 'utf8');
  }

  // 이미 누군가(팀이든 우리든) 이 파일들의 eol 을 정해 뒀으면 손대지 않는다 — 이미 crlf 면 할 일이 없고,
  // 다른 값이면 팀의 명시적 선택이라 덮지 않는다. unspecified 일 때만 우리 줄을 넣는다.
  const decided = HARNESS_CRLF_SAMPLE_FILES.map((rel) => resolvedEolAttribute(target, rel));
  if (decided.length > 0 && decided.every((value) => value && value !== 'unspecified')) return 0;

  // git 판정이 불가한 환경(git 없음·저장소 아님)을 위한 폴백: 같은 패턴 문자열이 이미 있으면 넣지 않는다.
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  const missing = HARNESS_GITATTRIBUTES_ENTRIES.filter((entry) => {
    const pattern = entry.split(/\s+/)[0];
    return !lines.some((line) => line && !line.startsWith('#') && line.split(/\s+/)[0] === pattern);
  });
  if (missing.length === 0) return 0;

  if (!opts.dryRun) {
    const prefix = current.trim() ? `${current.replace(/\s*$/, '')}\n\n` : '';
    writeFileSync(gitattributesPath, `${prefix}# harness-seed: cmd.exe 배치는 CRLF 로 배포된다 (LF 에서 label/goto 가 깨질 수 있음)\n${missing.join('\n')}\n`);
  }

  return missing.length;
}

function findEslintConfig(target) {
  // create-vue 등 최신 스캐폴딩은 eslint.config.ts를 쓴다. 목록에서 빠지면 그 프로젝트의 설정을
  // 아예 못 보고 조용히 넘어간다 — 실증: multisite(2026-08-11).
  for (const rel of ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts']) {
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

// `.harness/`는 하네스 본체 코드다. 소비자가 고칠 수 없고(고치면 manifest sha가 어긋나 이후 모든
// 업데이트에서 제외된다) 고칠 이유도 없다. node_modules를 린트하지 않는 것과 같은 이유로 린트 대상에서
// 뺀다. 0.2.108까지는 Node globals override만 넣어 "린트해도 에러는 안 나는" 상태로 뒀는데, 그게 오히려
// import-sort 같은 자동수정 규칙에 활짝 열어주는 반쪽 보호였다(2026-08-11 multisite 실증: 10개 파일 동결).
const HARNESS_LINT_IGNORE = '.harness/**';
const HARNESS_BACKUP_IGNORE = '**/.harness-backup/**';

function hasHarnessBackupIgnore(content) {
  return content.includes('.harness-backup');
}

function hasHarnessLintIgnore(content) {
  return new RegExp(`['"][^'"]*\\.harness/\\*\\*[^'"]*['"]`).test(content);
}

// 기존 항목의 따옴표 스타일을 따라간다. 소비자 설정 파일 자체는 여전히 린트 대상이라
// 한 파일에 따옴표가 섞이면 그 프로젝트의 quotes 규칙에 걸린다.
function detectQuoteStyle(body) {
  return body.includes('"') && !body.includes("'") ? '"' : "'";
}

function insertGlobalIgnoreEntries(content, wanted) {
  const pattern = /globalIgnores\(\s*\[([\s\S]*?)\]\s*\)/m;

  if (!pattern.test(content)) {
    return null;
  }

  let changed = false;
  const next = content.replace(pattern, (full, entries) => {
    const missing = wanted.filter((entry) => !entries.includes(entry));
    if (missing.length === 0) {
      return full;
    }

    changed = true;
    const quote = detectQuoteStyle(entries);
    const rendered = missing.map((entry) => `${quote}${entry}${quote}`);

    if (!entries.includes('\n')) {
      const separator = entries.trim() ? ', ' : '';
      return `globalIgnores([${entries}${separator}${rendered.join(', ')}])`;
    }

    const trimmed = entries.replace(/\s*$/, '');
    return `globalIgnores([${trimmed},\n${rendered.map((item) => `  ${item},`).join('\n')}\n])`;
  });

  return changed ? next : null;
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

  const wantedIgnores = [];
  if (!hasHarnessLintIgnore(next)) wantedIgnores.push(HARNESS_LINT_IGNORE);
  if (!hasHarnessBackupIgnore(next)) wantedIgnores.push(HARNESS_BACKUP_IGNORE);

  const ignoreLabel = '.harness lint 제외';
  if (wantedIgnores.length === 0) {
    already.push(ignoreLabel);
  } else {
    const withIgnores = insertGlobalIgnoreEntries(next, wantedIgnores);
    if (withIgnores) {
      next = withIgnores;
      applied.push(ignoreLabel);
    } else {
      manual.push(ignoreLabel);
    }
  }

  // .harness/**를 통째로 제외했으면 하네스 파일은 린트되지 않으므로 Node globals override는 죽은 설정이다.
  // 이걸 보지 않으면 "제외했는데도 override를 넣으라"는 틀린 안내가 나간다(0.2.109 실측: multisite).
  if (hasHarnessLintIgnore(next)) {
    // 이미 있으면 그대로 둔다(무해). 없으면 요구하지 않는다.
  } else if (hasNodeScriptsOverride(next)) {
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

  if (next !== content && isSymlinkPath(abs)) {
    return { status: 'manual', message: `${rel} 자리가 심볼릭 링크라 하네스가 쓰지 않습니다 — 직접 편집하세요` };
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

// eslint 하나만 막아서는 부족하다. 같은 저장소에서 oxlint·prettier가 각자 .harness/를 훑고 --fix/--write로
// 고치면 결과는 동일하다(multisite는 eslint와 oxlint를 함께 쓴다). 도구별 제외 파일을 각각 손본다.
// 여기서 다루지 않는 도구(biome 등)는 guard의 managed drift 검사가 결과로 잡는다.
function patchLintIgnoreFiles(target, opts) {
  const results = [];

  const oxlintRel = '.oxlintrc.json';
  const oxlintAbs = join(target, oxlintRel);
  if (isSymlinkPath(oxlintAbs)) {
    // 링크 자리에는 쓰지 않는다(Codex 5R #1, 결정 A) — 끊어진 링크는 existsSync 가 "없음"으로 보므로 먼저 본다.
    console.warn(`'${oxlintRel}' 자리가 심볼릭 링크라 .harness 제외 반영을 건너뜁니다 — 직접 편집하세요.`);
    results.push({ rel: oxlintRel, status: 'manual' });
  } else if (existsSync(oxlintAbs)) {
    try {
      const raw = readFileSync(oxlintAbs, 'utf8');
      const config = JSON.parse(raw);
      const patterns = Array.isArray(config.ignorePatterns) ? config.ignorePatterns : [];
      if (patterns.some((entry) => typeof entry === 'string' && entry.includes('.harness/'))) {
        results.push({ rel: oxlintRel, status: 'already' });
      } else {
        config.ignorePatterns = [...patterns, HARNESS_LINT_IGNORE];
        if (!opts.dryRun) {
          writeFileSync(oxlintAbs, `${JSON.stringify(config, null, 2)}\n`);
        }
        results.push({ rel: oxlintRel, status: 'updated' });
      }
    } catch {
      // 설정이 JSON으로 안 읽히면(주석 등) 건드리지 않고 수동 안내로 넘긴다.
      results.push({ rel: oxlintRel, status: 'manual' });
    }
  }

  // prettier: .prettierignore가 있으면 항목을 보장한다. 설정만 있고 ignore 파일이 없으면 만든다
  // (그 상태에서 prettier --write는 .harness/ 전체를 재포맷한다).
  const prettierIgnoreRel = '.prettierignore';
  const prettierIgnoreAbs = join(target, prettierIgnoreRel);
  const hasPrettierConfig = [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    'prettier.config.js',
    'prettier.config.mjs',
    'prettier.config.cjs',
  ].some((rel) => existsSync(join(target, rel)));

  if (isSymlinkPath(prettierIgnoreAbs)) {
    console.warn(`'${prettierIgnoreRel}' 자리가 심볼릭 링크라 .harness 제외 반영을 건너뜁니다 — 직접 편집하세요.`);
    results.push({ rel: prettierIgnoreRel, status: 'manual' });
  } else if (existsSync(prettierIgnoreAbs)) {
    const current = readFileSync(prettierIgnoreAbs, 'utf8');
    if (current.split(/\r?\n/).some((line) => line.trim() === '.harness/' || line.trim() === HARNESS_LINT_IGNORE)) {
      results.push({ rel: prettierIgnoreRel, status: 'already' });
    } else {
      if (!opts.dryRun) {
        const prefix = current.trim() ? `${current.replace(/\s*$/, '')}\n` : '';
        writeFileSync(prettierIgnoreAbs, `${prefix}.harness/\n`);
      }
      results.push({ rel: prettierIgnoreRel, status: 'updated' });
    }
  } else if (hasPrettierConfig) {
    if (!opts.dryRun) {
      writeFileSync(prettierIgnoreAbs, '.harness/\n');
    }
    results.push({ rel: prettierIgnoreRel, status: 'created' });
  }

  return results;
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
    // #14(백엔드 common): 성공한 단계의 경고가 여기서 통째로 삼켜져 "기존 훅이 꺼진다" 같은
    // 안내가 설치자에게 닿지 않았다. 성공은 요약 한 단어로 두되, 자식이 stderr로 낸 경고는
    // 그대로 보여준다(node 런타임 잡음만 제외).
    const warnings = `${result.stderr ?? ''}`
      .split('\n')
      .filter((line) => line.trim() && !/^\(node:\d+\)/.test(line));
    for (const line of warnings) console.log(`    ${line}`);
    return true;
  }

  console.log('실패');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) {
    console.log(output);
  }
  return false;
}

function runPostInstallDiagnostics(target, opts, { freshInstall = false } = {}) {
  if (opts.dryRun) {
    return { hooks: 'skipped', scan: 'skipped', handoff: 'skipped', check: 'skipped' };
  }

  const result = { hooks: 'skipped', scan: 'skipped', handoff: 'skipped', check: 'skipped' };

  // 최초 설치에만 git hook을 자동 활성화한다(결정 94): 하네스 설치가 곧 관문 동의이고,
  // "설치했는데 관문이 꺼진 상태"가 기본값이면 안내를 흘린 프로젝트가 무방비가 된다.
  // 업데이트는 재배선하지 않는다 — 기존 clone이 내린 선택(훅 미사용 포함)을 존중한다.
  // hooks:install은 멱등이고 uninstall이 설치 전 상태로 복원한다.
  if (freshInstall && opts.noHooks && isGitRepository(target)) {
    // --no-hooks는 "이 PC에서는 켜지 말라"는 명시적 선택이다. 세션 시작 자동 복원(결정 94 보강)이
    // 이 선택을 무력화하지 않도록 표식을 남긴다. 되돌리기: git config --unset harness.hooksAutoEnable
    spawnSync('git', ['config', 'harness.hooksAutoEnable', 'false'], { cwd: target, stdio: 'ignore' });
  }

  if (freshInstall && !opts.noHooks && isGitRepository(target)) {
    result.hooks = runPostInstallStep(
      target,
      'git hook 활성화 (이 clone 기준 — 새 clone은 세션 시작 때 자동 복원)',
      [process.execPath, '.harness/bin/install-hooks.mjs'],
      opts,
    ) ? 'ok' : 'failed';
  }

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
      // 하네스 흔적(.harness)과 프로젝트 자신의 에이전트 파일(.claude·CLAUDE.md 등)은 다르다(0.2.142).
      // 보존 동작은 같지만 문구는 갈라야 한다 — 처음 설치하는 저장소에 "이전 설치 흔적"이라고
      // 말하면 리더가 없던 과거를 의심한다(백엔드 통합 저장소 실측, 2026-09-04).
      console.log(existsSync(join(TARGET, '.harness'))
        ? '이전에 설치된 하네스 흔적이 있어 기존 파일은 보존하고 누락된 공통 기준만 보강합니다.'
        : '이미 있는 에이전트 설정(.claude, CLAUDE.md 등)은 내용을 보존하고 하네스 기준만 보강합니다.');
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

    // 훅 이름 충돌 사전 검사(0.2.146): 파일 복사·설정 병합·백업 전에 멈춘다. dry-run 은 목록만 보여준다.
    const hookConflicts = detectHookConflicts(sourceRoot, TARGET, files, recognizedManifest);
    // --replace-file 로 훅 경로를 지정하면 훅 교체 결정으로도 읽는다(Codex 1R #3): 충돌 사전 검사가 먼저 멈춰 새 플래그가
    // 닿지 못했다. 한 파일에 대한 결정은 한 곳(훅 결정)으로 모은다 — 유지(--keep-hook)와의 모순도 그 검사가 잡는다.
    for (const rel of opts.replaceFiles ?? []) {
      if (rel.startsWith('.claude/hooks/') && rel.endsWith('.sh')) (opts.replaceHooks ??= new Set()).add(hookBaseName(rel));
    }
    const hookDecisions = resolveHookConflicts(hookConflicts, opts);
    if (hookDecisions.unresolved.length > 0) {
      if (opts.dryRun) {
        console.log(`[dry-run] 같은 이름의 기존 훅 ${hookDecisions.unresolved.length}개가 하네스 원본과 다릅니다(실제 실행이면 여기서 멈춤): ${hookDecisions.unresolved.map((c) => c.rel).join(', ')}`);
      } else {
        printHookConflictsAndExit(hookDecisions.unresolved);
      }
    }
    // --replace-file(0.2.148, #34) 대상 검증 — 조용히 넘기는 경우가 없어야 한다(적대적 리뷰 P1·P2):
    //  ① 프로젝트 소유 파일 거절 — 팀 설정(profile.json 등)을 템플릿으로 덮는 사고 방지
    //  ② 마커 진입점(CLAUDE.md·AGENTS.md·copilot-instructions) 거절 — 정상 설치에선 마커 병합 경로가 먼저라 조용히 무시되지만,
    //     설치 기록이 없는 외래 .harness/ 상태에선 통째로 덮여 팀 문서가 사라진다(리뷰 P1, --force 동의 관문도 우회)
    //  ③ 하네스가 배포하지 않는 경로는 오타일 확률이 높다 — 안내를 따라 친 한 글자 오타가 "복원됐다"는 믿음으로 끝나면 안 된다
    for (const rel of opts.replaceFiles ?? []) {
      if (isProjectOwned(rel)) {
        console.error(`--replace-file 대상 '${rel}'은 프로젝트 소유 파일입니다 — 하네스 원본으로 덮을 수 없습니다(팀 설정이 사라집니다). 되돌리려면 직접 편집하세요.`);
        process.exit(1);
      }
      if (isMarkerManaged(rel)) {
        console.error(`--replace-file 대상 '${rel}'은 마커로 병합하는 진입점입니다 — 통째로 교체할 수 없습니다(프로젝트 영역이 사라집니다). 하네스 블록은 그냥 업데이트하면 마커 안만 갱신됩니다.`);
        process.exit(1);
      }
      if (!files.includes(rel)) {
        console.error(`--replace-file 대상 '${rel}'은 하네스가 배포하는 파일이 아닙니다 — 경로를 확인하세요(예: .harness/policy/policy-registry.json).`);
        process.exit(1);
      }
    }
    opts.replaceHookRels = new Set(hookDecisions.replace.map((c) => c.rel));
    opts.keepHookRels = new Set(hookDecisions.keep.map((c) => c.rel));
    //  ④ 같은 파일에 유지(--keep-hook)와 교체(--replace-file)를 함께 주면 모순 — 훅 결정 검사와 같은 규칙으로 멈춘다(리뷰 P2)
    const keptAndReplaced = [...(opts.replaceFiles ?? [])].filter((rel) => opts.keepHookRels.has(rel));
    if (keptAndReplaced.length > 0) {
      console.error(`같은 파일에 유지(--keep-hook)와 교체(--replace-file)를 함께 지정했습니다: ${keptAndReplaced.join(', ')} — 하나만 남기고 다시 실행하세요.`);
      process.exit(1);
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
    const staleNotesMigrated = migrateStaleProfileNotes(TARGET, opts);
    const pkg = mergePackageJson(TARGET);
    const claudeSettings = mergeClaudeSettings(sourceRoot, TARGET, opts);
    const gitignoreAdded = mergeGitignore(TARGET, opts);
    const gitattributesAdded = mergeGitattributes(TARGET, opts);
    const eslintPatch = patchEslintConfigForHarness(TARGET, opts);
    const lintIgnorePatches = patchLintIgnoreFiles(TARGET, opts);
    ensureExecutable(TARGET, opts);
    const writtenManifest = writeInstallManifest(sourceRoot, TARGET, files, installed.copiedFiles, opts, recognizedManifest);
    const lockResult = writtenManifest ? writeHarnessLock(sourceRoot, TARGET, writtenManifest, opts) : null;
    const writtenLock = lockResult?.lock ?? null;
    // 일회성 사건이라 verbose 가 아니어도 알린다(적대적 리뷰 P3·P2-4): 이 줄을 넣으면 git 이 인덱스를 정규화해
    // `.harness/bin/harness.cmd` 가 한 번 "수정됨"으로 보인다 — 내용은 그대로다. 미리 말해 두면 놀라지 않는다.
    if (gitattributesAdded > 0 && !opts.dryRun) {
      console.log('');
      console.log(`.gitattributes: cmd 줄바꿈 속성 ${gitattributesAdded}건을 넣었습니다 (git의 "CRLF will be replaced by LF" 경고 제거).`);
      console.log('  이 때문에 .harness/bin/harness.cmd 가 한 번 수정된 것으로 보일 수 있습니다 — 내용은 그대로이니 그대로 커밋하면 됩니다.');
    }

    const diagnostics = runPostInstallDiagnostics(TARGET, opts, { freshInstall: !recognizedManifest });
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
        console.log('package.json: 없음 → 생성하지 않음 (비-Node 프로젝트로 간주). 하네스 명령은 .harness/bin/harness 런처를 사용합니다.');
      } else {
        console.log('package.json: 주입 별칭 없음 (모든 하네스 명령은 .harness/bin/harness 런처)');
        const retiredNotice = renderRetiredScriptsNotice(pkg.retired);
        if (retiredNotice) console.log(`package.json: ${retiredNotice}`);
      }
      console.log(`.gitignore: harness entry ${gitignoreAdded}개 추가`);
      if (claudeSettings.skipped === 'symlink') {
        console.log('.claude/settings.json: 자리가 심볼릭 링크라 하네스 훅 병합을 건너뜀 — 하네스는 링크 너머를 쓰지 않습니다. 링크를 정리한 뒤 다시 실행하세요.');
      } else if (claudeSettings.skipped === 'parse-error') {
        console.log('.claude/settings.json: 파싱 실패로 하네스 훅 병합을 건너뜀 (수동 확인 필요)');
      } else if (claudeSettings.changed) {
        console.log(`.claude/settings.json: 기존 설정 보존하고 하네스 안전 표면 병합 (hooks ${claudeSettings.hooksAdded}, deny ${claudeSettings.denyAdded}, allow ${claudeSettings.allowAdded}, env ${claudeSettings.envAdded}${claudeSettings.statusLineSet ? ', statusLine' : ''})`);
      } else {
        console.log('.claude/settings.json: 하네스 안전 표면 이미 반영됨 (변경 없음)');
      }
      console.log(`eslint config: ${eslintPatch.message}`);
      for (const patch of lintIgnorePatches) {
        console.log(`lint ignore: ${patch.rel} ${patch.status === 'already' ? '이미 .harness 제외됨' : patch.status === 'manual' ? '자동 수정 불가 — .harness/** 수동 추가 필요' : `.harness 제외 ${patch.status === 'created' ? '생성' : '추가'}`}`);
      }
      console.log(`legacy root scripts: ${opts.dryRun ? `${legacyManagedRootScripts.length}개 제거 예정` : `${migration.removed}개 제거`}`);
      console.log(`work history: ${workHistoryYear.rel}${workHistoryYear.created ? ' 생성' : ' 준비됨'}`);
      console.log(`install manifest: ${opts.dryRun ? 'dry-run' : `${Object.keys(writtenManifest.managedFiles).length}개 managed file 기록`}`);
      console.log(`harness lock: ${opts.dryRun ? 'dry-run' : `${writtenLock.baseHarness.version} (${writtenLock.baseHarness.ref ?? writtenLock.baseHarness.source.type})`}`);
      if (opts.retiredFlagsUsed) {
        console.log(`retired flags (무시됨): ${opts.retiredFlagsUsed.join(', ')}`);
      }
      console.log(`hooks: ${diagnostics.hooks}`);
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
      } else {
        const retiredNotice = renderRetiredScriptsNotice(pkg.retired);
        if (retiredNotice) console.log(`  - ${retiredNotice}`);
      }
      if (['updated', 'partial', 'manual'].includes(eslintPatch.status)) {
        console.log(`  - eslint config: ${eslintPatch.message}`);
      }
      for (const patch of lintIgnorePatches.filter((item) => item.status !== 'already')) {
        console.log(`  - lint ignore: ${patch.rel} ${patch.status === 'manual' ? '자동 수정 불가 — .harness/** 수동 추가 필요' : '.harness 제외 반영'}`);
      }
      if (claudeSettings.skipped === 'symlink') {
        console.log('.claude/settings.json: 자리가 심볼릭 링크라 하네스 훅 병합을 건너뜀 — 하네스는 링크 너머를 쓰지 않습니다. 링크를 정리한 뒤 다시 실행하세요.');
      } else if (claudeSettings.skipped === 'parse-error') {
        console.log('  - .claude/settings.json JSON 손상으로 하네스 안전 훅 병합을 건너뛰었습니다. 파일을 고친 뒤 init/update를 다시 실행하세요.');
      }
      if (migration.removed > 0) {
        console.log(`  - legacy root scripts: ${migration.removed}개 제거`);
      }
      if (diagnostics.hooks === 'ok') {
        console.log('  - git hook을 활성화했습니다 (이 clone 기준). 새로 clone한 팀원은 세션을 열면 하네스가 자동으로 켜고 알려줍니다 — 손으로 hooks:install 할 필요가 없습니다.');
      } else if (diagnostics.hooks === 'failed') {
        console.log('  - git hook 자동 활성화에 실패했습니다. .harness/bin/harness hooks:install로 직접 실행해 원인을 확인하세요.');
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
      console.log('이 내역은 나중에 .harness/bin/harness changelog 로 다시 볼 수 있습니다.');
    }

    const foreignPreserved = installed.preservedForeignFiles ?? [];
    const readopted = installed.readoptedFiles ?? [];
    const nonRegular = installed.nonRegularSkipped ?? [];
    const ordinarySkipped = installed.skippedFiles.filter((rel) => !foreignPreserved.includes(rel) && !readopted.includes(rel) && !nonRegular.includes(rel));
    if (ordinarySkipped.length > 0) {
      console.log('');
      console.log('보존된 프로젝트 소유 파일:');
      for (const rel of ordinarySkipped.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (ordinarySkipped.length > 15) {
        console.log(`  ... 외 ${ordinarySkipped.length - 15}건`);
      }
      console.log('모두 덮어쓰려면 --force를 사용하세요.');
    }
    if (installed.replacedHooks && installed.replacedHooks.length > 0) {
      console.log('');
      console.log(`같은 이름의 기존 훅 ${installed.replacedHooks.length}개를 하네스 원본으로 교체했습니다(--replace-hook):`);
      for (const item of installed.replacedHooks) console.log(`  - ${item.rel}  (기존 파일 → ${item.backup})`);
      console.log('  개인 훅으로 계속 쓰려면 보관 파일을 <이름>.local.sh 로 옮겨 .claude/settings.local.json 에 등록하세요.');
    }
    if (installed.replacedFiles && installed.replacedFiles.length > 0) {
      console.log('');
      console.log(`기존 파일 ${installed.replacedFiles.length}개를 하네스 원본으로 ${opts.dryRun ? '교체합니다(dry-run — 실제 실행 시)' : '교체했습니다'}(--replace-file):`);
      for (const item of installed.replacedFiles) console.log(`  - ${item.rel}  (기존 파일 → ${item.backup})`);
    }
    if (nonRegular.length > 0) {
      console.log('');
      console.log(`일반 파일이 아니라 건너뛴 대상 ${nonRegular.length}개 (심볼릭 링크·디렉터리·끊어진 링크) — 하네스는 링크 너머를 쓰지 않습니다:`);
      for (const rel of nonRegular) console.log(`  - ${rel}`);
      console.log('  링크나 폴더를 직접 정리한 뒤 다시 실행하세요. --force 나 --replace-file 로는 풀리지 않습니다.');
    }
    if (installed.readoptedFiles && installed.readoptedFiles.length > 0) {
      console.log('');
      console.log(`하네스 원본과 같은 내용이 된 파일 ${installed.readoptedFiles.length}개를 다시 관리 대상으로 들였습니다(내용 변경 없음 — 다음 업데이트부터 함께 갱신됩니다):`);
      for (const rel of installed.readoptedFiles) console.log(`  - ${rel}`);
    }
    if (foreignPreserved.length > 0) {
      // 경고는 stderr — init 이 성공 단계의 stdout 을 접어도 살아남아 에이전트가 "정상"으로 넘기지 못하게(#14 방식).
      console.warn('');
      console.warn(`⚠ 하네스 원본과 다른 같은 이름의 기존 파일 ${foreignPreserved.length}개를 보존했습니다 — 하네스가 갱신하지 않으며 manifest 에 현황(preservedForeignFiles)으로 기록됩니다:`);
      for (const rel of foreignPreserved.slice(0, 15)) {
        const isHook = rel.startsWith('.claude/hooks/') && rel.endsWith('.sh');
        const registryLocal = rel.endsWith('policy/policy-registry.json') ? 'policy-registry.local.json'
          : rel.endsWith('documentation/document-registry.json') ? 'document-registry.local.json' : null;
        const arrow = isHook
          ? '  ← 훅 자리: 팀 .claude/settings.json 이 이 파일을 실행합니다(--keep-hook 으로 유지). 원본으로 바꾸려면 --replace-hook ' + hookBaseName(rel)
          : registryLocal
            ? `  ← 프로젝트 항목은 ${registryLocal}(프로젝트 소유)으로 옮기고, 원본으로 되돌리려면 --replace-file ${rel}`
            : '';
        console.warn(`  - ${rel}${arrow}`);
      }
      if (foreignPreserved.length > 15) console.warn(`  ... 외 ${foreignPreserved.length - 15}건`);
    }
    if (!opts.dryRun) {
      warnIgnoredSharedOutputs(TARGET, installed, recognizedManifest);
    }

    // 안전망 후처리 리포트: 로컬 수정 감지된 managed 파일을 명시적으로 보고한다.
    // CLAUDE.md/AGENTS.md를 비롯한 하이브리드 managed 파일이 base 업데이트로 조용히 사라지지 않도록
    // 매번 표면에 띄우는 것이 안전망의 핵심이다.
    if (installed.preservedLocallyModified && installed.preservedLocallyModified.length > 0) {
      console.log('');
      // 0.2.109 문구 정정: 여기 오는 파일은 마커 하이브리드(CLAUDE.md 등)가 아니라 순수 하네스 코드다.
      // 마커 파일은 위쪽 머지 경로에서 처리되므로 이 목록에 오지 않는다. 즉 이 목록은 "안전망이 잘 돌았다"가
      // 아니라 "이 파일들은 이번에도, 그리고 앞으로도 갱신되지 않는다"는 뜻이다. 실증(multisite): 이 목록을
      // 안전망 작동으로 읽는 바람에 10개 파일이 여러 버전 동안 동결됐고 post-merge hook 지원이 빠져 있었다.
      console.log(`⚠ 갱신하지 못한 하네스 파일 ${installed.preservedLocallyModified.length}건 — 설치 기록과 내용이 다릅니다.`);
      for (const rel of installed.preservedLocallyModified.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.preservedLocallyModified.length > 15) {
        console.log(`  ... 외 ${installed.preservedLocallyModified.length - 15}건`);
      }
      console.log('이 파일들은 프로젝트가 소유한 파일이 아니라 하네스 본체 코드입니다. 덮어쓰지 않고 건너뛰었으므로');
      console.log('그대로 두면 이번 업데이트뿐 아니라 앞으로의 모든 업데이트에서도 계속 제외됩니다.');
      console.log('가장 흔한 원인은 lint/formatter가 .harness/를 대상에 포함하는 것입니다.');
      console.log('  1) lint·formatter 설정에서 .harness/**를 제외하세요(eslint globalIgnores, .oxlintrc.json ignorePatterns, .prettierignore).');
      console.log('  2) 그다음 원본으로 되돌리세요: .harness/bin/harness update --resync-managed');
      console.log('     (managed 파일만 되돌립니다. spec-map.md·profile.json 같은 프로젝트 소유 파일은 건드리지 않습니다.)');
    }

    if (installed.resyncedManaged && installed.resyncedManaged.length > 0) {
      console.log('');
      console.log(`본체 원본으로 되돌린 하네스 파일 ${installed.resyncedManaged.length}건 (--resync-managed):`);
      for (const rel of installed.resyncedManaged.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.resyncedManaged.length > 15) {
        console.log(`  ... 외 ${installed.resyncedManaged.length - 15}건`);
      }
      console.log('프로젝트 소유 파일은 건드리지 않았습니다. 되돌린 내용은 git diff로 확인하세요.');
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

    if (installed.prependedMarkerFiles && installed.prependedMarkerFiles.length > 0) {
      console.log('');
      console.log('프로젝트가 이미 갖고 있던 진입점 문서 위에 하네스 읽기 순서 블록을 얹었습니다 (기존 내용은 그대로 아래에 남아 프로젝트 영역이 됩니다):');
      for (const rel of installed.prependedMarkerFiles.slice(0, 15)) {
        console.log(`  - ${rel}`);
      }
      if (installed.prependedMarkerFiles.length > 15) {
        console.log(`  ... 외 ${installed.prependedMarkerFiles.length - 15}건`);
      }
      console.log('  할 일은 없습니다. 파일을 열어 위(하네스 블록)·아래(프로젝트 내용) 배치만 확인하세요. 다음 업데이트부터는 블록 안만 갱신됩니다.');
      console.log('  기존 내용에 규칙 본문(아키텍처 경계·도메인 규칙·커밋 규칙 등)이 있으면 하네스 룰 문서(.harness/project/*)로 옮길 수 있습니다 — 에이전트에게 「CLAUDE.md의 규칙을 하네스 문서로 마이그레이션해줘」라고 하세요. 옮기면 그 폴더를 고칠 때 검사가 해당 규칙을 짚어주고, CLAUDE.md는 "어디를 읽어라"만 남아 가벼워집니다. 시점은 팀이 정합니다.');
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

    if (seedOnlyCleanup.retiredRemoved.length > 0) {
      console.log('');
      console.log('예전 버전이 설치했지만 지금은 은퇴한 하네스 파일을 정리했습니다:');
      for (const rel of seedOnlyCleanup.retiredRemoved) {
        console.log(`  - ${rel}`);
      }
    }

    if (seedOnlyCleanup.retiredPreserved.length > 0) {
      console.log('');
      console.log('은퇴한 하네스 파일이지만 로컬 수정 흔적이 있어 보존했습니다 (이제 이 프로젝트 소유입니다):');
      for (const rel of seedOnlyCleanup.retiredPreserved) {
        console.log(`  - ${rel}`);
      }
      console.log('계속 쓰려면 .harness/documentation/document-registry.local.json에 등록하고, 불필요하면 직접 삭제하세요.');
    }

    if (staleNotesMigrated) {
      console.log('');
      console.log('profile.json notes의 낡은 harnessMode 안내를 갱신했습니다 (maintenance 은퇴 반영 — 다른 필드는 그대로).');
    }

    const bridgeCandidates = detectBridgeCandidates(TARGET, installed.skippedFiles);
    if (bridgeCandidates.length > 0) {
      console.log('');
      console.log('브리지 섹션 추가 후보:');
      for (const rel of bridgeCandidates) {
        console.log(`  - ${rel}`);
      }
      console.log('기존 전용 하네스를 보존했기 때문에 위 파일은 건드리지 않았습니다. 하네스 읽기 순서를 연결하려면 에이전트에게 「CLAUDE.md에 하네스 읽기 순서를 연결해줘」라고 하세요(공통 하네스 블록을 위에 얹고 기존 내용은 아래에 둡니다).');
      console.log('기준 계층과 충돌 후보는 .harness/bin/harness scan 결과를 확인하세요.');
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
  - 보존된 프로젝트 소유/로컬 수정 파일: ${installed.skipped + projectState.preserved}개${(installed.preservedForeignFiles?.length ?? 0) > 0 ? ` (그중 하네스 원본과 다른 동명 파일 ${installed.preservedForeignFiles.length}개 — 위 ⚠ 참조: ${installed.preservedForeignFiles.join(', ')})` : ''}
  - package.json 주입 별칭: 0개 (모든 하네스 명령은 .harness/bin/harness 런처)${renderRetiredScriptsNotice(pkg.retired) ? `\n  - ${renderRetiredScriptsNotice(pkg.retired)}` : ''}
  - 스택 기준은 나중에 추가할 수 있습니다.
  - 단순 운영 건이면 지금 상태로 작업을 시작해도 됩니다.
`);
    if (!recognizedManifest) {
      // 다음 단계·문서 목록은 최초 설치용이다(club-admin #25, 2026-09-08): 스택 확인·훅 활성화·제거 계획은
      // 이미 설치된 프로젝트엔 해당 없고 "제거 계획"은 업데이트 직후 안내로는 방향이 반대다. 0.2.144의
      // 다이어트는 아래 "소비자 명령 빠른 안내"만 감쌌고 이 32줄은 밖에 있었다. 현재 상태(버전·갱신/보존 수)는
      // 업데이트에서도 확인 가치가 있어 남긴다 — 팀들이 "project-owned가 보존됐나"를 그 줄로 본다.
      console.log(`
::: 다음 단계 :::
${renderNodeStep(TARGET)}
  1) 현재 상태를 브라우저로 확인
       .harness/bin/harness guide --open
  2) 자동 생성된 프로젝트 스캔/인수인계 확인
       .harness/session/project-scan-report.md
       .harness/session/handoff.md
  3) 필요하면 현재 프로젝트에 맞는 스택 기준 확인
       .harness/bin/harness standards:list
       .harness/bin/harness stack:status
  4) 맞는 스택 기준이 있으면 해당 스택 하네스의 init 명령을 실행
       예: npx -y git+<스택-저장소>#<tag> init
            (주소는 3)의 standards:list 출력에 나옵니다 — 본체는 특정 스택 주소를 들고 있지 않습니다)
  5) 팀 기준으로 남길 판단이 생기면 기록
       .harness/session/decision-log.md
       또는 판단이 필요하면 .harness/session/developer-input-queue.md
  5-1) 설치 결과 리포트 — 이 출력 맨 끝의 "::: 설치 결과 리포트 :::"를 보고 사용자에게 꼭 물어봅니다
  6) 필요하면 scaffold 템플릿 후보 조회 후 적용
       .harness/bin/harness templates:list
       .harness/bin/harness template:apply --preset-git <repo-url> --ref <tag-or-branch>
${renderHookStep(TARGET, 7, diagnostics.hooks)}
  8) 작업 완료 전 검증
       .harness/bin/harness check
  9) 설치를 되돌려야 하면 먼저 제거 계획 확인
       .harness/bin/harness uninstall

::: 문서 :::
  - CLAUDE.md
  - AGENTS.md
  - .claude/README.md
  - .github/copilot-instructions.md
  - .harness/project/bootstrap.md
`);
    }
    if (recognizedManifest) {
      // 출력 다이어트(0.2.139)는 update-harness의 꼬리말만 줄였고 이 블록은 업데이트마다 그대로 찍혔다
      // (scorecard #22 실측 293줄). 전체 안내는 최초 설치와 런처(무인자)가 담당한다.
      console.log('');
      console.log('명령 전체 목록: .harness/bin/harness (인자 없이 실행)');
    } else {
      printConsumerCommandGuide(TARGET);
    }
    printInstallReportPrompt();
  } finally {
    cleanupSource(sourceRoot, sourceIsTemp);
  }
}

main();
