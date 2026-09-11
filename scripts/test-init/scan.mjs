// 스캔·문서 링크·레지스트리·핵심 경로 회귀. 실행 등록은 scripts/test-init.mjs의 tests 배열이 정본이다.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isHistoryLogPath, isIgnorableCodePath } from '../../.harness/bin/doc-link-check.mjs'
import {
  repoRoot,
  nodeBin,
  run,
  harnessBin,
  assert,
  exists,
  read,
  writeJson,
  sha256Text,
  makeTarget,
  runInit,
  runGuard,
  SEED_ONLY_DOCS,
} from './helpers.mjs'

function scanReportDraftsStyleRulesFromConfigFiles() {
  const target = makeTarget()

  runInit(target)
  fs.writeFileSync(path.join(target, '.editorconfig'), `root = true

[*]
indent_style = space
indent_size = 2
insert_final_newline = true
`)
  fs.writeFileSync(path.join(target, '.eslintrc'), JSON.stringify({
    rules: {
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'import/order': ['warn'],
    },
  }, null, 2))

  run(harnessBin(target), ['scan'], { cwd: target })

  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('## Code Formatting Rule Draft'), 'scan report should include code formatting rule draft')
  assert(report.includes('.editorconfig *: indent_style = space'), 'scan report should draft editorconfig style rules')
  assert(report.includes('.eslintrc: quote = single'), 'scan report should draft eslint quote rule')
  assert(report.includes('.eslintrc: semicolon = always'), 'scan report should draft eslint semicolon rule')
  assert(report.includes('.eslintrc: import grouping/order rule is configured'), 'scan report should draft eslint import order rule')
  assert(!report.includes('## Code Formatting Preset Candidates'), 'scan report should not suggest presets when style sources exist')
}

// doc-link-check 오탐(0.2.68): 백틱 디렉토리 예시/CI 어댑터 경로를 dead code-path로 잘못 표시하던 문제.
function isIgnorableCodePathClassifiesExamplesAndCiPaths() {
  // 예시/디렉토리/CI 어댑터 경로는 무결성 검사 대상이 아니다.
  assert(isIgnorableCodePath('.github/workflows/'), 'trailing-slash CI dir is a directory example')
  assert(isIgnorableCodePath('.harness/policy/'), 'trailing-slash dir is a directory example')
  // 0.2.151: 예시를 소비자 쪽 이름으로 바꿨다. 본체에는 워크플로가 없고(결정 114) 이 규칙이 지키는
  // 것은 **소비자가 자기 CI 파일을 구체 경로로 인용하는 경우**다.
  assert(isIgnorableCodePath('.github/workflows/ci.yml'), 'a concrete CI workflow path is ignorable (presence varies by environment)')
  assert(isIgnorableCodePath('.harness/bin/*.mjs'), 'glob is ignorable')
  assert(isIgnorableCodePath('.harness/session/...'), 'ellipsis is ignorable')
  // 구체 파일 참조는 여전히 검사 대상이어야 한다(오탐 수정이 진짜 dead까지 가리면 안 된다).
  assert(!isIgnorableCodePath('.harness/bin/guard.mjs'), 'concrete harness file must still be checked')
  assert(!isIgnorableCodePath('.claude/hooks/enforce-check.sh'), 'concrete hook file must still be checked')
  assert(!isIgnorableCodePath('src/index.ts'), 'concrete src file must still be checked')
}

function consumerDocLinkCheckIgnoresCiExamplePaths() {
  const target = makeTarget()
  runInit(target)
  // 예전 전제("소비자에 본체 CI 어댑터가 주입되지 않는다")는 0.2.151 에 본체 워크플로가 사라지면서
  // **영원히 참**이 됐다 — 검사처럼 보이지만 아무것도 지키지 않아 지웠다(결정 114·115).
  //
  // 대신 이 분기가 **실제로 지키는 것**을 겪게 한다: 소비자 문서가 자기 CI 파일을 **구체 경로로**
  // 인용하고 그 파일이 없는 환경. 본체 문서의 `.github/workflows/` 언급은 전부 trailing slash 라
  // 그쪽 규칙이 먼저 잡아 이 분기를 밟지 않는다(적대적 리뷰 실측 — 분기를 지워도 통과했다).
  fs.mkdirSync(path.join(target, '.harness/project'), { recursive: true })
  fs.appendFileSync(
    path.join(target, '.harness/project/workflow-rules.md'),
    '\n## CI\n\n배포는 `.github/workflows/deploy.yml` 이 담당합니다.\n',
  )
  assert(!exists(target, '.github/workflows/deploy.yml'), 'precondition: the cited workflow must be absent here')
  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!out.includes('.github/workflows'), 'consumer doc-link-check must not flag .github/workflows example/CI paths')
}

function consumerDocLinkCheckHandlesAbsentSeedOnlyDoc() {
  const target = makeTarget()
  runInit(target)
  // seed-only 문서는 소비자에 없고 document-registry에도 없으므로 missing/orphan으로 표시되면 안 된다.
  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  for (const docPath of SEED_ONLY_DOCS) {
    assert(!out.includes(path.basename(docPath, '.md')), 'consumer doc-link-check must not flag the absent seed-only doc')
  }
}

// score-print 권고 B(2026-08-31): 배포하는 md가 본체 registry에 빠지면 모든 소비자가
// 매 검사마다 고아 경고를 보게 된다. 본체는 소비자 시점을 겪지 않으므로 픽스처로 대신 겪는다.
function freshInstallHasNoRegistryOrphans() {
  const target = makeTarget()
  runInit(target)
  const output = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!/orphan/i.test(output), 'a fresh install must report zero registry orphans — every shipped md must be registered in document-registry.json')
}

// 0.2.135 — 멀티사이트·clubadm 동시 보고: 선언 glob의 앞머리가 실존하지 않으면 그 선언은
// 영원히 매칭 불가(템플릿 예시 잔존이 대표 사례)인데 무신호였다. 정보 등급 안내를 잠근다.
function criticalPathGhostDeclarationsGetNoticed() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  fs.mkdirSync(path.join(target, 'src/api'), { recursive: true })
  fs.writeFileSync(path.join(target, '.harness/project/critical-paths.md'), [
    '# Critical Paths',
    '',
    '| path | 왜 중요한가 | 권장 검증 |',
    '| --- | --- | --- |',
    '| `src/domain/**` | 유령 | 테스트 |',
    '| `src/api/**` | 실존 | 테스트 |',
    '',
  ].join('\n'))

  // clubadm 회신(2026-08-31) 확인 요청: 루트 직속 파일 선언은 폴더가 없어도
  // 파일 실존으로 판정해야 한다 — vite.config.js가 유령으로 잡히면 오탐.
  fs.writeFileSync(path.join(target, 'vite.config.js'), 'export default {}\n')
  fs.appendFileSync(path.join(target, '.harness/project/critical-paths.md'), [
    '| `vite.config.js` | 빌드 설정 | 빌드 |',
    '| `missing.config.js` | 없는 루트 파일 | - |',
    '',
  ].join('\n'))

  const out = runGuard(target)
  assert(out.includes('실존 대상이 없습니다'), 'ghost critical-path declarations must be surfaced')
  assert(out.includes('src/domain/**'), 'the ghost glob must be named')
  assert(!out.includes('- src/api/** ('), 'existing declarations must not be flagged')
  assert(!out.includes('vite.config.js ('), 'an existing root-level file declaration must not be flagged (clubadm reply)')
  assert(out.includes('missing.config.js (파일 없음)'), 'a missing wildcard-free declaration must be reported as a missing file')
  assert(!out.includes('템플릿 예시'), 'partial ghosts must not claim template leftovers')

  // 전부 유령이면 템플릿 잔존 의심 한 줄이 추가된다.
  const target2 = makeTarget()
  runInit(target2, '--no-scan', '--no-handoff', '--no-check')
  fs.writeFileSync(path.join(target2, '.harness/project/critical-paths.md'), [
    '| path | 왜 중요한가 | 권장 검증 |',
    '| --- | --- | --- |',
    '| `src/domain/**` | 유령 | 테스트 |',
    '| `ios/**` | 유령 | 확인 |',
    '',
  ].join('\n'))
  const out2 = runGuard(target2)
  assert(out2.includes('템플릿 예시'), 'all-ghost declarations should hint at template leftovers')

  // 본체(seed-mode)는 템플릿 원본이라 예시가 유령인 게 정상 — 면제.
  fs.writeFileSync(path.join(target2, '.harness-seed-mode'), '')
  const out3 = runGuard(target2)
  assert(!out3.includes('실존 대상이 없습니다'), 'seed-mode target must be exempt from the ghost notice')
}

