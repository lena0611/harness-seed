# Changelog

하네스 본체의 릴리스 변경사항을 기록합니다.

`CHANGELOG.md`는 하네스 본체 변경 이력입니다. 설치된 소비자 프로젝트의 판단 기록은 `.harness/session/decision-log.md`에 남깁니다.

## 0.2.88 - 2026-07-20

- 제품 중립 Vue 기술 스택과 Cloud Front 관리자형 제품 템플릿 `v0.2.0`을 승인 레지스트리에 연결했습니다.
- 기존 프로젝트는 `template:apply -- --contract-only`로 업무 코드를 복사하지 않고 템플릿 계약과 가이드 스냅샷만 연결할 수 있습니다.
- `template:gap`은 템플릿이 선언한 경로, 의존성, npm script, 근거 문서를 비교해 필수·권장 갭을 리포트합니다. 자연어 문서의 의미를 임의로 판정하지 않습니다.
- 설치, 상태 확인, 인수인계, 검사, 제거 경로에 제품 템플릿 계약과 `template:gap`을 연결했습니다.

## 0.2.87 - 2026-07-10

- `standards:list`와 `templates:list`가 private GitLab API를 기본 호출하지 않고, 배포물에 포함된 승인 레지스트리를 표시하도록 바꿨습니다. 사람과 에이전트 모두 토큰 없이 목록을 볼 수 있고, 실제 private 저장소 설치 때만 기존 Git 읽기 권한이 필요합니다.
- 관리자만 `--remote` 옵션과 `read_api` 토큰으로 원격 GitLab 그룹을 직접 조회할 수 있습니다.
- 기본 `harness:update`가 스택만 갱신한 뒤 base를 outdated로 남기지 않도록, 스택과 공통 하네스를 같은 호환 범위에서 함께 갱신합니다. 한쪽만 갱신할 때는 `--stack-only`, `--base-only`를 사용합니다.

## 0.2.86 - 2026-07-10

- 기계적인 문서/코드 한쪽 변경 감지를 `SYNC GAP` 대신 `기준 동기화 검토 후보`로 안내합니다. 의미 불일치 판정이 아니며 일반 구현 변경은 문서 수정이나 decision-log 없이 진행할 수 있습니다.
- 일반 정책의 강도와 동기화 후보 강도를 분리했습니다. strict에서도 기본 후보는 비차단이며, 필요한 정책만 `syncEnforcement: hook|block`으로 강제할 수 있습니다.

## 0.2.85 - 2026-07-09

- clubadm 소비자 개선 요청서를 본체 로드맵의 소비자 채택 안정화 에픽으로 승격했습니다.
- README 첫 설치 경로를 설치 전 실행 가능한 `ai-standard-cli init` 흐름으로 바꾸고, 실제 스택 하네스 예시 URL과 설치 풋프린트/제거 경로를 안내했습니다.
- `harness:uninstall` 명령을 추가했습니다. 기본 dry-run으로 제거 계획을 보여주고, `--confirm`일 때 install-manifest 기준 managed 파일과 하네스 npm 명령만 제거합니다.
- Claude Code 위험 차단 훅이 node 부재/파싱 실패 때 조용히 통과하지 않도록 shell 기반 deny 출력을 추가하고, `rm -fr`, long option, `find -exec rm` 등 위험 표면을 보강했습니다.
- 배포 패키지에서 세션 운영 문서와 `.claude/settings.local.json`이 포함되지 않도록 npm `files` 제외 규칙을 보강했습니다.
- 재설치 때 로컬 수정으로 보존된 managed 파일이 install-manifest에서 탈락하지 않도록 이전 manifest 엔트리를 승계합니다.
- 한글/공백 파일명이 있는 변경도 검증 캐시 키에 정상 반영되도록 git quoted path 디코딩을 추가했습니다.
- 정책 검사 통과 문구를 `Policy registry/schema check passed`로 좁혀, 스택별 실제 checks가 비어 있는 상태를 과대 해석하지 않도록 했습니다.
- `release:version-net` 명령을 추가해 본체, Vue3 스택 하네스, cloud-front 템플릿 manifest의 base/stack/template ref 정합을 검사하거나 `--write`로 갱신할 수 있게 했습니다.
- `apply-stack`의 스택/템플릿 id를 안전한 경로 이름으로 제한하고, reset 시 스냅샷 삭제 경로가 허용 루트를 벗어나지 못하게 했습니다.
- Windows에서 npm/npx 실행 실패가 무음 종료되지 않도록 `guard`의 npm script 실행과 tiged 어댑터 실행을 보강했습니다.

## 0.2.84 - 2026-07-09

- `스타일 기준` 문구를 `코드 작성/포매팅 기준`으로 바꿔 CSS 시각 스타일과 혼동하지 않도록 했고, formatter/linter 설정 파일을 연결하거나 preset을 선택하라는 대응을 명확히 했습니다.

## 0.2.83 - 2026-07-09

- 공통 하네스 기본 설치 출력에서 `manifest`, `project state`, `seed-only`, `최종화 승인` 등 내부 용어를 줄이고 소비자 행동 중심 문구로 정리했습니다.
- 공통 하네스만 설치한 경우를 미완성 상태처럼 보이지 않도록 `이번 선택: 공통 하네스만 설치`로 안내합니다.

## 0.2.82 - 2026-07-09

- 설치 직후 콘솔, `project-scan-report.md`, `handoff.md`에 `Harness Effect Summary`를 추가해 하네스가 프로젝트에서 바로 확인한 내용과 다음 작업 변화가 보이도록 했습니다.
- 기존 AI 룰, 스택 선택 상태, 테스트/검증 전략, 스타일 출처, 충돌 후보를 소비자 관점의 결론형 문장으로 요약합니다.

## 0.2.81 - 2026-07-08

- 공통 설치 완료 요약에 설치된 공통 하네스 버전을 표시합니다.

## 0.2.80 - 2026-07-08

- `.nvmrc`가 없는 프로젝트 설치 완료 안내가 `nvm use`로 시작하지 않도록 문구를 조정했습니다. 실행할 명령과 설명 문장을 더 명확히 구분합니다.

## 0.2.79 - 2026-07-08

- `.nvmrc`가 없는 프로젝트 설치 완료 안내에서 `nvm use`를 실행하라고 잘못 안내하던 문구를 수정했습니다. 이제 `.nvmrc`가 없으면 nvm use 단계를 건너뛰고 Node 계약을 정하는 방법을 안내합니다.
- git 저장소가 아닌 프로젝트에서 `npm run hooks:install` 실행 시 Node stack trace가 나오던 문제를 수정했습니다. 이제 `git init` 후 다시 실행하라는 짧은 안내로 실패합니다.
- `docs/standards/agent-rules.md`처럼 명시적인 AI 룰 후보 파일이 제목만 있어도 기존 AI 작업 룰 후보로 감지되도록 수정했습니다.

## 0.2.78 - 2026-07-08

