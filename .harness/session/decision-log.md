# 결정 로그

## 2026-06-25 - 소비자 profile.json 편집은 install preserve source trigger에서 제외
- 배경: clubadm이 0.2.73 적용 후 `profile.json`의 `harnessMode=active`와 `sources[]`를 직접 편집하자 `common.install.preserve-project-owned-files`가 blocking SYNC GAP을 냈다. 소비자 profile 편집은 본체 install/update 코드 변경이 아니라 PROJECT_OWNED 데이터 변경이다.
- 원인: preserve-project-owned-files 정책의 `triggerPaths`에 `.harness/policy/profile.json`이 포함되어 있어, 소비자가 자기 profile을 바꾼 것도 "install 보존 정책의 소스만 변경"으로 과매칭됐다.
- 결정: `profile.json`은 보존 대상(`ownedAreas`)으로 남기되, install 보존 정책의 source trigger에서는 제외한다. install/update 보존 동작 변경은 `scripts/init.mjs`, `update-harness.mjs`, `apply-stack.mjs`, waiver 변경으로 감지하고, 소비자 profile의 스택 상태·sources 선언은 `common.stack.bundle-integrity`와 profile 읽기 테스트가 다룬다.
- 회귀: 소비자 타깃에서 `profile.harnessMode`와 `sources[]`를 바꿔도 `common.install.preserve-project-owned-files` 및 SYNC GAP summary가 나오지 않는 테스트를 추가한다.

## 2026-06-25 - stack reset은 profile의 스택 소유 필드만 복원
- 배경: clubadm이 `profile.json`의 `harnessMode`를 `active`로 바꾼 뒤 `npm run harness:update`를 실행하자 `bootstrap`으로 되돌아가는 현상을 보고. 실제 clubadm 롤백본에서 업데이트를 실행해 `.harness/policy/profile.json`의 `harnessMode: active -> bootstrap` 회귀를 재현했다.
- 원인: 스택 하네스 init의 같은 스택 업데이트 경로가 `npm run stack:reset` 후 `stack:apply`를 실행한다. `stack:reset`은 `.harness/.stack-applied.json`의 최초 적용 시점 `profileBackup` 전체를 `profile.json`에 다시 쓰고 있었고, clubadm의 backup에는 초기 `harnessMode: bootstrap`이 남아 있었다. 이후 apply는 스택 필드만 갱신하므로 bootstrap이 그대로 유지됐다. 같은 경로에서 `updateHarnessLockForStack`이 lock을 새 객체로 만들며 base update의 `lastUpdate`도 삭제하는 부수 결함을 확인했다.
- 결정: profile에서 스택 런타임이 reset으로 되돌릴 수 있는 범위는 `activeStack`, `available`, `stackManifest`로 한정한다. `harnessMode`, `sources[]` 등 프로젝트가 직접 관리하는 필드는 현재 값을 보존한다.
- 조치: `apply-stack.mjs`의 reset 복원을 `restoreStackProfileFields`로 좁히고, stack lock 갱신은 기존 lock 메타데이터를 spread 보존한 뒤 `stackHarness`만 갱신하도록 바꿨다. 회귀 테스트가 stack apply 이후 변경된 `harnessMode`와 `sources[]`가 reset 후에도 유지되는지, stack apply/reset 후 `lastUpdate`가 유지되는지 확인한다. README와 `stack-preset-rules.md`에 profile 필드 소유 범위를 기록했다.
- 후속: 소비자에게 배포하려면 본체 릴리스 뒤 스택 하네스의 `baseHarness.minVersion/ref`도 새 본체 버전으로 올려, 기존 소비자가 같은 `npx ... init` 업데이트 경로에서 수정된 base를 받게 해야 한다.

## 2026-06-25 - bundled base outdated 안내 경로 정정
- 배경: clubadm 소비자가 `baseHarness.source.type="bundled"` 및 repo/ref 없음 상태에서 `harness:outdated`가 base를 `outdated`로 표시하면서 `npm run harness:update -- --base-only`를 권하고, 해당 명령은 `update-harness.mjs`에서 repo metadata 없음으로 실패한다고 보고.
- 판정: 보고가 맞다. `outdated-harness.mjs`는 조회 정확도를 위해 스택 lock의 `requiredBaseHarness.repo`로 base repo를 복구하지만, `update-harness --base-only`는 그 fallback을 갱신 입력으로 사용하지 않는다. 따라서 bundled base에서 repo를 stack requirement로만 복구한 경우 `--base-only`를 실행 가능한 경로로 안내하면 안 된다.
- 조치: `outdated` 결과에 base repo가 lock/install manifest에 직접 없고 requiredBase fallback으로만 복구된 판정을 추가하고, update command를 최신 스택 하네스 `npx ... init` 재실행으로 안내한다. 실제 소비자 파일 자동 수정은 하지 않는다. 회귀는 bundled base가 outdated일 때 `--base-only` 대신 stack init command와 note가 나오는지 확인한다.
- 기준 짝: `.harness/project/stack-preset-rules.md`에 bundled base 예외를 기록했다. 공통 하네스 git source로 설치된 base는 기존 `--base-only` 경로를 유지한다.
- 배포: 본체 0.2.72를 양쪽 원격(origin/main, company/master)과 태그 `v0.2.72`로 배포했고, GitHub Actions Policy Guard success 확인. consumer-facing 변경이라 `ai-standard-cli` 0.1.34에 base ref v0.2.72를 반영해 GitLab master와 태그 `v0.1.34`로 push했다.

