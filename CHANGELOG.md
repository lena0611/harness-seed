# Changelog

하네스 본체의 릴리스 변경사항을 기록합니다.

`CHANGELOG.md`는 하네스 본체 변경 이력입니다. 설치된 소비자 프로젝트의 판단 기록은 `.harness/session/decision-log.md`에 남깁니다.

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