- `ai-standard-cli` 경유로 공통 하네스만 설치된 프로젝트에서 `npm run harness:outdated`가 `baseHarness 저장소 정보가 lock/install-manifest에 없습니다`로 `unavailable`을 출력하던 문제를 수정했습니다.
- base source가 `bundled`이고 스택 기준이 아직 없어도 공식 공통 하네스 repo와 현재 설치 버전 태그를 복구해 outdated/update 계획을 만들도록 했습니다.

## 0.2.77 - 2026-07-08

- 기존 AI 작업 룰 후보가 여러 개 있을 때 등록 예시는 `git tracked` 상태의 팀 후보를 우선 사용합니다.
- `.gitignore 적용됨` 상태의 개인/임시 룰만 감지된 경우, 실제 개인 파일 경로를 팀 기준 등록 예시로 보여주지 않고 `<team-rule-path.md>` placeholder를 사용합니다.

## 0.2.76 - 2026-07-08

- 기존 AI 작업 룰 후보 리포트에 git 상태를 추가했습니다. 후보별로 `git tracked`, `.gitignore 적용됨`, `.gitignore 미적용`을 표시해 개인/임시 기준이 커밋될 위험을 바로 확인할 수 있습니다.
- `project-scan-report.md`에 `Existing AI Rule Registration Guide` 섹션을 추가했습니다. 팀 기준으로 확정한 문서를 `.harness/policy/profile.json`의 `sources[]`에 어떤 형식으로 등록하는지, 등록하면 어떤 효과가 있는지 설명합니다.
- `project-scan-report.md`와 `handoff.md`에 `Project Rule Authoring` 안내를 추가했습니다. 기존 에이전트 룰이 없는 프로젝트에서 작업방식/작업패턴 계약을 `.harness/project/domain-rules.md`, `architecture-rules.md`, `workflow-rules.md`, `commit-push-rules.md` 중 어디에 기록할지 설명합니다.
- `handoff.md`에도 팀 기준 등록 효과와 개인/임시 기준의 `.gitignore`/`git rm --cached` 조치 안내를 요약합니다.

## 0.2.75 - 2026-07-08

- 공통 하네스 설치 기본 출력에서 내부 `node .harness/bin/...` 실행 명령과 원문 진단 로그를 숨기고, 설치 결과/스캔/인수인계/검사 성공 여부만 요약하도록 정리했습니다. 상세 로그는 실패 시 또는 `init --verbose`에서 확인합니다.
- `harness:scan`이 기존 프로젝트의 AI 작업 룰 후보(`.cursor/rules/`, `.github/copilot-instructions.md`, `CLAUDE.md`, `AGENTS.md`, `docs/**/agent-rules.md` 등)를 별도 섹션으로 감지합니다. 후보는 자동 삭제·자동 병합·자동 `profile.json sources[]` 등록 없이 보존하고, 팀 공유 기준인지 개인/임시 기준인지 판단하도록 안내합니다.
- 설치 직후 콘솔과 `.harness/session/handoff.md`가 기존 AI 작업 룰 후보 수와 처리 기준을 함께 보여주도록 했습니다.
- npm이 `npm_config_prefix`를 주입한 환경에서 하네스 런처나 git hook이 nvm을 source하다가 멈추는 문제를 방지했습니다. 런처/hook은 nvm 로딩 전에 npm prefix 환경변수를 제거합니다.
- init smoke test에 기존 AI 작업 룰 문서 감지/리포팅 회귀를 추가했습니다.

## 0.2.74 - 2026-06-25

- 소비자 프로젝트가 `.harness/policy/profile.json`의 `harnessMode`나 `sources[]`를 직접 편집하면 `common.install.preserve-project-owned-files`가 blocking SYNC GAP을 내던 과매칭을 수정했습니다. `profile.json`은 PROJECT_OWNED 보존 대상이지만 install/update 구현 변경을 뜻하는 source trigger는 아니므로, preserve 정책의 `triggerPaths`에서 제외했습니다.
- install/update 보존 동작 변경은 계속 `scripts/init.mjs`, `update-harness.mjs`, `apply-stack.mjs`, waiver 변경으로 감지합니다. 소비자 profile의 스택 상태와 선언 소스는 stack/profile 관련 검사에서 다룹니다.
- init smoke test에 소비자 profile 편집(`harnessMode=active`, `sources[]`)이 install preserve SYNC GAP을 만들지 않는 회귀를 추가했습니다.

## 0.2.73 - 2026-06-25

- 스택 하네스 업데이트 경로에서 `stack:reset`이 최초 적용 시점의 `profileBackup` 전체를 복원해, 소비자가 직접 바꾼 `.harness/policy/profile.json`의 `harnessMode`가 `active`에서 `bootstrap`으로 되돌아가던 문제를 수정했습니다. 이제 reset은 스택 소유 필드(`activeStack`, `available`, `stackManifest`)만 되돌리고 `harnessMode`, `sources[]` 등 프로젝트 소유 필드는 현재 값을 보존합니다.
- 같은 경로에서 `stack:apply`가 `.harness/harness-lock.json`을 새 객체로 다시 쓰며 base 업데이트의 `lastUpdate` 변경 이력을 삭제하던 문제를 수정했습니다. stack lock 갱신은 기존 lock metadata를 보존한 뒤 `stackHarness`만 갱신합니다.
- init smoke test에 stack apply/reset 이후 `harnessMode`, `sources[]`, `lastUpdate`가 보존되는 회귀를 추가했습니다. clubadm의 실제 `.stack-applied.json` marker를 복사한 temp clone에서 업데이트 경로를 재검증했습니다.

## 0.2.72 - 2026-06-25

- `harness:outdated`가 bundled base의 업데이트 후보를 안내할 때 실행 불가능한 `npm run harness:update -- --base-only`를 권하던 문제를 수정했습니다. base repo가 lock/install manifest에 직접 없고 스택의 `requiredBaseHarness.repo`에서만 복구된 상태에서는 `--base-only`가 실패하므로, 최신 스택 하네스 `npx ... init` 재실행을 안내합니다.
- 기존 git source base는 그대로 `npm run harness:update -- --base-only` 경로를 유지합니다. 이번 변경은 read-only outdated 안내 정정이며 소비자 파일을 자동 수정하지 않습니다.
- init smoke test에 bundled base가 outdated일 때 stack init command와 note가 출력되는 회귀를 추가했습니다.

## 0.2.71 - 2026-06-25

