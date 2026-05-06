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
const MIN_NODE_MESSAGE = 'harness-seed requires Node.js >=20.19.0 or >=22.13.0.';
const MANIFEST_PATH = '.harness/install-manifest.json';
const LOCK_PATH = '.harness/harness-lock.json';

const INSTALL_ITEMS = [
  '.harness',
  '.claude',
  '.github/copilot-instructions.md',
  '.github/copilot-instructions',
  '.github/workflows',
  'scripts/apply-stack.mjs',
  'scripts/guard.mjs',
  'scripts/install-hooks.mjs',
  'scripts/policy-harness.mjs',
  'scripts/doc-link-check.mjs',
  'scripts/absorb-project.mjs',
  'scripts/list-stack-standards.mjs',
  'scripts/list-templates.mjs',
  'scripts/outdated-harness.mjs',
  'scripts/update-harness.mjs',
  'scripts/check-node-version.mjs',
  'scripts/check-seed-mode.mjs',
  '.githooks',
  '.nvmrc',
  'AGENTS.md',
  'CLAUDE.md',
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
  '.harness/project/domain-rules.md',
  '.harness/project/architecture-rules.md',
  '.harness/project/workflow-rules.md',
  '.harness/session/active-context.md',
  '.harness/session/decision-log.md',
  '.harness/session/developer-input-queue.md',
  '.harness/session/next-session-reminder.md',
  '.harness/session/project-memory.md',
  '.claude/settings.local.json',
  'CLAUDE.local.md',
]);

const PROJECT_OWNED_PREFIXES = [
  '.harness/session/memory/',
  '.harness/session/evolved/',
  '.claude/rules/project/',
  '.claude/skills/project-',
  '.claude/agents/project-',
];

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