// 0.2.135 — clubadm A: 표 한 칸의 백틱 여러 개는 각각 경로다. 종전에는 칸 전체가 유령 glob
// 하나가 되어 조용히 매칭 0이었다(본체 배포 템플릿의 spec 3파일 행이 실사례).
function criticalPathCellWithMultipleBacktickPathsMatchesEach() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  fs.mkdirSync(path.join(target, 'src/api'), { recursive: true })
  fs.writeFileSync(path.join(target, '.harness/project/critical-paths.md'), [
    '| path | 왜 중요한가 | 권장 검증 |',
    '| --- | --- | --- |',
    '| `src/api/a.js`, `src/api/b.js` | 판정 출처 | 테스트 |',
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(target, 'src/api/a.js'), 'export const a = 1\n')
  fs.writeFileSync(path.join(target, 'src/api/b.js'), 'export const b = 1\n')

  const out = runGuard(target)
  assert(out.includes('Critical path review'), 'multi-path cell must produce critical path matches')
  assert(out.includes('src/api/a.js') && out.includes('src/api/b.js'), 'each backticked path must match independently')

  // 백틱 없이 쉼표만 있으면 깨진 선언 — 안내 한 줄.
  fs.writeFileSync(path.join(target, '.harness/project/critical-paths.md'), [
    '| path | 왜 중요한가 | 권장 검증 |',
    '| --- | --- | --- |',
    '| src/api/a.js, src/api/b.js | 판정 출처 | 테스트 |',
    '',
  ].join('\n'))
  const out2 = runGuard(target)
  assert(out2.includes('쉼표가 든 경로'), 'a comma glob without backticks must get a guidance line')
}

// 0.2.135 — clubadm C: orphan 목록은 출구(document-registry.local.json, 0.2.131 신설)를
// 걸린 자리에서 알려줘야 한다. 목록만 나열하면 방치된다(실측 10건 2개월).
function orphanNoticePointsToLocalRegistryExit() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  fs.writeFileSync(path.join(target, '.claude/commands/team-custom.md'), '# 팀 자체 명령\n')

  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(out.includes('team-custom.md'), 'the unregistered doc must be listed as orphan')
  assert(out.includes('document-registry.local.json'), 'orphan listing must point to the local registry exit')
}