- 소비자(clubadm) P0 개선요청 중 P0-1만 축소 수용했습니다. 프로젝트가 기준/룰 문서를 `.harness/project/*` 밖(별도 가이드 폴더, 루트 표준 문서 등)에 두면 본체의 자동 발견·주입 경로(`build-context`의 하드코딩 `alwaysRead`, `scan-project`의 고정 화이트리스트)에서 보이지 않던 구조적 갭을 해소합니다. 나머지(P0-2 hook 자동배선, P0-5 Codex 정합)는 거부, P0-3/P0-4는 후속 후보로 남깁니다.
- `profile.json`에 프로젝트 소유 `sources[]` 배열을 추가했습니다(`{ path, kind, owner, inject }`). 본체는 이 배열을 **읽기만** 하고 자동으로 채우지 않습니다(자동 변경 금지 원칙). `profile.json`은 PROJECT_OWNED라 업데이트 시 보존되고, 신규 설치에는 빈 배열로 배포됩니다.
- `build-context`가 `profile.json`을 읽어 `inject:'always'`이고 실제 존재하는 소스를 Always Read에 병합합니다(병합 항목은 `(project source: profile.json sources[])`로 표시). 이전에는 profile.json을 전혀 읽지 않았으므로 순수 가산 변경입니다.
- `harness:scan`은 선언된 `sources[]` 경로가 실제 존재하는지만 검증합니다(zero false positive). 없는 경로는 Open Questions로 표면화하고, 룰 성격(`kind`) 소스가 선언돼 있으면 "로컬 방법론 없음" 오탐 질문을 대체합니다. 넓은 휴리스틱 자동 탐지는 도입하지 않습니다(최근 0.2.68~70 과매칭 제거 방향 유지).
- `bootstrap.md`에 "비표준 위치 룰 등록" 인터뷰 단계를 추가하고, 짝 문서로 `context-protocol.md`(계층/주입 거동)와 `portability-guide.md`(프로젝트 소유 등록 절차)를 갱신했습니다.
- init smoke test에 회귀 2종을 추가했습니다(build-context의 inject:always 병합 + 비-always 미병합, scan의 선언 경로 존재 검증 + 누락 경로 Open Question). 총 70종.

## 0.2.70 - 2026-06-22

- push/배포 시 중복 검사를 제거해 속도를 크게 높였습니다. 본체(seed-mode)는 매 `harness check`가 `test-init`(64+개 테스트) + 정책 + doc-link를 전부 다시 돌려, 릴리스 1회(commit + 양쪽 원격 + 태그 2개 push)에 같은 검증이 5회 반복됐습니다(약 1분/회).
- `guard.mjs`가 전체 검증(정책 SYNC GAP, doc-link, seed-mode test-init, 스택 lint/test/build)을 git tree 지문 캐시 게이트 뒤로 옮깁니다. 같은 tree면 전체를 스킵합니다(약 69초 → 0.1초 측정). 이들은 모두 git tree의 결정론적 함수라 "같은 tree면 결과가 같다"가 보장되어 검증 신뢰성을 해치지 않습니다. 기존 캐시는 스택 lint/test/build 전용 + `activeStack=none`이면 도달하지 못해 본체에선 무력했습니다.
- `full` 통과 캐시를 `fast` 요청이 재사용합니다(full ⊇ fast). commit(full) 직후 push(fast)·양쪽 원격·태그 push가 같은 tree라 캐시 히트로 재검증을 건너뜁니다. `fast` 캐시는 `full` 요청을 만족시키지 않습니다(test/build 누락 방지). 강제 재검증은 `--no-cache`.
- init smoke test에 캐시 회귀 4종을 추가했습니다(같은 tree 히트, full→fast 재사용, `--no-cache` 강제 재검증, tree 변경 시 미스). 총 68종.
- 정책 노이즈 제거: install 보존/force 정책(`common.install.*`)의 기준 문서를 종합 문서 `sync-protocol.md`에서 설치 전용 문서 `portability-guide.md`로 옮겼습니다. 한 종합 문서를 여러 정책이 공유해 "검증 캐시 절만 바꿔도 install 정책이 blocking으로 깨지던" 과매칭 노이즈(push/배포 시 반복되던 SYNC GAP 실패)를 근본 제거했습니다.

## 0.2.69 - 2026-06-22

- 본체(seed-mode) 전용 문서를 소비자 프로젝트 배포에서 제외했습니다. `body-release-checklist.md`(하네스 본체 릴리스 절차)는 자기 자신이 "소비자 미적용"을 명시하면서도 managed로 소비자에 배포돼 왔습니다. `init`은 `.harness-seed-mode` 마커 없는 타깃(소비자)에 이 문서를 복사하지 않고, 이전 버전이 설치한 기존본은 미수정(manifest sha 일치)이면 정리하고 수정·출처불명이면 보존+안내합니다. 본체(마커 있음)에는 그대로 둡니다.
- seed-only 식별은 배포 문서 전수를 adversarial 검증(분류 + 반론)으로 감사해 `body-release-checklist.md` 1개로 확정했습니다. `policy-db-readiness.md` 등은 "소비자가 자기 project/personal 정책을 policy-registry에 등록할 때 스키마가 필요"하다는 반론으로 보존 판정 — 잘못 제외하면 소비자가 필요한 문서를 잃으므로 보수적으로 처리했습니다.
- 연쇄 정합: `body-release-checklist.md`를 `document-registry.json`에서 제거(소비자에서 "registry엔 있는데 파일 없음" 오탐 방지)하고, `doc-link-check`는 `seedOnlyDocs` 예외로 본체에서 orphan으로 보지 않습니다. `init.mjs`의 `SEED_ONLY_DOC_PATHS`와 `doc-link-check.mjs`의 `seedOnlyDocs`를 동기화합니다.
- init smoke test에 seed-only 회귀 5종을 추가했습니다(소비자 미배포+manifest 미등록, 소비자 doc-link 무오탐, 미수정 기존본 정리, 수정본 보존, seed-mode 타깃 유지). 총 64종.
- `document-registry.json`에서 문서를 제거하면 `common.agent.skill-selection` 정책이 strict 검사에서 과매칭으로 실패하던 것을 정밀화했습니다. skill-selection의 ownedAreas에서 `document-registry.json`을 제거했고(레지스트리 무결성은 `documentation.registry-integrity`가 전담), reading-set 직접 입력인 `context-registry.json`은 유지합니다.
- 다른 문서가 seed-only 문서를 링크/코드 경로로 참조할 때 소비자(파일 부재)에서 broken으로 잡히던 것을 막았습니다. `doc-link-check`의 `exists()`가 `seedOnlyDocs` 경로를 존재로 간주하므로 본체(파일 있음)와 소비자(파일 없음) 양쪽에서 동일하게 통과합니다.

## 0.2.68 - 2026-06-22

