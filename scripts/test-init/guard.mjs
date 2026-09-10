// guard/check·컨텍스트 빌드·검증 캐시 회귀. 실행 등록은 scripts/test-init.mjs의 tests 배열이 정본이다.
import fs from 'node:fs'
import path from 'node:path'
import {
  nodeBin,
  run,
  harnessBin,
  assert,
  read,
  writeJson,
  makeTarget,
  runInit,
  runGuard,
  gitCommitAll,
  makeSyncHookPreset,
  setupSyncReviewTarget,
  setupSpecLinkedTarget,
  expectFailure,
} from './helpers.mjs'

function workflowWorkstreamChangeDoesNotTriggerCommitPushHookPolicy() {
  const target = makeTarget()

  runInit(target)
  run('git', ['add', '.'], { cwd: target })
  run('git', [
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'baseline',
  ], { cwd: target })

  fs.appendFileSync(path.join(target, '.harness/project/workflow-rules.md'), `

## Workstream 운영
- 긴 대화창은 업무 흐름별로 분리합니다.
`)

  const workflowImpact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact'], { cwd: target })
  assert(!workflowImpact.includes('common.hooks.commit-push-check'), 'workflow workstream-only change should not trigger commit/push hook policy')

  fs.appendFileSync(path.join(target, '.harness/project/commit-push-rules.md'), `

## 프로젝트 예외
- 커밋 전 검증은 팀 기준에 맞게 조정할 수 있습니다.
`)

  const hookImpact = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'impact'], { cwd: target })
  assert(hookImpact.includes('common.hooks.commit-push-check'), 'commit/push rules change should trigger commit/push hook policy')
}

// 검증 캐시(0.2.70): 같은 git tree면 관문 검사(policy/doc-link/managed drift 등) 전체를 스킵해
// push/배포 중복 검사를 제거한다. 캐시 축에 있던 stack verify는 0.2.131 verify 제거로 빠졌다.
function guardCacheHitSkipsRevalidationOnSameTree() {
  const target = makeTarget()
  runInit(target)
  // 안내 등급 항목이 캐시 히트에서도 나와야 한다(멀티사이트 #24, 2026-09-08): 업데이트 내부 검사가 캐시를
  // 채운 뒤 소비자가 "뭐가 달라졌나" 보려고 돌린 check가 critical path 유령 경로 안내를 한 줄도 안 냈다.
  // 캐시는 "이 tree가 검증을 통과했는가"의 답이고, 안내는 통과 여부와 무관한 현재 상태다 — 드리프트와 같은 사유.
  fs.writeFileSync(path.join(target, '.harness/project/critical-paths.md'), `# Critical Paths\n\n## 선언 표\n\n| path | 왜 중요한가 | 권장 검증 |\n| --- | --- | --- |\n| \`legacy/ghost/**\` | 없는 경로 | 없음 |\n`)
  const first = runGuard(target) // 1회차: 캐시 미스 → 전체 검증 → 통과 기록
  assert(first.includes('실존 대상이 없습니다'), 'a ghost critical path must be reported on a cache miss (precondition)')
  const second = runGuard(target) // 2회차: 같은 tree → 캐시 재사용
  assert(second.includes('캐시 재사용'), 'second guard run on the same git tree should reuse the validation cache')
  assert(second.includes('실존 대상이 없습니다'), 'advisory notices (ghost critical paths) must still print on a cache hit — the cache answers "did this tree pass", not "is there nothing to tell"')
}

function guardFullCacheSatisfiesFastRequest() {
  const target = makeTarget()
  runInit(target)
  runGuard(target) // full 통과 기록 (commit hook 시뮬)
  const fast = runGuard(target, '--fast') // push hook 시뮬: full ⊇ fast 이므로 full 캐시 재사용
  assert(fast.includes('캐시 재사용'), 'fast request should reuse a full cache on the same tree (full superset of fast)')
}

function guardNoCacheForcesRevalidation() {
  const target = makeTarget()
  runInit(target)
  runGuard(target) // 기록
  const out = runGuard(target, '--no-cache')
  assert(!out.includes('캐시 재사용'), '--no-cache must force full revalidation, never reuse cache')
}

function guardCacheMissAfterTreeChange() {
  const target = makeTarget()
  runInit(target)
  runGuard(target) // 기록
  fs.appendFileSync(path.join(target, '.harness/project/domain-rules.md'), '\n<!-- tree change -->\n')
  const out = runGuard(target) // working tree가 바뀌어 키가 달라짐 → 미스 → 재검증
  assert(!out.includes('캐시 재사용'), 'a changed git tree must miss the cache and revalidate')
}

