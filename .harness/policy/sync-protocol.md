# 동기화 프로토콜

## 언제 반드시 실행하는가
- `.claude/**`, `.codex/**`, `.github/copilot-instructions*` 어댑터가 바뀔 때
- `.harness/policy/**`가 바뀔 때
- 업무 코드가 바뀔 때
- 구조, 데이터 흐름, 책임 경계에 영향을 줄 수 있는 리팩터링을 할 때
- `scripts/init.mjs`, `scripts/test-init.mjs`, `.harness/bin/scan-project.mjs`, `.harness/bin/handoff.mjs` 또는 문서 검사 스크립트가 바뀔 때

## 기본 실행 순서
1. 일반 프로젝트에서는 먼저 `npm run harness:impact`로 영향 범위를 봅니다.
2. 작업 범위가 크거나 생소하면 `npm run harness:sync` 후 `npm run harness:context -- "<작업 설명>"`로 에이전트 판단 컨텍스트를 생성합니다.
3. 필요 시 관련 기준 문서와 영향 영역을 함께 수정합니다.
4. 최종 확인은 `npm run harness:check`로 수행합니다. CI에서는 `npm run harness:check:strict`를 사용합니다.

하네스 본체 저장소에서 세부 원인 분석이 필요하면 `policy:impact`, `policy:check`, `docs:check` 같은 내부 npm script를 별도로 사용할 수 있습니다.

## SYNC GAP 처리
- `harness:impact` 또는 `policy:impact` 출력에 `SYNC GAP` 블록이 보이면 한쪽(문서 또는 소스)만 변경된 상태라는 뜻입니다.
- 출력은 `trigger files`, `matched rules`, `needed action`, `can ignore when`을 함께 보여줘야 합니다.
- 등급은 `blocking`, `action required`, `review suggested`, `info`로 나눕니다.
- `.harness/install-manifest.json`의 managed hash와 일치하는 하네스 baseline/generated 파일은 본체 업데이트 산출물로 분류하고 정책 sync gap 계산에서 제외합니다.
- 같은 문서를 소비자 프로젝트가 직접 수정해 manifest hash와 달라진 경우에는 로컬 하네스 변경으로 보고 기존처럼 정책 매칭과 sync gap 검토를 수행합니다.
- 기본 동작: `review suggested`와 `info`는 로컬 `harness:check`를 실패시키지 않습니다.
- CI나 `strict` 모드에서는 남아 있는 갭을 실패 기준으로 봅니다.
- `.harness/policy/profile.json`의 `harnessMode`가 `bootstrap`이면 초기 설치나 스택 기준 추가에서 생긴 갭은 정보성 안내로 낮춰 볼 수 있습니다.
- `harnessMode`가 `strict`이면 `harness:check`도 strict 검증처럼 해석합니다.
- 해결 옵션:
  1. 반대편을 같이 갱신해 갭을 닫는다.
  2. 의도된 단방향 변경이면 `decision-log.md`에 사유를 남기고 필요 시 `waivers.json`에 등록한다.
  3. 기준 매핑이 잘못된 경우 `policy-registry.json`의 `documents`/`triggerPaths`를 수정한다.

## 정책 매칭 범위
- `documents`는 정책을 설명하는 기준 문서입니다.
- `ownedAreas`는 정책이 검토 대상으로 삼는 전체 파일 영역입니다.
- `triggerPaths`는 실제 변경이 있을 때 그 정책을 깨우는 좁은 경로입니다. 없으면 `ownedAreas`를 사용합니다.
- 넓은 프로젝트 문서 전체를 `ownedAreas`에 넣더라도, 노이즈가 커지는 정책은 반드시 `triggerPaths`를 따로 둡니다.
- 예: 설치/업데이트 보존 정책은 프로젝트 소유 문서를 검토 범위로 알 수는 있지만, `domain-rules.md` 변경만으로 설치 정책을 깨우면 안 됩니다.

## 중요 경로와 수동 조치
- 프로젝트 핵심 파일은 `.harness/project/critical-paths.md`에 선언합니다.
- `supabase/functions/**`가 바뀌면 `harness:check`는 `deno check` 또는 프로젝트 지정 검증 명령(`supabase:functions:check`, `edge:functions:check`, `functions:check`)을 찾습니다.
- 에이전트가 직접 처리할 수 없는 외부 콘솔, secret, capability, Pages 설정은 `.harness/session/manual-actions.md`에 남깁니다.