- doc-link-check가 백틱으로 감싼 디렉토리 예시·CI 어댑터 경로를 dead code-path로 잘못 표시하던 환경 의존 오탐을 수정했습니다. 소비자(clubadm) 설치 후 `.github/workflows/` 같은 예시 경로가 dead로 검출되던 문제입니다.
- `isIgnorableCodePath`를 도입해 (1) glob/생략(`*`, `...`), (2) trailing slash 디렉토리 예시(`.github/workflows/`, `.harness/policy/`), (3) `.github/workflows/` 하위(본체 CI 어댑터, 소비자에 기본 주입되지 않음)를 code-path 무결성 검사에서 제외합니다. 구체 파일 참조(`.harness/bin/guard.mjs` 등)는 계속 검사하므로 진짜 dead 탐지는 유지됩니다.
- 본체 저장소엔 해당 디렉토리가 실제 존재해 통과하지만 소비자 환경엔 없을 수 있어(CI 미사용, 비-Node, 구조 차이) 본체 self-test로는 드러나지 않던 사각지대였습니다.
- `doc-link-check.mjs`의 진입을 직접 실행 가드로 감싸 `isIgnorableCodePath`를 테스트에서 import할 수 있게 했고, init smoke test에 단위/소비자 e2e 회귀 2종을 추가했습니다(총 59종). 짝 문서로 `.harness/documentation/indexing-rules.md`에 코드 경로 참조 검사 규칙을 명문화했습니다.
- 알려진 후속(별도): `body-release-checklist.md`는 자기 자신이 "seed-mode 본체 전용"이라 명시하지만 managed로 소비자에 배포됩니다. dead-link 오탐은 본 릴리스로 해소됐고, 본체 전용 문서의 소비자 배포 제외는 배포 로직·기존 소비자 정리가 필요해 후속 과제로 둡니다.

## 0.2.67 - 2026-06-18

- `CLAUDE.md`/`AGENTS.md`/`.github/copilot-instructions.md`를 마커 기반 머지로 전환했습니다(옵션 A, 공존융합). 본체가 배포하는 이 진입 파일들은 `<!-- harness-managed:start -->`~`<!-- harness-managed:end -->` 블록으로 회사 영역을 감싸고, 그 아래를 소비자 소유 영역으로 둡니다. `harness:update`는 마커 안(회사 영역)만 정본으로 갱신하고 마커 밖(소비자 영역)은 보존합니다. 0.2.65/0.2.66의 통짜 안전망("둘 중 하나만 보존")을 넘어, 회사 갱신과 소비자 지침이 한 파일에서 공존합니다.
- 마이그레이션: 마커 없는 기존 소비자 파일은 (1) 미수정이면 마커 버전으로 자동 이전하고, (2) 수정됐으면 보존 + 수동 이전 안내(프로젝트 내용을 `harness-managed:end` 아래로 옮기고 본체 영역에 마커를 두른 뒤 재실행)를 출력합니다. 소비자가 마커 안(회사 영역)을 수정한 흔적이 있으면 머지 전 `<파일>.harness-bak`로 백업하고 후처리 리포트에 명시합니다.
- 충돌 처리: 마커 안(회사 영역)과 마커 밖(소비자 영역) 지침이 충돌하면 `.harness/project/standards-layers.md`의 "충돌 해석 순서"를 따릅니다(안전류=회사 필수 차단 우선, 운영류=프로젝트 우선). 자유 산문의 의미 충돌 자동 감지는 오탐이 많아 범위에서 제외하고, 충돌 해석 순서가 에이전트의 판단 기준입니다.
- manifest 스키마: 마커 대상 파일에 `managedRegionSha256`(마커 안 해시)을 추가 기록합니다(manifestVersion 3, 가산 필드라 하위호환). 0.2.65 통짜 안전망은 마커 비대상 managed 파일(hook 스크립트, `.harness/bin/*` 등)에 계속 적용됩니다.
- init smoke test에 마커 머지 회귀 6종을 추가하고(신규 설치 마커+영역 해시 기록, 머지 시 소비자 영역 보존+회사 영역 갱신, 회사 영역 훼손 시 정본 복구+사이드카, 미수정 옛 파일 자동 이전, 수정 옛 파일 보존+안내, 멱등성), 통짜 안전망 3종은 마커 비대상 파일 대상으로 재정렬했습니다(총 57종). 0.2.66의 hybrid managed 통짜 테스트 5종은 마커 머지 동작으로 대체되었습니다.

## 0.2.66 - 2026-06-15

- 0.2.65에서 도입한 안전망(소비자 수정 managed 파일 보존 + `.harness-bak` 사이드카)은 같은 분기를 거치는 모든 hybrid managed 파일에 자동 적용되지만, 회귀 테스트는 `CLAUDE.md`만 명시 검증해 다른 진입점이 같은 보장을 받는다는 잠금이 없었습니다. 이번 릴리스는 그 잠금을 추가합니다.
- `scripts/test-init.mjs`에 hybrid managed 진입점 회귀 5종을 추가했습니다(총 55종): `AGENTS.md` 보존 + 사이드카, `.github/copilot-instructions.md` 보존, 세 파일(CLAUDE.md/AGENTS.md/copilot) 동시 수정 시 모두 보존 + 후처리 리포트가 셋을 모두 명시, `--force --confirm` 시 세 파일 모두 `.harness-bak` 사이드카가 소비자 바이트 verbatim 보존.
- 본체 동작은 변경 없음(test-only patch). installer/CLI 사용자는 거동 차이를 못 느끼며, 0.2.65 안전망이 PaceLAB류 다중 파일 수정 시나리오에서 의도대로 동작함이 회귀로 잠겼습니다.

## 0.2.65 - 2026-06-15

- 소비자가 직접 수정한 managed 파일(예: `CLAUDE.md`, `AGENTS.md`)을 `harness:update`가 무경고로 덮어쓰던 사고를 차단했습니다. PaceLAB(0.2.56→0.2.64)에서 `CLAUDE.md`의 `## 모노레포 구조 (#250)` 섹션과 UI reading-list 라인이 조용히 소실된 사례가 동기입니다.
- 안전망(옵션 C): `init`이 managed 파일을 덮어쓰기 전에 `install-manifest.json`에 기록된 sha256과 현재 sha256을 비교합니다. 불일치(=설치 이후 소비자가 수정)면 기본적으로 파일을 보존하고, 후처리 리포트에 "로컬 수정으로 보존된 managed 파일" 목록을 명시 출력합니다. `--force`만 있고 `--confirm-overwrite-project-files`가 없으면 이 파일들도 기존 force 가드에 포함되어 init이 중단됩니다(`scripts/init.mjs`).
- 위험 인지 후 덮어쓰기 경로도 보존책을 둡니다: `--force --confirm-overwrite-project-files`로 덮어쓸 때는 직전 소비자본을 같은 디렉터리에 `<파일>.harness-bak` 사이드카로 남기고, 후처리 리포트에 백업 경로를 한 줄씩 명시합니다(다시 머지할 표면이 드러나도록).
- 적용 범위는 `managedFiles`에 등록된 모든 파일이며, manifest가 없는 첫 설치 경로는 영향이 없습니다. `CLAUDE.md`/`AGENTS.md`만 특별 처리하지 않고 같은 클래스의 다른 managed 파일에도 같은 보호가 자동 적용됩니다.
- init smoke test에 3종을 추가했습니다(총 50종): managed `CLAUDE.md`에 소비자가 섹션을 추가한 뒤 재설치 시 보존되고 후처리 리포트가 파일을 명시할 것, `--force --confirm`로 덮어쓸 때 `.harness-bak` 사이드카가 소비자 바이트를 그대로 보존할 것, `--force` 단독은 confirmation 안내와 함께 종료할 것.
- 마커 기반 머지(옵션 A) 또는 `CLAUDE.md`/`AGENTS.md`의 project-owned 재분류(옵션 B)는 후속 릴리스 검토 대상입니다. 본 릴리스는 "어떤 경우에도 조용한 손실 없음"을 우선 보장하는 안전망까지를 범위로 합니다.

