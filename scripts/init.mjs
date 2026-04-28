#!/usr/bin/env node
/**
 * harness-seed init: 기존 프로젝트에 harness만 설치한다.
 *
 * 사용법 (외부 프로젝트의 루트에서):
 *   npx -y git+<seed-repo-url>#<tag> init
 *
 * 동작:
 *  - .harness/ 하네스 본체를 복사한다.
 *  - .github/ 는 Copilot shim과 workflows만 복사한다.
 *    ISSUE_TEMPLATE/ pull_request_template.md / commit-template.txt 는 프로젝트마다 다르므로 제외.
 *  - scripts/*.mjs (apply-stack, guard, policy-harness, doc-link-check,
 *    install-hooks, check-node-version, check-seed-mode) 복사. init.mjs 자체는 제외.
 *  - .githooks/ 복사.
 *  - .nvmrc 복사(이미 있으면 보존).
 *  - 사용자 package.json scripts 에 harness 명령을 머지(기존 키는 보존).
 *  - .harness-seed-mode 마커는 절대 설치하지 않는다(사용자는 시드가 아님).
 *  - 이미 존재하는 파일은 덮어쓰지 않고 건너뛴 뒤 끝에 보고한다.
 */

import { fileURLToPath } from 'url';
import {
  dirname,
  join,
  relative,
  resolve as pathResolve,
} from 'path';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE_ROOT = pathResolve(__dirname, '..'); // 패키지 루트(= harness-seed repo)
const TARGET = process.cwd();
const MIN_NODE_MESSAGE = 'harness-seed requires Node.js >=20.19.0 or >=22.13.0.';

function parseNodeVersion(version) {
  const parts = version.split('.').map((part) => Number(part));
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
  };
}

function isSupportedNode(version) {
  if (version.major > 22) return true;
  if (version.major === 22) return version.minor >= 13;
  if (version.major === 20) return version.minor >= 19;
  return false;
}

const nodeVersion = parseNodeVersion(process.versions.node);
if (!isSupportedNode(nodeVersion)) {
  console.error('');
  console.error(`${MIN_NODE_MESSAGE} Current: ${process.version}`);
  console.error('');
  console.error('Recommended: nvm install && nvm use');
  console.error('Run init again after switching Node.');
  process.exit(1);
}

// .github/ 아래에서 복사할 플랫폼/에이전트 어댑터(허용 리스트)
const GITHUB_INCLUDE = [
  'copilot-instructions.md',
  'copilot-instructions',
  'workflows', // harness CI (policy-guard.yml). 사용자 충돌 시 자동 skip.
];

// scripts/ 아래에서 복사할 파일(허용 리스트). init.mjs 자체는 제외.
const SCRIPTS_INCLUDE = [
  'apply-stack.mjs',
  'guard.mjs',
  'install-hooks.mjs',
  'policy-harness.mjs',
  'doc-link-check.mjs',
  'check-node-version.mjs',
  'check-seed-mode.mjs',
];

const ROOT_INCLUDE = [
  '.nvmrc',
  'AGENTS.md',
  'CLAUDE.md',
];

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function copyOne(srcAbs, dstAbs, conflicts) {
  if (existsSync(dstAbs)) {
    conflicts.push(relative(TARGET, dstAbs));
    return false;
  }
  mkdirSync(dirname(dstAbs), { recursive: true });
  copyFileSync(srcAbs, dstAbs);
  return true;
}

function copyPath(relFromSource, conflicts) {
  const srcAbs = join(SOURCE_ROOT, relFromSource);
  if (!existsSync(srcAbs)) return 0;
  let copied = 0;
  let isDirectory = false;
  try {
    readdirSync(srcAbs);
    isDirectory = true;
  } catch {
    isDirectory = false;
  }
  if (isDirectory) {
    for (const f of walkFiles(srcAbs)) {
      const rel = relative(SOURCE_ROOT, f);
      if (copyOne(f, join(TARGET, rel), conflicts)) copied++;
    }
  } else {
    if (copyOne(srcAbs, join(TARGET, relFromSource), conflicts)) copied++;
  }
  return copied;
}