## 반복 검증 완화
- `harness:check`는 같은 git tree와 같은 검증 계획이 이미 통과했으면 `.harness/generated/check-cache.json`을 사용해 lint/test/build 반복을 줄일 수 있습니다.
- `pre-commit`은 `.harness/bin/harness check`로 전체 검사를 실행합니다(npm 프로젝트의 `npm run harness:check`와 동일 검사, 비-Node 프로젝트에서도 동작).
- `pre-push`는 `.harness/bin/harness check --fast`를 실행해 정책, 문서, 버전, lint 중심으로 빠르게 확인하고 test/build 반복을 줄입니다.

## 세션 트리거
- 새 세션 시작 시 `session-boot.md`를 읽은 직후 이 프로토콜을 확인합니다.
- 개발 기준 또는 소스 코드를 손대는 작업을 시작하면 먼저 `harness:impact`로 영향 범위를 확인합니다.
- 사용자가 최종 검증을 승인한 뒤 `harness:check`를 실행해 최종 위반이 없는지 확인합니다.

## 해석 원칙
- `harness:impact`는 "어디를 다시 봐야 하는지" 알려줍니다.
- `policy:check`는 하네스 본체 저장소에서 "지금 바로 위반인지"를 알려줍니다.
- `harness:sync`와 `harness:context`는 이번 작업의 판단 기준, 영향 후보, 충돌 우선순위를 좁혀주는 에이전트 보조 장치입니다.
- `harness:impact`가 출력한 영역이 넓더라도, 검토 대상에서 제외하지 않습니다.
- 자동 검사로 다 잡히지 않는 항목은 `automation-coverage.md`와 `waivers.json` 기준으로 추가 판단합니다.

## 생성 컨텍스트
- `.harness/generated/**`는 실제 코드와 문서를 훑어 만든 재생성 산출물입니다.
- `.harness/session/task-context.md`는 작업 설명을 기준으로 만든 에이전트 판단 컨텍스트입니다.
- 두 산출물은 git 추적 대상이 아니며, 기준 문서나 실제 코드를 대신하지 않습니다.
- 생성 컨텍스트와 원본 문서가 충돌하면 원본 문서와 실제 코드를 우선합니다.

