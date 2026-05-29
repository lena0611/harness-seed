#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..', '..')
const harnessRoot = fs.existsSync(path.join(repoRoot, '.harness'))
  ? path.join(repoRoot, '.harness')
  : path.join(repoRoot, '.github')
const lockPath = path.join(harnessRoot, 'harness-lock.json')
const installManifestPath = path.join(harnessRoot, 'install-manifest.json')

function printUsageAndExit(code = 0) {
  console.log(`Usage:
  npm run harness:update [-- options]

Options:
  --dry-run                 실행할 업데이트 명령만 출력합니다.
  --strategy <mode>         업데이트 전략입니다. compatible | locked | latest. 기본값: compatible
  --range <semver-range>    SemVer range를 직접 지정합니다. 예: ^1.0.0
  --ref <ref>               git branch/tag/sha를 직접 지정합니다.
  --base-only               스택 하네스 없이 공통 하네스만 업데이트합니다.
  --stack-only              스택 하네스만 업데이트합니다. 기본 동작과 같지만 의도를 명확히 합니다.
  --force                   하네스 설치 시 프로젝트 소유 파일까지 덮어씁니다.
  --confirm-overwrite-project-files
                            --force 덮어쓰기 위험을 인지했음을 명시합니다.
  --force-stack             다른 스택 기준이 적용되어 있어도 reset 후 적용합니다.
  --allow-mismatch          스택 호환성 불일치를 명시적으로 허용합니다.
  --migration-mode          --allow-mismatch alias입니다.
  --no-backup               공통 하네스 백업을 만들지 않습니다. --force와 함께만 사용합니다.
  --no-scan                 업데이트 후 프로젝트 스캔 리포트 자동 생성을 끕니다.
  --no-handoff              업데이트 후 인수인계 요약 자동 생성을 끕니다.
  --no-check                업데이트 후 하네스 기본 검사 자동 실행을 끕니다.
  -h, --help                도움말을 출력합니다.

기본 동작은 현재 lock에 기록된 스택 하네스를 같은 major 범위 안에서 최신으로 다시 실행합니다.
공통 하네스만 업데이트하려면 npm run harness:update -- --base-only 를 사용합니다.
`)
  process.exit(code)
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    strategy: 'compatible',
    range: null,
    ref: null,
    baseOnly: false,
    stackOnly: false,
    forwarded: [],
  }

  const args = argv.slice(2)
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    switch (arg) {
      case '-h':
      case '--help':
        printUsageAndExit(0)
        break
      case '--dry-run':
        opts.dryRun = true
        break
      case '--strategy': {
        const value = requireValue(args, i, arg)
        if (!['compatible', 'locked', 'latest'].includes(value)) {
          console.error('--strategy는 compatible, locked, latest 중 하나여야 합니다.')
          process.exit(1)
        }
        opts.strategy = value
        i += 1
        break
      }
      case '--range':
        opts.range = requireValue(args, i, arg)
        i += 1
        break
      case '--ref':
        opts.ref = requireValue(args, i, arg)
        i += 1
        break
      case '--base-only':
        opts.baseOnly = true
        break
      case '--stack-only':
        opts.stackOnly = true
        break
      case '--force':
      case '--force-stack':
      case '--confirm-overwrite-project-files':
      case '--confirm-overwrite-project-state':
      case '--allow-mismatch':
      case '--migration-mode':
      case '--no-backup':
      case '--no-scan':
      case '--no-handoff':
      case '--no-check':
        opts.forwarded.push(arg)
        break
      default:
        console.error(`알 수 없는 옵션: ${arg}`)
        printUsageAndExit(1)
    }
  }

  if (opts.baseOnly && opts.stackOnly) {
    console.error('--base-only와 --stack-only는 함께 사용할 수 없습니다.')
    process.exit(1)
  }

  return opts
}

function assertForceConfirmation(opts) {
  if (
    opts.dryRun ||
    !opts.forwarded.includes('--force') ||
    opts.forwarded.includes('--confirm-overwrite-project-files') ||
    opts.forwarded.includes('--confirm-overwrite-project-state') ||
    process.env.AI_STANDARD_CONFIRM_OVERWRITE_PROJECT_FILES === '1'
  ) {
    return
  }

  console.error('harness:update --force는 프로젝트 소유 문서를 덮어쓸 수 있어 중단합니다.')
  console.error('진행하려면 위험을 인지했다는 뜻으로 다음 옵션을 함께 사용하세요:')
  console.error('  npm run harness:update -- --force --confirm-overwrite-project-files')
  console.error('먼저 명령만 보려면:')
  console.error('  npm run harness:update -- --dry-run --force')
  process.exit(1)
}

function requireValue(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    console.error(`${flag}에는 값이 필요합니다.`)
    process.exit(1)
  }
  return value
}

function readJson(absPath, fallback = null) {
  if (!fs.existsSync(absPath)) {
    return fallback
  }

  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'))
  } catch {
    return fallback
  }
}