// #31(scorecard-print 0.2.146 업데이트 리포트) ①: 프로젝트가 자기 정책을 관리 파일(policy-registry.json)에 직접
// 넣자 그 파일이 갱신 대상에서 빠져 공통 정책이 조용히 얼어붙었다 — 공통 정책 2건 누락, checks 가 은퇴한 별칭 12개를
// 가리키는 상태로 0.2.131 이전에 멈춰 있었고 0.2.146 전까지 아무 신호도 없었다. 문서 등록부(결정 91)와 같은 구조로
// 프로젝트 등록 지점을 만든다: 추가만 하고, 업데이트가 덮지 않고, 오류는 그 항목이 적힌 파일을 가리킨다.
function localPolicyRegistryIsMergedAndProjectOwned() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const localRel = '.harness/policy/policy-registry.local.json'
  const localPath = path.join(target, localRel)
  const managedRel = '.harness/policy/policy-registry.json'
  const check = () => {
    try {
      return run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'check'], { cwd: target })
    } catch (error) {
      return `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
  }
  const projectPolicy = (overrides = {}) => ({
    id: 'project.spec.scorecard-sync',
    title: 'Scorecard spec stays in sync',
    layer: 'project',
    category: 'domain',
    status: 'active',
    severity: 'warning',
    enforcement: 'inform',
    waiverAllowed: true,
    owner: 'scorecard-print',
    source: { type: 'local', path: localRel },
    documents: ['.harness/project/domain-rules.md'],
    ownedAreas: ['src/'],
    checks: [],
    conflictsWith: [],
    supersedes: [],
    tags: [],
    ...overrides,
  })
  const writeLocal = (value) => fs.writeFileSync(localPath, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)

  // 부재가 정상이다 — 파일이 없어도 검사는 통과한다.
  assert(check().includes('Policy registry/schema check passed'), 'the check must pass when the project registry is absent')

  // 유효한 프로젝트 정책은 추가되고 검사는 계속 통과한다.
  writeLocal({ version: 3, policies: [projectPolicy()] })
  assert(check().includes('Policy registry/schema check passed'), `a valid project policy must be accepted (got: ${check()})`)

  // 필수 필드가 빠지면 위반이고, 위반이 가리키는 파일은 **그 항목이 적힌 곳**이어야 한다.
  writeLocal({ version: 3, policies: [projectPolicy({ documents: [] })] })
  const missingField = check()
  assert(missingField.includes(localRel), `a violation in the project registry must name the project registry (got: ${missingField})`)
  assert(!missingField.includes(`${managedRel}:`) && !missingField.includes(`  ${managedRel}`), `the violation must not point at the managed file the project cannot fix (got: ${missingField})`)

  // 공통 정책 id 를 덮으려 하면 duplicate 로 막힌다 — 프로젝트가 공통 정책을 조용히 무력화할 길을 열지 않는다.
  const commonId = JSON.parse(read(target, managedRel)).policies[0].id
  writeLocal({ version: 3, policies: [projectPolicy({ id: commonId })] })
  const duplicate = check()
  assert(duplicate.includes('duplicate policy id') && duplicate.includes(commonId), `a project entry reusing a common policy id must be rejected (got: ${duplicate})`)
  // 어느 파일을 가리키는지가 이 기능의 핵심 약속이다(적대적 리뷰 P2-7): 병합 순서를 뒤집으면 위반이 관리 파일을
  // 가리키는데, 그 파일은 프로젝트가 고칠 수 없다. 메시지만 보는 단언은 그 회귀를 놓쳤다.
  assert(duplicate.includes(localRel), `the duplicate must be reported against the file the project can actually fix (got: ${duplicate})`)

  // 손으로 쓰는 파일이라 오타가 잦다 — 배열 원소 타입 오류는 크래시가 아니라 그 파일을 가리키는 위반이어야 한다
  // (적대적 리뷰 P2-1: 종전에는 스키마를 통과한 뒤 glob 변환에서 TypeError 로 죽어 파일명을 한 번도 말하지 않았다).
  writeLocal({ version: 3, policies: [projectPolicy({ ownedAreas: [null] })] })
  const badElement = check()
  assert(badElement.includes(localRel) && badElement.includes('문자열이어야 합니다'), `a non-string glob element must be reported against the project registry (got: ${badElement})`)
  try {
    const guardOut = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact'], { cwd: target })
    assert(!guardOut.includes('TypeError'), 'impact must not crash on a non-string glob element')
  } catch (error) {
    assert(!String(error.stderr ?? '').includes('TypeError'), `impact must not crash on a non-string glob element (got: ${String(error.stderr ?? '').slice(0, 200)})`)
  }

  // 프로젝트 항목도 v3 스키마 검사를 받는다(적대적 리뷰 P2-2: 문서가 "같은 형식"이라고 약속하는데 면제됐다).
  writeLocal({ version: 3, policies: [projectPolicy({ layer: 'NOT_A_LAYER' })] })
  const badLayer = check()
  assert(badLayer.includes(localRel) && badLayer.includes('layer'), `an invalid layer in the project registry must be caught (got: ${badLayer})`)

  // 깨진 파일은 조용히 무시하지 않는다 — 정책이 조용히 빠지는 것이 이 결함의 원인이었다.
  writeLocal('{ this is not json')
  const broken = check()
  assert(broken.includes(localRel) && broken.includes('읽지 못했습니다'), `a malformed project registry must be reported, not silently ignored (got: ${broken})`)

  // 업데이트가 덮지 않는다(프로젝트 소유). 재설치 후에도 내용이 그대로여야 한다.
  writeLocal({ version: 3, policies: [projectPolicy()] })
  const before = read(target, localRel)
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(read(target, localRel) === before, 'reinstall must not overwrite the project-owned registry')
  // manifest 취급은 문서 등록부와 같다: 본체가 배포하지 않는 파일이라 managed 목록에 없고 업데이트가 손대지 않는다.
  // (적대적 리뷰 P2-6: 이 성질은 PROJECT_OWNED_PATHS 등록과 무관하게 성립하므로 그 등록을 지워도 단언이 통과했다.
  //  등록은 방어층으로 남기고, 여기서는 하네스가 실제로 보장하는 것 — 소유 판정 자체 — 을 본다.)
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!manifest.managedFiles?.[localRel], 'the project registry must not be recorded as a managed file')
  // 소유 판정의 실질은 "덮어쓰기를 명시해도 보존된다"는 것이다 — 그것을 직접 확인한다.
  runInit(target, '--no-scan', '--no-handoff', '--no-check', '--force', '--confirm-overwrite-project-files')
  assert(read(target, localRel) === before, 'even a forced reinstall must preserve the project-owned registry')

  // 관리 파일을 직접 고친 상태(=이 결함의 그 상태)는 드리프트 안내가 잡고 옮길 자리를 알려준다.
  // 판정을 여기 두는 이유는 이 경로가 **줄바꿈 정규화 sha**로 비교하기 때문이다 — 원시 바이트로 비교하면
  // CRLF 체크아웃(Windows)에서 손대지 않은 프로젝트에도 발동한다(적대적 리뷰 P1). 캐시 히트에서도 나오고,
  // 다른 위반에 가려지지 않는다 — 문서 등록부 안내가 이미 있던 자리다.
  writeLocal({ version: 3, policies: [projectPolicy()] })
  const drift = () => runGuard(target, '--no-cache', '--fast')
  assert(!drift().includes('policy-registry.local.json(프로젝트 소유)'), 'an untouched managed registry must not trigger the relocation hint')
  const managedPath = path.join(target, managedRel)
  const pristineManaged = fs.readFileSync(managedPath, 'utf8')
  const managed = JSON.parse(pristineManaged)
  managed.policies.push(projectPolicy({ id: 'project.frozen.example' }))
  fs.writeFileSync(managedPath, `${JSON.stringify(managed, null, 2)}\n`)
  const hinted = drift()
  assert(hinted.includes('policy-registry.local.json(프로젝트 소유)'), `editing the managed registry must be surfaced with the place to move entries to (got: ${hinted})`)
  assert(hinted.includes('--resync-managed'), 'the hint must name the command that restores the managed file')
  // 줄바꿈만 다른 체크아웃(Windows autocrlf)은 드리프트가 아니다 — 판정이 원시 바이트 비교로 돌아가면 여기서 걸린다.
  fs.writeFileSync(managedPath, pristineManaged.replaceAll('\n', '\r\n'))
  assert(!drift().includes('policy-registry.local.json(프로젝트 소유)'), 'a CRLF-only checkout must not be reported as drift (that would false-alarm every Windows consumer)')
  fs.writeFileSync(managedPath, pristineManaged)
}

// #34(scorecard-print 0.2.147 리포트): 이관 안내가 정작 제보한 프로젝트에는 오지 않았다. 0.2.146의 동명 파일 처리가
// 관리 파일을 덮지 않고 preservedForeignFiles 로 기록하므로, 이 결함을 겪은 프로젝트는 모두 이미 managed 밖이고 관리 파일만
// 대조하는 드리프트 안내는 그들을 보지 못했다. 보존 기록에서 같은 안내를 내고, 되돌릴 길(--replace-file)을 준다. 그리고
// 손으로 원본과 같게 만든 파일은 다음 업데이트가 다시 관리 대상으로 들인다 — 종전에는 copiedFiles 에도 승계에도 없어
// 영원히 관리 밖이었다(제보자의 "다음 업데이트에서 재편입될 것으로 기대"는 현 코드로는 거짓이었다).
function preservedForeignRegistryIsGuidedAndReadopted() {
  const rel = '.harness/policy/policy-registry.json'
  const original = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
  const modified = JSON.parse(original)
  modified.policies.push({ ...modified.policies[0], id: 'project.frozen.example', layer: 'project' })
  const seedForeign = (target) => {
    fs.mkdirSync(path.join(target, '.harness/policy'), { recursive: true })
    fs.writeFileSync(path.join(target, rel), `${JSON.stringify(modified, null, 2)}\n`)
  }
  const manifestOf = (target) => JSON.parse(read(target, '.harness/install-manifest.json'))
  const guardOut = (target) => {
    try {
      return runGuard(target, '--no-cache', '--fast')
    } catch (error) {
      return `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
  }

  const target = makeTarget()
  seedForeign(target)
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  let manifest = manifestOf(target)
  assert(manifest.preservedForeignFiles?.includes(rel) && !manifest.managedFiles?.[rel], 'precondition: a pre-existing differing registry must be recorded as preserved-foreign, not managed')

  // 드리프트 안내는 관리 파일만 보므로 이 파일은 시야 밖이었다 — 보존 기록에서 같은 안내가 나와야 한다.
  const guarded = guardOut(target)
  assert(guarded.includes('policy-registry.local.json') && guarded.includes(`--replace-file ${rel}`), `a preserved-foreign policy registry must get the relocation hint with the recovery command (got: ${guarded})`)

  // 복구 ①: --replace-file → 원본으로 교체(기존 파일은 .harness-bak), 관리 대상으로 복귀, 안내 소멸.
  runInit(target, '--no-scan', '--no-handoff', '--no-check', '--replace-file', rel)
  assert(fs.existsSync(path.join(target, `${rel}.harness-bak`)), 'the replaced file must be kept as a .harness-bak sidecar')
  assert(read(target, rel) === original, 'the registry must equal the harness original after --replace-file')
  manifest = manifestOf(target)
  assert(manifest.managedFiles?.[rel] && !manifest.preservedForeignFiles?.includes(rel), 'after --replace-file the registry must be managed again')
  const afterReplace = guardOut(target)
  assert(!afterReplace.includes(`--replace-file ${rel}`), 'the preserved-foreign hint must disappear once the file is back under management')

  // 복구 ②: 손으로 원본과 같게 되돌린 파일은 다음 업데이트가 다시 관리 대상으로 들인다(재편입).
  const restored = makeTarget()
  seedForeign(restored)
  runInit(restored, '--no-scan', '--no-handoff', '--no-check')
  assert(manifestOf(restored).preservedForeignFiles?.includes(rel), 'precondition: preserved-foreign')
  fs.writeFileSync(path.join(restored, rel), original)
  const readoptOut = runInit(restored, '--no-scan', '--no-handoff', '--no-check')
  const after = manifestOf(restored)
  assert(after.managedFiles?.[rel] && !after.preservedForeignFiles?.includes(rel), 'a hand-restored file identical to the harness original must be re-adopted as managed on the next update')
  assert(read(restored, rel) === original, 're-adoption must not touch the file bytes')
  // 재편입 목록에 실리고, 보존 목록에는 실리지 않아야 한다(적대적 리뷰 B-2: 같은 파일이 두 목록에 동시에 찍혔다).
  assert(/다시 관리 대상으로 들였습니다[^\n]*\n(?:  - [^\n]+\n)*?  - \.harness\/policy\/policy-registry\.json\n/.test(readoptOut), `re-adoption must list the file under the re-adoption header (got: ${readoptOut.split('\n').filter((line) => line.includes(rel) || line.includes('관리 대상')).join(' | ')})`)
  assert((readoptOut.match(new RegExp(`  - ${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`, 'g')) ?? []).length === 1, 'a re-adopted file must appear in exactly one list, not also under the preserved list')
  // 줄바꿈만 다른 사본도 "같은 내용"이다(적대적 리뷰 B-1): 설치기 자신이 .cmd 를 CRLF 로 쓰고, Windows 체크아웃은 전부 CRLF 다.
  const crlfTarget = makeTarget()
  fs.mkdirSync(path.join(crlfTarget, '.harness/project'), { recursive: true })
  const termRel = '.harness/project/terminology.md'
  fs.writeFileSync(path.join(crlfTarget, termRel), fs.readFileSync(path.join(repoRoot, termRel), 'utf8').replaceAll('\n', '\r\n'))
  runInit(crlfTarget, '--no-scan', '--no-handoff', '--no-check')
  const crlfManifest = manifestOf(crlfTarget)
  assert(crlfManifest.managedFiles?.[termRel] && !crlfManifest.preservedForeignFiles?.includes(termRel), 'a CRLF-only copy of a harness file must be adopted as managed, not recorded as foreign')

  // --replace-file 은 프로젝트 소유 파일을 거절한다 — 팀 설정(profile.json 등)을 템플릿으로 덮는 사고를 막는다.
  let refused = ''
  try {
    runInit(restored, '--no-scan', '--no-handoff', '--no-check', '--replace-file', '.harness/policy/profile.json')
  } catch (error) {
    refused = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(refused.includes('프로젝트 소유 파일입니다'), `--replace-file on a project-owned file must be refused with a clear reason (got: ${refused.slice(0, 300)})`)

  // 적대적 리뷰 P1: 마커 진입점은 거절해야 한다 — 설치 기록이 없는 외래 .harness/ 상태에선 통째로 덮여 팀 문서가 사라졌다.
  const foreignHarness = makeTarget()
  fs.mkdirSync(path.join(foreignHarness, '.harness'), { recursive: true })
  fs.writeFileSync(path.join(foreignHarness, 'CLAUDE.md'), '# 팀 문서\n\n팀만 아는 규칙 한 줄\n')
  let markerRefused = ''
  try {
    runInit(foreignHarness, '--no-scan', '--no-handoff', '--no-check', '--replace-file', 'CLAUDE.md')
  } catch (error) {
    markerRefused = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(markerRefused.includes('마커'), `--replace-file on a marker-managed entry point must be refused (got: ${markerRefused.slice(0, 300)})`)
  assert(fs.readFileSync(path.join(foreignHarness, 'CLAUDE.md'), 'utf8').includes('팀만 아는 규칙'), 'the team CLAUDE.md must be untouched after the refusal')

  // 적대적 리뷰 P2: 하네스가 배포하지 않는 경로(오타)는 조용히 넘기지 않고 멈춘다.
  let typoRefused = ''
  try {
    runInit(restored, '--no-scan', '--no-handoff', '--no-check', '--replace-file', '.harness/policy/policy-registry.jsonn')
  } catch (error) {
    typoRefused = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(typoRefused.includes('배포하는 파일이 아닙니다'), `a typo in --replace-file must fail loudly, not succeed silently (got: ${typoRefused.slice(0, 300)})`)

  // 적대적 리뷰: !replacedFile 가드는 관리 파일이 로컬 수정된 경우에만 의미가 있는데 그 경로가 무단언이었다.
  const managedRel = '.harness/policy/README.md'
  const managedOriginal = fs.readFileSync(path.join(repoRoot, managedRel), 'utf8')
  fs.writeFileSync(path.join(restored, managedRel), `${managedOriginal}\n로컬 메모\n`)
  runInit(restored, '--no-scan', '--no-handoff', '--no-check', '--replace-file', managedRel)
  assert(read(restored, managedRel) === managedOriginal, '--replace-file on a locally modified managed file must restore the original (the preserve guard must not undo it)')
  assert(read(restored, `${managedRel}.harness-bak`).includes('로컬 메모'), 'the sidecar must hold the local edit')

  // Codex 1R #1: 심볼릭 링크 대상은 경고만 하고 두면 managed 파일의 일반 복사 경로가 링크 너머를 그대로 덮었다(경고가 거짓).
  // 복사도 꺼야 하고, 재편입도 링크는 들이지 않아야 한다(들이면 다음 업데이트가 링크 너머를 쓴다).
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-outside-'))
  const outsideFile = path.join(outside, 'terminology.md')   // termRel 은 위 CRLF 케이스에서 선언한 것을 그대로 쓴다
  fs.writeFileSync(outsideFile, fs.readFileSync(path.join(repoRoot, termRel), 'utf8'))
  const linked = makeTarget()
  runInit(linked, '--no-scan', '--no-handoff', '--no-check')
  fs.rmSync(path.join(linked, termRel))
  fs.symlinkSync(outsideFile, path.join(linked, termRel))
  const outsideBefore = fs.readFileSync(outsideFile, 'utf8')
  const symlinkOut = runInit(linked, '--no-scan', '--no-handoff', '--no-check', '--replace-file', termRel)
  assert(symlinkOut.includes('일반 파일이 아니라'), `a symlinked --replace-file target must be reported as skipped (got: ${symlinkOut.split('\n').filter((line) => line.includes(termRel)).join(' | ')})`)
  assert(fs.readFileSync(outsideFile, 'utf8') === outsideBefore && fs.lstatSync(path.join(linked, termRel)).isSymbolicLink(), 'the file beyond the symlink must be untouched and the link must remain')
  // Codex 3R #2: 차단된 대상은 전용 블록으로 보고되고, "--force 로 덮으세요"가 붙는 일반 보존 목록에는 안 나와야 한다(--force 로 풀리지 않는다).
  assert(symlinkOut.includes('일반 파일이 아니라 건너뛴 대상'), `blocked non-regular targets must get their own report block (got: ${symlinkOut.split('\n').filter((line) => line.includes('건너뛴') || line.includes('보존된')).join(' | ')})`)
  const preservedBlock = symlinkOut.split('보존된 프로젝트 소유 파일:')[1]?.split('\n\n')[0] ?? ''
  assert(!preservedBlock.includes(termRel), 'a blocked non-regular target must not be listed as a preserved project-owned file')
  // 재편입 경로: 관리 기록이 없는 링크(내용은 원본과 동치)는 관리 대상으로 들이지 않는다.
  const linkedFresh = makeTarget()
  fs.mkdirSync(path.join(linkedFresh, '.harness/project'), { recursive: true })
  fs.symlinkSync(outsideFile, path.join(linkedFresh, termRel))
  runInit(linkedFresh, '--no-scan', '--no-handoff', '--no-check')
  assert(!manifestOf(linkedFresh).managedFiles?.[termRel], 'a symlink must not be re-adopted as a managed file')
  assert(fs.readFileSync(outsideFile, 'utf8') === outsideBefore, 'installing next to a symlink must not write through it')

  const hookRel = '.claude/hooks/block-dangerous.sh'   // 아래 여러 라운드의 훅 케이스가 공유한다(선언은 첫 사용 앞에)
  // Codex 1R #2: 줄바꿈만 다른 훅은 충돌(원시 바이트)로 잡혀 --keep-hook 으로 유지되는데, 재편입(정규화 동치)이 그 파일을
  // 관리 대상으로 들여 다음 업데이트가 덮었다. 유지 결정이 재편입보다 우선해야 한다.
  const keptCrlf = makeTarget()
  fs.mkdirSync(path.join(keptCrlf, '.claude/hooks'), { recursive: true })
  fs.writeFileSync(path.join(keptCrlf, hookRel), fs.readFileSync(path.join(repoRoot, hookRel), 'utf8').replaceAll('\n', '\r\n'))
  runInit(keptCrlf, '--no-scan', '--no-handoff', '--no-check', '--keep-hook', 'block-dangerous')
  const keptManifest = manifestOf(keptCrlf)
  assert(!keptManifest.managedFiles?.[hookRel], 'a hook the user chose to keep must not be re-adopted as managed even when it differs only by line endings')
  assert(keptManifest.preservedForeignFiles?.includes(hookRel), 'the kept hook must stay recorded as preserved-foreign')
  assert(fs.readFileSync(path.join(keptCrlf, hookRel), 'utf8').includes('\r\n'), 'the kept file must be untouched')

  // Codex 2R #1: 비정규 판정은 최종이어야 한다 — --resync-managed 가 로컬 수정 가드에서 shouldCopy 를 다시 켜 링크 너머를 덮었다.
  const resyncLinked = makeTarget()
  runInit(resyncLinked, '--no-scan', '--no-handoff', '--no-check')
  const outsideDiff = path.join(outside, 'terminology-diff.md')
  fs.writeFileSync(outsideDiff, '# 밖의 파일 — 원본과 다른 내용\n')
  fs.rmSync(path.join(resyncLinked, termRel))
  fs.symlinkSync(outsideDiff, path.join(resyncLinked, termRel))
  runInit(resyncLinked, '--no-scan', '--no-handoff', '--no-check', '--replace-file', termRel, '--resync-managed')
  assert(fs.readFileSync(outsideDiff, 'utf8').startsWith('# 밖의 파일'), '--resync-managed must not re-enable the copy that the non-regular check refused (the file beyond the link must be untouched)')
  assert(fs.lstatSync(path.join(resyncLinked, termRel)).isSymbolicLink(), 'the link must remain in place')

  // Codex 2R #2: 훅 경로로 매핑된 --replace-file(= --replace-hook 결정)도 같은 비정규 파일 차단을 받아야 한다.
  const hookLinked = makeTarget()
  const outsideHook = path.join(outside, 'personal-hook.sh')
  fs.writeFileSync(outsideHook, '#!/bin/sh\necho outside\n')
  fs.mkdirSync(path.join(hookLinked, '.claude/hooks'), { recursive: true })
  fs.symlinkSync(outsideHook, path.join(hookLinked, hookRel))
  const hookLinkOut = runInit(hookLinked, '--no-scan', '--no-handoff', '--no-check', '--replace-file', hookRel)
  assert(fs.readFileSync(outsideHook, 'utf8').includes('echo outside'), 'a symlinked foreign hook replaced via --replace-file must not have the file beyond the link overwritten')
  assert(hookLinkOut.includes('일반 파일이 아니라'), `the skip must be reported (got: ${hookLinkOut.split('\n').filter((line) => line.includes(hookRel)).join(' | ')})`)
  // Codex 3R #3: 교체를 골랐는데 차단된 훅을 "--keep-hook 으로 유지"했다고 보고하면 안 된다.
  assert(!hookLinkOut.includes('--keep-hook 으로 유지'), `a blocked replace must not be reported as a keep decision (got: ${hookLinkOut.split('\n').filter((line) => line.includes('keep-hook')).join(' | ')})`)
  assert(!manifestOf(hookLinked).preservedForeignFiles?.includes(hookRel), 'a blocked non-regular hook must not be recorded as preserved-foreign (it is neither kept nor replaced)')

  // Codex 3R #1: 끊어진 심볼릭 링크는 existsSync 에 "없음"으로 보여 새 파일로 취급되고, writeFileSync 가 링크를 따라 밖에 파일을 만들었다.
  const dangling = makeTarget()
  const ghost = path.join(outside, 'ghost-dir', 'terminology.md')
  fs.mkdirSync(path.dirname(ghost), { recursive: true })   // 부모는 있고 파일은 없다 — 쓰기가 가능한 조건
  fs.mkdirSync(path.join(dangling, '.harness/project'), { recursive: true })
  fs.symlinkSync(ghost, path.join(dangling, termRel))
  const danglingDry = runInit(dangling, '--no-scan', '--no-handoff', '--no-check', '--dry-run')
  assert(danglingDry.includes(`[dry-run] skip ${termRel} (끊어진 심볼릭 링크)`), `dry-run must show the dangling link as skipped, not as add (got: ${danglingDry.split('\n').filter((line) => line.includes(termRel)).join(' | ')})`)
  const danglingOut = runInit(dangling, '--no-scan', '--no-handoff', '--no-check')
  assert(!fs.existsSync(ghost), 'installing over a dangling symlink must not create the file beyond the link')
  assert(fs.lstatSync(path.join(dangling, termRel)).isSymbolicLink(), 'the dangling link must be left in place for the user to clean up')
  assert(danglingOut.includes('일반 파일이 아니라 건너뛴 대상') && danglingOut.includes(termRel), `the dangling link must be listed in the non-regular report block (got: ${danglingOut.split('\n').filter((line) => line.includes('건너뛴') || line.includes(termRel)).join(' | ')})`)
  assert(!manifestOf(dangling).managedFiles?.[termRel], 'a dangling link must not be recorded as a managed file')

  // 사용자 결정 A(Codex 4R): 원칙을 한 곳에서 닫는다 — 링크 자리에는 어떤 경로로도 쓰지 않는다. 종전엔 자리별로 막아서
  // 한 자리를 막으면 다음 자리(백업·후처리·승계·--force)가 열렸다.
  // (a) 살아 있는 링크 + --force 동의: 종전엔 일반 복사가 링크 너머를 덮었다.
  const liveLinked = makeTarget()
  runInit(liveLinked, '--no-scan', '--no-handoff', '--no-check')
  const outsideLive = path.join(outside, 'live-target.md')
  fs.writeFileSync(outsideLive, '# 링크 너머의 내 파일\n')
  fs.rmSync(path.join(liveLinked, termRel))
  fs.symlinkSync(outsideLive, path.join(liveLinked, termRel))
  const forcedOut = runInit(liveLinked, '--no-scan', '--no-handoff', '--no-check', '--force', '--confirm-overwrite-project-files')
  assert(fs.readFileSync(outsideLive, 'utf8').startsWith('# 링크 너머'), 'even --force must not write through a live symlink')
  assert(forcedOut.includes('일반 파일이 아니라 건너뛴 대상') && forcedOut.includes(termRel), `the live-link skip must be listed in the non-regular report block (got: ${forcedOut.split('\n').filter((line) => line.includes('건너뛴') || line.includes(termRel)).join(' | ')})`)
  assert(!manifestOf(liveLinked).managedFiles?.[termRel], 'a symlinked path must not be inherited or recorded as managed (Codex 4R #3)')
  // (b) 백업 자리가 링크: 교체를 건너뛰고 링크 너머를 백업 내용으로 덮지 않는다 (Codex 4R #2).
  const bakLinked = makeTarget()
  runInit(bakLinked, '--no-scan', '--no-handoff', '--no-check')
  const outsideBak = path.join(outside, 'bak-target.json')
  fs.writeFileSync(outsideBak, '{"mine":true}\n')
  const bakRel = `${rel}.harness-bak`
  fs.symlinkSync(outsideBak, path.join(bakLinked, bakRel))
  const registryBefore = read(bakLinked, rel)
  const edited = JSON.parse(registryBefore)
  edited.policies.push({ ...edited.policies[0], id: 'project.bak.example', layer: 'project' })
  fs.writeFileSync(path.join(bakLinked, rel), `${JSON.stringify(edited, null, 2)}\n`)
  const bakOut = runInit(bakLinked, '--no-scan', '--no-handoff', '--no-check', '--replace-file', rel)
  assert(fs.readFileSync(outsideBak, 'utf8') === '{"mine":true}\n', 'the backup must not be written through a symlinked .harness-bak')
  assert(read(bakLinked, rel).includes('project.bak.example'), 'the replacement must be skipped when its backup cannot be written safely')
  assert(bakOut.includes('일반 파일이 아니라 건너뛴 대상') && bakOut.includes(rel), `the backup-link skip must be listed in the non-regular report block (got: ${bakOut.split('\n').filter((line) => line.includes('건너뛴') || line.includes(rel)).join(' | ')})`)
  // (c) 후처리(work-history 연도 폴더)도 링크 너머에 파일을 만들지 않는다 (Codex 4R #1).
  const whLinked = makeTarget()
  const year = String(new Date().getFullYear())
  const whRel = `.harness/maintenance/work-history/${year}/.gitkeep`
  const outsideKeep = path.join(outside, 'wh-ghost', '.gitkeep')
  fs.mkdirSync(path.dirname(outsideKeep), { recursive: true })
  fs.mkdirSync(path.join(whLinked, path.dirname(whRel)), { recursive: true })
  fs.symlinkSync(outsideKeep, path.join(whLinked, whRel))
  runInit(whLinked, '--no-scan', '--no-handoff', '--no-check')
  assert(!fs.existsSync(outsideKeep), 'the work-history post-processing must not create a file beyond a dangling link')

  // Codex 5R #1: 후처리 쓰기(.claude/settings.json 병합)는 루프의 차단을 모르고 링크 너머를 썼다 — 같은 게이트.
  const settingsLinked = makeTarget()
  const outsideSettings = path.join(outside, 'settings.json')
  fs.writeFileSync(outsideSettings, '{}\n')
  fs.mkdirSync(path.join(settingsLinked, '.claude'), { recursive: true })
  fs.symlinkSync(outsideSettings, path.join(settingsLinked, '.claude/settings.json'))
  const settingsOut = runInit(settingsLinked, '--no-scan', '--no-handoff', '--no-check', '--verbose')
  assert(fs.readFileSync(outsideSettings, 'utf8') === '{}\n', 'the settings merge must not write through a symlinked .claude/settings.json')
  assert(settingsOut.includes('심볼릭 링크라 하네스 훅 병합을 건너뜀'), `the skipped merge must be reported (got: ${settingsOut.split('\n').filter((line) => line.includes('settings.json')).join(' | ')})`)

  // Codex 1R #3: 외래 훅에 --replace-file 을 주면 훅 교체 결정으로 읽혀 교체된다(종전엔 충돌 사전 검사가 먼저 멈춰 닿지 못했다).
  const viaFile = makeTarget()
  fs.mkdirSync(path.join(viaFile, '.claude/hooks'), { recursive: true })
  fs.writeFileSync(path.join(viaFile, hookRel), '#!/bin/sh\necho personal\n')
  runInit(viaFile, '--no-scan', '--no-handoff', '--no-check', '--replace-file', hookRel)
  assert(read(viaFile, hookRel) === fs.readFileSync(path.join(repoRoot, hookRel), 'utf8'), '--replace-file on a foreign hook must replace it with the harness original')
  assert(read(viaFile, `${hookRel}.harness-bak`).includes('personal'), 'the personal hook must be kept as a .harness-bak sidecar')

  // 적대적 리뷰 P2: 같은 파일에 --keep-hook 과 --replace-file 을 함께 주면 모순이다 — 훅 결정 검사와 같이 멈춘다.
  const conflicted = makeTarget()
  fs.mkdirSync(path.join(conflicted, '.claude/hooks'), { recursive: true })
  fs.writeFileSync(path.join(conflicted, '.claude/hooks/block-dangerous.sh'), '#!/bin/sh\necho personal\n')
  let contradiction = ''
  try {
    runInit(conflicted, '--no-scan', '--no-handoff', '--no-check', '--keep-hook', 'block-dangerous', '--replace-file', '.claude/hooks/block-dangerous.sh')
  } catch (error) {
    contradiction = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(contradiction.includes('함께 지정'), `keep-hook + replace-file on the same file must be refused as a contradiction (got: ${contradiction.slice(0, 300)})`)
  assert(fs.readFileSync(path.join(conflicted, '.claude/hooks/block-dangerous.sh'), 'utf8').includes('personal'), 'the kept hook must be untouched after the refusal')
}

// 0.2.136 — 백엔드 첫 적용 리포트 ②: 설치 템플릿의 critical-paths 표는 비어 있는 상태로
// 시작한다(예시는 하네스가 읽지 않는 블록으로). 설치 첫날 유령 경고 0건.
function freshCriticalPathTemplateStartsEmpty() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const out = runGuard(target)
  assert(!out.includes('실존 대상이 없습니다'), 'a fresh install must not start with ghost critical-path warnings')
  assert(!out.includes('Critical path review'), 'the example block must not be parsed as live declarations')
}

// P0-1(0.2.71): harness:scan은 선언된 sources[] 경로가 실제 존재하는지만 검증한다(zero false positive).
// 없는 경로는 Open Questions로 표면화하고, 선언 소스를 인벤토리에 나열한다.
// 0.2.141: sources[]에 등록된 문서는 kind 값과 무관하게 규칙 문서다. 예전엔 kind에 숨은 단어 목록이
// 들어가야 인정해 `api-contract` 같은 라벨은 등록했는데도 "로컬 개발방법론 없음"이 떴다(문서화 안 된 가짜 손잡이).
function scanTreatsEveryDeclaredSourceAsRuleDoc() {
  const target = makeTarget()
  runInit(target)
  fs.mkdirSync(path.join(target, 'svc/multisite'), { recursive: true })
  fs.writeFileSync(path.join(target, 'svc/multisite/CLAUDE.md'), '# 서비스 룰\n')
  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  profile.sources = [{ path: 'svc/multisite/CLAUDE.md', kind: 'api-contract', owner: 'multisite' }]
  writeJson(target, '.harness/policy/profile.json', profile)
  // 로컬 방법론 문서를 지워 "규칙 문서가 하나도 없는" 상태를 만든다 — 등록 항목이 그 자리를 채워야 한다.
  for (const rel of ['.harness/project/local-methodology.md']) {
    try { fs.rmSync(path.join(target, rel)) } catch {}
  }
  run(harnessBin(target), ['scan'], { cwd: target })
  const report = read(target, '.harness/session/project-scan-report.md')
  assert(!report.includes('로컬 개발방법론 문서가 없습니다'), 'a declared source must count as a rule doc regardless of its kind label')
  assert(report.includes('svc/multisite/CLAUDE.md (exists') && report.includes('메모 — owner: multisite, kind: api-contract'), 'inventory shows the declared source with owner/kind as a memo')
  assert(!report.includes('"kind": "methodology"'), 'the registration guide must not present kind as a required switch')
  assert(report.includes('kind 값과 무관하게'), 'the registration guide must say kind does not change behavior')
}

function scanValidatesDeclaredProjectSources() {
  const target = makeTarget()
  runInit(target)

  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/team-conventions.md'), '# Team Conventions\n')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  profile.sources = [
    { path: 'docs/standards/team-conventions.md', kind: 'methodology', owner: 'team', inject: 'always' },
    { path: 'docs/standards/does-not-exist.md', kind: 'rule', owner: 'team', inject: 'context' },
  ]
  writeJson(target, '.harness/policy/profile.json', profile)

  run(harnessBin(target), ['scan'], { cwd: target })
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('### Declared Project Sources (profile.json sources[])'), 'scan report should include the declared project sources inventory')
  assert(report.includes('docs/standards/team-conventions.md') && report.includes('exists'), 'scan should mark an existing declared source as exists')
  assert(report.includes('docs/standards/does-not-exist.md'), 'scan should surface the missing declared source path')
  assert(/sources\[\]에 선언된 경로가 실제로 없습니다/.test(report), 'scan should raise an open question for a missing declared source path')
}

