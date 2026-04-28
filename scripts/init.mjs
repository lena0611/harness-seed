#!/usr/bin/env node
/**
 * harness-seed init: 기존 프로젝트에 harness를 설치/업데이트한다.
 *
 * 기본 동작:
 *  - 하네스 소유 파일은 업데이트한다.
 *  - 프로젝트 소유 파일은 이미 있으면 보존한다.
 *  - 기존 항목이 있으면 .harness-backup/<timestamp>/ 아래에 먼저 백업한다.
 */

import { spawnSync } from 'node:child_process';
import {
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
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import {
  dirname,
  join,
  relative,
  resolve as pathResolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUNDLED_SOURCE_ROOT = pathResolve(__dirname, '..');
const TARGET = process.cwd();
const MIN_NODE_MESSAGE = 'harness-seed requires Node.js >=20.19.0 or >=22.13.0.';

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
  --from-git <repo-url>  동봉본 대신 git 저장소에서 소스를 가져옵니다.
  --ref <ref>            --from-git과 함께 사용할 branch/tag/sha입니다. 기본값: main
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
    fromGit: null,
    ref: 'main',
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
  return PROJECT_OWNED_PATHS.has(rel) || PROJECT_OWNED_PREFIXES.some((prefix) => rel.startsWith(prefix));
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

function installFiles(sourceRoot, target, files, opts) {
  const stats = { added: 0, updated: 0, skipped: 0 };
  const skippedFiles = [];

  for (const rel of files) {
    const src = join(sourceRoot, rel);
    const dest = join(target, rel);
    const exists = existsSync(dest);
    const projectOwned = isProjectOwned(rel);
    const shouldCopy = !exists || opts.force || !projectOwned;

    if (opts.dryRun) {
      console.log(`[dry-run] ${!exists ? 'add' : shouldCopy ? 'update' : 'preserve'} ${rel}`);
    } else if (shouldCopy) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }

    if (!exists) {
      stats.added++;
    } else if (shouldCopy) {
      stats.updated++;
    } else {
      stats.skipped++;
      skippedFiles.push(rel);
    }
  }

  return { ...stats, skippedFiles };
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
    '.vite.pid',
    '.harness/.stack-applied.json',
    '.harness-backup/',
    'CLAUDE.local.md',
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

    if (!opts.noBackup) {
      const backup = backupExisting(TARGET, files, opts.dryRun);
      if (backup.count > 0) {
        console.log(`backup: ${backup.dir} (${backup.count}개 기존 파일)`);
      } else {
        console.log('backup: 기존 하네스 파일 없음');
      }
      console.log('');
    }

    const installed = installFiles(sourceRoot, TARGET, files, opts);
    const pkg = mergePackageJson(sourceRoot, TARGET, opts);
    const gitignoreAdded = mergeGitignore(TARGET, opts);
    ensureExecutable(TARGET, opts);

    console.log('');
    console.log(`files: ${installed.added}개 추가, ${installed.updated}개 갱신, ${installed.skipped}개 보존`);
    console.log(
      `package.json: ${pkg.created ? '신규 생성, ' : ''}scripts ${pkg.added}개 추가` +
        (pkg.skipped.length ? `, 기존 scripts 보존 ${pkg.skipped.length}개 (${pkg.skipped.join(', ')})` : ''),
    );
    console.log(`.gitignore: harness entry ${gitignoreAdded}개 추가`);

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

    console.log(`
하네스 설치 완료

다음 단계:
  1) git hook 활성화
       npm run hooks:install
  2) 선택: 스택 프리셋 적용
       npm run stack:status
       npm run stack:apply
  3) 정책/코드/문서 동기화 검증
       npm run guard

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