## 0.2.64 - 2026-06-15

- 배포 마무리 루틴을 문서로 고정했습니다(문서/프로세스 변경, 소비자 동작 불변). `body-release-checklist.md` 5단계에 "태그도 양쪽 원격에 push" 단계를, 6단계에 `ai-standard-cli` 반영의 구체 절차(버전 bump·base ref 갱신·check/test·태그·GitLab push)를 추가했습니다. 기존에는 이 CLI 반영 루틴이 어디에도 없어 git 이력에서 역추적해야 했습니다.
- `next-session-reminder.md`를 현재 상태(0.2.63 dual-runtime 출시)로 갱신하고, SessionStart에 자동 노출되는 "본체 개발 후 배포 마무리 루틴" 상기 블록(커밋→dual-remote push→태그 양쪽→CLI 반영→CI 확인)을 추가했습니다.

## 0.2.63 - 2026-06-12

- 저버전 Node 프로젝트(`.nvmrc` < 20.19) 지원: **dual-runtime 모드**를 추가했습니다. git hook과 `.harness/bin/harness` 런처는 활성 Node가 낮으면 nvm 설치본 중 최신(>=20.19)으로 하네스 스크립트만 자동 전환하고(`.harness/bin/dual-node.sh`, nvm.sh 비의존·dash 안전), lint/test/build·stack verify 등 프로젝트 검증은 guard가 `.nvmrc` Node로 되돌려 실행합니다(`HARNESS_PROJECT_NODE_BIN`, `.harness/bin/node-env.mjs`). 기존 프로젝트 hook 체인(husky 등)은 전환 전 PATH로 실행됩니다.
- init 설치 게이트 완화/보강: `.nvmrc < 20.19`여도 설치를 중단하지 않고 dual-runtime 안내와 환경 진단(nvm, 하네스 Node, 프로젝트 Node 설치 여부)을 출력합니다. nvm 자체가 없으면 전환 수단이 없으므로 설치를 중단하고 안내합니다(머신 환경을 바꾸는 nvm 자동 설치는 하지 않음).
- `.nvmrc` 없는 Node 프로젝트에서 저버전 신호(package.json engines, .node-version, Dockerfile, CI node-version)를 감지하면 추측으로 확정하지 않고 `init --project-node <ver>` 인터뷰를 요구합니다. 사용자가 확인한 버전을 `.nvmrc`로 기록합니다(프로젝트 버전 선언 — 하네스 버전 `.nvmrc` 주입 금지는 유지). 비-Node 프로젝트(package.json 부재)는 인터뷰 없이 설치됩니다.
- 저버전 `.nvmrc` Node가 nvm에 미설치면 guard가 프로젝트 검증을 하네스 Node로 대신 실행하지 않고 `nvm install <ver>` 안내와 함께 실패합니다(검증 신뢰성 우선). `hooks:install`도 설치 시점에 같은 node 환경 진단을 출력합니다.
- `check-node-version.mjs` 게이트 메시지에 dual-runtime 안내를 추가했습니다. Windows(nvm-windows)는 기존 거동(PATH node + 게이트)을 유지합니다.
- 적대적 코드 리뷰로 발견한 dual-runtime 엣지 케이스를 보강했습니다:
  - `dual-node.sh` 헬퍼(`harness_node_supported`/`harness_node_sort_key`)를 인자 없이 호출해도 dash `set -u`에서 무출력 exit 2(0.2.61 클래스)로 죽지 않도록 `${1:-}`로 가드했습니다.
  - `node`가 셸 함수/별칭이라 `command -v node`가 절대경로를 주지 않을 때 `HARNESS_PROJECT_NODE_BIN`에 `.`가 export되던 footgun을, 절대경로일 때만 export하도록 막았습니다.
  - guard가 hook이 넘긴 `HARNESS_PROJECT_NODE_BIN`을 `.nvmrc`와 교차검증합니다. hook의 `nvm use`가 미설치 `.nvmrc`로 조용히 실패해 displaced 기본 Node를 넘겨도, guard는 그 Node를 맹신하지 않고 `.nvmrc` 해석으로 폴백하며 미설치면 `nvm install <ver>`로 하드페일합니다(검증 신뢰성 우선 계약을 hook 경로에서도 보장).
  - `.nvmrc` 없는 프로젝트의 저버전 신호 감지에서 `engines.node`를 핀이 아닌 범위로 평가합니다. `>=18`처럼 20.19+로 만족되는 floor는 더 이상 인터뷰를 오탐 강제하지 않고, `^12`·`12.x`·`<20`처럼 20.19+로 만족 불가한 경우만 강제합니다(핀 신호 .node-version/Dockerfile/CI는 종전대로 major<20 기준).
  - `common.runtime.minimum-node` 정책의 ownedAreas/triggerPaths에 `dual-node.sh`, `node-env.mjs`를 추가해 게이트 상수 변경이 정책 트리거를 깨우도록 했습니다.

## 0.2.62 - 2026-06-10

- git hook이 첫 `node` 호출 전에 `check-node-version.mjs`를 실행해, 낮은 Node 환경에서 ESM 크래시 스택 대신 명확한 업그레이드 안내가 나오도록 했습니다.
- hook 구현 계약(POSIX/dash 호환, nvm 로드 `set +u` 보호, 최소 Node 검사 선행, npm 비경유 런처 호출)을 `commit-push-rules.md`에 문서화했습니다.

## 0.2.61 - 2026-06-10

- Linux(sh=dash) + nvm 환경에서 git hook(pre-commit/pre-push)이 메시지 없이 exit 2로 죽어 커밋/푸시가 차단되던 버그를 수정했습니다. `set -u` 상태에서 `nvm use`의 미설정 변수 참조가 dash에서는 expansion error가 되어 `|| true`로도 잡히지 않던 문제로, nvm 로드 구간만 `set +u`로 감쌌습니다.
- 이 버그는 0.2.60 이전부터 존재했으며(npm 경유 hook도 동일), 0.2.60에서 추가된 CI의 hook 실행 e2e 테스트가 처음 드러냈습니다. macOS(sh=bash)는 영향이 없습니다.

## 0.2.60 - 2026-06-10