// P0-1(0.2.71): profile.json의 프로젝트 소유 sources[]에 inject:always로 선언된
// 비표준 위치 룰 문서를 build-context가 Always Read에 병합한다(본체는 읽기만 함).
function buildContextMergesProfileAlwaysSources() {
  const target = makeTarget()
  runInit(target)

  fs.mkdirSync(path.join(target, 'docs/standards'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/standards/team-conventions.md'), '# Team Conventions\n\n팀 규칙.\n')
  fs.writeFileSync(path.join(target, 'docs/standards/reference.md'), '# Reference\n')

  const profile = JSON.parse(read(target, '.harness/policy/profile.json'))
  profile.sources = [
    { path: 'docs/standards/team-conventions.md', kind: 'methodology', owner: 'team', inject: 'always' },
    { path: 'docs/standards/reference.md', kind: 'reference', owner: 'team', inject: 'context' },
  ]
  writeJson(target, '.harness/policy/profile.json', profile)

  run(harnessBin(target), ['context', 'context smoke'], { cwd: target })
  const context = read(target, '.harness/session/task-context.md')
  const alwaysSection = (context.split('## Always Read\n')[1] ?? '').split('\n## ')[0]

  assert(alwaysSection.includes('docs/standards/team-conventions.md'), 'build-context should merge inject:always profile source into Always Read')
  assert(alwaysSection.includes('(project source: profile.json sources[])'), 'merged project source should be tagged as project-declared in Always Read')
  assert(!alwaysSection.includes('docs/standards/reference.md'), 'a source with inject other than always must not be merged into Always Read')
}

// guard 요약 기본(0.2.90, score-print P4): guard 경로의 기본 출력은 요약이고 상세는 --verbose.
// 픽스처 주의: 문서가 정책의 documents에만 있어야 한쪽 변경 gap이 생긴다.
// workflow-rules.md는 local-rule.promotion의 documents와 ownedAreas 양쪽에 있어 gap이 되지 않는다.
// portability-guide.md는 minimum-node의 documents에만 있어 로컬 수정 시 document-only 후보가 된다
// (harnessBaselineDocUpdateDoesNotTriggerSyncGap의 검증된 픽스처와 동일).
function guardModeDefaultsToSummaryImpactOutput() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')

  fs.appendFileSync(
    path.join(target, '.harness/project/portability-guide.md'),
    '\n## Local project edit\n- 프로젝트가 직접 수정한 런타임 기준입니다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('기준 동기화 검토 후보'), 'summary output should keep the sync candidate header')
  assert(/(가볍게 확인|참고) \d+건/.test(summary), 'summary output should aggregate advisory candidates as counts')
  assert(!summary.includes('연결 문서:'), 'default guard output must not expand advisory candidate detail')
  assert(!summary.includes('trigger files:'), 'default guard output must not expand per-policy file mappings')
  assert(summary.includes('--verbose'), 'summary output should point to the detailed path')
  // P4 잔여 압축(0.2.94): 요약 모드의 변경 파일 분류는 한 줄이다.
  assert(/Changed files: user \d+/.test(summary), 'summary mode should compress changed-file groups to one line')
  assert(!summary.includes('Changed files brief:'), 'summary mode must not print the old two-block breakdown')

  const detailed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--verbose'], { cwd: target })
  assert(detailed.includes('연결 문서:'), '--verbose should expand candidate detail')
  assert(detailed.includes('[common.runtime.minimum-node]'), '--verbose should name the linked policy')
}

function guardSummaryStillDetailsMustActSyncCandidates() {
  const target = makeTarget()
  const preset = makeSyncHookPreset()

  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  run(harnessBin(target), ['stack:apply', '--preset-path', preset], { cwd: target })
  fs.mkdirSync(path.join(target, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(target, 'docs/contract.md'), '# 계약 문서\n')
  gitCommitAll(target, 'baseline')

  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('[확인 필수] [stack.demo.contract-sync]'), 'hook-enforced candidate must surface as 확인 필수 in summary mode')
  assert(summary.includes('연결 문서:'), 'must-act candidate must expand detail even in summary mode')
  assert(summary.includes('docs/contract.md'), 'must-act detail should include the linked contract document')

  let failed = false
  let combined = ''
  try {
    run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  } catch (error) {
    failed = true
    combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(failed, 'strict mode must fail when a hook-enforced sync candidate is open')
  assert(combined.includes('[확인 필수] [stack.demo.contract-sync]'), 'strict failure output must include the failing candidate detail')
}

function guardEscalatesSyncCandidatesOnReversalCommit() {
  const target = setupSyncReviewTarget()
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - 인쇄 후 첫화면 복귀 ⛔ 번복됨(2026-08-04, 현재 화면 유지로 대체)\n- 새 결정: 인쇄 후 현재 화면을 유지한다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('정책 번복 감지'), 'reversal banner in decision-log diff must be announced')
  assert(summary.includes('[확인 필수] [stack.demo.contract-review]'), 'reversal commit must escalate default review candidates to 확인 필수')
  assert(summary.includes('연결 문서:'), 'escalated candidate must expand detail in summary mode')

  let failed = false
  let combined = ''
  try {
    run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  } catch (error) {
    failed = true
    combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  assert(failed, 'strict mode must fail on a reversal commit with open sync candidates')
  assert(combined.includes('정책 번복 감지'), 'strict failure output must explain the reversal escalation')
}

function guardDoesNotEscalateProseWithoutBannerEmoji() {
  const target = setupSyncReviewTarget()
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - 구형 API 정리\n- 레거시 목 API를 폐기했다. 관련 결정을 번복 없이 유지한다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!summary.includes('정책 번복 감지'), 'prose 폐기/번복 mentions without ⛔ must not trigger reversal escalation')
  assert(!summary.includes('[확인 필수]'), 'default review candidate must stay advisory without a reversal banner')
  assert(/가볍게 확인 \d+건/.test(summary), 'default review candidate should remain a summarized advisory count')
}

function guardNoticesLogOnlyReversalCommit() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - 세션 수명 30일 ⛔ 폐기됨(2026-08-04, 1일로 축소)\n- 새 결정: 세션 수명은 1일.\n',
  )

  // 동기화 후보가 없는 로그 단독 번복 커밋: 안내는 나오되 실패하지 않는다(strict 포함).
  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('정책 번복 감지'), 'log-only reversal commit should still print the reversal notice')
  const strict = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  assert(strict.includes('정책 번복 감지'), 'strict log-only reversal should print the notice without failing')
}