function cleanVersion(value) {
  const match = String(value ?? '').match(/^v?(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

function ensureGitPackageSpec(repo) {
  if (repo.startsWith('git+') || repo.startsWith('github:')) {
    return repo
  }

  return `git+${repo}`
}

function stripGitPrefix(repo) {
  return repo?.startsWith('git+') ? repo.slice(4) : repo
}

function parseSourceSpec(spec) {
  if (!spec || spec === 'bundled') {
    return {}
  }

  const [repo, ref] = String(spec).split('#')
  return {
    repo: repo || null,
    ref: ref || null,
  }
}

function appendRef(spec, ref) {
  if (!ref) {
    return spec
  }

  return spec.includes('#') ? spec : `${spec}#${ref}`
}

function compatibleRange(harness) {
  const version = cleanVersion(harness?.version ?? harness?.source?.packageVersion)
  return version ? `^${version}` : null
}

function selectGitRef(harness, opts) {
  if (opts.range) {
    return `semver:${opts.range}`
  }

  if (opts.ref) {
    return opts.ref
  }

  if (opts.strategy === 'latest') {
    return null
  }

  if (harness?.range) {
    return `semver:${harness.range}`
  }

  if (harness?.source?.range) {
    return `semver:${harness.source.range}`
  }

  if (opts.strategy === 'compatible') {
    const range = compatibleRange(harness)
    if (range) {
      return `semver:${range}`
    }
  }

  return harness?.ref ?? harness?.source?.ref ?? null
}

function hydrateHarness(harness, fallbackSource = {}) {
  const source = {
    ...fallbackSource,
    ...(harness?.source ?? {}),
  }
  const parsed = parseSourceSpec(source.spec)

  return {
    ...(harness ?? {}),
    repo: harness?.repo ?? source.repo ?? parsed.repo ?? null,
    ref: harness?.ref ?? source.ref ?? parsed.ref ?? null,
    source,
  }
}

function buildPackageSpec(harness, opts) {
  const repo = harness?.repo ?? harness?.source?.repo
  if (!repo) {
    return null
  }

  return appendRef(ensureGitPackageSpec(repo), selectGitRef(harness, opts))
}

function buildSourceMetadataArgs(harness, opts, targetKind) {
  if (targetKind !== 'base') {
    return []
  }

  const repo = harness?.repo ?? harness?.source?.repo
  if (!repo) {
    return []
  }

  const sourceArgs = ['--source-repo', stripGitPrefix(repo)]
  const ref = selectGitRef(harness, opts)
  if (ref) {
    sourceArgs.push('--source-ref', ref)
  }

  return sourceArgs
}

function buildCommand(lock, opts, installManifest) {
  if (opts.stackOnly && !lock.stackHarness) {
    throw new Error('stackHarness 정보가 lock에 없습니다. 스택 하네스 init을 먼저 실행하세요.')
  }

  const targetKind = opts.baseOnly || !lock.stackHarness ? 'base' : 'stack'
  const label = targetKind === 'base' ? '공통 하네스' : '스택 하네스'
  const fallbackSource = label === '공통 하네스' ? installManifest?.source ?? {} : {}
  const selected = hydrateHarness(
    targetKind === 'base'
      ? lock.baseHarness
      : lock.stackHarness,
    fallbackSource,
  )
  const packageSpec = buildPackageSpec(selected, opts)

  if (!packageSpec) {
    throw new Error(`${label} 저장소 정보가 lock/install-manifest에 없습니다. init을 다시 실행해 repo/ref/version을 기록하세요.`)
  }

  return {
    selected,
    command: 'npx',
    args: ['-y', packageSpec, 'init', ...buildSourceMetadataArgs(selected, opts, targetKind), ...opts.forwarded],
  }
}

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function printConsumerCommandGuide() {
  console.log(`
업데이트 후 유용한 소비자 명령:
  - 현재 상태 가이드 열기
       npm run harness:guide -- --open
  - 프로젝트 구조와 로컬룰 후보 다시 스캔
       npm run harness:scan
  - 업데이트 인수인계 요약 다시 생성
       npm run harness:handoff
  - 큰 작업 전 읽을 문서와 스킬 좁히기
       npm run harness:context -- "<작업 설명>"
  - 운영 업무 시작(Claude Code)
       /운영업무
  - 최종화 승인 후 검증
       npm run harness:check
  - 다음 업데이트 후보 확인
       npm run harness:outdated
  - 승인한 git commit/push 전 자동 검증 연결
       npm run hooks:install
`)
}

function main() {
  const opts = parseArgs(process.argv)
  assertForceConfirmation(opts)
  const lock = readJson(lockPath)
  const installManifest = readJson(installManifestPath, {})

  if (!lock) {
    console.error(`harness lock을 찾을 수 없습니다: ${path.relative(repoRoot, lockPath)}`)
    console.error('먼저 스택 하네스 init 또는 공통 하네스 init을 실행하세요.')
    process.exit(1)
  }

  const plan = buildCommand(lock, opts, installManifest)
  const label = opts.baseOnly || !lock.stackHarness ? '공통 하네스' : '스택 하네스'

  console.log('Harness update')
  console.log(`  target: ${label}`)
  console.log(`  current: ${plan.selected?.id ?? 'unknown'} ${plan.selected?.version ?? 'unknown'}${plan.selected?.ref ? ` (${plan.selected.ref})` : ''}`)
  console.log(`  strategy: ${opts.range ? `range ${opts.range}` : opts.ref ? `ref ${opts.ref}` : opts.strategy}`)

  if (opts.dryRun) {
    console.log(`  command: ${[plan.command, ...plan.args].join(' ')}`)
    return
  }

  run(plan.command, plan.args)
  printConsumerCommandGuide()
}

main()
