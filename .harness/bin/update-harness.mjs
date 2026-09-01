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
const DEFAULT_BASE_HARNESS_REPO = process.env.AI_STANDARD_BASE_HARNESS_REPO
  ?? 'https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git'

function printUsageAndExit(code = 0) {
  console.log(`Usage:
  .harness/bin/harness update [options]

Options:
  --dry-run                 업데이트 명령과 각 단계의 변경 계획(무엇이 추가/갱신되는지)을 출력합니다. 파일은 바꾸지 않습니다.
  --strategy <mode>         업데이트 전략입니다. compatible | locked | latest. 기본값: compatible
  --range <semver-range>    SemVer range를 직접 지정합니다. 예: ^1.0.0
  --ref <ref>               git branch/tag/sha를 직접 지정합니다.
  --base-only               스택 하네스 없이 공통 하네스만 업데이트합니다.
  --stack-only              스택 하네스만 업데이트합니다.
  --force                   하네스 설치 시 프로젝트 소유 파일까지 덮어씁니다.
  --confirm-overwrite-project-files
                            --force 덮어쓰기 위험을 인지했음을 명시합니다.
  --resync-managed          설치 기록과 달라진 하네스 파일(managed)만 본체 원본으로 되돌립니다.
                            프로젝트 소유 파일은 건드리지 않습니다.
  --force-stack             다른 스택 기준이 적용되어 있어도 reset 후 적용합니다.
  --allow-mismatch          스택 호환성 불일치를 명시적으로 허용합니다.
  --migration-mode          --allow-mismatch alias입니다.
  --no-backup               공통 하네스 백업을 만들지 않습니다. --force와 함께만 사용합니다.
  --no-scan                 업데이트 후 프로젝트 스캔 리포트 자동 생성을 끕니다.
  --no-handoff              업데이트 후 인수인계 요약 자동 생성을 끕니다.
  --no-check                업데이트 후 하네스 기본 검사 자동 실행을 끕니다.
  -h, --help                도움말을 출력합니다.

기본 동작은 현재 lock에 기록된 스택 하네스와 공통 하네스를 같은 호환 범위 안에서 차례로 업데이트합니다.
공통 하네스만 업데이트하려면 .harness/bin/harness update --base-only 를 사용합니다.
`)
  process.exit(code)
}

// 공통 하네스 init 전용 플래그. 스택 CLI는 미지원 옵션을 exit 1로 거절하므로(의도된 오타 방어),
// 이 플래그가 오면 스택 단계에서 빼는 게 아니라 스택 단계 자체를 돌리지 않는다 — 본체 원본
// 복원(resync)에 스택 일반 init이 부수 실행되는 것은 사용자가 요청한 적 없는 작업이다.
// 실증: score-print 결함 보고(2026-08-24) — 안내된 --resync-managed가 스택 단계에서 항상
// 중단돼 base resync가 시작조차 못 했고, 실패가 옵션 오타처럼 보였다.
const BASE_ONLY_FLAGS = new Set(['--resync-managed'])

function baseOnlyFlagsIn(opts) {
  return opts.forwarded.filter((flag) => BASE_ONLY_FLAGS.has(flag))
}

function forwardedFor(opts, targetKind) {
  return targetKind === 'base' ? opts.forwarded : opts.forwarded.filter((flag) => !BASE_ONLY_FLAGS.has(flag))
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
      case '--resync-managed':
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

  const baseOnlyFlags = baseOnlyFlagsIn(opts)
  if (opts.stackOnly && baseOnlyFlags.length > 0) {
    console.error(`${baseOnlyFlags.join(', ')}는 공통 하네스 전용 옵션이라 --stack-only와 함께 쓸 수 없습니다.`)
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
  console.error('  .harness/bin/harness update --force --confirm-overwrite-project-files')
  console.error('먼저 명령만 보려면:')
  console.error('  .harness/bin/harness update --dry-run --force')
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
    ...harness?.source,
  }
  const parsed = parseSourceSpec(source.spec)

  return {
    ...harness,
    repo: harness?.repo ?? source.repo ?? parsed.repo ?? null,
    ref: harness?.ref ?? source.ref ?? parsed.ref ?? null,
    source,
  }
}

function hydrateBaseHarness(harness, fallbackSource = {}) {
  const hydrated = hydrateHarness(harness, fallbackSource)
  return {
    ...hydrated,
    repo: hydrated.repo ?? DEFAULT_BASE_HARNESS_REPO,
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

function buildCommand(lock, opts, installManifest, targetKind) {
  if (targetKind === 'stack' && !lock.stackHarness) {
    throw new Error('stackHarness 정보가 lock에 없습니다. 스택 하네스 init을 먼저 실행하세요.')
  }

  const label = targetKind === 'base' ? '공통 하네스' : '스택 하네스'
  const fallbackSource = label === '공통 하네스' ? installManifest?.source ?? {} : {}
  const selected = hydrateHarness(
    targetKind === 'base'
      ? hydrateBaseHarness(lock.baseHarness, fallbackSource)
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
    args: ['-y', packageSpec, 'init', ...buildSourceMetadataArgs(selected, opts, targetKind), ...forwardedFor(opts, targetKind)],
  }
}

function updateTargets(lock, opts) {
  if (opts.baseOnly || !lock.stackHarness) {
    return ['base']
  }

  // base 전용 플래그가 오면 스택 단계를 아예 돌리지 않는다(BASE_ONLY_FLAGS 주석 참조).
  if (baseOnlyFlagsIn(opts).length > 0) {
    return ['base']
  }

  if (opts.stackOnly || opts.ref || opts.range) {
    return ['stack']
  }

  return ['stack', 'base']
}

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })

  return result.status ?? 1
}