function installReportsExistingAiRuleDocuments() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/agent-rules.md'), '# Agent Rules\n\nAlways keep existing team AI rules visible.\n')
  run('git', ['add', 'docs/standards/agent-rules.md'], { cwd: target })

  const output = runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')
  const handoff = read(target, '.harness/session/handoff.md')

  assert(output.includes('기존 AI 작업 룰 후보 1건을 감지했습니다'), 'install output should summarize detected existing AI rule docs')
  assert(output.includes('::: 하네스가 바로 확인한 것 :::'), 'install output should show immediate harness effect summary')
  assert(output.includes('이번 설치는'), 'install output should explain what harness applied in this project')
  assert(output.includes('::: 다음 작업에서 달라지는 점 :::'), 'install output should include workflow change heading')
  assert(output.includes('작업 시작: `.harness/bin/harness context "<작업 설명>"`'), 'install output should explain how future work starts')
  assert(report.includes('### Existing AI Rule Document Candidates'), 'scan report should include existing AI rule candidate section')
  assert(report.includes('## Harness Effect Summary'), 'scan report should include a project-level harness effect summary')
  assert(report.includes('이번 설치는'), 'effect summary should explain what harness applied')
  assert(report.includes('## What Changes For Developers'), 'scan report should explain how developer workflow changes')
  assert(report.includes('작업 시작: `.harness/bin/harness context "<작업 설명>"`'), 'workflow summary should name context command')
  assert(report.includes('작업 완료: `.harness/bin/harness check`'), 'workflow summary should name final check command')
  assert(report.includes('테스트 루트나 test script가 없어 완료 기준이 사람마다 달라질 수 있습니다'), 'effect summary should expose missing verification strategy')
  assert(report.includes('docs/standards/agent-rules.md (미등록 후보'), 'scan report should list the pre-existing AI rule doc as unregistered')
  assert(report.includes('docs/standards/agent-rules.md (미등록 후보, rule-like markdown name, git tracked)'), 'scan report should show git tracked safety state')
  assert(report.includes('하네스는 위 후보 문서를 삭제하거나 자동 병합하지 않고 보존합니다'), 'scan report should explain preservation behavior')
  assert(report.includes('profile.json sources[]에 등록'), 'scan report should explain source registration')
  assert(report.includes('### Existing AI Rule Registration Guide'), 'scan report should include registration guide section')
  assert(report.includes('### Project Rule Authoring Guide'), 'scan report should include project rule authoring guide section')
  assert(report.includes('"path": "docs/standards/agent-rules.md"'), 'registration guide should include a concrete sources[] path example')
  assert(report.includes('inject: "always"'), 'registration guide should explain Always Read effect')
  assert(report.includes('git rm --cached <path>'), 'scan report should explain tracked personal-rule removal')
  assert(report.includes('.harness/project/workflow-rules.md'), 'project rule authoring guide should explain workflow rules target')
  assert(handoff.includes('## Harness Effect Summary'), 'handoff should include harness effect summary')
  assert(handoff.includes('## What Changes For Developers'), 'handoff should include workflow effect summary')
  assert(handoff.includes('작업 완료: `.harness/bin/harness check`'), 'handoff should repeat final check effect')
  assert(handoff.includes('## Existing AI Rules'), 'handoff should include existing AI rules summary')
  assert(handoff.includes('docs/standards/agent-rules.md'), 'handoff should repeat the detected AI rule doc')
  assert(handoff.includes('git rm --cached <path>'), 'handoff should explain tracked personal-rule removal')
  assert(handoff.includes('## Project Rule Authoring'), 'handoff should include project rule authoring guidance')
}