function mergePackageJson() {
  const pkgPath = join(TARGET, 'package.json');
  let userPkg;
  let created = false;
  if (!existsSync(pkgPath)) {
    created = true;
    userPkg = { name: 'my-project', private: true, type: 'module', scripts: {} };
  } else {
    userPkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  }
  const seedPkg = JSON.parse(readFileSync(join(SOURCE_ROOT, 'package.json'), 'utf8'));
  userPkg.scripts = userPkg.scripts || {};
  let added = 0;
  const skipped = [];
  for (const [k, v] of Object.entries(seedPkg.scripts || {})) {
    if (userPkg.scripts[k] !== undefined) {
      if (userPkg.scripts[k] !== v) skipped.push(k);
      continue;
    }
    userPkg.scripts[k] = v;
    added++;
  }
  writeFileSync(pkgPath, JSON.stringify(userPkg, null, 2) + '\n');
  return { added, skipped, created };
}

function mergeGitignore() {
  const gitignorePath = join(TARGET, '.gitignore');
  const entries = [
    'node_modules/',
    'dist/',
    '.env',
    '.env.local',
    '.env.*.local',
    '.node-version.cache',
    '.package-json.hash',
    '.vite.pid',
    '.harness/.stack-applied.json',
    '.harness-backup/',
  ];

  let current = '';
  if (existsSync(gitignorePath)) {
    current = readFileSync(gitignorePath, 'utf8');
  }

  const lines = current.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));

  if (missing.length === 0) {
    return 0;
  }

  const prefix = current.trim() ? `${current.replace(/\s*$/, '')}\n\n` : '';
  writeFileSync(gitignorePath, `${prefix}# harness-seed generated artifacts\n${missing.join('\n')}\n`);
  return missing.length;
}

function printUsageAndExit(code = 0) {
  console.log(`Usage:
  npx -y git+<seed-repo-url>#<tag> init

기존 프로젝트 루트에서 실행하세요. 하네스(.harness/, scripts/, .githooks/, package.json scripts) 만 설치합니다.
`);
  process.exit(code);
}

const cmd = process.argv[2];
if (!cmd) printUsageAndExit(0);
if (cmd !== 'init') {
  console.error(`알 수 없는 명령: ${cmd}`);
  printUsageAndExit(1);
}

console.log(`harness-seed: harness 설치 시작 → ${TARGET}\n`);

if (!existsSync(join(TARGET, '.git'))) {
  console.warn('⚠ .git 이 없습니다. git 저장소에서 사용하길 권장합니다.\n');
}

const conflicts = [];
let copied = 0;

// .harness/ 본체
copied += copyPath('.harness', conflicts);

// .github/ allow-list
for (const name of GITHUB_INCLUDE) {
  copied += copyPath(join('.github', name), conflicts);
}
// scripts/ allow-list
for (const name of SCRIPTS_INCLUDE) {
  copied += copyPath(join('scripts', name), conflicts);
}
// .githooks/ 통째로
copied += copyPath('.githooks', conflicts);
for (const name of ROOT_INCLUDE) {
  copied += copyPath(name, conflicts);
}

const pkg = mergePackageJson();
const gitignoreAdded = mergeGitignore();

console.log(`복사한 파일: ${copied}개`);
console.log(
  `package.json: ${pkg.created ? '신규 생성, ' : ''}scripts ${pkg.added}개 추가` +
    (pkg.skipped.length ? `, 충돌로 보존 ${pkg.skipped.length}개 (${pkg.skipped.join(', ')})` : ''),
);
console.log(`.gitignore: harness entry ${gitignoreAdded}개 추가`);
if (conflicts.length) {
  console.log(`\n이미 존재해 건너뛴 파일 ${conflicts.length}개:`);
  for (const c of conflicts.slice(0, 15)) console.log('  -', c);
  if (conflicts.length > 15) console.log(`  ... 외 ${conflicts.length - 15}건`);
  console.log('덮어쓰려면 해당 파일을 먼저 지우고 다시 실행하세요.');
}

console.log(`
✅ 하네스 설치 완료

다음 단계:
  1) git hook 활성화
       npm run hooks:install
  2) (선택) 스택 프리셋 적용
       ls .harness/stacks                       # 사용 가능한 스택 확인
       npm run stack:apply -- <stack-id>
  3) 정책↔코드↔문서 동기화 검증
       npm run guard

문서:
  - CLAUDE.md                                  # 기준 AI 에이전트 진입점
  - AGENTS.md                                  # 보조 AI 에이전트 shim
  - .github/copilot-instructions.md            # GitHub Copilot shim
  - .harness/project/bootstrap.md              # 새 프로젝트 부트스트랩 절차
  - README.md                                  # 설치/운영 개요
`);