function printConsumerCommandGuide() {
  console.log(`
업데이트 후 유용한 소비자 명령:
  - 현재 상태 가이드 열기
       .harness/bin/harness guide --open
  - 프로젝트 구조와 로컬룰 후보 다시 스캔
       .harness/bin/harness scan
  - 업데이트 인수인계 요약 다시 생성
       .harness/bin/harness handoff
  - 큰 작업 전 읽을 문서와 스킬 좁히기
       .harness/bin/harness context "<작업 설명>"
  - 운영 업무 시작(Claude Code)
       /운영업무
  - 최종화 승인 후 검증
       .harness/bin/harness check
  - 다음 업데이트 후보 확인
       .harness/bin/harness outdated
  - 승인한 git commit/push 전 자동 검증 연결
       .harness/bin/harness hooks:install
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

  const targets = updateTargets(lock, opts)
  const plans = targets.map((targetKind) => ({
    targetKind,
    plan: buildCommand(lock, opts, installManifest, targetKind),
  }))

  console.log('Harness update')
  console.log(`  strategy: ${opts.range ? `range ${opts.range}` : opts.ref ? `ref ${opts.ref}` : opts.strategy}`)

  const skippedBaseOnlyFlags = baseOnlyFlagsIn(opts)
  if (lock.stackHarness && !opts.baseOnly && skippedBaseOnlyFlags.length > 0) {
    console.log(`  note: ${skippedBaseOnlyFlags.join(', ')}는 공통 하네스 전용입니다 — 스택 하네스 단계는 건너뜁니다.`)
  }

  for (const { targetKind, plan } of plans) {
    const label = targetKind === 'base' ? '공통 하네스' : '스택 하네스'
    console.log(`  target: ${label}`)
    console.log(`  current: ${plan.selected?.id ?? 'unknown'} ${plan.selected?.version ?? 'unknown'}${plan.selected?.ref ? ` (${plan.selected.ref})` : ''}`)
    console.log(`  command: ${[plan.command, ...plan.args].join(' ')}`)
  }

  if (opts.dryRun) {
    // 계획 실행(score-print 요청, 2026-08-28): 호출 명령만 찍으면 "무엇이 바뀌는지"를
    // 소비자가 저장소를 직접 clone해 diff로 알아내야 했다. --dry-run을 각 단계에
    // 그대로 전달해 실행한다 — init의 dry-run은 파일을 쓰지 않으므로 안전하고,
    // 새 스택(v0.2.35+)은 스택 적용 계획(추가/갱신/동일 목록)까지 보여준다.
    console.log('')
    console.log('  아래는 각 단계의 --dry-run 실행 결과입니다 (파일은 바뀌지 않습니다):')
    for (const { targetKind, plan } of plans) {
      const status = run(plan.command, [...plan.args, '--dry-run'])
      if (status !== 0) {
        const label = targetKind === 'base' ? '공통 하네스' : '스택 하네스'
        console.log(`  (${label} 단계의 dry-run 실행에 실패했습니다 — 위 command를 직접 실행해 원인을 확인하세요. 계획 확인이므로 파일은 바뀌지 않았습니다.)`)
      }
    }
    return
  }

  // 앞 단계 실패가 뒤 단계를 조용히 삼키지 않는다 — 무엇이 실행되지 않았는지 밝히고 종료한다
  // (score-print 보고 6번: 실패가 옵션 오타처럼 보여 "안내된 명령이 실행 불가"를 알아채기 어려웠다).
  for (let i = 0; i < plans.length; i += 1) {
    const status = run(plans[i].plan.command, plans[i].plan.args)
    if (status !== 0) {
      const failedLabel = plans[i].targetKind === 'base' ? '공통 하네스' : '스택 하네스'
      const remaining = plans.slice(i + 1).map(({ targetKind }) => (targetKind === 'base' ? '공통 하네스' : '스택 하네스'))
      if (remaining.length > 0) {
        console.error(`${failedLabel} 단계가 실패해 남은 단계 ${remaining.length}건(${remaining.join(', ')})을 실행하지 않았습니다.`)
      }
      process.exit(status)
    }
  }

  printConsumerCommandGuide()

  // 결과 리포트 안내(결정 98): 에이전트 절차를 밟지 않고 이 스크립트만 직접 돌린 경우에도
  // 마지막 줄에서 보고 경로를 보게 한다 — 강제가 아니라 안내(유실 창 축소).
  console.log('')
  console.log('업데이트 결과를 본체에 알리려면(개선 의견이 있으면 함께 실립니다):')
  console.log('  .harness/bin/harness report:install -- --kind update --from <이전버전> --to <새버전>')
  console.log('  (등록 토큰이 없으면 파일로만 남고 전달 안내가 나옵니다 — 리더 승인 후 실행)')
}

main()