function scanReportsHeadingOnlyAiRuleDocuments() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/agent-rules.md'), '# Agent Rules\n')
  run('git', ['add', 'docs/standards/agent-rules.md'], { cwd: target })

  runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('docs/standards/agent-rules.md (미등록 후보, rule-like markdown name, git tracked)'), 'heading-only agent-rules.md should still be reported as an AI rule candidate')
}

function scanReportsIgnoredAiRuleCandidates() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, '.cursor/rules'), { recursive: true })
  fs.writeFileSync(path.join(target, '.cursor/rules/private.mdc'), '# Private Rule\n\nUse my temporary prompts.\n')
  fs.writeFileSync(path.join(target, '.gitignore'), '.cursor/rules/private.mdc\n')

  runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('.cursor/rules/private.mdc (미등록 후보, agent rule directory, .gitignore 적용됨)'), 'scan report should show ignored personal rule candidates')
  assert(report.includes('"path": "<team-rule-path.md>"'), 'registration guide should not use ignored personal files as the team-rule example')
}

// 0.2.146 — PHP 백엔드 마이그레이션 실측: 규약을 다 옮긴 뒤 원문을 `CONVENTIONS_BAK.md`로 남겨 두면(원작성자 참고용)
// 스캔이 매번 "미등록 룰 후보"로 잡아 잡음이었다. 이름에 bak/backup 토큰이 있는 파일은 후보로 보지 않는다.
// 원문 그대로인 CONVENTIONS.md 는 여전히 후보다(이름만 바꾼 게 아니라면 규약이 살아 있는 것).
function scanIgnoresArchivedRuleCopies() {
  const target = makeTarget()
  const body = '# 팀 규약\n\n- 모든 쿼리는 파라미터 바인딩을 쓴다.\n'
  fs.writeFileSync(path.join(target, 'CONVENTIONS.md'), body)
  fs.writeFileSync(path.join(target, 'CONVENTIONS_BAK.md'), body)
  fs.writeFileSync(path.join(target, 'rules.bak.md'), body)
  fs.writeFileSync(path.join(target, 'old-rules-backup.md'), body)
  fs.writeFileSync(path.join(target, 'bakery-rules.md'), body) // "bak" 이 토큰이 아니라 단어 일부 — 후보다
  runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('CONVENTIONS.md (미등록 후보'), 'the live conventions file must still be a candidate')
  assert(report.includes('bakery-rules.md (미등록 후보'), 'a name that merely contains the letters "bak" is still a candidate')
  for (const rel of ['CONVENTIONS_BAK.md', 'rules.bak.md', 'old-rules-backup.md']) {
    assert(!report.includes(rel), `an archived copy (${rel}) must not be listed as a rule candidate`)
  }
}