// 권고 뒤집기 기록 검사(0.2.91, score-print P1 축소): [권고 뒤집기] 항목이 추가되면
// 같은 diff에 근거 반박: 필드가 있어야 한다. 없으면 확인 필수, strict에서는 실패.
function guardLintsOverrideEntryRebuttalField() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '\n## 2026-08-04 - CSS purge 채택 [권고 뒤집기]\n- 번들 감사가 purge를 비권장했지만 채택한다.\n',
  )

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('권고 뒤집기 기록 검사'), 'override entry without rebuttal must be reported')
  assert(summary.includes('근거 반박'), 'override finding should name the missing field')

  const guardOut = runGuard(target)
  assert(guardOut.includes('필수 조치: 1건'), 'guard summary must count the missing rebuttal as required action')
  assert(guardOut.includes('결과: 조치 필요'), 'guard summary result should demand action for missing rebuttal')
  // 차단 옵트인 표면화(0.2.94): 필수 조치가 있을 때만 strict 승격 안내가 나온다.
  assert(guardOut.includes('harnessMode: strict'), 'guard summary should surface the strict escalation hint when required actions exist')

  let failed = false
  try {
    run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  } catch {
    failed = true
  }
  assert(failed, 'strict mode must fail when an override entry lacks the rebuttal field')

  // 같은 diff에 근거 반박을 채우면 검사는 통과한다.
  fs.appendFileSync(
    path.join(target, '.harness/session/decision-log.md'),
    '- 근거 반박: 키오스크 전 화면을 E2E 스냅샷으로 커버해 safelist 누락이 빌드에서 실패한다.\n',
  )
  const fixed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--strict'], { cwd: target })
  assert(!fixed.includes('권고 뒤집기 기록 검사'), 'override entry with rebuttal must not be reported')
}

