# 결정 로그

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