function scanPrefersTrackedAiRuleForRegistrationExample() {
  const target = makeTarget()
  fs.mkdirSync(path.join(target, '.cursor/rules'), { recursive: true })
  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, '.cursor/rules/private.mdc'), '# Private Rule\n\nUse my temporary prompts.\n')
  fs.writeFileSync(path.join(target, 'docs/standards/agent-rules.md'), '# Agent Rules\n\nAlways keep existing team AI rules visible.\n')
  fs.writeFileSync(path.join(target, '.gitignore'), '.cursor/rules/private.mdc\n')
  run('git', ['add', 'docs/standards/agent-rules.md'], { cwd: target })

  runInit(target)
  const report = read(target, '.harness/session/project-scan-report.md')

  assert(report.includes('.cursor/rules/private.mdc (미등록 후보, agent rule directory, .gitignore 적용됨)'), 'scan report should include ignored personal candidate')
  assert(report.includes('docs/standards/agent-rules.md (미등록 후보, rule-like markdown name, git tracked)'), 'scan report should include tracked team-like candidate')
  assert(report.includes('"path": "docs/standards/agent-rules.md"'), 'registration guide should prefer tracked team-like candidates')
  assert(!report.includes('"path": ".cursor/rules/private.mdc"'), 'registration guide should not prefer ignored personal candidates')
}

