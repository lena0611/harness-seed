# Changelog

하네스 본체의 릴리스 변경사항을 기록합니다.

`CHANGELOG.md`는 하네스 본체 변경 이력입니다. 설치된 소비자 프로젝트의 판단 기록은 `.harness/session/decision-log.md`에 남깁니다.

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