- package.json이 없는 백엔드 프로젝트(PHP/Java/Swift/Kotlin)에 하네스를 설치해도 package.json을 새로 만들지 않습니다. 프로젝트 매니페스트 오염 없이 설치되며, greenfield Node 프로젝트는 `init --with-package-json`으로만 생성합니다.
- npm 없이 하네스를 실행하는 `harness` 런처(`.harness/bin/harness`)를 추가했습니다. `harness check`, `harness impact`, `harness hooks:install` 등 모든 소비자 명령을 `npm run harness:*`와 동일하게 실행합니다. Windows cmd/PowerShell용 `.harness/bin/harness.cmd` shim도 함께 설치됩니다(git hook은 Windows에서도 Git Bash로 동작).
- git hook(pre-commit/pre-push)이 npm 대신 harness 런처를 호출해, package.json 없는 프로젝트에서도 commit/push 자동 검증이 동작합니다. npm 프로젝트의 검증 결과는 동일합니다.
- 스택 manifest에 선택적 `verify` 섹션(`{ "lint", "test", "build" }`, raw shell 명령)을 추가했습니다. 비-Node 스택이 `./gradlew test`, `composer test` 같은 명령을 검증 단계로 선언할 수 있고, 선언이 없는 stage는 기존처럼 package.json scripts로 동작합니다.
- `harness check`(guard)가 package.json 없이도 동작하도록 수정했고, `.gitignore` 주입에서 Node 전용 항목(node_modules/, dist/)은 package.json이 있을 때만 추가합니다.
- `common.template.contract-bridge` 정책의 documents를 전용 계약 문서로 좁혀, 일반 안내 문서 수정마다 발생하던 과매칭 SYNC GAP을 해소했습니다.
- init smoke test에 비-Node 설치, opt-in package.json 생성, 런처 동작/드리프트 가드, npm-free git hook e2e, raw verify 실행 검증을 추가했습니다(총 38종). 기존 Node 소비자의 거동은 모든 경로에서 이전과 동일합니다.

## 0.2.59 - 2026-06-08

- 소비자가 이미 `.claude/settings.json`을 갖고 있을 때 하네스 에이전트 안전 훅이 wiring되지 않던 갭을 수정했습니다. 이제 `init`이 기존 설정을 보존하면서 하네스의 hooks/permissions(deny·allow)/env/statusLine을 멱등·비파괴로 병합합니다.
- `.claude/settings.json`을 project-owned로 분류해 업데이트가 소비자 설정을 덮어쓰지 않도록 했습니다. 병합은 누락된 안전 표면만 추가하고 기존 값은 보존하며, 재설치해도 훅이 중복되지 않습니다.
- init smoke test에 "기존 settings.json + 하네스 훅 병합 + 멱등성" 검증을 추가했습니다.
- 실제 첫 소비자 후보 clubadm(Vue3) 대상 고스트 테스트로 설치/보존/업데이트/changelog/훅 병합을 검증하고 온보딩 플레이북을 남겼습니다(`consumer-reviews/`).

## 0.2.58 - 2026-06-08

- 소비자가 `npm run harness:update`로 공통 하네스를 올리면, 이번 업데이트로 반영된 변경 항목(이전 버전 → 새 버전 사이의 `CHANGELOG.md` 구간)을 설치 직후 바로 출력합니다.
- 소비자 프로젝트에는 본체 `CHANGELOG.md`를 복사하지 않으므로, 그 변경 요약을 `.harness/harness-lock.json`의 `lastUpdate`에 보존하고 새 명령 `npm run harness:changelog`로 언제든 다시 볼 수 있게 했습니다.
- `npm run harness:outdated`가 업데이트 후보를 알릴 때 변경 내역을 어디서 보는지 안내하는 힌트를 추가했습니다.
- 새 도구 `.harness/bin/changelog-delta.mjs`는 lock의 lastUpdate 재생과 임의 CHANGELOG 구간 파싱(`--changelog/--from/--to`)을 지원합니다.
- init smoke test에 업데이트 델타 기록·재생 검증을 추가했고, 이 테스트가 "CHANGELOG 최상단 버전 == package.json version" 릴리스 동기화도 함께 강제합니다.

## 0.2.57 - 2026-06-08

- 본체(harness-seed) 자체를 고치고 내보내는 절차를 `.harness/project/body-release-checklist.md`로 고정했습니다. 영향 확인, 정책-코드 동기화, 버전/CHANGELOG, 양쪽 원격 동기화, downstream 통지를 체크리스트로 만들었습니다.
- maintainer 작업 스킬 `harness.body-release`를 skill registry에 추가하고 context-registry에 연결했습니다.
- 시드 모드 전용 원격 동기화 가드 `.harness/bin/check-remote-sync.mjs`를 추가하고 pre-push에 연결했습니다. `.harness-seed-mode`가 있을 때만 동작하고, 네트워크를 쓰지 않으며, push를 막지 않는 비차단 알림입니다. 소비자 프로젝트에서는 no-op입니다.
- Policy Guard CI(`.github/workflows/policy-guard.yml`)의 `Apply active stack` 단계가 `activeStack=none`에서 항상 실패하던 문제를 가드해, none이면 단계를 건너뛰도록 했습니다.

## 0.2.56 - 2026-06-06

- 실제 업무 진행 보고에만 visible trace를 적용하고, 단순 질문/잡담/메타 턴에는 강요하지 않는 조건부 경계를 명시했습니다.
- Claude UserPromptSubmit hook, Codex context injection hook, Copilot instructions에 조건부 visible trace 리마인더를 추가했습니다.
- Codex 어댑터 `.codex/hooks/inject-context.sh`를 설치 대상에 포함해 본체 업데이트로 소비자 프로젝트에 동기화되도록 했습니다.
- visible trace 응답 형식은 정적 검사 차단 대상이 아니라 런타임 리마인더로 보강한다는 기준을 문서화했습니다.

## 0.2.55 - 2026-06-06

- 세션 슬림 원칙을 `decision-log.md`, `developer-input-queue.md`, `project-memory.md`, `MEMORY.md`류 인덱스까지 확장하는 기억 표면 정리 기준을 추가했습니다.
- `/decision`, `/memory`, session README, session boot, skill registry에 supersede된 결정 축약, answered/obsolete 큐 제거, 중복 기억 업데이트 원칙을 반영했습니다.
- 신규 설치용 소비자 session 시드에 결정 로그 아카이브, 큐 open/deferred 유지, project memory 한 줄 인덱스 원칙을 추가했습니다.
- SessionStart hook이 developer-input-queue의 상태 정의 줄을 오탐하지 않고 실제 `open`/`deferred` 테이블 행만 표시하도록 정규식을 좁혔습니다.

## 0.2.54 - 2026-06-05

- `next-session-reminder.md`, `active-context.md`가 프로젝트 규칙 본문을 복사해 비대해지지 않도록 세션 파일 슬림 유지 원칙을 `/reminder`, session README, decision-flow, skill registry에 반영했습니다.
- 신규 설치용 소비자 세션 템플릿을 체크리스트와 권위 문서 포인터 중심으로 정리했습니다.
- 기존 소비자 프로젝트의 project-owned 세션 파일은 업데이트 시 덮어쓰지 않는 보존 동작을 유지합니다.

## 0.2.53 - 2026-06-05

