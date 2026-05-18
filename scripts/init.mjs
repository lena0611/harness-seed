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
  '.harness/session/next-session-reminder.md',
  '.harness/session/project-memory.md',
];

const INSTALL_ITEMS = [
  '.harness',
  '.claude',
  '.github/commit-template.txt',
  '.github/copilot-instructions.md',
  '.github/copilot-instructions',
  '.github/workflows',
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
  '.harness/session/active-context.md',
  '.harness/session/decision-log.md',
  '.harness/session/developer-input-queue.md',
  '.harness/session/next-session-reminder.md',
  '.harness/session/project-memory.md',
  '.claude/settings.local.json',
  'CLAUDE.local.md',
  '.nvmrc',
]);

const PROJECT_OWNED_PREFIXES = [
  '.harness/session/memory/',
  '.harness/session/evolved/',
  '.claude/rules/project/',
  '.claude/skills/project-',
  '.claude/agents/project-',
];

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
  'hooks:install',
  'standards:list',
  'templates:list',
  'stack:status',
  'stack:apply',
  'stack:reset',
  'template:status',
  'template:apply',
  'template:reset',
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

function parseNodeContract(raw) {
  const value = String(raw ?? '').trim();
  const match = value.match(/^v?(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
  };
}

function checkProjectNodeContract(target, opts) {
  const nvmrcPath = join(target, '.nvmrc');
  if (!existsSync(nvmrcPath)) return;

  const value = readFileSync(nvmrcPath, 'utf8').trim();
  const parsed = parseNodeContract(value);
  const supported = parsed && isSupportedNode(parsed);

  if (supported) {
    console.log(`project node: existing .nvmrc ${value} preserved`);
    return;
  }

  const message = [
    `project node: existing .nvmrc ${value || '(empty)'} is below harness minimum Node 20.19.0.`,
    'Jenkins가 이 버전으로 `nvm use` 후 하네스 검사 또는 빌드를 실행하면 실패할 수 있습니다.',
    '프로젝트 Node 전환 계획을 먼저 정하거나, 의도적이면 --allow-node-mismatch를 붙여 진행하세요.',
  ].join('\n');

  if (opts.allowNodeMismatch) {
    console.warn(message);
    console.warn('mode: node mismatch allowed');
    return;
  }

  console.error(message);
  process.exit(1);
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
  --allow-node-mismatch  기존 프로젝트 .nvmrc가 하네스 최소 버전보다 낮아도 명시적으로 진행합니다.
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
    allowNodeMismatch: false,
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
      case '--allow-node-mismatch':
        opts.allowNodeMismatch = true;
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

## 다음 작업 후보
- \`.harness/project/project-charter.md\`의 TBD 항목을 프로젝트 상황에 맞게 채웁니다.
- 작업을 시작하기 전에 \`npm run harness:context -- "<작업 설명>"\`으로 읽을 기준을 좁힙니다.
- 작업 후 \`npm run harness:check\`로 기준, 링크, 검증 상태를 확인합니다.
`;

    case '.harness/session/decision-log.md':
      return `# 결정 로그

이 문서는 이 프로젝트에서 내린 중요한 판단과 선택 이유를 남기는 소비자 프로젝트 전용 로그입니다.

> 하네스 본체의 변경 이력이나 릴리스 노트가 아닙니다. 하네스 본체 변경 기록은 하네스 저장소의 \`CHANGELOG.md\` 또는 릴리스 태그를 확인합니다.

## 기록 원칙
- 프로젝트 기준, 스택 기준, 템플릿 계약, 개인 기준이 충돌할 때 선택 이유를 남깁니다.
- 테스트 전략, 예외 허용, 아키텍처 경계, 운영 절차처럼 이후 작업에 영향을 주는 판단을 남깁니다.
- 단순 작업 로그나 일회성 구현 세부사항은 남기지 않습니다.
- 임시 예외는 가능하면 \`.harness/policy/waivers.json\`에 범위와 만료 조건을 함께 남깁니다.

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
`;

    case '.harness/session/next-session-reminder.md':
      return `# 다음 세션 리마인더

새 세션에서 바로 이어받기 위한 소비자 프로젝트 전용 메모입니다.

## 먼저 확인할 것
1. \`git --no-pager status --short\`
2. \`.harness/session/handoff.md\`
3. \`.harness/session/project-scan-report.md\`
4. \`.harness/session/developer-input-queue.md\`

## 다음 작업
- 프로젝트 헌장 TBD 항목을 확인합니다.
- 이번 작업 설명이 있으면 \`npm run harness:context -- "<작업 설명>"\`으로 읽을 기준을 좁힙니다.
- 작업 후 \`npm run harness:check\`를 실행합니다.
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

function collectForceOverwriteTargets(target, files, manifest) {
  return [...new Set([...files, ...CONSUMER_PROJECT_STATE_PATHS])]
    .filter((rel) => existsSync(join(target, rel)))
    .filter((rel) => (
      CONSUMER_PROJECT_STATE_PATHS.includes(rel) ||
      isProjectOwned(rel) ||
      !isManagedByManifest(manifest, rel)
    ))
    .sort();
}

function assertForceOverwriteConfirmed(opts, targets) {
  if (!opts.force || opts.dryRun || targets.length === 0 || opts.confirmOverwriteProjectFiles) {
    return;
  }

  console.error('--force는 프로젝트 소유 파일 또는 출처를 확인할 수 없는 기존 파일을 덮어쓸 수 있어 중단합니다.');
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

function buildInstallManifest(sourceRoot, target, files, copiedFiles, opts) {
  const seedPkg = readJson(join(sourceRoot, 'package.json'), {})
  const managedFiles = {}
  const projectOwnedFiles = [...new Set([
    ...files.filter((rel) => isProjectOwned(rel)),
    ...CONSUMER_PROJECT_STATE_PATHS,
  ])].sort()
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

  return { added, skipped, created };
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
    '.harness/generated/',
    '.harness/session/project-scan-report.md',
    '.harness/session/handoff.md',
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
    return { scan: 'skipped', handoff: 'skipped', check: 'skipped' };
  }

  const result = { scan: 'skipped', handoff: 'skipped', check: 'skipped' };

  if (!opts.noScan) {
    result.scan = runPostInstallStep(
      target,
      '자동 스캔: 현재 프로젝트 분석 리포트 생성',
      [process.execPath, '.harness/bin/scan-project.mjs', '--write'],
    ) ? 'ok' : 'failed';
  }

  if (!opts.noHandoff) {
    result.handoff = runPostInstallStep(
      target,
      '자동 인수인계: 설치/업데이트 요약 생성',
      [process.execPath, '.harness/bin/handoff.mjs', '--write'],
    ) ? 'ok' : 'failed';
  }

  if (!opts.noCheck) {
    result.check = runPostInstallStep(
      target,
      '자동 검사: 하네스 설치 상태 확인',
      [process.execPath, '.harness/bin/guard.mjs'],
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

  checkProjectNodeContract(TARGET, opts);

  const sourceRoot = opts.fromGit ? fetchFromGit(opts.fromGit, opts.ref) : BUNDLED_SOURCE_ROOT;
  const sourceIsTemp = Boolean(opts.fromGit);

  try {
    console.log(`harness-seed: harness 설치 시작 -> ${TARGET}`);
    console.log(`source: ${opts.fromGit ? `${opts.fromGit}#${opts.ref}` : 'bundled'}`);
    if (opts.dryRun) console.log('mode: dry-run');
    console.log('');

    const files = collectInstallFiles(sourceRoot);
    const sourcePkg = readJson(join(sourceRoot, 'package.json'), {});
    const existingManifest = readJson(join(TARGET, MANIFEST_PATH), null);
    const recognizedManifest = existingManifest && existingManifest.tool === 'harness-seed' ? existingManifest : null;
    const legacyManagedRootScripts = collectLegacyManagedRootScripts(TARGET, recognizedManifest);
    const externalHarnessMode = !recognizedManifest && hasHarnessLikeFiles(TARGET);
    const forceOverwriteTargets = collectForceOverwriteTargets(TARGET, files, recognizedManifest);

    if (externalHarnessMode) {
      console.log('기존 하네스가 있지만 harness-seed install manifest는 없습니다.');
      console.log('전용 하네스일 수 있어 기존 파일은 기본적으로 보존합니다. 덮어쓰려면 --force를 사용하세요.');
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
      } else {
        console.log('backup: 기존 하네스 파일 없음');
      }
      console.log('');
    }

    const installed = installFiles(sourceRoot, TARGET, files, opts, recognizedManifest);
    const projectState = writeConsumerProjectStateFiles(TARGET, opts, recognizedManifest, sourcePkg);
    const migration = removeLegacyManagedRootScripts(TARGET, legacyManagedRootScripts, opts);
    const pkg = mergePackageJson(sourceRoot, TARGET, opts);
    const gitignoreAdded = mergeGitignore(TARGET, opts);
    const eslintPatch = patchEslintConfigForHarness(TARGET, opts);
    ensureExecutable(TARGET, opts);
    const writtenManifest = writeInstallManifest(sourceRoot, TARGET, files, installed.copiedFiles, opts);
    const writtenLock = writtenManifest ? writeHarnessLock(TARGET, writtenManifest, opts) : null;
    const diagnostics = runPostInstallDiagnostics(TARGET, opts);

    console.log('');
    console.log(`files: ${installed.added}개 추가, ${installed.updated}개 갱신, ${installed.skipped}개 보존`);
    console.log(
      `project state: ${opts.dryRun ? `${projectState.planned}개 생성/교체 예정` : `${projectState.added}개 추가, ${projectState.updated}개 교체, ${projectState.preserved}개 보존`}`,
    );
    console.log(
      `package.json: ${pkg.created ? '신규 생성, ' : ''}scripts ${pkg.added}개 추가` +
        (pkg.skipped.length ? `, 기존 scripts 보존 ${pkg.skipped.length}개 (${pkg.skipped.join(', ')})` : ''),
    );
    console.log(`.gitignore: harness entry ${gitignoreAdded}개 추가`);
    console.log(`eslint config: ${eslintPatch.message}`);
    console.log(`legacy root scripts: ${opts.dryRun ? `${legacyManagedRootScripts.length}개 제거 예정` : `${migration.removed}개 제거`}`);
    console.log(`install manifest: ${opts.dryRun ? 'dry-run' : `${Object.keys(writtenManifest.managedFiles).length}개 managed file 기록`}`);
    console.log(`harness lock: ${opts.dryRun ? 'dry-run' : `${writtenLock.baseHarness.version} (${writtenLock.baseHarness.ref ?? writtenLock.baseHarness.source.type})`}`);
    console.log(`scan: ${diagnostics.scan}`);
    console.log(`handoff: ${diagnostics.handoff}`);
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
      console.log('기준 계층과 충돌 후보는 npm run harness:scan 결과를 확인하세요.');
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
하네스 설치 완료

다음 단계:
  0) 새 터미널이면 프로젝트 루트에서 Node 버전 적용
       nvm use
  1) 자동 생성된 프로젝트 스캔/인수인계 확인
       .harness/session/project-scan-report.md
       .harness/session/handoff.md
       CLI 사용 시: ai guide
  2) git hook 활성화
       npm run hooks:install
  3) 스택 기준 선택, 필요하면 scaffold 템플릿 후보 조회 후 적용
       npm run stack:status
       npm run standards:list
       npm run templates:list
       npm run template:apply -- --preset-git <repo-url> --ref <tag-or-branch>
  4) 작업 중간에 다시 검사
       npm run harness:check
       CLI 사용 시: ai check

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