// decision-log 임계 안내(0.2.92, score-print P5): 임계(400줄) 초과 상태에서 "그 파일을 만진"
// 커밋에만 아카이브 분리를 안내한다. 초과 상태여도 안 만진 커밋에는 반복 안내하지 않는다.
function guardNudgesDecisionLogArchiveWhenOversizedAndTouched() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')

  // 임계 미만에서 만진 경우: 안내 없음.
  fs.appendFileSync(path.join(target, '.harness/session/decision-log.md'), '\n## 2026-08-04 - 작은 결정\n- 내용.\n')
  const small = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!small.includes('Decision log size notice'), 'under-threshold decision-log must not trigger the archive nudge')

  // 임계 초과 + 만진 커밋: 안내 + guard 요약 추천 조치.
  const filler = Array.from({ length: 420 }, (_, i) => `- 이력 항목 ${i}`).join('\n')
  fs.appendFileSync(path.join(target, '.harness/session/decision-log.md'), `\n## 2026-08-04 - 누적 이력\n${filler}\n`)
  const touched = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(touched.includes('Decision log size notice'), 'oversized decision-log touched in this change must trigger the archive nudge')
  const guardOut = runGuard(target)
  assert(guardOut.includes('아카이브로 분리'), 'guard summary should recommend archive split for oversized decision-log')

  // 임계 초과 상태여도 이번 변경이 decision-log를 안 만졌으면 안내하지 않는다(반복 노이즈 금지).
  gitCommitAll(target, 'oversized log')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')
  const untouched = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!untouched.includes('Decision log size notice'), 'oversized but untouched decision-log must not repeat the nudge')
}

// 승격 분기(0.2.92, score-print P6): 로컬룰 승격 안내가 "문서 규칙 vs 실행 가능한 검증" 분기를 묻는다.
function promotionReminderAsksExecutableGuardBranch() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')
  gitCommitAll(target, 'baseline')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/app.js'), 'export const demo = 1\n')

  const summary = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(summary.includes('테스트/CI 가드'), 'summary promotion reminder should mention executable guards')

  const detailed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard', '--verbose'], { cwd: target })
  assert(detailed.includes('런타임 불변식'), 'verbose promotion reminder should name runtime invariants')
  assert(detailed.includes('실행 가능한 검증으로 만들 것인가'), 'verbose promotion reminder should ask the doc-vs-guard question')
}

// 설치가 기존 CLAUDE.md 위에 블록을 얹은 뒤 안내하는 문장 — "CLAUDE.md의 규칙을 하네스 문서로 마이그레이션해줘" —
// 을 개발자가 그대로 말하면 에이전트는 로컬룰 승격 스킬과 그 스킬이 읽는 가이드(절차 절)를 골라야 한다.
// 2026-09-08 실측: 요청이 docs로 분류되면 docs를 가진 스킬 넷이 task 가점(+10)으로 상위 4칸을 다 차지하고,
// 스킬 매칭이 한 방향(토큰 ⊂ 스킬 텍스트)이라 조사가 붙은 "규칙을"·"마이그레이션해줘"는 트리거 "규칙"·"마이그레이션"에
// 걸리지 않아 rule-promotion이 탈락했다. 안내 문장이 스킬을 못 부르면 안내는 거짓이다.
function contextSelectsRulePromotionForEntrypointMigrationRequest() {
  const target = makeTarget()
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# 프로젝트 규약\n\n@CONVENTIONS.md\n')
  fs.writeFileSync(path.join(target, 'CONVENTIONS.md'), '# 규약\n\n## 3. 계층\n- Controller/Service/DAO\n')
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  run(harnessBin(target), ['context', 'CLAUDE.md의 규칙을 하네스 문서로 마이그레이션해줘'], { cwd: target })
  const ctx = read(target, '.harness/session/task-context.md')
  const skills = ctx.split('## Selected Skills')[1]?.split('\n## ')[0] ?? ''
  assert(skills.includes('(harness.rule-promotion)'),
    'the sentence the installer hands to developers must select the rule-promotion skill — otherwise the guidance is a dead end')
  const block = skills.split('(harness.rule-promotion)')[1]?.split('\n### ')[0] ?? ''
  assert(block.includes('.harness/project/project-harness-guide.md'),
    'the selected skill must read the guide that carries the migration procedure')
}

function contextClassifiesPlainKoreanDevelopmentRequest() {
  const { target } = setupSpecLinkedTarget()

  const out = run(nodeBin, [path.join(target, '.harness/bin/build-context.mjs'), '--stdout', '로그인 페이지 개발'], { cwd: target })
  assert(out.includes('detected: feature'), 'plain "개발" must classify as feature, not unknown')
  assert(!out.includes('detected: unknown'), 'the most common Korean phrasing must not fall through to unknown')
  // confidence는 키워드 2개 이상일 때만 medium이다(설계). 여기서 중요한 건 유형이 잡혀
  // taskTypes 가점 경로가 살아나는 것이다.
  assert(out.includes('개발'), 'the reason should name the keyword that matched')
  assert(out.includes('features/로그인.md'), 'the matching spec must still be injected')
}