- `harness:check`가 ignored `.harness/.stack-applied.json` 마커만으로 스택 적용 여부를 판단하던 문제를 수정했습니다.
- 이제 fresh clone, git worktree, CI처럼 마커가 없는 환경에서도 `profile.activeStack`과 커밋된 `.harness/stacks/.applied/<stack>/manifest.json` 스냅샷으로 스택 적용 상태를 복원해 lint/test/build를 실행합니다.
- `activeStack`은 설정됐지만 추적 가능한 스택 스냅샷이 없으면 검증을 조용히 통과시키지 않고 실패로 처리합니다.

## 0.2.52 - 2026-05-29

- `harness:update`로 들어온 본체 baseline 문서 변경이 소비자 프로젝트의 로컬룰 변경처럼 SYNC GAP을 발생시키지 않도록, install manifest 해시와 일치하는 baseline/generated 파일을 정책 매칭에서 제외했습니다.
- baseline 파일 변경은 `Harness baseline update notice`로 별도 안내하고, 같은 파일을 소비자 프로젝트가 직접 수정해 manifest 해시와 달라진 경우에는 기존처럼 로컬 하네스 변경으로 검토합니다.

## 0.2.51 - 2026-05-29

- `harness:update -- --base-only`가 공통 하네스 init에 `--source-repo`, `--source-ref`를 전달해 git source metadata를 lock/install manifest에 보존하도록 수정했습니다.
- init이 `semver:*` source ref로 실행된 경우 실제 설치된 package version tag(`vX.Y.Z`)로 source ref를 정규화합니다.
- 기존 소비자 프로젝트에 base source가 `bundled`로 남아 있어도, stack의 `requiredBaseHarness.repo`와 설치된 base version으로 `harness:outdated`가 repo/ref를 복구해 `unavailable`을 피하도록 보강했습니다.
- 사용자-facing `/하네스업데이트` command와 `하네스 업데이트 흐름` 스킬을 추가했습니다.

## 0.2.50 - 2026-05-29

- `harness:outdated` 기본 동작을 공통 하네스와 스택 하네스를 함께 검사하도록 변경했습니다.
- `--base-only`, `--stack-only`, `--fail-on-outdated`가 복합 상태에서 명확히 동작하도록 정리하고 target별 update command를 출력합니다.
- `harness:update`는 기존처럼 스택 중심 기본 동작을 유지하되, 공통 하네스 업데이트는 `--base-only`로 안내하고 lock/source metadata 복구 범위를 보강했습니다.
- 스택이 요구하는 `baseHarness.ref`는 기본적으로 검증된 기준 ref로 해석하고, `minVersion`을 만족하는 상위 공통 하네스는 downgrade하지 않는 기준을 문서화했습니다. exact pin이 필요한 경우에만 `exactRefRequired: true`를 사용합니다.

## 0.2.49 - 2026-05-29

- `커밋/푸시` 요청에서는 설치된 git hook 검증을 신뢰하고 commit 직전 수동 `harness:check`를 중복 실행하지 않도록 에이전트 기준과 hook 안내를 정리했습니다.
- 같은 기준을 소비자용 `커밋/푸시 최종화 흐름` 스킬로 추가해 요청 유형, hook 설치 여부, 중복 검증 생략 여부를 스킬 레지스트리에서도 판단할 수 있게 했습니다.
- 정책/세션/개념맵/인터랙티브 가이드 문서의 검증 안내를 `최종 검증만`과 `커밋/푸시 hook 검증`으로 나눠 정리했습니다.
- `scripts/test-init.mjs`의 다른 smoke test 보강이 force overwrite와 Node 런타임 정책을 불필요하게 blocking으로 깨우지 않도록 해당 정책의 `triggerPaths`를 구현 파일 중심으로 좁혔습니다.

## 0.2.48 - 2026-05-29

- commit/push hook 기준을 `commit-push-rules.md`로 분리해 `workflow-rules.md`의 workstream 운영 문구 변경이 `common.hooks.commit-push-check`를 불필요하게 트리거하지 않도록 했습니다.

## 0.2.47 - 2026-05-28

- 긴 대화창 컨텍스트 비대화를 줄이기 위한 Workstream 대화창 분리 가이드와 선택형 템플릿을 추가했습니다.

## 0.2.46 - 2026-05-28

- 사용자 최종화 승인 전에는 build/test/harness:check/commit/push/PR 생성을 실행하지 않는 완료 승인 게이트를 문서와 Claude Stop hook에 반영했습니다.

## 0.2.45 - 2026-05-27

- 소비자 리뷰에서 나온 프로젝트 고유 경로와 작업 유형이 공통 기본 기준으로 노출되지 않도록 중요 경로, 컨텍스트 유형, 스킬 트리거를 일반화했습니다.

## 0.2.44 - 2026-05-27

- RunContext 소비자 리뷰를 `consumer-reviews/`로 이동해 본체 개선 입력으로 보존합니다.
- `harness:check` 마지막에 소비자용 요약을 출력해 필수 조치, 추천 조치, 수동 조치, 검증 결과를 빠르게 확인할 수 있게 했습니다.
- 중요 경로별 추천 검증을 `critical-paths.md` 표에서 읽어 변경 파일과 함께 안내합니다.
- 요청 시작 컨텍스트 축소를 위해 UI, Supabase, native, domain-logic 작업 유형과 관련 문서/스킬 매핑을 보강했습니다.

## 0.2.43 - 2026-05-27

- SYNC GAP 출력에 `trigger files`, `matched rules`, `needed action`, `can ignore when`을 추가해 경고 근거와 조치 여부를 명확히 했습니다.
- 정책 레지스트리에 `triggerPaths`를 도입해 설치/업데이트 보존 정책처럼 넓은 검토 범위를 가진 정책의 노이즈를 줄였습니다.
- `blocking`, `action required`, `review suggested`, `info` 등급으로 경고를 나눠 출력합니다.
- 같은 git tree에서 이미 통과한 검증은 `.harness/generated/check-cache.json`으로 재사용하고, pre-push는 `--fast` 모드로 test/build 반복을 줄입니다.
- `supabase/functions/**` 변경 시 Deno 또는 프로젝트 지정 Edge Function 검증 명령을 찾도록 했습니다.
- 프로젝트 중요 경로 선언 파일과 사용자 수동 조치 목록을 추가했습니다.

## 0.2.42 - 2026-05-22

- 설치 완료와 `harness:update` 완료 후 소비자 프로젝트에서 바로 쓸 수 있는 주요 `npm run harness:*` 명령을 안내합니다.
- 가이드, 스캔, 인수인계, 작업 컨텍스트, 운영 업무, 검증, 업데이트, git hook 연결 명령을 빠른 안내로 묶었습니다.

## 0.2.41 - 2026-05-22