function printUsageAndExit(code = 0) {
  console.log(`Usage:
  npx -y git+<seed-repo-url>#<tag> init [options]

Options:
  --dry-run              변경 없이 설치 계획만 출력합니다.
  --force                프로젝트 소유 파일까지 덮어씁니다.
  --no-backup            백업을 만들지 않습니다. 기존 항목이 있으면 --force가 필요합니다.
  --no-doctor            설치 후 프로젝트 진단 리포트를 자동 생성하지 않습니다.
  --no-check             설치 후 하네스 기본 검사를 자동 실행하지 않습니다.
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
    noBackup: false,
    noDoctor: false,
    noCheck: false,
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
      case '--no-backup':
        opts.noBackup = true;
        break;
      case '--no-doctor':
        opts.noDoctor = true;
        break;
      case '--no-check':
        opts.noCheck = true;
        break;
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
        files.push(toPosix(relative(sourceRoot, file)));
      }
      continue;
    }

    files.push(toPosix(item));
  }

  return [...new Set(files)].filter((file) => !file.endsWith('scripts/init.mjs'));
}

function isProjectOwned(relPath) {
  const rel = toPosix(relPath);
  if (rel === MANIFEST_PATH) return false;
  return PROJECT_OWNED_PATHS.has(rel) || PROJECT_OWNED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function isManagedByManifest(manifest, relPath) {
  return Boolean(manifest && manifest.managedFiles && manifest.managedFiles[toPosix(relPath)]);
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

  for (const rel of files) {
    const src = join(sourceRoot, rel);
    const dest = join(target, rel);
    const exists = existsSync(dest);
    const projectOwned = isProjectOwned(rel);
    const managed = isManagedByManifest(manifest, rel);
    const shouldCopy = !exists || opts.force || (!projectOwned && managed);

    if (opts.dryRun) {
      console.log(`[dry-run] ${!exists ? 'add' : shouldCopy ? 'update' : 'preserve'} ${rel}`);
    } else if (shouldCopy) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }

    if (!exists) {
      stats.added++;
      copiedFiles.push(rel);
    } else if (shouldCopy) {
      stats.updated++;
      copiedFiles.push(rel);
    } else {
      stats.skipped++;
      skippedFiles.push(rel);
    }
  }

  return { ...stats, skippedFiles, copiedFiles };
}

function buildInstallManifest(sourceRoot, target, files, copiedFiles, opts) {
  const seedPkg = readJson(join(sourceRoot, 'package.json'), {})
  const managedFiles = {}
  const projectOwnedFiles = files.filter((rel) => isProjectOwned(rel)).sort()
  const source = buildSourceMetadata(sourceRoot, opts, seedPkg)

  for (const rel of copiedFiles) {
    const abs = join(target, rel)
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      continue
    }

    managedFiles[rel] = {
      sha256: sha256(abs),
    }
  }

  return {
    tool: 'harness-seed',
    version: seedPkg.version || '0.0.0',
    installedAt: new Date().toISOString(),
    source,
    manifestVersion: 2,
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
  const ref = opts.fromGit ? opts.ref : opts.sourceRef
  const commit = opts.sourceCommit ?? (opts.fromGit ? gitOutput(sourceRoot, ['rev-parse', 'HEAD']) : null)
  const packageVersion = seedPkg.version || '0.0.0'

  return {
    type: repo ? 'git' : 'bundled',
    repo,
    ref: ref ?? null,
    commit,
    packageVersion,
    spec: repo ? `${repo}${ref ? `#${ref}` : ''}` : 'bundled',
  }
}

function writeInstallManifest(sourceRoot, target, files, copiedFiles, opts) {
  if (opts.dryRun) return null

  const manifest = buildInstallManifest(sourceRoot, target, files, copiedFiles, opts)
  const manifestAbs = join(target, MANIFEST_PATH)
  mkdirSync(dirname(manifestAbs), { recursive: true })
  writeFileSync(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function writeHarnessLock(target, installManifest, opts) {
  if (opts.dryRun) return null

  const lockAbs = join(target, LOCK_PATH)
  const previous = readJson(lockAbs, {})
  const source = installManifest.source ?? {}
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
  }

  mkdirSync(dirname(lockAbs), { recursive: true })
  writeFileSync(lockAbs, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

function readJson(absPath, fallback) {
  if (!existsSync(absPath)) return fallback;
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

function mergePackageJson(sourceRoot, target, opts) {
  const pkgPath = join(target, 'package.json');
  let userPkg;
  let created = false;

  if (!existsSync(pkgPath)) {
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
  for (const [key, value] of Object.entries(seedPkg.scripts || {})) {
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

  return { added, skipped, created };
}

function mergeGitignore(target, opts) {
  const gitignorePath = join(target, '.gitignore');
  const entries = [
    'node_modules/',
    'dist/',
    '.env',
    '.env.local',
    '.env.*.local',
    '.node-version.cache',
    '.package-json.hash',
    '.harness/.stack-applied.json',
    '.harness/session/absorb-report.md',
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

function ensureExecutable(target, opts) {
  if (opts.dryRun) return;
  for (const dir of [join(target, '.githooks'), join(target, '.claude', 'hooks')]) {
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir)) {
      if (/\.(sh|mjs|js|py)$/.test(file)) {
        try {
          chmodSync(file, 0o755);
        } catch {
          // 권한 보정 실패는 치명적이지 않다.
        }
      }
    }
  }
}

function runPostInstallStep(target, title, commandArgs) {
  console.log('');
  console.log(title);
  console.log(`$ ${commandArgs.join(' ')}`);

  const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
    cwd: target,
    stdio: 'inherit',
  });

  return result.status === 0;
}

function runPostInstallDiagnostics(target, opts) {
  if (opts.dryRun) {
    return { doctor: 'skipped', check: 'skipped' };
  }

  const result = { doctor: 'skipped', check: 'skipped' };

  if (!opts.noDoctor) {
    result.doctor = runPostInstallStep(
      target,
      '자동 진단: 현재 프로젝트 분석 리포트 생성',
      [process.execPath, 'scripts/absorb-project.mjs', '--write'],
    ) ? 'ok' : 'failed';
  }

  if (!opts.noCheck) {
    result.check = runPostInstallStep(
      target,
      '자동 검사: 하네스 설치 상태 확인',
      [process.execPath, 'scripts/guard.mjs'],
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

  const sourceRoot = opts.fromGit ? fetchFromGit(opts.fromGit, opts.ref) : BUNDLED_SOURCE_ROOT;
  const sourceIsTemp = Boolean(opts.fromGit);

  try {
    console.log(`harness-seed: harness 설치 시작 -> ${TARGET}`);
    console.log(`source: ${opts.fromGit ? `${opts.fromGit}#${opts.ref}` : 'bundled'}`);
    if (opts.dryRun) console.log('mode: dry-run');
    console.log('');

    const files = collectInstallFiles(sourceRoot);
    const existingManifest = readJson(join(TARGET, MANIFEST_PATH), null);
    const recognizedManifest = existingManifest && existingManifest.tool === 'harness-seed' ? existingManifest : null;
    const externalHarnessMode = !recognizedManifest && hasHarnessLikeFiles(TARGET);

    if (externalHarnessMode) {
      console.log('기존 하네스가 있지만 harness-seed install manifest는 없습니다.');
      console.log('전용 하네스일 수 있어 기존 파일은 기본적으로 보존합니다. 덮어쓰려면 --force를 사용하세요.');
      console.log('');
    }

    if (!opts.noBackup) {
      const backup = backupExisting(TARGET, files, opts.dryRun);
      if (backup.count > 0) {
        console.log(`backup: ${backup.dir} (${backup.count}개 기존 파일)`);
      } else {
        console.log('backup: 기존 하네스 파일 없음');
      }
      console.log('');
    }

    const installed = installFiles(sourceRoot, TARGET, files, opts, recognizedManifest);
    const pkg = mergePackageJson(sourceRoot, TARGET, opts);
    const gitignoreAdded = mergeGitignore(TARGET, opts);
    ensureExecutable(TARGET, opts);
    const writtenManifest = writeInstallManifest(sourceRoot, TARGET, files, installed.copiedFiles, opts);
    const writtenLock = writtenManifest ? writeHarnessLock(TARGET, writtenManifest, opts) : null;
    const diagnostics = runPostInstallDiagnostics(TARGET, opts);

    console.log('');
    console.log(`files: ${installed.added}개 추가, ${installed.updated}개 갱신, ${installed.skipped}개 보존`);
    console.log(
      `package.json: ${pkg.created ? '신규 생성, ' : ''}scripts ${pkg.added}개 추가` +
        (pkg.skipped.length ? `, 기존 scripts 보존 ${pkg.skipped.length}개 (${pkg.skipped.join(', ')})` : ''),
    );
    console.log(`.gitignore: harness entry ${gitignoreAdded}개 추가`);
    console.log(`install manifest: ${opts.dryRun ? 'dry-run' : `${Object.keys(writtenManifest.managedFiles).length}개 managed file 기록`}`);
    console.log(`harness lock: ${opts.dryRun ? 'dry-run' : `${writtenLock.baseHarness.version} (${writtenLock.baseHarness.ref ?? writtenLock.baseHarness.source.type})`}`);
    console.log(`doctor: ${diagnostics.doctor}`);
    console.log(`check: ${diagnostics.check}`);

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

    const bridgeCandidates = detectBridgeCandidates(TARGET, installed.skippedFiles);
    if (bridgeCandidates.length > 0) {
      console.log('');
      console.log('브리지 섹션 추가 후보:');
      for (const rel of bridgeCandidates) {
        console.log(`  - ${rel}`);
      }
      console.log('기존 개인/전용 룰을 보존했기 때문에, 위 파일에 .harness 읽기 순서를 연결할지 검토하세요.');
      console.log('기준 계층과 충돌 후보는 npm run harness:doctor 결과를 확인하세요.');
    }

    console.log(`
하네스 설치 완료

다음 단계:
  1) 자동 생성된 프로젝트 진단 리포트 확인
       .harness/session/absorb-report.md
  2) git hook 활성화
       npm run hooks:install
  3) 스택 기준 선택, 필요하면 scaffold 템플릿 후보 조회 후 적용
       npm run stack:status
       npm run standards:list
       npm run templates:list
       npm run stack:apply -- --preset-git <repo-url> --ref <tag-or-branch>
  4) 작업 중간에 다시 검사
       npm run harness:check

문서:
  - CLAUDE.md
  - AGENTS.md
  - .claude/README.md
  - .github/copilot-instructions.md
  - .harness/project/bootstrap.md
`);
  } finally {
    cleanupSource(sourceRoot, sourceIsTemp);
  }
}

main();