// 이력 로그 예외(0.2.90, score-print P3): decision-log 계열의 백틱 코드 경로는 역사 참조라
// 라이브 무결성 검사에서 제외한다. 살아있는 세션/기준 문서는 계속 검사한다.
function historyLogPathClassifiesDecisionLogFamily() {
  assert(isHistoryLogPath('.harness/session/decision-log.md'), 'decision-log is a history log')
  assert(isHistoryLogPath('.harness/session/decision-log-2026H1.md'), 'decision-log archive is a history log')
  assert(isHistoryLogPath('.harness/session/thread-handoff-2026-08-04.md'), 'thread handoff snapshot is a history log')
  assert(isHistoryLogPath('.github/session/decision-log.md'), 'legacy .github harness root decision-log is a history log')
  assert(!isHistoryLogPath('.harness/session/active-context.md'), 'living session state doc must still be checked')
  assert(!isHistoryLogPath('.harness/session/project-memory.md'), 'project memory must still be checked')
  assert(!isHistoryLogPath('.harness/project/domain-rules.md'), 'standards docs must still be checked')
}

function consumerDocLinkCheckSkipsDecisionLogHistoryPaths() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // 이력 항목이 언급하는 삭제된 소스 경로(역사 참조)는 dead code path로 잡히면 안 된다.
  // 반면 이력 문서 안에서도 마크다운 링크는 탐색용이라 계속 검사되어야 한다.
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 구조 정리\n- `src/apis/system.js`를 제거하고 호출부를 정리했다.\n- [폐기 설계](../project/removed-design.md) 참조.\n',
  )
  fs.writeFileSync(
    path.join(target, '.harness/session/decision-log-2026H1.md'),
    '# 결정 로그 아카이브 (2026 상반기)\n\n- `src/store/settings.js`를 폐기했다.\n',
  )

  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!out.includes('src/apis/system.js'), 'decision-log history code path must not be reported as dead reference')
  assert(!out.includes('src/store/settings.js'), 'decision-log archive code path must not be reported as dead reference')
  assert(!out.includes('decision-log-2026H1.md'), 'dynamically named decision-log archive must not be reported as orphan')
  assert(out.includes('removed-design.md'), 'markdown links inside history logs must still be checked')
}

function consumerDocLinkCheckStillFlagsLiveDocDeadPaths() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // 이력 예외가 살아있는 기준 문서의 진짜 dead 참조까지 가리면 안 된다.
  fs.appendFileSync(
    path.join(target, '.harness/project/domain-rules.md'),
    '\n## 규칙 근거\n- 판정 구현: `src/rules/engine.js`\n',
  )

  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(out.includes('src/rules/engine.js'), 'live standards docs must still flag dead code paths')
  assert(out.includes('code-path'), 'dead reference should keep the code-path kind label')
}

// 통과 시 1줄 출력(0.2.90, score-print P4): 신호 대 잡음비를 위해 clean 결과는 요약 한 줄로 끝낸다.
function docLinkCheckPrintsSingleLineWhenClean() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  const lines = out.trim().split('\n')
  assert(lines.length === 1, `clean doc-link check should print a single line, got ${lines.length}: ${out}`)
  assert(lines[0].includes('OK'), 'clean doc-link check line should state OK')
}

// 개발자가 가장 자연스럽게 쓰는 말이 가장 나쁜 결과를 내면 안 된다.
// "개발"이 유형 키워드에 없어 unknown/low로 떨어졌고, 유형 가점이 죽어 관련 문서가 밀리고
// 엉뚱한 스킬(JIRA 운영 업무 접수)이 올라왔다(2026-08-11 multisite 실측).
// 코딩 규약 문서(2026-09-08, 0.2.143): 언어·문법 제약·서식·네이밍은 도메인도 구조도 절차도 아니라 룰 문서 지도에
// 칸이 없었다 — PHP 백엔드 규약을 찢을 때 그 절들이 갈 곳이 없어 별도 문서로 남았다(사용자 지적). 표준 프로젝트
// 문서로 추가한다: 새 설치에 실리고, 프로젝트 소유라 업데이트가 덮지 않고, 등록돼 있어 orphan이 아니며,
// 컨텍스트가 네이밍·문법 요청에 골라내고, 스캔의 읽기 순서와 업데이트 대상 목록에 들어 있어야 한다.
function codingConventionsShipsAsProjectOwnedRuleDoc() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const rel = '.harness/project/coding-conventions.md'
  assert(exists(target, rel), 'a fresh install must ship the coding conventions rule doc')
  assert(read(target, rel).includes('## 금지 문법·API') && read(target, rel).includes('## 네이밍'), 'the skeleton must carry the sections the migration table points at')

  // 프로젝트 소유: 팀이 채운 내용을 업데이트가 덮지 않는다
  fs.writeFileSync(path.join(target, rel), '# 코딩 규약\n\n## 금지 문법·API\n| `match` | `switch` |\n')
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  assert(read(target, rel).includes('| `match` | `switch` |'), 'the team\'s conventions must survive an update (project-owned)')

  // 컨텍스트가 골라낸다
  run(harnessBin(target), ['context', '클래스 네이밍 규칙과 금지 문법 정리'], { cwd: target })
  assert(read(target, '.harness/session/task-context.md').includes(rel), 'a naming/syntax request must surface the coding conventions doc')

  // 스캔 리포트의 읽기 순서·업데이트 대상에 들어 있다
  run(harnessBin(target), ['scan'], { cwd: target })
  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes(rel), 'the scan report must list the doc among project rule docs')

  // 진입점 읽기 목록과 가이드 표에도 있다(같은 지도를 세 곳이 보여야 한다)
  assert(read(target, 'CLAUDE.md').includes(rel), 'CLAUDE.md task-specific reading list must include it')
  assert(read(target, '.harness/project/project-harness-guide.md').includes('`coding-conventions.md`'), 'the guide responsibility table must include it')
}

// 코딩 규약은 채워지면 자동으로 항상 읽기(2026-09-08 사용자 지적): 기능·버그 작업 컨텍스트에는 작업 유형만으로 골라지지만,
// 컨텍스트를 만들지 않는 작은 수정에서는 이름만 남는다. "profile sources에 inject: always를 넣어라"를 마이그레이션 단계로
// 두면 새로 하네스를 입힌 프로젝트가 정확히 빠진다. 정의상 모든 코드 변경에 걸리는 규칙이라 채워진 순간 항상 읽기가 맞고,
// 빈 뼈대일 땐 넣지 않는다(소음).
function codingConventionsBecomeAlwaysReadOnceFilled() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const rel = '.harness/project/coding-conventions.md'
  const alwaysSection = () => read(target, '.harness/session/task-context.md').split('## Always Read')[1].split('\n## ')[0]

  run(harnessBin(target), ['context', '결제 취소 API 버그 수정'], { cwd: target })
  assert(!alwaysSection().includes(rel), 'the empty skeleton must not be always-read (noise)')

  // 팀이 규칙 한 줄을 채운다 — 등록 없이.
  const doc = read(target, rel).replace('## 금지 문법·API\n- `TBD` — "금지 | 대신 사용" 표 형식을 권합니다', '## 금지 문법·API\n\n| 금지 | 대신 사용 |\n|---|---|\n| `match` | `switch` |')
  assert(doc !== read(target, rel), 'the fixture must actually fill a rule (precondition)')
  fs.writeFileSync(path.join(target, rel), doc)
  run(harnessBin(target), ['context', '결제 취소 API 버그 수정'], { cwd: target })
  assert(alwaysSection().includes(rel), 'once a rule is filled the doc must be always-read without any profile registration')
  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  assert(!(profile.sources ?? []).some((src) => src.path === rel), 'no profile sources[] line is needed (precondition of the claim)')
  assert(alwaysSection().split(rel).length === 2, 'the doc must appear once even if also matched elsewhere')
}

// 0.2.142: 스킬 목록(registry.json)이 가리키는 경로·명령을 아무도 검증하지 않아 결함 3건이
// 살아 있었다 — 소비자에 존재한 적 없는 npm 별칭(`npm run docs:check:strict`, 0.2.131에서 별칭
// 주입이 0이 됨)과 리터럴 `YYYY` 경로 2건. 에이전트는 이 목록을 보고 읽을 파일과 실행할 명령을
// 정하므로, 없는 것을 가리키면 그 스킬은 조용히 헛돈다. **설치본 기준**으로 검증한다.
function skillRegistryPointsAtRealFilesAndCommands() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const registry = JSON.parse(read(target, '.harness/skills/registry.json'))

  // 옵트인·명령 실행으로 생기는 산출물 — 설치 직후에 없는 것이 정상이다.
  const optionalRuntimeArtifacts = new Set([
    '.harness/spec-sources.json', // 기획 연동을 켠 프로젝트에만
    '.harness/spec-lock.json', // 〃
    '.harness/project/issue-adapter.md', // 견본을 복사해 켠 프로젝트에만
    '.harness/session/project-scan-report.md', // harness scan 실행 산출물
  ])
  const isPlaceholder = (value) => value.includes('<') || value.includes('*')

  const missing = []
  for (const skill of registry.skills) {
    // 본체 유지보수용 스킬은 소비자에게 배포되지 않는 문서를 가리킨다 — 시드 저장소 기준으로 본다.
    const bodyOnly = (skill.audience ?? []).length > 0 && !(skill.audience ?? []).includes('consumer')
    const root = bodyOnly ? repoRoot : target
    const has = (rel) => fs.existsSync(path.join(root, rel))
    for (const key of ['read', 'records']) {
      for (const rel of skill[key] ?? []) {
        if (isPlaceholder(rel) || optionalRuntimeArtifacts.has(rel)) continue
        if (!has(rel)) missing.push(`${skill.id} ${key}: ${rel}`)
      }
    }
    for (const command of skill.commands ?? []) {
      assert(!command.startsWith('npm run '),
        `skill ${skill.id} must not depend on an npm alias — the harness injects none since 0.2.131: ${command}`)
      const script = command.match(/(\.harness\/bin\/[A-Za-z0-9_.-]+)/)
      if (script && !has(script[1])) missing.push(`${skill.id} command: ${script[1]}`)
    }
  }
  assert(missing.length === 0, `skill registry points at files that do not ship: ${missing.join(' | ')}`)

  // 자리표시자는 실제 경로처럼 보이면 안 된다 — 리터럴 YYYY가 그렇게 새어 들어왔다.
  const raw = read(target, '.harness/skills/registry.json')
  assert(!raw.includes('work-history/YYYY'), 'a literal YYYY path must not pose as a real directory')
}