- Claude slash command `/운영업무`, `/업무요약`을 추가해 JIRA 운영 업무 접수와 완료 히스토리 기록 흐름을 제공합니다.
- 하네스 스킬 레지스트리에 `운영 업무 접수 흐름`, `기존 기능 개선 흐름`, `업무 요약 흐름`을 추가했습니다.
- 소비자 프로젝트의 운영 업무 요약은 `.harness/maintenance/work-history/` 아래 연도별 폴더에 보존하고 Git 형상관리 대상으로 공유하도록 했습니다.
- 업무 요약 후 중요한 결정은 `decision-log.md`, 반복 규칙은 `.harness/project/*`로 승격하도록 안내했습니다.
- `/운영업무` 종료 시 개발 완료 후보를 제시하고 사용자 승인 후 `업무 요약 흐름`을 수행하는 반자동 완료 절차를 명시했습니다.

## 0.2.40 - 2026-05-21

- 소비자 프로젝트 루트에 `.harness/`가 있으면 사용자가 하네스를 명시적으로 언급하지 않아도 에이전트가 하네스 작업 프로토콜을 적용해야 한다는 지침을 강화했습니다.
- `CLAUDE.md`, `AGENTS.md`, Copilot shim, 세션 시작 알림, 소비자 세션 템플릿에 자동 인식, 반복 규칙 승격, 불확실성 인터뷰, 완료 전 검증 원칙을 명시했습니다.
- 설치 smoke test가 자동 인식 지침이 소비자 프로젝트에 주입되는지 검증합니다.

## 0.2.39 - 2026-05-20

- `hooks:install` 완료 메시지에 설치된 hook, commit template, 기존 hook 체인 실행 안내를 출력합니다.
- 기존 `.git/hooks/*` 또는 기존 `core.hooksPath`의 hook을 `harness.previousHooksPath`로 저장하고 하네스 hook에서 먼저 실행하도록 변경했습니다.

## 0.2.38 - 2026-05-20

- 요청 유형별로 읽을 문서, 실행 명령, 기록 위치를 좁히는 하네스 스킬 레지스트리를 추가했습니다.
- `harness:context`가 관련 문서와 함께 Selected Skills를 출력하도록 개선했습니다.
- Claude/Codex/Copilot 진입 문서에서 스킬 선택 흐름을 안내합니다.
- 스킬 내부 ID는 영어로 유지하고, 개발자 표시명과 설명은 한국어로 정리했습니다.
- 소비자 프로젝트용 세션 시작, 스택 선택, 직접 수정 반영, 커밋 전 검증 스킬을 추가했습니다.

## 0.2.37 - 2026-05-19

- README와 policy README에 본체 개발용 검증과 소비자 프로젝트용 검증의 차이를 표로 기록했습니다.

## 0.2.36 - 2026-05-19

- `policy-registry.json`을 v3로 확장해 원자 정책 단위, 계층, 상태, 심각도, 강제 강도, 예외 가능 여부, 소유자, 출처, 검증 명령을 기록합니다.
- 정책 DB화 전 점검 문서 `policy-db-readiness.md`를 추가했습니다.
- `policy:check`와 `harness:check`에서 공통 정책 레지스트리 v3 필수 필드와 enum을 검사합니다.

## 0.2.35 - 2026-05-19

- 가이드 출력의 `Daily entrypoints`를 `Recommended commands`로 바꾸고 각 명령의 실행 시점을 함께 표시했습니다.
- `harness:handoff`를 설치/업데이트 후 확인할 일과 권장 조치 요약으로 설명했습니다.
- `hooks:install` 후 commit/push 전에 `harness:check`가 자동 실행된다는 안내를 추가했습니다.

## 0.2.34 - 2026-05-19

- `harness:context` 출력을 Agent Decision Context로 정리했습니다.
- 작업 유형, 관련 기준, 충돌 우선순위, 영향 후보, 필수 산출물을 한 파일에 모으도록 개선했습니다.
- `context-registry.json`을 추가해 작업 유형별로 읽을 기준을 선택할 수 있게 했습니다.
- README와 가이드에서 `harness:context`를 개발자가 매 요청마다 실행하는 명령이 아니라 에이전트 보조 명령으로 설명했습니다.

## 0.2.33 - 2026-05-19

- 사용자-facing 용어를 “공통 하네스” 중심으로 정리하고 용어 문서를 추가했습니다.
- Claude Code `SessionStart` hook으로 `next-session-reminder.md`를 자동 표시합니다.
- `/reminder`, `/memory`, `/decision` slash command를 추가해 세션 리마인더, 프로젝트 메모리, 결정 로그 갱신 경로를 명시했습니다.
- Codex와 Copilot은 같은 hook 강제성이 없음을 문서화하고, `CLAUDE.md` 읽기 순서와 대상 파일을 기준으로 안내합니다.
- 프로젝트 `.nvmrc`가 하네스 실행 최소 Node보다 낮으면 설치를 중단하도록 정리했습니다.

## 0.2.32 - 2026-05-18

- 공통 하네스만 설치된 상태를 정상 선택 가능한 상태로 안내합니다.
- 설치 완료 안내, 인수인계 요약, 대시보드에 다음 선택지를 추가했습니다.
- 개발자가 스택 후보 적용, 공통 기준 단독 운영, 새 스택 하네스 후보 요청 중 하나를 바로 선택할 수 있게 했습니다.
- 본체 GitHub Actions workflow는 소비자 프로젝트 설치 대상과 npm 패키지 포함 대상에서 제외했습니다.

## 0.2.31 - 2026-05-18

- 설치 후 일상 명령 안내를 `npm run harness:*` 중심으로 정리했습니다.
- `ai-standard-cli`는 최초 설치와 스택 선택을 돕는 bootstrap/router로 두고, 소비자 프로젝트의 상시 사용 표면은 npm script로 고정했습니다.

## 0.2.30 - 2026-05-18

- 설치 후 안내에서 프로젝트 로컬 CLI 실행 방식을 실험했습니다.
- 이 방향은 0.2.31에서 폐기하고 `npm run harness:*` 중심 안내로 되돌렸습니다.

## 0.2.29 - 2026-05-18

- `--force` 단독 실행 시 프로젝트 소유 파일 덮어쓰기 위험을 안내하고 중단하도록 변경했습니다.
- 실제 덮어쓰기는 `--force --confirm-overwrite-project-files`로 위험 인지를 명시해야 진행됩니다.
- `harness:update`에서도 같은 확인 규칙을 적용했습니다.

## 0.2.28 - 2026-05-18

- 소비자 프로젝트에 본체 세션 기록이 복사되지 않도록 분리했습니다.
- `active-context.md`, `decision-log.md`, `developer-input-queue.md`, `next-session-reminder.md`, `project-memory.md`는 설치 시 소비자 프로젝트용 템플릿으로 생성합니다.
- 과거 버전에서 본체 세션 문서가 그대로 복사되었고 사용자가 수정하지 않은 경우, 업데이트 시 소비자 프로젝트용 템플릿으로 교체합니다.
- 소비자 프로젝트의 `decision-log.md`가 릴리스 노트가 아니라 프로젝트별 기준 충돌과 선택 이유를 기록하는 문서임을 명확히 했습니다.