## 2026-06-25 - clubadm P0 개선요청서 적대적 검토 + P0-1 축소 수용 (0.2.71)
- 배경: 소비자 clubadm이 본체 0.2.70 대상 P0 5건(P0-2 hook 자동배선, P0-5 Codex 정합, P0-1 sources[] 레지스트리, P0-4 행위충돌 표면화, P0-3 harnessMode 라이프사이클) 개선요청. 사용자가 "오해 가능성 포함 적대적 검토" 지시. 본체 원본 대조 + 독립 재검증.
- 메타 발견: clubadm의 코드 인용(file:line)은 대체로 정확하나 **증상·동기 서사는 반복적으로 조작/과장**됐고, 제안 5건 전부 "본체가 소비자 소유 파일을 자동으로 쓴다/넓은 탐지기" 요소가 있어 자동 변경 금지·노이즈 최소화 위배. 또 clubadm은 자기 개인 글로벌 설정을 본체 동작으로 혼동(P0-4 Co-author).
- 판정: P0-1 축소 수용·배포. **P0-2 거부**(hook 미배선은 의도된 opt-in, commit-template를 런타임 약속으로 오독, fallback·테스트 이미 존재, 자동배선은 git config 무단 변경). **P0-5 거부**(본체는 "Codex 강제 불가"를 일관 명시 = 고치라는 문구가 이미 맞음, .codex/hooks.json은 추측성 자산 grep 0건, 제안 테스트는 test theater). P0-3·P0-4는 축소 형태(문서/read-only)로만 후속 후보 — 필드 추가·init 자동 기록·소비자 정책 파일 자동 덮어쓰기는 거부.
- P0-1 반영 범위(읽기 전용): profile.json 프로젝트 소유 `sources[]`({path,kind,owner,inject}) 추가(본체 자동 작성 X, PROJECT_OWNED 보존, 신규설치 빈 배열). build-context가 profile.json을 읽어 `inject:always`·실재 항목을 Always Read에 병합(`(project source)` 표시; 이전엔 profile.json 미독해라 순수 가산). scan은 선언 경로 존재만 검증(false positive 0, 없으면 Open Question; 룰성 kind 선언 시 "방법론 없음" 오탐 질문 대체). 넓은 휴리스틱 자동 탐지기·자동 등록 writer는 거부(0.2.68~70 과매칭 제거 방향 유지). bootstrap.md에 등록 인터뷰 단계.
- ★ SYNC GAP 짝 문서 = leaf 문서 페어링(중요): 코드 변경의 정책 짝을 **공유 문서가 아닌, 해당 정책 전용 leaf 문서**로 골라야 연쇄 gap이 안 난다. preserve-project-owned(profile.json 트리거, blocker)→`README.md`(preserve 전용 leaf), generated-not-source(build-context)→`context-registry.json`(엔트리 추가; 양측 owned/doc), skill-selection(build-context)→`skills/README.md`(skills/** 전용). **portability-guide.md·context-protocol.md는 금지** — portability-guide는 minimum-node/force-overwrite의 doc이라 건드리면 그 코드(node파일/init) 미변경으로 document-only blocking; context-protocol은 visible-trace의 doc이자 source-trace의 ownedArea라 양방향 연쇄. 첫 시도에서 이 둘을 건드려 blocking 2 + review 2 발생 → 되돌리고 leaf로 재페어링해 SYNC GAP 0 달성. 교훈: 정책 documents/ownedAreas 그래프를 먼저 조회(matchedFiles 로직)해 leaf를 고른다.
- 검증: strict 70 tests + 정책 strict + doc-link 통과(SYNC GAP 0). 회귀 2종(build-context 병합/비-always 미병합, scan 존재검증/누락 Open Question).
- 배포: 양쪽 원격 `5e90efd` + 태그 `v0.2.71`, CI Policy Guard success. CLI 0.1.33로 base ref v0.2.71 반영(consumer-facing: 소비자가 sources[] 사용).

## 2026-06-22 - push/배포 중복 검사 제거: 전체 검증 git-tree 캐시 (0.2.70)
- 배경: 사용자가 push/배포가 느리다고 지적. 진단 결과 본체(seed-mode)는 매 `harness check`(pre-commit/pre-push)가 `guard.mjs:726`에서 `test-init`(64+ 테스트, ~30s) + 정책 + doc-link를 전부 재실행. 릴리스 1회 = commit + 양쪽 원격 push + 태그 2개 = 같은 검증 5회. 기존 validation cache는 스택 lint/test/build 전용 + `activeStack=none`이면 그 전에 exit해 본체에서 무력.
- 결정: `guard.mjs`의 전체 검증(policy guard, doc-link, test-init, edge, critical, version lock, 스택 verify)을 `validationCacheKey` 게이트 뒤로 이동. 같은 git tree면 전체 스킵(측정 69s→0.1s). 근거: 모든 검증이 git tree의 결정론적 함수라 외부 비결정 요소가 없어 "같은 tree=같은 결과"가 보장 → 캐시가 신뢰성을 해치지 않음.
- 캐시 키 재설계: `validationCacheKey`에서 fast/full을 제거하고 strict/default만 키에 유지. fast/full은 캐시 레코드의 mode로 판정해 `full` 통과 캐시를 `fast` 요청이 재사용(full ⊇ fast). 반대(`fast` 캐시 → `full` 요청)는 test/build 누락이라 미스. 효과: commit(full) 1회만 실검증, 직후 push(fast)·양쪽 원격·태그 push는 같은 tree라 전부 히트 → 릴리스 검증 5회→1회.
- 안전: tree가 1비트라도 바뀌면(getChangedFiles 해시) 미스→전체 재검증. guard.mjs/policy/doc-link/test-init 코드가 바뀌면 commit으로 HEAD 변동 또는 working tree dirty라 자동 무효화. harness 업데이트는 harness-lock 변동으로 무효화. `--no-cache`로 강제 재검증. missing-snapshot 등 실패는 통과가 아니므로 캐시 기록 안 함.
- 회귀 4종(총 68): 같은 tree 히트, full→fast 재사용, --no-cache 강제 재검증, tree 변경 미스.
- 짝 문서 처리: guard.mjs(코드) 변경의 정책 짝은 `common.policy.sync-gap`(guard.mjs ownedArea + documents=`.harness/policy/**`,`.harness/session/**`)이며 sync-protocol/session 변경으로 충족된다. 검증 캐시 계약은 `sync-protocol.md` "반복 검증 완화" 절에 정밀 반영했다.
- SYNC GAP 노이즈 근본 제거(사용자 "푸시배포 노이즈 앞으로 없게" 지시): 검증 캐시 계약을 sync-protocol에 반영하자 install 정책(`preserve-project-owned-files`/`force-overwrite-confirmation`)이 sync-protocol을 공유 documents로 가져 "문서만 변경" blocking으로 깨졌다(sync-protocol "정책 매칭 범위" 절이 경고하는 노이즈 그대로 — 한 종합 문서를 여러 정책이 documents로 공유). **install 정책의 documents/source를 종합 문서 `sync-protocol.md` → 설치 전용 문서 `portability-guide.md`로 옮겨 근본 해결**했다. portability-guide는 이미 install 보존/force/seed-only 계약("그대로 두는 것"/"소비자에 배포하지 않는 것")을 담고 있다. 이제 sync-protocol(검증/세션/동기화 빈번 변경)이 install 정책을 깨우지 않는다.
- 분리 방식 비교: install 계약 전용 문서(install-protocol.md) 신설도 시도했으나, 신규 문서 추가 자체가 install 정책을 'document-only'로 깨우고 그걸 닫으려 install 소스(init.mjs→minimum-node, update-harness→bundle-integrity)를 건드리면 다른 정책이 연쇄로 깨지는 함정이 있어 폐기했다. **기존 install 계약 문서(portability-guide)를 documents로 재지정**하는 쪽이 신규 gap 없이 노이즈를 제거한다(이번 커밋에서 portability-guide 내용은 미변경이므로 install 정책이 트리거되지 않음).
- 태그 push의 hook 레벨 스킵(nvm 로드까지 생략)은 stdin 처리 복잡도 대비 이득(수초)이 작고, 캐시로 이미 검사가 스킵되므로 채택하지 않음. CLI: 소비자 검증 속도 개선(consumer-facing)이라 0.2.69+0.2.70 묶어 base ref 반영.

## 2026-06-22 - 본체(seed-mode) 전용 문서 소비자 배포 제외 (0.2.69)
- 배경: 0.2.68 후속 과제. `body-release-checklist.md`는 "seed-mode 본체 전용, 소비자 미적용"을 자기 명시하면서도 managed로 소비자에 배포됨. dead-link 오탐은 0.2.68로 해소됐으나 본체 전용 문서가 소비자에 존재하는 적절성 문제 잔존.
- 식별: 배포 문서 49개를 워크플로(classify low-effort 51 에이전트 + seed-only adversarial verify high-effort)로 전수 감사. seed-only 확정 = `body-release-checklist.md` 1개. `policy-db-readiness.md`는 ambiguous였으나 "소비자가 project/personal 정책을 policy-registry에 등록할 때 필드 스키마가 필요"로 refute → 보존. 잘못 제외하면 소비자가 필요한 문서를 잃으므로 보수적 판정(default refute).
- 결정: `SEED_ONLY_DOC_PATHS` 도입. 소비자(`.harness-seed-mode` 마커 없음) 타깃에 배포 안 함 + 기존본 정리(미수정 sha 일치 → 제거, 수정/출처불명 → 보존+안내). 본체(마커 있음)는 유지(본체 개발에 필요).
- 연쇄: `document-registry.json`에서 제거(소비자 missing 방지) + `doc-link-check`의 `seedOnlyDocs` orphan 예외(본체 orphan 방지). `init.mjs` `SEED_ONLY_DOC_PATHS` ↔ `doc-link-check.mjs` `seedOnlyDocs` 동기화 필요.
- 회귀 5종(총 64). 짝 문서: `sync-protocol.md`(배포 제외), `indexing-rules.md`(registry 예외 절), `portability-guide.md`(소비자 미배포 절).
- CLI: 소비자 설치 산출물이 바뀌므로(body-release-checklist 미설치) consumer-facing → base ref 반영.
- SYNC GAP 정밀화(CI 복구 1차): `document-registry.json`에서 문서를 제거하면 `common.agent.skill-selection`(reading-set) 정책이 strict에서 과매칭으로 실패했다(0.2.69 첫 push에서 GitHub Actions Policy Guard `Run harness check` 실패). skill-selection의 ownedAreas에서 `document-registry.json`을 제거했다 — 레지스트리 무결성은 `common.documentation.registry-integrity`가 전담하고, reading-set 직접 입력인 `context-registry.json`은 유지한다. 0.2.68의 install 정책 triggerPaths 정밀화와 동형. (참고: 본체 전용 `harness.body-release` 스킬은 purpose에 "seed-mode 저장소에서만 적용"을 명시하고 audience가 harness-maintainer라 소비자에선 자연 배제되므로 skills/registry.json은 변경하지 않았다.)
- CI 복구 2차: `sync-protocol.md`/`indexing-rules.md`가 seed-only 문서를 full-path 백틱(`.harness/project/body-release-checklist.md`)으로 참조하는데, 그 문서는 소비자에 없으므로 소비자 시뮬 테스트(`consumerDocLinkCheckHandlesAbsentSeedOnlyDoc`)가 broken code-path로 잡아 CI strict가 다시 실패했다. 로컬 commit hook(비-strict)은 정책 트리거 checks(`node scripts/test-init.mjs`)를 돌리지 않아 사각이었다(strict 전용 실행). 해결: `doc-link-check`의 `exists()`가 `seedOnlyDocs` 경로를 존재로 간주하게 해 seed-only 참조를 소비자에서 broken으로 보지 않는다(본체엔 실제 존재라 무영향). 0.2.68 환경 의존 오탐과 같은 클래스. 교훈: 본체/소비자에서 파일 존재가 갈리는 경로를 문서가 참조하면 로컬(본체) 검사로는 안 잡히므로, 커밋 전 `node scripts/test-init.mjs`를 직접 돌려 소비자 시뮬 회귀를 확인한다.

## 2026-06-22 - doc-link-check 소비자 환경 의존 오탐 수정 (백틱 디렉토리/CI 예시 경로) (0.2.68)
- 배경: clubadm 소비자 설치 후 doc-link-check가 백틱 예시 경로(`.github/workflows/` 등)를 code-path 참조로 해석해 dead로 표시. 본체엔 `.github/workflows/`·`scripts/`·`src/` 등 디렉토리가 실제 존재해 통과하지만, 소비자 환경엔 없을 수 있어(CI 미사용, 비-Node, 구조 차이) 환경 의존 오탐 발생. 본체 self-test로는 안 잡히는 사각지대였다.
- 결정: `codePathPattern` 검사에 `isIgnorableCodePath` 도입. (1) glob/생략(`*`, `...`), (2) trailing-slash 디렉토리 예시, (3) `.github/workflows/` 하위(본체 CI 어댑터, 소비자 미주입)는 검사 제외. 구체 파일 참조는 계속 검사해 진짜 dead 탐지는 유지.
- 근거: 디렉토리 trailing-slash는 "이런 위치를 보라"는 안내이지 파일 링크가 아니다. `.github/workflows/`는 기존 decision-log와 body-release-checklist가 이미 "소비자 기본 주입 대상 아님"이라 명시.
- 테스트 가능성: `doc-link-check.mjs`의 `main()`을 직접 실행 가드(`process.argv[1] === __filename`)로 감싸 `isIgnorableCodePath`를 export. test-init이 import해 단위 + 소비자 e2e 회귀 2종 추가(총 59종).
- 짝 문서(`common.documentation.registry-integrity`, ownedAreas에 doc-link-check.mjs): `indexing-rules.md`에 "코드 경로 참조 검사 규칙" 절 추가.
- 후속(별도 과제): `body-release-checklist.md`는 자기 자신이 "seed-mode 본체 전용, 소비자 미적용"이라 명시하는데 managed로 소비자에 배포된다. dead-link는 본 수정으로 해소됐으나, 본체 전용 문서가 소비자에 존재하는 적절성 문제는 배포 제외 로직 + 기존 소비자 정리(removeLegacy류)가 필요해 분리한다.
- 정책 정밀화: install 정책(`common.install.preserve-project-owned-files`, `common.install.force-overwrite-confirmation`)의 `triggerPaths`에서 `scripts/test-init.mjs`를 제거했다(ownedAreas는 유지). test-init.mjs는 init의 install·마커·doc-link·dual-runtime을 모두 검증하는 종합 스모크라, install 무관 변경(이번 doc-link 회귀 등)에도 install 짝 문서 갱신을 강요하는 false positive가 다발했다. install 계약 변경의 실제 trigger는 `scripts/init.mjs`/`update-harness.mjs`이고 그때 test-init.mjs는 ownedAreas로 함께 검토된다. 0.2.66에서 force-overwrite triggerPaths에 test-init.mjs를 넣었던 것을 이 근거로 되돌린다.

## 2026-06-18 - CLAUDE.md/AGENTS.md/copilot 마커 기반 공존융합 (옵션 A, 0.2.67)
- 배경: 0.2.65/0.2.66 통짜 안전망은 "소비자가 수정한 진입 파일을 무경고로 안 덮는다"까지였고, 회사 갱신과 소비자 지침의 공존융합은 없었다("둘 중 하나만 산다"). 사용자가 "CLAUDE.md 사고만 막았지 공존융합 개념이 없다"고 지적하고 옵션 A를 선택.
- 결정: CLAUDE.md/AGENTS.md/.github/copilot-instructions.md를 마커(`<!-- harness-managed:start/end -->`) 기반 머지로 전환. apply-stack.mjs의 `upsertGeneratedSection`과 같은 마커 패턴. 본체 진입 파일 전체를 마커로 감싸고 안내 주석으로 "마커 안=회사 자동갱신, 마커 밖=소비자 보존, 충돌 시 standards-layers 충돌 해석 순서"를 명시.
- 의미 충돌 자동 감지는 범위 제외: 자유 산문의 의미 모순을 결정론적으로 판정하는 것은 LLM 없이 불가하고 오탐이 많다. 대신 이미 존재하는 standards-layers "충돌 해석 순서"(안전류=회사 필수 차단 우선, 운영류=프로젝트 우선)가 에이전트의 판단 기준이 된다. 마커는 물리적 공존, 충돌 해석 순서는 판단 심판 — 둘을 연결하는 것이 본 릴리스의 설계다.
- 완전 자동 머지(규칙을 JSON DB로 구조화, settings.json 수준)는 CLAUDE.md를 산문에서 데이터로 바꾸는 대공사라 범위 제외. 충돌이 잦은 규칙이 생기면 그때 해당 규칙만 `policy-registry.json`으로 승격하는 것이 현실적(사용자와 합의).
- 구현(`scripts/init.mjs`): `MARKER_MANAGED_FILES` 상수, `extractManagedBlock`/`extractManagedRegion`/`mergeMarkerManaged` 헬퍼, installFiles 마커 분기(머지/자동 마이그레이션/보존+안내), buildInstallManifest `managedRegionSha256` 기록(manifestVersion 2→3), `isLocallyModifiedManagedFile`에 마커 가드(마커 대상은 통짜 경로 제외). 마커 머지는 force와 무관(소비자 영역은 항상 보존). 소비자가 회사 영역(마커 안)을 수정했으면 머지 전 `.harness-bak` 백업.
- 통짜 안전망(0.2.65)의 적용 대상 재정의: 마커 비대상 managed 파일(hook 스크립트, `.harness/bin/*` 등). 0.2.65 회귀 3종을 `.claude/hooks/enforce-check.sh` 대상으로 재타게팅. 0.2.66의 hybrid 통짜 테스트 5종은 마커 도입으로 동작이 바뀌어(마커 밖 추가는 이제 머지로 보존) 마커 머지 회귀 6종으로 대체.
- 검증: `node scripts/test-init.mjs` 57/57 OK. CLI(`../ai-standard-cli`)는 installer 실제 동작 변경(consumer-facing)이라 base ref 반영 필요.
- SYNC GAP 예상: init.mjs/test-init.mjs → install 정책 3개(blocker, 짝: sync-protocol/portability 갱신함). CLAUDE.md/AGENTS.md/copilot → visible-trace/skill-selection 정책(warning) — 마커는 그 규칙 내용과 무관한 구조 변경이라 짝 문서(context-protocol/skills) 변경 없음(commit 시 결과 확인).

## 2026-06-15 - 0.2.66 회귀 강화 (hybrid managed 진입점 모두에 명시 잠금)
- 배경: 0.2.65 안전망은 `installFiles`의 단일 분기로 모든 managed 파일에 일반화 적용되지만, 회귀 테스트는 `CLAUDE.md`만 명시 검증했다. PaceLAB류 실 소비자는 보통 `CLAUDE.md`/`AGENTS.md`/`.github/copilot-instructions.md`를 모두 수정하기 때문에 같은 보장을 명시로 잠그는 것이 안착 신뢰도를 높인다.
- 결정: 본체 동작은 변경하지 않고 회귀 테스트 5종만 추가(0.2.66 patch). `AGENTS.md` 보존 + 사이드카, `.github/copilot-instructions.md` 보존, 세 파일 동시 수정 시 모두 보존 + 후처리 리포트 명시, `--force --confirm` 시 세 파일 모두 `.harness-bak` 사이드카 verbatim 보존.
- installer 동작 무변경 → consumer-facing 아님 → `ai-standard-cli` base ref 반영 생략(0.2.64 사례).
- 후속(옵션 A 마커 영역, 옵션 B project-owned 재분류)은 별도 릴리스로 진행. 본 patch는 0.2.65 안착 신뢰도 강화에 한정.
- SYNC GAP 정합: `common.install.force-overwrite-confirmation` 정책의 `triggerPaths`에 `scripts/test-init.mjs`를 추가했다. 본 정책의 ownedAreas에는 이미 test-init.mjs가 있었지만 triggerPaths에는 빠져 있어, 회귀 추가만으로는 force-overwrite 정책이 docs-only로 분류되어 blocking SYNC GAP이 떠 있었다. `common.install.preserve-project-owned-files`의 triggerPaths가 이미 test-init.mjs를 포함하던 패턴과 정렬한다(2026-06-09 P5 사례, 0.2.63 minimum-node 정책 트리거 확장 사례와 동일 패턴).

## 2026-06-15 - harness:update가 소비자 수정된 managed 파일(CLAUDE.md/AGENTS.md)을 무경고로 덮어쓰던 사고 차단 (안전망, 옵션 C)
- 배경: PaceLAB(RunningCoach)에서 0.2.56→0.2.64 base 업데이트 시 소비자가 직접 추가한 `CLAUDE.md`의 `## 모노레포 구조 (#250)` 섹션과 UI reading-list 라인이 경고/백업/머지 없이 통째로 사라졌다(`git diff` 9 deletions, 0 insertions). 커밋 전 수동 발견·복원이 없었다면 영구 손실. 보고서로 코드 근거 5건이 모두 정확히 식별됨: (1) `CLAUDE.md`/`AGENTS.md`가 `install-manifest.json.managedFiles`에 전체-파일 sha256으로 등록, (2) `installFiles`의 `shouldCopy = !exists || force || (!projectOwned && managed)`가 무조건 덮어쓰기, (3) `--force --confirm-overwrite-project-files` 가드는 project-owned만 보호, (4) `isUnmodifiedManagedHarnessFile`(guard)는 sha 불일치=로컬 수정을 관용하는데 update는 그 수정을 폐기(시스템 내부 모순), (5) 0.2.59 `.claude/settings.json` 사례가 같은 버그 클래스를 project-owned 재분류+비파괴 머지로 이미 고쳤지만 CLAUDE.md/AGENTS.md에는 적용 안 됨.
- 결정: **옵션 C(안전망) 단독으로 0.2.65 릴리스**. 보고서 우선순위 1을 따른다 — "어떤 경우에도 *조용한* 손실 없음"이 가장 위. 옵션 A(`<!-- harness-managed:start/end -->` 마커 영역 머지)와 옵션 B(`CLAUDE.md`/`AGENTS.md` project-owned 재분류 + Markdown 멱등 머지)는 후속 검토.
- 옵션 A/B 보류 이유: (A) 본체 CLAUDE.md/AGENTS.md 본문을 마커로 감싸는 구조 변경 + manifest 스키마 확장(영역 해시) + 기존 소비자 install-manifest 마이그레이션 경로가 필요해 범위가 크다. (B) Markdown 멱등 머지는 settings.json(JSON)의 키-단위 union보다 의미가 모호하다 — 섹션 동등성, 사용자가 본체 섹션을 의도적으로 삭제했을 때의 구분 등 결정사항이 늘어난다.
- 구현 범위(옵션 C, `scripts/init.mjs`): (a) 새 헬퍼 `isLocallyModifiedManagedFile(target, rel, manifest)`로 manifest 기록 sha256과 현재 파일 sha256 비교. (b) `installFiles`가 managed + !projectOwned + 로컬 수정 감지 시 — `--force` 없으면 보존 + `preservedLocallyModified` 누적, `--force --confirm-overwrite-project-files` 시 `<파일>.harness-bak` 사이드카로 직전 소비자본을 백업한 뒤 덮어쓰고 `overwroteLocallyModified` 누적. (c) `collectForceOverwriteTargets`가 로컬 수정 managed도 가드 대상에 포함해 `--force` 단독은 차단. (d) 후처리에 "로컬 수정으로 보존된 managed 파일"과 "백업 후 덮어쓴 managed 파일" 두 섹션을 항상 출력해 조용한 손실 차단.
- 적용 범위: `managedFiles`에 등록된 모든 파일. CLAUDE.md/AGENTS.md 특별 처리가 아니라 같은 클래스의 모든 managed 파일이 자동 보호된다. manifest가 없는 첫 설치(첫 init) 경로는 영향 없음.
- 회귀: `scripts/test-init.mjs`에 3종 추가 — managed `CLAUDE.md`에 소비자 섹션 추가 후 재설치 시 보존 + 후처리 리포트 명시(`reinstallPreservesLocallyEditedManagedHarnessFile`), `--force --confirm` 시 `.harness-bak` 사이드카에 소비자 바이트 verbatim 보존 + 본체로 덮임(`forceConfirmOverwritesLocallyEditedManagedHarnessFileWithBackup`), `--force` 단독은 confirmation 안내와 함께 종료(`forceAloneStopsWhenManagedHarnessFileWasLocallyEdited`). 총 50개 통과.
- 정합: 가드(`policy-harness.mjs:482` `isUnmodifiedManagedHarnessFile`)는 이미 sha 불일치를 관용하던 시스템 사실을 update 경로에서도 인정한다는 의미이므로 0.2.59 선례와 사상이 일관된다. PaceLAB 임시 조치(수동 diff 확인 + 복원)는 안전망 도입 이후에도 후처리 리포트가 표면화하지만, "덮어쓰기 자체가 일어나지 않는" 기본 경로가 우선 작동한다.
- SYNC GAP 처리(정직 반영): pre-commit hook이 `scripts/init.mjs`/`scripts/test-init.mjs` 소스 변경에 대해 install 정책 3개(`preserve-project-owned-files`, `force-overwrite-confirmation`, `runtime.minimum-node`)를 깨움. 실제 바뀐 계약(소비자 수정 managed 파일 보존 + `<파일>.harness-bak` 사이드카 백업 경로)을 `.harness/policy/sync-protocol.md`(설치 프로토콜)와 `.harness/project/portability-guide.md`(이식 절차 "그대로 두는 것")에 짧게 명문화했다. `runtime.minimum-node`는 본 변경에서 실제 동작은 만지지 않았으나 `scripts/init.mjs` 파일 변경으로 정책 매칭이 깨어났을 뿐이며, 정책 documents 중 하나인 portability-guide.md를 같은 릴리스에서 갱신해 충족한다(`config-contract.md`는 본 변경과 의미상 무관해 손대지 않는다). README의 보존 기준 설명은 변경 없이도 일관되므로 0.2.59 사례와 같이 README은 손대지 않는다.

## 2026-06-12 - 저버전 Node 프로젝트 dual-runtime 지원 (.nvmrc < 20.19 설치 허용)
- 배경: 사내 프로젝트는 대부분 nvm으로 Node를 관리하고 프로젝트마다 버전이 다르다(레거시는 Node 12 수준, 일부는 `.nvmrc` 부재). 기존에는 `.nvmrc < 20.19`면 설치를 중단했고, `.nvmrc` 없는 저버전 프로젝트는 차단 게이트가 감지하지 못한 채 설치되어 hook이 동작 불능이었다(2026-06-12 사용자 확인).
- 결정: 2026-05-08의 "하네스 실행 Node와 프로젝트 빌드 Node 분리"를 실행 레이어까지 완성한다. **dual-runtime**: hook/런처는 활성 Node가 20.19 미만이면 `$NVM_DIR/versions/node` 목록에서 최신(>=20.19)으로 하네스 스크립트만 전환하고(`.harness/bin/dual-node.sh`), guard는 프로젝트 검증(lint/test/build, stack verify)을 `.nvmrc` Node로 되돌려 실행한다(`HARNESS_PROJECT_NODE_BIN`, `.harness/bin/node-env.mjs`). 기존 hook은 전환 전 PATH(`HARNESS_PREV_PATH`)로 체인 실행한다.
- 2026-05-08 결정과의 구분: "하네스가 자신의 Node 버전을 `.nvmrc`로 주입하지 않는다"는 유지한다. 이번에 허용한 것은 **사용자 확인 기반(`init --project-node <ver>`)으로 프로젝트의 기존 Node 버전을 `.nvmrc`로 선언**하는 것이며, 하네스 버전 강요가 아니다. `.nvmrc`는 계속 project-owned로 업데이트 시 덮어쓰지 않는다.
- 설치 게이트 변경: `.nvmrc < 20.19` → 중단 대신 dual-runtime 안내+진단(nvm/하네스 Node/프로젝트 Node 설치 여부). 단 nvm 자체가 없으면 전환 수단이 없으므로 중단한다(머신 환경을 바꾸는 nvm 자동 설치는 하지 않고 안내만 한다). `.nvmrc` 없는 Node 프로젝트에서 저버전 신호(engines/.node-version/Dockerfile/CI, major 기준)가 감지되면 추측으로 확정하지 않고 `--project-node` 인터뷰를 요구한다. 비-Node 프로젝트(package.json 부재)는 `.nvmrc` 계약이 원래 없으므로 인터뷰를 생략한다.
- 강제 규칙: 저버전 `.nvmrc` 프로젝트에서 해당 Node가 nvm에 없으면 guard가 프로젝트 검증을 하네스 Node로 대신 돌리지 않고 `nvm install <ver>` 안내와 함께 실패한다(검증 신뢰성 우선). `.nvmrc >= 20.19`인데 설치본이 없는 경우는 기존 거동(현재 Node로 실행)을 유지한다.
- 비범위: Windows(nvm-windows)는 dual-runtime 전환을 지원하지 않는다(기존 PATH node + 게이트 거동 유지). nvm 별칭 `.nvmrc`(lts/* 등)는 해석하지 않고 경고 후 현재 Node로 실행한다. 소비자 npm 별칭(`npm run harness:*`)의 런처 경유 전환은 Windows 호환 문제로 보류 — 저버전 셸에서는 게이트 안내가 `.harness/bin/harness <command>` 사용을 권한다.
- nvm.sh 비의존: dual-node.sh는 nvm 셸 함수를 쓰지 않고 디렉터리 목록만 읽는다. dash + nvm.sh 무출력 사망(0.2.61) 표면을 늘리지 않기 위함이다.
- 적대적 리뷰(다차원 코드리뷰 + 검증) 결과 5개 엣지 케이스를 보강했다(같은 0.2.63): (1) dual-node.sh 헬퍼 arg-less `set -u` 가드, (2) node가 셸 함수일 때 `HARNESS_PROJECT_NODE_BIN='.'` 누출 차단, (3) guard가 hook이 넘긴 노드 bin을 `.nvmrc`와 교차검증해 nvm use 무음 실패 시에도 검증 신뢰성 우선 하드페일을 hook 경로에서 보장, (4) engines.node를 범위로 평가해 `>=18` floor 오탐 제거(핀만 major<20 강제), (5) `common.runtime.minimum-node` 정책 트리거에 신규 파일 등록. 모두 회귀 테스트로 고정(test-init.mjs).
- 보류한 제안: bare-major `.nvmrc` '20'을 supported로 올리는 변경은 거부했다. '20'은 20.19를 보장하지 못하므로 보수적으로 dual-runtime/하드페일 경로로 두는 편이 하네스 실행 안전에 부합한다(init.mjs·node-env.mjs 두 구현이 이미 동일 결과). 저버전 npm 별칭 자동 전환은 Windows 호환 문제로 계속 보류하되 진단 메시지에서 `.harness/bin/harness` 사용을 명시한다.

## 2026-06-09 - 하네스 백엔드 범용성: npm/package.json 표면 분리 설계 (합의용, 코드 미변경)
- 배경/갭: 하네스 엔진(`.harness/bin/*.mjs`)은 외부 npm 의존성이 0이고 Node 내장 모듈만 쓴다(`@eslint/js`·`globals`는 `scripts/test-init.mjs`의 픽스처 문자열일 뿐, 런타임 import 아님). 즉 `npm install` 없이 `node .harness/bin/guard.mjs`로 직접 돈다. 그런데 설치기와 모든 공개 명령이 npm/package.json을 전제해, package.json이 없는 백엔드 스택(PHP/Java/Swift/Kotlin)에는 범용 설치가 어렵다. 약점은 "기준 본체"가 아니라 "실행/설치 표면"에 있다.
- 진단(범용성 저해 순): (1) `mergePackageJson`이 package.json 없을 때 새로 생성하고 harness 별칭을 주입 — 가장 침습적, **1순위**(개발자 지정). (2) 일상 명령이 전부 `npm run` 경유이고 `bin`은 설치기(`harness-seed`)만 노출. (3) git hook이 `npm run harness:check`+nvm을 하드코딩. (4) `guard.mjs`의 검증 단계가 `runNpmScript`(`npm run <script>`)를 가정. (5) 본체에 프론트 흔적(Supabase Edge Function verifier, eslint config 패칭, `.gitignore`에 node_modules/dist 주입). (6) Node 런타임 필수 — 가장 깊지만 "도구 런타임"으로는 수용.
- 설계 원칙: **Node-as-도구-런타임**과 **npm/package.json-as-프로젝트-매니페스트**를 분리한다. Node 필수는 유지(2026-05-19·2026-05-08 결정과 정합)하고, npm/package.json 표면만 선택적으로 만든다. 모든 변경은 가산 우선이며 기존 소비자(package.json 보유)는 거동이 100% 동일해야 한다(test-init 회귀로 강제).
- 단계(우선순위):
  - **P1 package.json 비주입(1순위, 규칙 단순화 2026-06-09)**: 핵심 규칙을 "감지"가 아니라 "존재"로 둔다 — `mergePackageJson`은 **package.json을 새로 생성하지 않고, 이미 있을 때만 별칭을 머지**한다. 없으면 launcher만 설치하고 조용히 스킵한다(package.json 부재 자체가 비-Node 신호). 드문 greenfield Node 케이스는 `--with-package-json` opt-in 플래그로만 생성. 이 규칙은 백엔드 매니페스트 감지(composer.json/pom.xml/build.gradle/*.csproj/Package.swift) 없이도 성립하므로 더 단순하고 오탐이 없다. 감지 신호는 P4 verify 예시·test 픽스처 용도로만 남긴다. 기존 소비자는 package.json이 이미 있어 동일 경로 → 무영향.
  - **P2 `harness` 런처 추가(가산)**: `harness` 런처(sh shim, 설치 경로는 P2 구현 시 확정)[+Windows shim 검토]가 `harness check|impact|scan|...`를 `node` 직접 호출로 디스패치. package.json 불필요. 기존 `npm run harness:*`는 같은 .mjs를 부르므로 그대로. **2026-05-18 "CLI 부트스트랩/라우터 축소"와 정합**: 이는 daily-CLI로 npm을 대체하는 게 아니라 npm 없는 프로젝트용 동등 진입면이며, npm 보유 프로젝트의 표준은 계속 `npm run harness:*`. 전역 설치/`ai` 명령/devDependency CLI 아님(커밋되는 shell shim).
  - **P3 git hook 진입면 분리**: hook이 npm 대신 launcher(`harness check`)를 호출, nvm 로드는 있으면 쓰고 없으면 통과(이미 `|| true` 패턴 존재). 기존 소비자 결과 동일.
  - **P4 guard verify 명령 범용화**: 스택 검증을 npm script 외 raw command(`./gradlew test`, `composer test`, `swift test`, `mvn -q test` 등)로도 선언 가능하게. npm-script는 그중 한 종류로 유지(back-compat). 선언 위치/스키마는 미결(개발자 입력).
  - **P5 본체 프론트 흔적 정리**: Supabase verifier·eslint 패치·.gitignore node 항목을 스택 프리셋으로 이동(기존 분리 원칙). 가산/조건부라 무영향이나 회귀로 확인.
- 기존 결정과의 정합: 2026-05-18(전역/devDependency CLI 폐기)와 비위배(위 P2 단서). 2026-05-19·2026-05-08(Node 정책)와 정합 — 백엔드 프로젝트는 "빌드 Node 없음"이어도 되지만 "하네스 도구 Node 20.19+"는 dev/CI에 있어야 한다는 전제는 개발자 확인 필요(큐 `bw-node-availability`).
- 기존 소비자 회귀 보장: P1~P5 모두 "package.json 있으면 기존 경로" 분기. `scripts/test-init.mjs`에 (a) Node 프로젝트=기존 거동 유지, (b) 비-Node 픽스처(pom.xml/composer.json 가짜 루트)=package.json 미생성+launcher 설치 두 시나리오를 추가.
- 검증: 코드 변경 후 test-init 신규 시나리오 + `harness:check:strict`, 백엔드 픽스처로 비주입·launcher 동작 e2e.
- 개발자 입력 결과(2026-06-09): **`bw-node-availability` 확인됨 — 백엔드 dev/CI에 도구용 Node 20.19+ 설치 가능.** 설계 전제(Node-as-도구 유지)가 성립하므로 P1~P5를 그대로 진행한다. **`bw-target-stacks` = PHP·Java** 우선(1차 검증 픽스처·P4 verify 예시 기준). Swift/Kotlin은 감지 신호만 등록. 남은 갈래(Windows shim, verify 스키마)는 구현 세부 제안 기본값으로 진행.
- 진행 결정: **P1(package.json 비주입) 구현 시작.** P2 런처는 후속. P1 단독 상태에서 비-Node 프로젝트는 `node .harness/bin/<script>.mjs`로 명령을 직접 실행하도록 설치 안내에 명시한다(P2에서 단축 런처 추가).
- **P1 구현 결과(2026-06-09)**: `scripts/init.mjs` `mergePackageJson`을 "존재 기준"으로 전환(없으면 생성 안 함, 있을 때만 머지), `--with-package-json` opt-in 추가, 설치 요약/비-Node 안내 출력 추가. `scripts/test-init.mjs`는 `makeTarget`에 package.json을 부여해 기존 33종을 Node 소비자로 보존하고 `makeBareTarget` 기반 신규 2종(`nonNodeInstallSkipsPackageJson`, `optInCreatesPackageJsonForGreenfieldNode`)을 추가.
- **스모크가 잡은 실제 결합 수정**: `nonNodeInstallSkipsPackageJson`이 `.harness/bin/guard.mjs:599`의 무조건 `readFileSync('package.json')` ENOENT 크래시를 노출. guard가 package.json 없으면 `scripts={}`로 처리하도록 존재 가드 추가(Node 소비자 거동 동일). 이로써 "비-Node에서 `node guard.mjs`로 검증 가능"이라는 P1 약속이 실제로 성립. bin 전체 전수 점검 결과 무방비 package.json 읽기는 guard.mjs 한 곳뿐이었다(나머지는 fallback/가드 존재).
- **SYNC GAP 처리(정직 반영 원칙)**: init.mjs 변경이 install 정책 3개(preserve-project-owned, force-overwrite, minimum-node)를 깨움. 실제 바뀐 계약(package.json 비주입)을 정확한 계약 문서에만 반영 — `.harness/policy/sync-protocol.md`(설치 프로토콜), `.harness/project/config-contract.md`(설정 계약). `portability-guide.md`에도 한 줄 추가했으나 `common.template.contract-bridge`를 과매칭시켜, 2026-06-08 선례대로 정책 약화/거짓 수정 대신 그 한 줄만 되돌림. decision-log 본 항목의 P2 런처 경로 토큰(미존재 파일)은 doc-link broken-link라 비경로 표현으로 수정.
- **검증 결과**: `node scripts/test-init.mjs` 35/35 OK, `npm run harness:check:strict` 통과(필수 조치 0). 이 셸 기본 node가 v12라 검증은 `nvm use`(Node 22.14)로 PATH를 맞춘 뒤 실행함.
- **P2 구현 결과(2026-06-09)**: npm 없이 쓰는 진입면 `.harness/bin/harness`(무확장자 POSIX sh 런처) 추가. `harness <command>`가 `node .harness/bin/<script>.mjs`로 디스패치하며, 명령은 `npm run harness:*`에서 `harness:` 접두사를 뗀 형태(`check/impact/scan/...`)와 네임스페이스 명령(`stack:apply`, `template:status`, `hooks:install` 등) 그대로. dispatch 전 `check-node-version.mjs`로 최소 Node 강제, git hook과 동일한 nvm 로드(`set +u` 보호), `cd ROOT`로 npm과 동일한 cwd. `init`은 이 런처를 설치하고 실행 권한을 부여하도록 `ensureExecutable`을 무확장자 `harness`까지 확장. P1의 비-Node 안내 출력도 런처를 가리키도록 갱신.
- **P2 정합/범위**: 2026-05-18 "전역/devDependency CLI 폐기"와 비위배 — 커밋되는 shell shim이며 npm 보유 프로젝트 표준은 계속 `npm run harness:*`. Windows shim(.cmd/.ps1)은 검증 가능 범위를 위해 후속으로 미룸(큐 `bw-windows-shim` 유지). 계약 문서는 `sync-protocol.md`(설치/진입면)·`config-contract.md`(런처의 최소 Node 강제)에만 반영하고 `portability-guide.md`는 contract-bridge 과매칭이라 건드리지 않음.
- **P2 드리프트 가드**: `scripts/test-init.mjs`에 `launcherRunsHarnessWithoutNpm` 추가 — 비-Node 설치에서 런처 존재/실행권한/`harness check` 동작/미지원 명령 거부를 검증하고, `CONSUMER_SCRIPT_NAMES`가 가리키는 모든 `.harness/bin/*.mjs`를 런처가 커버하는지 확인해 npm script↔런처 드리프트를 차단.
- **P2 검증 결과**: 스모크 36/36 OK(신규 런처 테스트 포함), `npm run harness:check:strict` 통과(필수 조치 0).
- **P3 구현 결과(2026-06-09)**: git hook의 npm 의존 제거. `.githooks/pre-commit`이 `npm run harness:check` 대신 `.harness/bin/harness check`를, `.githooks/pre-push`가 `.harness/bin/harness check --fast`를 호출한다. 같은 guard.mjs를 실행하므로 npm 프로젝트 검증 결과는 동일하고, package.json 없는 비-Node 프로젝트에서도 commit/push 검증이 동작한다. hook 자체의 nvm 로드는 run-previous-hook 등 선행 `node` 직접 호출 때문에 유지(없으면 통과하는 기존 `|| true` 패턴 그대로).
- **P3 SYNC GAP 짝 변경**: hook 정책(`common.hooks.commit-push-check`, ownedAreas=.githooks/**·install-hooks.mjs)의 짝 문서 `commit-push-rules.md`의 요청별 검증 경로/pre-commit/pre-push/변경 시 확인 목록을 실제 동작으로 갱신(런처를 hook 의존으로 명시). `sync-protocol.md` 반복 검증 완화 절과 `install-hooks.mjs` 설치 안내, `handoff.mjs` 커밋 예시의 검증 줄도 같은 사실로 정렬.
- **P3 검증 결과**: 신규 `gitHooksRunWithoutNpm` 테스트 — 비-Node(consumer) 타깃에서 hook의 npm-free 정적 보장(`npm run` 미참조 + 런처 호출), 런처 경유 `hooks:install` 동작, `.githooks/pre-commit`/`pre-push` 직접 실행 e2e 통과. 스모크 37/37 OK, `harness:check:strict` 통과(필수 조치 0).
- **P4 구현 결과(2026-06-09, `bw-verify-contract` 해소)**: 스택 검증 명령의 선언 위치는 **스택 manifest의 선택적 `verify` 섹션**(`{ "lint": "...", "test": "...", "build": "..." }`, 값=raw shell 명령)으로 확정. guard(`harness check`)는 stage별로 `verify.<stage>`가 있으면 프로젝트 루트에서 shell로 실행하고(`runStackVerifyCommand`), 없으면 기존 package.json scripts로 fallback — verify 없는 기존 Node 스택은 이전과 완전히 같은 경로(순수 가산). fast check는 npm script와 동일하게 test/build 스킵. validation cache key에 manifest 해시가 이미 포함돼 verify 변경도 캐시 무효화. `profile.json`은 activeStack 단일 진실 출처로 유지하고 검증 명령을 담지 않는다. 계약은 `.harness/stacks/README.md` 외부 프리셋 manifest 계약에 문서화.
- **P5 구현 결과(2026-06-09)**: `init`의 `.gitignore` 주입에서 Node 전용 항목(`node_modules/`, `dist/`)은 package.json이 있을 때만 추가(비-Node 프로젝트 .gitignore 오염 방지, `.env`류는 범용이라 유지). guard의 Supabase Edge Function verifier와 init의 eslint config 패칭은 이미 트리거 없으면 no-op인 조건부 검사라 비-Node에 무해함을 확인하고 본체에 유지 — 외부 스택 저장소로의 완전 이동은 스택 하네스 저장소 분리 시점의 후속 과제로 남긴다.
- **정책 매핑 수정(2026-05-28 선례 적용)**: `common.template.contract-bridge`의 `documents`에 일반 안내 문서(`portability-guide.md`, `stacks/README.md`)가 들어 있어 템플릿 계약과 무관한 변경(P1의 portability-guide 한 줄, P4의 stacks README verify 계약)마다 과매칭 갭이 났다. documents를 전용 계약 문서 `.harness/project/template-contract.md`로 축소(ownedAreas의 apply-stack 소스 보호는 유지). triggerPaths는 소스 쪽 매칭이라 문서 과매칭에는 효과가 없음을 policy-harness.mjs 로직으로 확인하고 documents 축소를 선택했다.
- **P4/P5 검증 결과**: 신규 `stackVerifyRunsRawCommandsWithoutNpm` — 비-Node 타깃에 verify 프리셋 적용 후 `harness check`가 raw lint/test 명령을 실행(산출 파일 확인)하고 `--fast`가 test stage를 스킵함을 e2e 검증. 비-Node `.gitignore` 비오염/Node 기존 거동 잠금 단언 추가. 스모크 38/38 OK, `harness:check:strict` 통과(필수 조치 0).
- **릴리스 후 CI 실패 2건과 교훈(2026-06-10, v0.2.61~62)**: (1) v0.2.60 CI에서 신규 hook e2e 테스트가 **기존 잠복 버그**를 노출 — Linux(sh=dash)+nvm에서 `set -u` 상태의 `nvm use`가 expansion error로 hook을 무출력 exit 2 종료시킴(`|| true`로 못 잡고, `2>/dev/null`이 메시지를 삼킴; macOS sh=bash는 비영향, 그래서 로컬은 통과). nvm 로드 구간을 `set +u`로 감싸 수정(v0.2.61). 재현 중 추가 발견: hook이 첫 node 호출 전 버전 검사를 안 해 낮은 Node에서 안내 대신 ESM 크래시 — `check-node-version.mjs` 선행으로 수정(v0.2.62). (2) v0.2.61 CI는 strict의 per-push 갭 규칙에 걸림 — hook 소스만 바꾸고 짝 문서를 같은 push에 안 넣으면 `common.hooks.commit-push-check`가 "소스만 변경됨"으로 차단. **교훈을 규칙으로**: 정책 짝(소스↔문서)은 반드시 같은 push에 함께 넣는다. waivers.json은 현재 policy-harness가 갭 억제에 실제로 소비하지 않으므로(메시지 안내뿐) 단방향 변경의 탈출구가 아니다. hook 구현 계약(dash 호환·set +u·Node 검사 선행·런처 호출)은 `commit-push-rules.md`에 승격했다.
- **Windows shim 추가(2026-06-10, `bw-windows-shim` 해소)**: 개발자 답변 — Windows 사용자가 있어 shim 필요. `.harness/bin/harness.cmd`(cmd.exe/PowerShell용)를 sh 런처와 같은 명령표로 추가. git hook은 Windows에서도 Git Bash(sh)로 실행되므로 hook 경로는 sh 런처를 그대로 사용하고, .cmd는 터미널 직접 입력용. batch는 cp949 mojibake를 피하려고 메시지를 ASCII로 유지. macOS에서 .cmd 실행 검증은 불가하므로 정적 드리프트 가드로 보강 — `launcherRunsHarnessWithoutNpm`이 (a) 소비자 npm script가 가리키는 모든 `.harness/bin/*.mjs`를 sh/.cmd 둘 다 커버하는지, (b) sh case 라벨 전부가 .cmd 분기에 존재하는지 검사. 실제 Windows 동작 확인은 Windows 사용자 첫 도입 시 후속 확인 항목.

## 2026-06-08 - 기존 .claude/settings.json에 안전 훅 병합 + clubadm 고스트 테스트
- 갭: 소비자가 이미 `.claude/settings.json`을 가지면 init이 그 파일을 보존만 하고 하네스 훅 wiring(settings.json hooks 블록)을 적용하지 않아, 에이전트 안전 훅(회사 공통 필수 차단 기준)이 실제로 동작하지 않았습니다. clubadm 고스트 테스트에서 재현됨.
- 또한 첫 설치엔 보존, 이후 업데이트엔 managed로 덮어쓰는 비일관 거동이라 소비자 커스터마이즈가 사라질 위험도 있었습니다.
- 해결: `.claude/settings.json`을 project-owned로 분류(업데이트 덮어쓰기 방지)하고, `mergeClaudeSettings`로 하네스 안전 표면(hooks/permissions.deny·allow/env/statusLine)을 기존 설정에 멱등·비파괴 병합(기존 값 보존, statusLine은 없을 때만, command 시그니처로 중복 제거). mergePackageJson 선례와 같은 패턴.
- 정책 근거: 안전 훅 wiring은 보존보다 우선하는 필수 차단 기준이지만, 병합은 추가만 하고 소비자 설정을 파괴하지 않으므로 project-owned 보존 원칙과 양립합니다.
- SYNC GAP 해소: init.mjs 변경이 트리거하는 force-overwrite·preserve-project-owned는 install 보존 프로토콜 문서 `sync-protocol.md`에, minimum-node는 `.claude` 어댑터 config 문서 `config-contract.md`에 settings.json 병합 거동을 정직하게 기록해 클리어했습니다(둘 다 실제 바뀐 계약).
- 검증: 신규 smoke test + clubadm 고스트 재테스트(기존 UserPromptSubmit 훅 보존 + 하네스 6개 이벤트 wiring + 재설치 멱등) 통과. 온보딩 플레이북은 `consumer-reviews/CLUBADM_ONBOARDING_PLAYBOOK_2026-06-08.md`.

## 2026-06-08 - 하네스 업데이트 변경 내역 가시화 (changelog 델타)
- 문제: `harness:outdated`/`harness:update`가 버전 번호만 보여주고 무엇이 바뀌었는지는 보여주지 않았습니다. 게다가 init은 본체 `CHANGELOG.md`를 소비자에 복사하지 않으므로(INSTALL_ITEMS 제외) 소비자는 변경 내용을 알 길이 없었습니다.
- 새 CHANGELOG는 `npx ... init`이 새 패키지 안에서 실행되는 그 순간에만 접근 가능합니다. 따라서 init이 (이전 lock 버전 → 새 버전] 구간의 CHANGELOG 델타를 계산해 (a) 설치 직후 인라인 출력하고 (b) `harness-lock.json`의 `lastUpdate`에 보존합니다. lock은 ship되지 않는 프로젝트별 상태라 소비자별로 안전합니다.
- 재열람은 새 명령 `npm run harness:changelog`(= `.harness/bin/changelog-delta.mjs`)가 lock.lastUpdate를 다시 출력합니다. 본체 개발자는 `--changelog/--from/--to`로 임의 구간도 파싱할 수 있습니다.
- `outdated`에는 변경 내역 확인 경로 힌트만 추가하고, 무거운 원격 CHANGELOG fetch는 넣지 않았습니다(자격증명/지연 위험). 실제 델타는 이미 패키지를 받는 update 시점에 보여줍니다.
- init smoke test에 델타 기록·재생 검증을 추가했고, 이 테스트가 "CHANGELOG 최상단 버전 == package.json version"까지 강제해 릴리스 동기화 회귀를 막습니다.
- 검증 중 cwd 실수로 시드 저장소에 self-install이 발생했으나(bin mode-only 변경 + lock/manifest 산출물), 커밋 전 전부 복원/삭제했습니다. 작업 트리에는 의도한 변경만 남았습니다.
- SYNC GAP 해소 (strict CI 통과 기준): init.mjs는 force-overwrite·minimum-node·preserve-project-owned 등 여러 정책의 공통 트리거라, 변경 시 짝 문서를 함께 봐야 합니다. 내 변경이 실제로 건드린 계약만 정직하게 문서화했습니다 — (1) install/update 프로토콜(lock에 lastUpdate 기록)은 `sync-protocol.md`에, (2) harness-lock.json에 새로 추가된 `lastUpdate` 필드는 설정 계약 문서 `config-contract.md`에 반영. 이로써 force-overwrite·minimum-node·preserve-project-owned가 모두 짝 변경으로 클리어됐습니다.
- 반대로 `outdated/update`의 안내문과 `portability-guide.md` 한 줄은 각각 `common.stack.bundle-integrity`·`common.template.contract-bridge`를 과매칭시키는 cosmetic/중복 변경이라, 정책을 약화하거나 문서를 거짓 수정하는 대신 되돌렸습니다. harness:changelog 발견성은 README·update-flow 스킬·sync-protocol·config-contract·업데이트 인라인 출력으로 충분히 유지됩니다.
- 참고: 5/29~ CI가 apply-stack 단계에서 죽어 strict 정책 검사가 실제로 돈 적이 없었고, 그 단계를 고친 뒤 0.2.57이 strict를 처음 통과했습니다. 그래서 init.mjs를 건드리는 이번 변경이 다수 정책을 처음으로 마주쳤습니다.

## 2026-06-08 - 본체 변경/배포 체크리스트 + 원격 동기화 가드 추가
- 본체(harness-seed)는 "남을 위한 안전장치"는 갖췄지만 자기 자신을 고치고 내보내는 절차(버전 bump, CHANGELOG, 양쪽 원격 동기화, downstream 통지)가 사람의 기억에만 의존하는 갭이 있었습니다. 실제로 GitHub 미러가 2커밋 뒤처지는 사고로 드러났습니다.
- 두 가지를 추가합니다. (A) 본체 전용 절차 문서 `.harness/project/body-release-checklist.md`, (B) maintainer 스킬 `harness.body-release` + 원격 동기화 가드 `.harness/bin/check-remote-sync.mjs`.
- `body-release-checklist.md`는 소비자에게도 ship되지만(authoring-guide.md 선례처럼) seed-mode 전용임을 상단에 명시하고, 소비자 커밋/푸시 기준은 commit-push-rules.md로 분리합니다.
- 원격 동기화 가드는 `check-seed-mode.mjs` 선례를 따라 `.harness-seed-mode`가 있을 때만 동작(소비자 no-op)하고, 네트워크를 쓰지 않으며(캐시된 remote-tracking ref만 비교) 절대 push를 막지 않습니다(항상 exit 0, 비차단 알림). pre-push에서 `|| true`로 호출합니다.
- 자동 dual-push 스크립트는 만들지 않았습니다. push는 부수효과가 크고 자격증명/네트워크 위험이 있어, 정확한 절차는 체크리스트로 문서화하고 가드는 "빠진 원격 알림"까지만 책임집니다.
- 새 문서는 document-registry.json에 등록해 orphan(strict 실패)을 피하고, context-registry.json과 skills/registry.json에 연결했습니다. commit-push-rules.md의 "변경 시 함께 확인할 것"에 새 스크립트와 체크리스트 포인터를 추가했습니다.
- 버전 bump와 CHANGELOG 항목은 사용자 최종화 승인 단계에서 처리합니다(이 변경 자체가 그 체크리스트의 첫 dogfooding).

## 2026-06-08 - Policy Guard CI의 activeStack=none 실패 가드
- GitHub Actions `Policy Guard`(`.github/workflows/policy-guard.yml`)가 `activeStack: none`이 된 5/29 이후 모든 main push에서 ~10초 만에 실패해 왔습니다.
- 실패 단계는 검증(`harness:check:strict`)이 아니라 그 앞의 `Apply active stack` 단계입니다. 이 단계가 `node .harness/bin/apply-stack.mjs`를 인자 없이 실행하는데, `apply-stack.mjs`는 무인자 + `activeStack==='none'`이면 의도적으로 exit 1 합니다(스택을 먼저 고르라는 정상 동작).
- 로컬 pre-push hook은 `harness:check --fast`만 돌려 `none`을 정상 스킵하므로 통과하지만, CI에만 있는 `apply-stack` 단계가 `none`을 견디지 못해 로컬↔CI 결과가 갈렸습니다.
- 스크립트(`apply-stack.mjs`)는 건드리지 않습니다. 무인자 적용 시 exit 1은 `npm run stack:apply`의 의도된 사용자 안내이므로 보존합니다.
- 수정 위치는 워크플로입니다. `Apply active stack` 단계가 `profile.json`의 `activeStack`을 읽어 `none`이면 단계를 건너뛰고, 스택이 지정된 소비자 환경에서는 기존대로 `apply-stack.mjs`를 실행하도록 가드를 추가합니다. 이후 단계는 로컬 pre-push와 동일하게 `harness:check:strict`로 검사합니다.

## 2026-06-06 - visible trace 조건부 리마인더 본체 반영
- visible trace는 실제 업무 진행 보고에 적용되는 런타임 보고 규약이며, 단순 질문 응답·잡담·메타 확인에는 강요하지 않습니다.
- 긴 세션에서 규약이 풍화되지 않도록 Claude UserPromptSubmit hook, Codex inject-context hook, Copilot instructions에 같은 조건부 리마인더 문구를 둡니다.
- 응답 형식은 정적 파일 검사로 안정적으로 판정할 수 없으므로 `harness:check` 차단 대상이 아니라 어댑터 주입과 진입점 문서 리마인더로 보강합니다.
- `.harness/generated/**`나 task-context 같은 생성 컨텍스트를 진실 출처로 승격하지 않습니다. 이번 변경은 생성 산출물 처리 기준이 아니라 보고 형식 리마인더의 적용/면제 경계를 명시한 것입니다.
- `portability-guide.md`의 플랫폼 어댑터 계약은 scaffold/template 계약을 바꾸지 않습니다. 템플릿은 계속 contract bridge를 통해 프로젝트 룰에 연결하고, 이번 변경은 `.codex/` 어댑터 설치 표면을 문서화하는 데 한정합니다.

## 2026-06-06 - Claude Code 어댑터 안전 hook 보강
- Venom의 실제 hook 동작을 검토한 뒤, 그대로 memory를 누적하는 방식은 배제하고 Claude Code 실행 표면의 결핍만 보강합니다.
- 도입 범위는 사용자 프롬프트 secret 패턴 감지, 위험 Bash 명령/secret 파일 읽기 우회 차단, 보호 경로 Write/Edit 차단, 최근 tool 실패/PermissionDenied capped 기록으로 제한합니다.
- 최근 실패 기록은 `.harness/generated/agent-events.ndjson`에 redaction 후 최대 `HARNESS_AGENT_EVENT_CAP`개만 남기고, 컨텍스트에는 `HARNESS_AGENT_EVENT_TTL_MINUTES` 안의 마지막 1건만 주입합니다. 이 파일은 재생성/임시 산출물이며 프로젝트 룰이나 세션 기억으로 자동 승격하지 않습니다.
- 반복 규칙으로 굳힐 필요가 있을 때만 `developer-input-queue.md`, `decision-log.md`, `.harness/project/*`, 정책 registry 중 알맞은 위치로 별도 승격합니다.

## 2026-06-06 - 축적형 기억 표면 정리 기준 승격
- v0.2.54의 세션 슬림 원칙은 `next-session-reminder.md`, `active-context.md` 중심이라 재개 시 로드되는 `decision-log.md`, `developer-input-queue.md`, `project-memory.md`, `MEMORY.md`류 인덱스의 무한 누적을 막기에는 부족했습니다.
- 세션/기억 운영 기준은 회사 공통 기본 운영 기준으로 보고, 실제 소비자 내용은 project-owned로 보존하되 본체는 `/decision`, `/memory`, session README, skill registry, 신규 설치 시드에 정리 규율을 내립니다.
- 원칙: supersede된 결정은 포인터로 축약하거나 날짜별 스냅샷으로 아카이브하고, 큐에는 `open`/`deferred`만 상시 유지하며, 장기 기억 인덱스는 같은 사실을 중복 추가하지 않고 기존 항목을 갱신합니다.

## 2026-05-29 - base-only update source metadata 보존
- 소비자 프로젝트에서 `npm run harness:update -- --base-only` 후 공통 하네스는 `0.2.50`으로 업데이트되었지만 `.harness/harness-lock.json`과 `.harness/install-manifest.json`의 base source metadata가 `bundled`로 남는 문제가 확인되었습니다.
- 이후 `npm run harness:outdated`가 공통 하네스 repo/ref를 찾지 못해 baseHarness를 `unavailable`로 표시했습니다.
- 업데이트 wrapper가 공통 하네스 init을 실행할 때 `--source-repo`, `--source-ref`를 전달하도록 수정합니다.
- init은 `semver:*` source ref를 그대로 기록하지 않고 실제 설치된 package version tag(`vX.Y.Z`)로 정규화합니다.
- 이미 `bundled` metadata가 남아 있는 소비자 프로젝트도 stack의 `requiredBaseHarness.repo`와 현재 base version으로 repo/ref를 복구해 outdated 검사가 동작하도록 보강합니다.

## 2026-05-29 - harness:outdated 공통/스택 복합 검사
- 소비자 프로젝트에서 스택 하네스가 최신이면 공통 하네스가 오래되어도 `npm run harness:outdated`가 `up-to-date`처럼 보이는 문제가 확인되었습니다.
- `harness:outdated` 기본 동작은 `baseHarness`와 `stackHarness`를 모두 검사하고, 둘 중 하나라도 업데이트 후보가 있으면 전체 상태를 `outdated`로 표시합니다.
- `--base-only`, `--stack-only`는 단일 대상 점검용으로 유지하고, `--fail-on-outdated`는 공통 또는 스택 중 하나라도 outdated면 실패합니다.
- `harness:update` 기본 동작은 안전하게 스택 중심으로 유지합니다. 공통 하네스만 업데이트할 때는 `npm run harness:update -- --base-only`를 출력에서 명확히 안내합니다.
- base metadata가 lock에 부족한 경우 lock source 또는 install manifest source에서 repo/ref/version을 복구해 조회할 수 있게 합니다.
- 스택 manifest의 `baseHarness.ref`는 기본적으로 검증된 기준 ref로 취급하고 exact pin으로 보지 않습니다. 설치된 공통 하네스가 `minVersion` 이상이면 상위 base를 보존해야 하며, 정확한 ref 고정이 필요한 경우에만 `exactRefRequired: true`를 별도 필드로 명시합니다.

## 2026-05-29 - commit/push 승인 시 중복 검증 방지
- 소비자 프로젝트에서 에이전트가 커밋 직전 `npm run harness:check`를 수동 실행한 뒤, pre-commit hook에서 같은 검증을 다시 실행해 작업 시간이 늘어나는 문제가 확인되었습니다.
- `최종 검증만` 요청은 에이전트가 직접 `npm run harness:check`를 실행하고, `커밋/푸시` 요청은 설치된 pre-commit/pre-push hook 검증에 맡기는 기준으로 분리합니다.
- hook이 설치되어 있지 않거나 `--no-verify` 등으로 우회되는 환경에서는 에이전트가 직접 `npm run harness:check`를 실행합니다.
- 대형 변경에서 커밋 전 빠른 실패 확인이 필요하면 수동 check를 허용하되, 이후 hook에서 같은 검증이 다시 실행될 수 있음을 사용자에게 먼저 알립니다.
- 이 기준을 소비자용 `커밋/푸시 최종화 흐름` 스킬로도 등록해 에이전트가 커밋/푸시 요청을 받았을 때 별도 선행 검증을 생략할지 판단할 수 있게 합니다.
- 스킬 smoke test를 `scripts/test-init.mjs`에 추가해도 force overwrite와 Node 런타임 정책이 파일 단위로 과도하게 blocking 되지 않도록, 두 정책의 `triggerPaths`는 실제 구현 파일 중심으로 좁힙니다.

## 2026-05-28 - commit/push hook 정책 문서 범위 축소
- 소비자 프로젝트에서 `workflow-rules.md`의 workstream 운영 문구만 수정해도 `common.hooks.commit-push-check`가 action required로 뜨는 false positive가 확인되었습니다.
- 1차 개선으로 commit/push hook 기준을 `.harness/project/commit-push-rules.md`로 분리하고, 해당 정책의 `documents`를 이 전용 문서와 `standards-layers.md`로 좁혔습니다.
- `workflow-rules.md`는 일반 개발 흐름, 검증 흐름, 완료 승인 게이트 중심으로 유지하고, hook 구현/체인/커밋 템플릿 기준은 `commit-push-rules.md`가 소유합니다.
- 향후 개선 후보로 문서 heading/section 단위 매칭과 decision-log 기반 documented exception 완화를 남깁니다. 다만 근본 완화는 정책별 documents 범위 축소를 우선합니다.

## 2026-05-28 - Workstream 대화창 분리 가이드 1차 반영
- 소비자 프로젝트에서 긴 대화창에 여러 업무가 누적되면 컨텍스트가 비대해지고 에이전트가 현재 작업 범위를 흐리게 인식하는 문제가 확인되었습니다.
- 1차 반영은 강제 기능이 아니라 `.harness/documentation/workstream-chat-splitting-guide.md` 공통 가이드와 `.harness/documentation/templates/workstreams/` 아래 복사용 예시 템플릿으로 제한합니다.
- 프로젝트가 session workstreams README를 만들어 opt-in 한 경우에만 에이전트가 매 요청 시작 시 현재 workstream과 선행/후행 workstream 필요 여부를 식별합니다.
- 자동화는 아직 도입하지 않습니다. 향후 후보는 `harness:workstream:init`, `harness:workstream:status`, `harness:handoff` 연동, `harness:context`의 workstream 추천, 어댑터 visible trace 표시입니다.

## 2026-05-22 - 운영 업무 접수와 업무 요약 흐름 추가
- 운영 업무는 JIRA 출처와 업무 유형이 명확해야 하므로 Claude slash command `/운영업무`를 추가해 `버그픽스`, `신규 기능`, `단순 리팩토링`, `기존 기능 개선` 중 하나를 먼저 확인하도록 합니다.
- 업무 유형별 기존 스킬을 연결하되, 기존 기능 개선은 별도 흐름이 필요해 `harness.enhancement-flow`를 추가합니다.
- 작업 종료 시 `/업무요약`과 `harness.work-summary`를 통해 .harness/maintenance/work-history/연도별 폴더에 JIRA URL, 요청 개요, 핵심 개발 내용, 검증, 잠재 이슈 또는 TODO를 남기도록 합니다.
- .harness/maintenance/work-history/연도별 폴더는 팀이 공유하는 운영 히스토리이므로 Git 형상관리 대상으로 두고, 하네스 업데이트 때 보존되는 프로젝트 소유 경로로 둡니다.
- 업무 히스토리 작성 후 중요한 구조 결정이나 예외는 `decision-log.md`에, 반복되는 도메인/구조/검증 규칙은 `.harness/project/*` 로컬룰로 승격할지 판단합니다.

## 2026-05-21 - 하네스 자동 인식 실패 회귀 반영
- RunContext 소비자 프로젝트 검증 중, 하네스가 설치되어 있었지만 에이전트가 사용자의 명시적 "하네스" 언급 전까지 `.harness` 기준을 자동으로 적용하지 않는 문제가 드러났습니다.
- 기존 문서는 읽기 순서를 안내했지만, Codex/Copilot 같은 비-Claude 에이전트에게 "루트에 `.harness/`가 있으면 자동으로 하네스 프로젝트로 인식한다"는 의무가 충분히 강하지 않았습니다.
- `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `session-start-alert.md`에 자동 인식 의무와 반복 규칙 승격, 불확실성 인터뷰, 완료 전 `harness:check` 원칙을 더 직접적으로 추가합니다.
- 설치 템플릿의 `active-context.md`, `decision-log.md`, `developer-input-queue.md`, `next-session-reminder.md`에도 사용자가 하네스를 말하지 않아도 하네스 프로토콜을 적용해야 한다는 문구를 남깁니다.
- `scripts/test-init.mjs`에 자동 인식 문구가 소비자 프로젝트에 실제 주입되는지 검증하는 회귀 테스트를 추가합니다.

## 2026-05-20 - 하네스 스킬 레지스트리 도입
- 에이전트가 요청을 받았을 때 모든 문서를 읽는 방식은 토큰과 판단 품질 측면에서 비효율적입니다.
- 공통 하네스 내부에 `.harness/skills/registry.json`을 두고, 요청 유형별 읽을 문서, 실행 명령, 산출물, 기록 위치를 선택하게 합니다.
- `harness:context -- "<작업 설명>"`는 관련 문서 후보와 함께 Selected Skills를 출력합니다.
- 여기서 스킬은 Claude slash command나 외부 Codex skill이 아니라, 공통 하네스가 관리하는 에이전트 작업 절차입니다.
- 스킬 ID는 자동화를 위해 영어로 유지하되, 소비자 프로젝트 개발자가 보는 `title`과 설명은 한국어로 둡니다.
- 소비자 프로젝트에는 세션 시작, 스택 선택, 버그 수정, 기능 개발, 리팩토링, 직접 수정 반영, 커밋 전 검증, 인계 흐름이 우선 필요합니다.

## 2026-05-20 - hooks:install 안내 강화
- `npm run hooks:install`은 hook 파일을 새로 생성하기보다 `git config core.hooksPath .githooks`와 `commit.template`을 설정하는 명령입니다.
- 기존 `.git/hooks/pre-commit`, `.git/hooks/pre-push` 또는 기존 `core.hooksPath`의 hook은 사용자 프로젝트 소유 검증일 수 있으므로 하네스 설치 후에도 함께 실행되어야 합니다.
- 설치 시 기존 hook 경로를 `harness.previousHooksPath`에 저장하고, `.githooks/pre-commit`/`.githooks/pre-push`가 기존 hook을 먼저 실행한 뒤 하네스 검사를 실행합니다.
- 설치 완료 시 활성화되는 `.githooks/pre-commit`, `.githooks/pre-push`, `.github/commit-template.txt`의 역할과 기존 hook 체인 실행 여부를 출력합니다.

## 2026-05-19 - 공통 하네스 용어와 에이전트 세션 명령 정리
- 사용자-facing 용어는 “공통 하네스”로 통일하고, “하네스시드”는 공통 하네스 설치 저장소/패키지 이름으로 제한합니다.
- Claude Code는 `SessionStart` hook과 slash command를 통해 `next-session-reminder.md`, `project-memory.md`, `decision-log.md`를 명시적으로 다룹니다.
- Codex와 Copilot은 동일한 hook 강제성이 없으므로 `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`에서 읽기 순서와 대상 파일을 안내합니다.

## 2026-05-19 - 낮은 Node 프로젝트의 하네스 설치 중단
- 하네스 실행 스크립트는 Node 20.19 이상을 기준으로 유지합니다.
- Node 12 같은 낮은 프로젝트 런타임에서 CLI만 우회 실행해도 설치 이후 `harness:scan`, `harness:check`, `harness:update`가 계속 실패하므로 CommonJS 호환 레이어를 만들지 않습니다.
- 기존 `.nvmrc`가 하네스 실행 최소 버전보다 낮으면 설치를 중단하고 프로젝트 Node 전환을 먼저 안내합니다.

## 2026-05-19 - Agent Decision Context v1
- `harness:context`는 개발자가 업무 지시마다 직접 실행하는 명령이 아니라 에이전트가 큰 작업, 낯선 영역, 충돌 가능성이 있는 작업 전에 쓰는 보조 명령으로 둡니다.
- 산출물은 단순 읽을거리 후보가 아니라 작업 유형, 관련 기준, 충돌 우선순위, 영향 후보, 필수 산출물을 담는 `Agent Decision Context`로 정리합니다.
- 항상 읽는 최소 기준은 짧게 유지하고, 누적된 프로젝트 룰은 `context-registry.json`과 작업 설명을 통해 필요한 문서만 좁혀 읽습니다.
- 생성 컨텍스트는 기준이 아니며 실제 코드와 원본 문서가 우선합니다.

## 2026-05-19 - 가이드 진입 명령 표현 정리
- `Daily entrypoints`는 매일 실행해야 하는 명령처럼 보이므로 `Recommended commands`로 바꿉니다.
- `harness:handoff`의 목적은 추상적인 다음 행동이 아니라 설치/업데이트 후 확인할 일, 현재 변경 상태, 권장 조치를 보여주는 것입니다.
- `hooks:install`을 실행한 프로젝트는 `git commit`과 `git push` 전에 `harness:check`가 자동 실행된다는 점을 가이드 출력에 명시합니다.

## 2026-05-19 - Policy Registry v3
- 정책 DB화 전에 파일 기반 레지스트리를 먼저 원자 정책 단위로 확장합니다.
- 공통 정책 항목에는 계층, 상태, 심각도, 강제 강도, 예외 가능 여부, 소유자, 출처, 문서/소유 영역, 검증 명령을 기록합니다.
- `policy:check`는 공통 정책 레지스트리 v3 필수 필드와 enum을 검사합니다.
- 스택 하네스 외부 `policies.json`는 기존 호환을 위해 기본 필드만 검사하고, v3 강제는 공통 레지스트리부터 적용합니다.

## 2026-05-19 - 검증 명령 사용 위치 표기
- `harness:check`, `harness:impact`, `harness:scan`, `harness:handoff`, `hooks:install`은 소비자 프로젝트에서도 쓰는 공개 명령입니다.
- `policy:check`, `docs:check:strict`, `scripts/test-init.mjs`, `npm pack --dry-run`은 주로 하네스 본체 개발과 배포 검증에서 쓰는 명령입니다.
- 스택 하네스와 CLI 저장소의 downstream 검증은 소비자 프로젝트가 아니라 해당 본체 저장소의 릴리스 안전성을 확인하는 용도입니다.

## 2026-05-18 - 공통 하네스만 설치된 상태의 다음 선택 안내
- 러버덕 테스트에서 공통시드만 설치한 개발자가 다음 행동을 알기 어렵다는 문제가 확인되었습니다.
- 공통 하네스 단독 설치는 실패나 미완료가 아니라 정상 선택 가능한 상태입니다.
- `activeStack: none`은 "선택 전"과 "공통 기준 단독 운영"을 모두 표현할 수 있으므로 안내에서는 두 경우를 구분해 설명합니다.
- 설치 완료 안내, `harness:handoff`, `harness:guide`는 맞는 스택 적용, 공통 기준 단독 운영, 새 스택 하네스 후보 요청 중 하나를 다음 선택으로 제시합니다.

## 2026-05-18 - 본체 GitHub Actions workflow 소비자 설치 제외
- `.github/workflows/policy-guard.yml`은 하네스 본체 또는 GitHub 환경에서 쓰는 CI 어댑터이며, 소비자 프로젝트에 기본 주입될 파일이 아닙니다.
- 소비자 프로젝트에는 에이전트 진입점, 커밋 템플릿, Copilot 지침처럼 직접 쓰는 어댑터만 설치합니다.
- GitHub Actions workflow가 필요한 프로젝트는 프로젝트/조직 CI 기준으로 별도 템플릿에서 선택 적용해야 합니다.

## 2026-05-18 - CLI 역할을 부트스트랩/라우터로 축소
- 소비자 프로젝트에서 프로젝트 로컬 CLI를 일상 명령으로 쓰게 하는 방식은 `npm run harness:*` 대비 실익이 작고, `ai` 명령이 바로 될 것이라는 오해를 만듭니다.
- `ai-standard-cli`는 최초 설치 시 프로젝트 스택을 감지하고 적절한 하네스 init으로 연결하는 bootstrap/router로 제한합니다.
- 설치 이후 개발자와 에이전트는 프로젝트에 생성된 `npm run harness:guide`, `npm run harness:check`, `npm run harness:update` 등을 표준 실행면으로 사용합니다.

## 2026-05-18 - force 덮어쓰기 확인 절차 추가
- 소비자 프로젝트의 `decision-log.md`, `project-memory.md`, 프로젝트 룰 문서는 하네스 업데이트 중에도 프로젝트 소유 산출물로 보존되어야 합니다.
- `--force`는 이 보존 원칙을 깨고 프로젝트 소유/출처 미확인 파일까지 덮어쓸 수 있으므로 단독 실행을 중단합니다.
- 실제 덮어쓰기는 `--force --confirm-overwrite-project-files`로 위험 인지를 명시한 경우에만 허용합니다.
- 자동화 환경에서는 `AI_STANDARD_CONFIRM_OVERWRITE_PROJECT_FILES=1`을 사용할 수 있지만, 이 경우에도 백업 생성 여부와 덮어쓰기 대상 목록을 확인해야 합니다.
- 본체 개발 레포는 소비자 프로젝트와 달리 개발용 `.nvmrc`를 보유하고, npm/버전/lockfile 작업 전 `nvm use`를 먼저 적용합니다.

## 2026-05-18 - 전역 없는 CLI 사용 방식 정리
- 후속 결정으로 이 방향은 폐기했습니다. CLI는 devDependency로 남기지 않고, 설치 이후 표준 사용은 `npm run harness:*`로 통일합니다.
- 소비자 개발자는 전역 설치를 기본으로 하지 않습니다.
- 당시에는 `npx ... ai-standard-cli.git#<tag> init` 이후 CLI를 적용 프로젝트의 devDependency로 남기는 방안을 검토했습니다.
- 이후 명령도 프로젝트 로컬 CLI로 감싸는 방향을 검토했지만, 현재 표준에서는 사용하지 않습니다.
- `ai`만 직접 입력하는 방식은 전역 설치나 PATH 변경이 필요하므로 기본 도입 흐름에서 제외합니다.

## 2026-05-14 - scan/handoff 공개 명령 정리
- 정식 공개 전 공개 명령을 `harness:scan`, `harness:handoff`, `harness:impact`, `harness:check` 중심으로 정리합니다.
- `harness:scan`은 프로젝트 구조, 스타일 출처, 기준 계층, 충돌 후보를 `.harness/session/project-scan-report.md`에 남깁니다.
- `harness:handoff`는 설치/업데이트 직후 개발자가 봐야 할 요약과 다음 액션을 `.harness/session/handoff.md`에 남깁니다.
- 에이전트 사고 흐름은 원시 내부 추론이 아니라 `[harness] request/context/impact/action/decision/verify` 형태의 visible trace로 설명합니다.
- 커밋 확정 단계는 `.github/commit-template.txt`의 한글 요약 + 하이픈 상세 + 검증 목록 형식을 따릅니다.

## 2026-05-14 - 로컬룰 누적 대응 원칙 추가
- 프로젝트 운영 기간이 길어져도 모든 로컬룰을 매번 프롬프트에 넣지 않습니다.
- 항상 읽는 최소 기준은 짧게 유지하고, `harness:context -- "<작업 설명>"`으로 에이전트 판단 컨텍스트를 만듭니다.
- 길어진 룰은 인덱스, 최신 요약, 세부 문서, decision-log로 분리하고, 현재 따라야 할 기준만 상위 문서에 남깁니다.
- 한 번뿐인 구현 세부사항은 프로젝트 룰로 승격하지 않고, 반복 근거가 있는 도메인/구조/검증 기준만 승격합니다.

## 2026-05-14 - 개발자용 클릭형 가이드 도입
- 하네스 문서 전체를 개발자가 직접 읽고 이해하는 방식은 실제 도입 장벽이 높다고 판단했습니다.
- 정적 라이프사이클 이미지는 개요로 유지하되, 실제 사용 진입점은 `npm run harness:guide`로 생성되는 현재 상태 대시보드와 `.harness/documentation/guide/index.html` 클릭형 가이드로 둡니다.
- 클릭형 가이드는 요구 수신, 기준 탐색, 영향 판단, 구현, 검토, 검증, 커밋 확정 단계별로 관련 명령과 파일만 보여줍니다.
- `harness:guide`가 생성하는 `.harness/generated/harness-dashboard.html`은 런타임 산출물이므로 형상관리 대상에서 제외합니다.

## 2026-05-14 - 정식 공개 전 npm script alias 정리
- 정식 공개 전이라 과거 호환을 유지할 필요가 없으므로 오래된 공개 alias를 제거합니다.
- 개발자용 표준 명령은 `harness:guide`, `harness:scan`, `harness:check`, `standards:list`, `templates:list`, `stack:*`, `template:*`로 정리합니다.
- `policy:*`와 `docs:*`는 삭제하지 않고 하네스 관리자/CI용 세부 검사 명령으로 문서에서 분리합니다.

## 2026-05-14 - 소비자 프로젝트 npm script 축소
- 하네스 본체 개발용 npm script와 소비자 프로젝트에 주입되는 npm script를 분리합니다.
- `scripts/init.mjs`는 package.json의 모든 script를 병합하지 않고 소비자용 allowlist만 병합합니다.
- 소비자 프로젝트에는 `node:check`, `policy:*`, `docs:*`를 기본 주입하지 않고, 공개 명령인 `harness:impact`, `harness:check`를 통해 필요한 검사를 실행하게 합니다.
- 소비자용 script는 `node:check` npm script에 의존하지 않도록 `.harness/bin/check-node-version.mjs`를 직접 호출합니다.

## 2026-05-08 - 하네스 실행 Node와 프로젝트 빌드 Node 분리
- 공통 하네스, 스택 하네스, scaffold 템플릿이 서로 다른 `.nvmrc` 기준을 보이면 적용 프로젝트 개발자가 어떤 런타임을 선택해야 하는지 헷갈릴 수 있습니다.
- Jenkins 파이프라인에서 프로젝트 `.nvmrc`를 `nvm use`로 읽는 기존 프로젝트가 있으므로, 하네스 실행 기준과 프로젝트 빌드 기준을 분리합니다.
- 하네스 실행 최소 Node는 `20.19.0`으로 낮추고, 하네스 스크립트는 이 버전에서 동작하도록 유지합니다.
- 공통/스택 하네스는 소비자 프로젝트에 `.nvmrc`를 주입하지 않습니다.
- 적용 프로젝트의 `.nvmrc`는 프로젝트/Jenkins 빌드 계약으로 보고, scaffold 템플릿 적용 시에도 기존 파일을 자동 덮어쓰지 않습니다.
- Node 20은 2026-04-30에 EOL이므로 신규 프로젝트는 Jenkins 검증이 준비되는 대로 Node 22/24 전환을 검토합니다.

## 2026-04-30 - 최상위 기준 정책 위배 항목 보정
- `ai-standard/docs`의 최상위 길라잡이는 원본으로 두고, 하네스시드에는 참조 문서만 둡니다.
- `harness:scan` 리포트에 회사/스택/템플릿/프로젝트/개인 기준 계층과 충돌 후보 섹션을 추가해, 기준 충돌을 개발자가 선택할 수 있게 합니다.
- 프로젝트 적용 흐름은 공통 기준 직접 사용이 아니라 스택 기준 선택 중심으로 설명합니다. `none`은 예외 또는 전환 중 상태로 둡니다.
- scaffold 템플릿은 기본값이 아니라 후보 목록으로 표현하며, 현재 등록된 후보 예시만 문서에 남깁니다.
- 에이전트 작업은 로컬 git hook 설치 여부와 무관하게 완료 시 `harness:check`를 실행하는 Claude Code hook을 추가합니다.

## 2026-04-30 - policy 용어 설명 정리
- 외부 설명에서는 policy를 회사 규정처럼 보이게 쓰지 않고, "프로젝트가 반복적으로 지키기로 한 개발 기준"으로 풀어 설명합니다.
- `.harness/policy/` 폴더명과 `policy:*` 명령은 내부 구조명으로 유지하되, README와 하네스 문서에서는 개발 기준, 검증 기준, 기준 동기화라는 표현을 우선 사용합니다.

## 2026-04-29 - scan/check 설치 흐름 도입
- 처음 주입할 때는 기존 프로젝트 구조를 파악하는 `harness:scan`이 `.harness/session/project-scan-report.md`를 자동 생성합니다.
- 설치 직후 `harness:check`를 자동 실행해 하네스 문서, 정책, 링크, 스택 적용 상태가 기본적으로 맞는지 확인합니다.
- 새 문서와 CI 표기는 `harness:scan`과 `harness:check`를 기준으로 정리합니다.
- 자동 실행이 부담되는 환경을 위해 `init --no-scan --no-check` 옵션을 둡니다.

## 2026-04-28 - 하네스 본체를 .harness로 이동
- 특정 플랫폼 의존을 줄이기 위해 일반 하네스 본체를 `.harness/`로 이동했습니다.
- 플랫폼별 파일은 하네스 본체 밖의 어댑터로만 남깁니다.
- 범용 에이전트 진입점 `AGENTS.md`와 Claude 진입점 `CLAUDE.md`를 추가했습니다.
- 사내 표준 에이전트는 Claude로 정하고, `CLAUDE.md`를 모든 에이전트의 기준 진입점으로 승격했습니다. `AGENTS.md`는 보조 진입점 역할을 합니다.
- 하네스 실행 스크립트는 `.harness/bin/*`을 우선 사용하고, 과거 구조 기반 설치본도 읽을 수 있도록 fallback을 유지합니다.
- stack 적용 마커는 새 구조에서 `.harness/.stack-applied.json`을 사용합니다.

## 2026-04-28 - Node 런타임 고정 및 init 안정화
- `.nvmrc`를 `22.14.0`으로 추가하고 `package.json`의 `engines.node`를 현재 Node 기반 도구체인 요구사항(`>=20.19.0 || >=22.13.0`)에 맞췄습니다.
- 모든 npm harness 명령 앞에 `.harness/bin/check-node-version.mjs`를 연결해 낮은 Node에서 문법 에러 대신 명확한 업그레이드 안내가 나오게 했습니다.
- `scripts/init.mjs`는 기존 프로젝트 병합 진입점이므로 낮은 Node에서도 최소한 버전 안내까지 도달하도록 최신 문법 사용을 피했습니다.
- 당시 내장 scaffold의 실행 명령은 nvm 로드/설치, `.nvmrc` 전환, Node/패키지 변경 감지, 의존성 동기화 흐름을 처리하도록 설계했습니다.
- 팀 배포에서는 `git+<seed-repo-url>#<tag>` 형태의 tag 고정 실행을 권장하고, 장기적으로 npm publish가 가능하도록 `bin`, `files`, `engines` 구성을 정리했습니다.

## 2026-04-27 - 시드 하네스 저장소 분리 및 이름 변경 (bareunmal → harness-seed)
- bareunmal은 원래 실제 작업 프로젝트로 의도되었으나, 작업 중 시드 하네스로 진화함을 인지했습니다.
- 시드 하네스의 정체성을 명확히 분리하기 위해 저장소명을 `bareunmal` → `harness-seed`로 변경합니다.
- 코드/문서 내 참조를 일괄 교체했고 (`scripts/init.mjs`, `package.json`, `README.md`, `.harness-seed-mode`, scaffold의 기본 프로젝트명 등), 과거 결정 로그의 `bareunmal` 언급은 역사 기록으로 보존합니다.
- `.harness/bin/apply-stack.mjs` 의 tmpdir prefix를 `bareunmal-stack-` → `harness-seed-stack-`으로 변경했습니다 (의미 변화 없음, 정체성 정합만 맞춤).
- 실제 작업 프로젝트는 추후 별도 repo로 분리합니다.

## 2026-04-22 - 기본 스캐폴드 채택
- 초기에는 특정 스택 조합으로 스캐폴드를 구성했습니다.
- 도메인이 아직 없으므로 중립적인 예시 use-case만 두고 구조를 먼저 고정했습니다.

## 2026-04-22 - 아키텍처 규칙 문서 분리
- 세부 규칙은 주제별 문서로 분리해 긴 지침도 탐색하기 쉽게 만들었습니다.

## 2026-04-22 - 정적 배포 자동화 채택
- 정적 배포 자동화 구성을 채택했습니다.
- 저장소명을 반영하기 위해 당시 정적 빌드 base path를 설정했습니다.

## 2026-04-22 - 세션 하네스 도입
- 새 세션이 이전 상태를 빠르게 복구할 수 있도록 `.harness/session/`를 추가했습니다.
- 장기 메모리와 단기 컨텍스트를 분리해 읽기 순서를 고정했습니다.

## 2026-04-22 - 정책 동기화 하네스 도입
- 정책 문서와 소스 코드의 상호 영향을 놓치지 않도록 `.harness/policy/`를 추가했습니다.
- 정책 영향 분석과 위반 검사를 `.harness/bin/policy-harness.mjs` 및 CI 검증에 연결했습니다.

## 2026-04-22 - 프로젝트 하네스 및 세션 시작 알림 도입
- 아직 도메인이 없더라도 프로젝트 목적과 범위를 담을 수 있도록 `.harness/project/`를 추가했습니다.
- 새 세션에서 미해결 항목을 반드시 다시 보도록 `session-start-alert.md`를 최우선 읽기 대상으로 추가했습니다.

## 2026-04-22 - 개발자 입력 큐 도입
- 개발자 정보 부족으로 완료되지 못한 항목을 다음 세션에 다시 묻기 위해 `developer-input-queue.md`를 추가했습니다.
- 개발자에게는 항상 `지금 답변 / 이번 세션 유보 / 나중에 다시 묻기` 선택권을 남기도록 원칙을 고정했습니다.

## 2026-04-22 - 문서 인덱싱 하네스 도입
- 긴 문서가 한 파일에 계속 누적되지 않도록 `.harness/documentation/`를 추가했습니다.
- 문서군마다 인덱스 문서와 세부 문서를 나누는 규칙을 세션 시작 하네스에 연결했습니다.

## 2026-04-22 - 스타일 검증 하네스 도입
- 코딩 스타일을 문서와 자동 검사로 함께 유지하기 위해 `.harness/style/`와 ESLint 기반 검증을 추가했습니다.
- 통합 검사에 lint를 포함해 구조/정책 검증과 스타일 검증을 함께 돌리도록 했습니다.

## 2026-04-22 - 사전준비 운영 세트 확장
- 저장소 관리형 로컬 git hook, 테스트 기반, 협업 템플릿, 설정 계약을 추가했습니다.
- commit/push 이전 검증과 협업 입력 품질을 도메인 정의 전 단계에서 미리 고정했습니다.

## 2026-04-27 - 일반화 하네스와 스택 프리셋 분리
- 저장소를 일반 하네스(프레임워크 독립 인프라)와 스택 프리셋(프레임워크+디자인패턴 꾸러미)으로 분리했습니다.
- 스택 자산을 본체와 격리해 root가 스택-독립적이 되게 했습니다.
- `apply-stack.mjs`를 source adapter 패턴으로 설계해 향후 외부 저장소로 분리가 저비용으로 가능하도록 했습니다.
- `npm run stack:apply` / `stack:reset` / `stack:status` 명령과 stack 적용 마커를 도입했습니다.
- `guard.mjs`는 스택 미적용 시 lint/test/build를 자동 스킵하고 일반 검사만 실행합니다.
- `doc-link-check.mjs`는 scaffold 폴더를 orphan/링크 검사에서 제외하고, 코드 경로 참조는 활성 스택의 scaffold 내부도 허용하도록 해서 미적용 상태에서도 문서 참조가 유효하게 했습니다.
- A-1 마이그레이션 트리거 조건: 스택 수 ≥ 2 또는 외부 공유 필요 시.

## 2026-04-27 - tiged 어댑터 실구현 + 시드 검증 통한 결함 수정
- `apply-stack.mjs`의 `adapterTiged()`를 실제 구현했습니다 (`npx -y tiged --force <ref> <tmp>` → subdir 분리 → 파일 복사 + packageMerge 처리). 어댑터 반환 형태를 `{ copied, packageMergeData }` 객체로 통일했습니다.
- 외부 빈 디렉토리에 저장소를 풀어 시드 사용자 시나리오를 e2e 검증하던 중 두 가지 치명적 결함 발견:
  - stack 적용 마커가 tracked 상태였음 → 시드 사용자가 dev 머신의 적용 상태를 그대로 받음.
  - `package.json`이 프리셋 의존성 머지 상태로 tracked → root가 슬림이 아님.
- 두 결함 모두 수정: marker는 `.gitignore`로, root `package.json`/`package-lock.json`은 항상 슬림 상태(stack:reset 후)로만 커밋합니다.
- CI 검증에 `node .harness/bin/apply-stack.mjs` 단계와 `npm install` 호출을 추가해, 슬림 root에서도 머지된 의존성으로 검증하도록 했습니다.
- `.gitignore`에 `.harness-backup/`도 미리 추가해 향후 흡수/백업 기능 도입을 위한 자리만 비워뒀습니다.

## 2026-05-15 - 소비자 설치 UX 정리
- 스택 하네스가 공통 하네스를 내부 호출할 때 중간 안내가 두 번 보이지 않도록 `init --embedded` 옵션을 추가합니다.
- 최종 안내는 스택 하네스가 한 번에 정리하고, 소비자 개발자는 `harness:guide`, `harness:check` 또는 CLI의 `ai guide`, `ai check`로 이어가도록 안내합니다.
- 하네스가 생성한 `AGENTS.md`처럼 이미 `CLAUDE.md`와 `.harness/`를 가리키는 엔트리포인트는 bridge 후보로 다시 제안하지 않습니다.
- 설치 직후 자동 검사는 상세 감사 리포트보다 성공/실패 판정이 우선이므로 `--brief` 출력으로 낮추고, 상세 영향도는 개발자가 필요할 때 `harness:impact` 또는 `harness:check -- --verbose`로 확인하게 합니다.
- `--brief` 검증에서는 lint/test/build 성공 로그를 `OK` 한 줄로 요약하고, 실패했을 때만 원문 출력과 원인 후보를 보여줍니다.
- 새 터미널에서 기본 Node가 낮게 잡히는 프로젝트를 위해 설치 후 handoff와 다음 단계 안내에 `nvm use` 선행을 명시합니다.