// 프로젝트가 자기 문서를 등록하는 통로는 둘이다(sources[]와 document-registry.local.json).
// 후자만 등록한 문서를 계속 "미등록 후보"로 지목하면, 권한 대로 등록한 사람에게 같은 지적이 반복된다.
function scanTreatsLocallyRegisteredDocsAsHandled() {
  const target = makeTarget()
  runInit(target)
  fs.mkdirSync(path.join(target, 'svc/multisite'), { recursive: true })
  fs.writeFileSync(path.join(target, 'svc/multisite/CLAUDE.md'), '# 서비스 진입 포인터\n\n규칙 정본은 docs/rules.md 입니다.\n')
  writeJson(target, '.harness/documentation/document-registry.local.json', { children: ['svc/multisite/CLAUDE.md'] })

  run(harnessBin(target), ['scan'], { cwd: target })
  const report = read(target, '.harness/session/project-scan-report.md')
  assert(report.includes('svc/multisite/CLAUDE.md (document-registry.local.json 등록됨'), 'a locally registered doc must be shown as registered, naming the channel')
  assert(!report.includes('svc/multisite/CLAUDE.md (미등록 후보'), 'a locally registered doc must not be repeated as an unregistered candidate')
}

// 프로젝트 소유 문서를 지워도 본체 레지스트리 때문에 매 커밋 경고가 뜨면 안 된다(0.2.102).
// 지울 권리가 있는 파일을 필수처럼 다루는 모순이라, 실제 소비자 업그레이드에서 노이즈로 관측됐다.
function docLinkTreatsDeletedProjectOwnedDocsAsOptional() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  fs.rmSync(path.join(target, '.harness/project/spec-map.md'), { force: true })
  const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!out.includes('spec-map.md'), 'a deleted project-owned doc must not be reported as missing or as a broken link')
  assert(out.includes('OK'), 'the check should pass cleanly after a project-owned doc is deleted')

  // 본체 managed 문서는 여전히 없으면 잡아야 한다(면제가 과하게 넓어지지 않았는지).
  fs.rmSync(path.join(target, '.harness/project/portability-guide.md'), { force: true })
  const strictOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(strictOut.includes('portability-guide.md'), 'a deleted managed doc must still be reported')
}

// P1-8(0.2.102 리뷰): 소유(project-owned)와 선택성(optional)은 다른 속성이다.
// project-owned 전부를 optional로 보면 profile/settings 삭제까지 조용해진다.
function docLinkKeepsRequiredProjectOwnedDocsMandatory() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  // spec 연동을 쓰지 않으면 없어도 되는 파일 → 허용.
  fs.rmSync(path.join(target, '.harness/project/spec-map.md'), { force: true })
  const optionalOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(optionalOut.includes('OK'), 'an optional project-owned doc may be absent')

  // project-owned이지만 구조적으로 중요한 문서는 계속 필수.
  fs.rmSync(path.join(target, '.harness/project/config-contract.md'), { force: true })
  const requiredOut = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(requiredOut.includes('config-contract.md'), 'a required project-owned doc must still be reported when deleted')
}

// 레지스트리 회귀 게이트 편입(0.2.96): test:standards-registry / test:template-registry가
// test-init(=pre-commit 게이트) 밖에 있어, 레지스트리 ref 범프로 픽스처가 깨져도 훅이 통과했다
// (2026-08-05 실증 — 파이프에 가린 수동 실행 실패가 그대로 커밋됨). 게이트 안으로 옮긴다.
function approvedRegistryListingsStayConsistent() {
  run(nodeBin, [path.join(repoRoot, 'scripts/test-standards-registry.mjs')])
  run(nodeBin, [path.join(repoRoot, 'scripts/test-template-registry.mjs')])
}

// score-print 개선요청(2026-08-25): 프로젝트가 만든 문서는 registry에 등록하지 않으면 orphan,
// 등록하면 managed drift로 업데이트에서 제외 — 출구가 없었다. 프로젝트 소유 등록 지점
// (document-registry.local.json)이 그 출구다. 부재가 정상이고, 등록 경로는 main registry와 같이
// missing 검사를 받으며(오타 fail-loud), 컨텍스트 후보 선별에도 포함된다(orphan 면제 우회를 기각한 이유).
function localDocumentRegistryGivesProjectOwnedRegistrationPoint() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  const localRel = '.harness/documentation/document-registry.local.json'
  const managedRel = '.harness/documentation/document-registry.json'
  const manifest = JSON.parse(read(target, '.harness/install-manifest.json'))
  assert(!manifest.managedFiles[localRel], 'the local registry must not be managed — it is the project-owned escape hatch')
  assert(!exists(target, localRel), 'the local registry must not ship — absence is the normal state')

  const docRel = '.claude/commands/project-own.md'
  fs.mkdirSync(path.join(target, '.claude/commands'), { recursive: true })
  fs.writeFileSync(path.join(target, docRel), '# 프로젝트 자체 명령\n\n다국어 리소스 싱크 절차입니다.\n')
  const before = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  assert(before.includes(docRel), 'an unregistered project doc must still be reported as orphan')

  fs.writeFileSync(path.join(target, localRel), JSON.stringify({ children: [docRel] }, null, 2))
  const after = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
  assert(!after.includes(`- ${docRel}`), 'registering in the local registry must clear the orphan report')
  const managedSha = sha256Text(read(target, managedRel))
  assert(managedSha === manifest.managedFiles[managedRel].sha256, 'the managed registry must stay untouched — that is the whole point')

  // 오타 경로는 조용히 무시되지 않고 missing으로 잡혀야 한다.
  fs.writeFileSync(path.join(target, localRel), JSON.stringify({ children: [docRel, '.claude/commands/typo.md'] }, null, 2))
  let flagged = false
  try {
    const out = run(nodeBin, [path.join(target, '.harness/bin/doc-link-check.mjs')], { cwd: target })
    flagged = out.includes('typo.md')
  } catch (error) {
    flagged = String(error.stdout ?? '').includes('typo.md')
  }
  assert(flagged, 'a typo in the local registry must fail loud, not vanish')

  // 컨텍스트 후보 선별에도 들어가야 한다(orphan 면제 glob 우회를 기각한 이유).
  fs.writeFileSync(path.join(target, localRel), JSON.stringify({ children: [docRel] }, null, 2))
  run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '다국어 리소스 싱크 절차'], { cwd: target })
  assert(read(target, '.harness/session/task-context.md').includes(docRel), 'locally registered docs must be selectable as task context candidates')
}

export {
  scanReportDraftsStyleRulesFromConfigFiles,
  isIgnorableCodePathClassifiesExamplesAndCiPaths,
  consumerDocLinkCheckIgnoresCiExamplePaths,
  consumerDocLinkCheckHandlesAbsentSeedOnlyDoc,
  freshInstallHasNoRegistryOrphans,
  criticalPathGhostDeclarationsGetNoticed,
  criticalPathCellWithMultipleBacktickPathsMatchesEach,
  orphanNoticePointsToLocalRegistryExit,
  localPolicyRegistryIsMergedAndProjectOwned,
  preservedForeignRegistryIsGuidedAndReadopted,
  freshCriticalPathTemplateStartsEmpty,
  scanTreatsEveryDeclaredSourceAsRuleDoc,
  scanValidatesDeclaredProjectSources,
  installReportsExistingAiRuleDocuments,
  scanReportsHeadingOnlyAiRuleDocuments,
  scanReportsIgnoredAiRuleCandidates,
  scanIgnoresArchivedRuleCopies,
  scanPrefersTrackedAiRuleForRegistrationExample,
  historyLogPathClassifiesDecisionLogFamily,
  consumerDocLinkCheckSkipsDecisionLogHistoryPaths,
  consumerDocLinkCheckStillFlagsLiveDocDeadPaths,
  docLinkCheckPrintsSingleLineWhenClean,
  codingConventionsShipsAsProjectOwnedRuleDoc,
  codingConventionsBecomeAlwaysReadOnceFilled,
  skillRegistryPointsAtRealFilesAndCommands,
  scanTreatsLocallyRegisteredDocsAsHandled,
  docLinkTreatsDeletedProjectOwnedDocsAsOptional,
  docLinkKeepsRequiredProjectOwnedDocsMandatory,
  approvedRegistryListingsStayConsistent,
  localDocumentRegistryGivesProjectOwnedRegistrationPoint,
}