## 어댑터와 설치 스크립트
- `.harness/`는 단일 진실 출처입니다. 도구별 어댑터(`.claude/`, `.codex/`, `.github/copilot-instructions*`)는 하네스 본체 밖에 둡니다.
- 새 어댑터 문서를 추가하면 `document-registry.json`과 `.harness/bin/doc-link-check.mjs`의 탐색 범위를 함께 확인합니다.
- `init`은 하네스 소유 파일을 갱신하고 프로젝트 소유 파일을 보존해야 합니다.
- `init`은 `.harness/install-manifest.json`으로 공통 하네스 설치기가 관리하는 파일을 식별해야 합니다.
- `init`은 package.json이 없으면 새로 만들지 않습니다(비-Node 프로젝트인 PHP/Java/Swift/Kotlin 보호 — 프로젝트 매니페스트 오염 방지). package.json이 이미 있을 때만 harness npm 별칭을 멱등 머지하고, 없으면 하네스 명령을 `.harness/bin/harness` 런처 또는 `node .harness/bin/<script>.mjs`로 실행하도록 설치 안내에 표시합니다. 드문 greenfield Node 케이스만 `--with-package-json`으로 새로 생성합니다. 이 거동이 바뀌면 `scripts/test-init.mjs`의 Node/비-Node 설치 테스트도 함께 갱신합니다.
- `init`은 프로젝트 Node가 하네스 최소 버전(20.19) 미만이어도 dual-runtime 모드로 설치합니다(0.2.63). 저버전 `.nvmrc`는 설치 중단 대신 nvm·하네스 Node·프로젝트 Node 설치 여부를 진단하고, nvm 자체가 없으면 전환 수단이 없으므로 중단합니다(머신 환경을 바꾸는 nvm 자동 설치는 하지 않음). `.nvmrc` 없는 Node 프로젝트(package.json 보유)에서 저버전 신호(engines/.node-version/Dockerfile/CI)를 감지하면 추측 확정 대신 `--project-node <ver>` 인터뷰를 요구하고, 사용자 확인 버전만 `.nvmrc`로 기록합니다(기존 `.nvmrc`는 덮어쓰지 않음 — 프로젝트 소유 보존). 비-Node 프로젝트(package.json 부재)는 인터뷰를 생략합니다. 런타임 전환은 `.harness/bin/dual-node.sh`(hook/런처가 source)와 `.harness/bin/node-env.mjs`(guard/install-hooks가 import)가 담당하며, hook은 하네스 스크립트만 전환하고 lint/test/build는 `.nvmrc` Node로 실행합니다. 이 설치/진단/인터뷰 거동이 바뀌면 `scripts/test-init.mjs`의 dual-runtime 테스트와 `.harness/project/portability-guide.md`의 Node 런타임 계약을 함께 갱신합니다.
- npm 없이 쓰는 진입면으로 `.harness/bin/harness` 런처(무확장자 POSIX sh)를 함께 설치하고 `init`이 실행 권한을 부여합니다. `harness <command>`는 `npm run harness:*`와 같은 `.harness/bin/*.mjs`를 호출하므로 동작이 일치해야 합니다. 런처 명령표나 소비자 npm script(`CONSUMER_SCRIPT_NAMES`)가 바뀌면 둘을 함께 갱신하고 `scripts/test-init.mjs`의 런처 드리프트 테스트로 확인합니다. 전역 설치/`ai` 명령/devDependency CLI가 아니라 커밋되는 shell shim이며(2026-05-18 결정과 정합), npm 보유 프로젝트의 표준은 계속 `npm run harness:*`입니다. Windows cmd/PowerShell 사용자용으로 `.harness/bin/harness.cmd` shim을 함께 설치하며, 같은 명령표를 유지해야 합니다(sh 런처와 .cmd shim의 명령 드리프트는 `scripts/test-init.mjs`가 검사). git hook은 Windows에서도 Git Bash(sh)로 실행되므로 hook 경로는 sh 런처를 그대로 사용합니다.
- manifest가 없는 기존 `.harness/`, `.claude/`, `.codex/`, `CLAUDE.md`는 전용 하네스일 수 있으므로 기본 보존하고 `--force`일 때만 덮어씁니다.
- `init`은 manifest의 managed 파일을 덮어쓰기 전에 현재 파일 sha256과 `install-manifest.json`의 기록 sha256을 비교해, 불일치(=설치 이후 소비자가 수정)면 기본적으로 보존합니다(0.2.65 안전망). 소비자가 위험을 인지하고 `--force --confirm-overwrite-project-files`를 함께 지정하면 직전 소비자본을 같은 디렉터리에 `<파일>.harness-bak` 사이드카로 백업한 뒤 덮어씁니다. `--force`만 있고 동의 플래그가 없으면 로컬 수정된 managed 파일도 기존 force 가드에 포함되어 init이 중단됩니다. 후처리 리포트는 "로컬 수정으로 보존된 managed 파일"과 "백업 후 덮어쓴 managed 파일"을 항상 명시 출력해 조용한 손실을 막습니다. 이 거동이 바뀌면 `scripts/test-init.mjs`의 안전망 회귀 테스트(`reinstallPreservesLocallyEditedManagedHarnessFile`, `forceConfirmOverwritesLocallyEditedManagedHarnessFileWithBackup`, `forceAloneStopsWhenManagedHarnessFileWasLocallyEdited`)와 README의 업데이트 안내를 함께 갱신합니다. 마커 영역(`<!-- harness-managed:start/end -->`)이나 `CLAUDE.md`/`AGENTS.md` project-owned 재분류는 후속 검토 항목이며, 본 안전망은 그 사이의 보호선입니다.
- `.claude/settings.json`은 project-owned로 보존하되, 회사 공통 필수 차단 기준인 에이전트 안전 훅이 소비자에서 무력화되지 않도록 `init`이 하네스의 안전 표면(hooks, permissions.deny/allow, env, statusLine)을 기존 설정에 멱등·비파괴로 병합합니다(기존 값은 덮지 않고, statusLine은 없을 때만 설정). 소비자가 의도적으로 제거한 항목을 되살릴 수 있으므로, 원치 않으면 설치 후 제거하고 사유를 남깁니다.
- `harness:outdated`는 공통 하네스와 스택 하네스를 함께 검사하고, 둘 중 하나라도 업데이트 후보가 있으면 전체 상태를 `outdated`로 표시합니다. 공통만 보려면 `--base-only`, 스택만 보려면 `--stack-only`를 사용합니다.
- `harness:update` 기본 동작은 스택 하네스 업데이트입니다. 공통 하네스만 업데이트할 때는 `--base-only`를 명시합니다.
- lock에 repo/ref/version 정보가 부족하면 lock source metadata와 install manifest source metadata에서 복구해 조회합니다.
- `harness:update -- --base-only`는 공통 하네스 init에 `--source-repo`, `--source-ref`를 전달해 `.harness/harness-lock.json`과 `.harness/install-manifest.json`의 base source metadata가 `bundled`로 되돌아가지 않게 해야 합니다.
- source ref가 `semver:*`인 경우 init은 lock/manifest에 그대로 기록하지 않고 실제 설치된 package version tag(`vX.Y.Z`)로 정규화합니다.
- 과거 업데이트로 base source가 `bundled`로 남은 프로젝트는 stack의 `requiredBaseHarness.repo`와 현재 base version으로 `harness:outdated`가 repo/ref를 복구할 수 있어야 합니다.
- `init`은 공통 하네스 버전이 오를 때 이전 버전 → 새 버전 사이의 `CHANGELOG.md` 구간을 계산해 설치 직후 출력하고 `.harness/harness-lock.json`의 `lastUpdate`에 보존합니다. 소비자 프로젝트에는 본체 `CHANGELOG.md`를 복사하지 않으므로, 변경 요약은 `npm run harness:changelog`로 lastUpdate에서 다시 확인합니다. 최초 설치처럼 이전 버전이 없으면 `lastUpdate`를 기록하지 않습니다.
- `harness:update -- --force`는 프로젝트 소유 파일을 덮어쓸 수 있으므로 `--confirm-overwrite-project-files` 없이는 중단해야 합니다.
- 업데이트 스크립트가 target 선택, source metadata 복구, force 확인 흐름을 바꾸면 `scripts/test-init.mjs`의 설치/업데이트/force 테스트와 README의 업데이트 명령 설명을 함께 갱신합니다.
- 프로젝트 소유 파일 예시는 `.harness/project/project-charter.md`, `.harness/project/local-methodology.md`, `.harness/project/stack-preset-rules.md`, `.harness/project/domain-rules.md`, `.harness/project/architecture-rules.md`, `.harness/project/workflow-rules.md`, `.harness/project/critical-paths.md`, `.harness/session/active-context.md`, `.harness/session/manual-actions.md`, `.harness/policy/profile.json`, `.harness/policy/waivers.json`, `.claude/settings.local.json`입니다.
- `stack:apply`는 활성 스택 instructions를 `.harness/project/stack-preset-rules.md`에 로컬룰로 반영해야 합니다.
- 외부 프리셋은 `profile.json`의 `stackManifest` 또는 `stack:apply -- --preset-path <dir>`로 연결하며, manifest 상대 경로는 manifest 위치 기준으로 해석합니다.
- 원격 템플릿 후보 조회는 `.harness/bin/list-templates.mjs`가 담당하며, 기본 대상은 사내 GitLab의 `ai-standard/stacks` 그룹입니다.
- 세미콜론, quote, import 정렬 같은 구체 스타일 값은 공통 하네스가 아니라 로컬 방법론 또는 스택 프리셋 로컬 규칙에서 다룹니다.
- 설치/업데이트 UX가 바뀌면 README의 init 사용법과 보존 기준 설명도 함께 갱신합니다.
- 어댑터 설치 항목이 바뀌면 `scripts/init.mjs`, `scripts/test-init.mjs`, `package.json` files 목록, README의 어댑터 설명을 함께 갱신합니다.
- 에이전트 진입 흐름, 기준 우선순위, 충돌 해석, 검증 절차, 요청 라이프사이클이 바뀌면 `.harness/documentation/assets/request-lifecycle-flow.svg`, `.harness/documentation/assets/agent-development-flow.png`, `ai-standard/docs`의 동일 이미지도 함께 갱신합니다.
- `.harness/bin/scan-project.mjs`는 자동 감지 리포트까지만 생성하고, 프로젝트 기준 문서를 직접 덮어쓰지 않습니다.
- `.harness/session/project-scan-report.md`는 런타임 산출물이므로 레지스트리 필수 문서로 보지 않습니다.
- `.harness/bin/handoff.mjs`는 설치/업데이트 인수인계 요약까지만 생성하고, 기준 문서를 직접 덮어쓰지 않습니다.
- `.harness/session/handoff.md`는 런타임 산출물이므로 레지스트리 필수 문서로 보지 않습니다.