// harnessMode 값 검증(0.2.102): 종전에는 'strict' 문자열 비교뿐이라 오타가 조용히 비-strict로
// 동작했다 — "차단을 켰다고 믿는데 꺼져 있는" 상태. 알 수 없는 값은 필수 조치로 표면화한다.
function guardFlagsInvalidHarnessModeInsteadOfSilentlyDowngrading() {
  const target = makeTarget()
  runInit(target, '--no-scan', '--no-handoff', '--no-check')

  const rel = '.harness/policy/profile.json'
  const profile = JSON.parse(read(target, rel))

  // (1) 값 오류 — fail-closed. 통과시키면 "strict를 켰다고 믿는데 꺼져 있는" 상태가 유지된다.
  writeJson(target, rel, { ...profile, harnessMode: 'strct' })
  const invalidOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target }),
    'invalid harnessMode must fail the check (fail-closed), not just print a note',
  )
  assert(invalidOut.includes('harnessMode 값이 유효하지 않습니다'), 'invalid harnessMode must be surfaced')
  assert(invalidOut.includes('strct'), 'the offending value should be echoed so the typo is obvious')
  assert(invalidOut.includes('차단이 켜지지 않은 상태'), 'the message should warn that strict blocking is not active')

  expectFailure(() => runGuard(target, '--no-cache'), 'harness:check must fail while harnessMode is invalid')

  // (2) JSON 자체가 깨진 경우도 "설정 없음"으로 통과시키지 않는다.
  fs.writeFileSync(path.join(target, rel), '{ broken json\n')
  const malformedOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target }),
    'malformed profile JSON must fail the check',
  )
  assert(malformedOut.includes('JSON으로 읽지 못했습니다'), 'malformed profile must be distinguished from a missing field')

  // (3) 유효 값이면 기존 동작 그대로.
  writeJson(target, rel, { ...profile, harnessMode: 'active' })
  const fixed = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(!fixed.includes('유효하지 않습니다'), 'a valid harnessMode must not produce the warning')
  assert(fixed.includes('Harness mode: active'), 'valid mode should be reported as-is')
  assert(!fixed.includes('active로 올리세요'), 'graduation hint must not appear outside bootstrap')

  // (3-1) maintenance는 0.2.131에서 은퇴(결정 95) — 유효 값이 아니라 설정 오류로 표면화된다.
  writeJson(target, rel, { ...profile, harnessMode: 'maintenance' })
  const retiredOut = expectFailure(
    () => run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target }),
    'retired harnessMode maintenance must be surfaced as a config error, not silently mapped',
  )
  assert(retiredOut.includes('maintenance'), 'the retired value should be echoed')

  // (3-2) bootstrap에는 졸업 이정표 한 줄이 뜬다.
  writeJson(target, rel, { ...profile, harnessMode: 'bootstrap' })
  const bootstrapOut = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(bootstrapOut.includes('active로 올리세요'), 'bootstrap mode should surface the graduation hint')

  // (4) 필드가 아예 없으면 bootstrap으로 계약대로 동작한다.
  const withoutMode = { ...profile }
  delete withoutMode.harnessMode
  writeJson(target, rel, withoutMode)
  const defaulted = run(nodeBin, [path.join(target, '.harness/bin/policy-harness.mjs'), 'guard'], { cwd: target })
  assert(defaulted.includes('Harness mode: bootstrap'), 'a missing harnessMode field defaults to bootstrap')
}

export {
  workflowWorkstreamChangeDoesNotTriggerCommitPushHookPolicy,
  guardCacheHitSkipsRevalidationOnSameTree,
  guardFullCacheSatisfiesFastRequest,
  guardNoCacheForcesRevalidation,
  guardCacheMissAfterTreeChange,
  buildContextMergesProfileAlwaysSources,
  guardModeDefaultsToSummaryImpactOutput,
  guardSummaryStillDetailsMustActSyncCandidates,
  guardEscalatesSyncCandidatesOnReversalCommit,
  guardDoesNotEscalateProseWithoutBannerEmoji,
  guardNoticesLogOnlyReversalCommit,
  guardLintsOverrideEntryRebuttalField,
  guardNudgesDecisionLogArchiveWhenOversizedAndTouched,
  promotionReminderAsksExecutableGuardBranch,
  contextSelectsRulePromotionForEntrypointMigrationRequest,
  contextClassifiesPlainKoreanDevelopmentRequest,
  guardFlagsInvalidHarnessModeInsteadOfSilentlyDowngrading,
}
