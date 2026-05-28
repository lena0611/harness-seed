# CLAUDE

이 파일이 모든 에이전트의 기준 진입점입니다. 사내 표준 에이전트는 Claude입니다.

## 하네스 자동 인식 의무
- 작업 루트에서 `.harness/`, `AGENTS.md`, `CLAUDE.md` 중 하나라도 발견하면 사용자가 "하네스"를 언급하지 않아도 하네스 프로젝트로 간주합니다.
- 하네스 프로젝트에서는 기능 구현이나 파일 수정 전에 아래 "항상 읽는 최소 기준"을 먼저 읽습니다.
- 사용자가 단순 질문이 아니라 코드/문서/설정 변경을 요청하면, 변경 전에 반복 규칙으로 승격할 내용이 있는지 판단합니다.
- 반복되는 도메인 규칙, 아키텍처 경계, 검증 흐름은 `.harness/session/*`에만 두지 말고 `.harness/project/*` 문서로 승격합니다.
- 판단이 불확실하면 구현을 추측으로 고정하지 말고 `.harness/session/developer-input-queue.md`에 질문을 남기거나 사용자에게 인터뷰합니다.
- 작업 지시 직후 상태는 기본적으로 진행 중입니다. 사용자가 명시적으로 완료, 최종 검증, 커밋, 푸시, PR 생성을 승인하기 전에는 `build`, `test`, `harness:check`, commit, push, PR 생성을 실행하지 말고 검증 후보로만 보고합니다.
- 최종화가 승인된 뒤에만 변경 성격에 맞는 검증을 실행합니다. 최소 기준은 `npm run harness:check`이며, 실행하지 못하면 이유를 최종 응답에 남깁니다.

## 항상 읽는 최소 기준
1. `.harness/policy/ai-standard-guiding-policy.md`
2. `.harness/session/session-start-alert.md`
3. `.harness/session/active-context.md`

## 세션 재개 시 추가 확인
- `.harness/session/project-memory.md`
- `.harness/session/decision-log.md`
- `.harness/session/developer-input-queue.md`

## 작업별로 골라 읽는 기준
- `.harness/project/terminology.md`
- `.harness/project/local-methodology.md`
- `.harness/project/standards-layers.md`
- `.harness/project/domain-rules.md`
- `.harness/project/architecture-rules.md`
- `.harness/project/workflow-rules.md`
- `.harness/project/commit-push-rules.md`
- `.harness/project/stack-preset-rules.md`
- `.harness/project/template-contract.md`
- `.harness/project/bootstrap.md`
- `.harness/policy/context-protocol.md`
- `.harness/skills/README.md`
- `.harness/documentation/README.md`
- `.harness/stacks/README.md`

## 기준
- 하네스 본체는 `.harness/`에 있습니다.
- 플랫폼별 파일은 하네스 본체 밖의 어댑터입니다.
- `.claude/`는 Claude Code hooks, agents, slash command용 어댑터입니다.
- `AGENTS.md`는 이 파일을 가리키는 보조 진입점입니다.
- 개발 기준, 세션, 문서, 스택 기준은 `.harness/`를 단일 진실 출처로 봅니다.
- Claude Code에서는 `/reminder`, `/memory`, `/decision`, `/harness-scan` 명령을 사용해 세션 리마인더, 장기 메모리, 결정 로그, 프로젝트 스캔을 명시적으로 갱신합니다.
- Claude Code의 `SessionStart` hook은 `.harness/session/next-session-reminder.md`를 자동으로 보여주도록 구성합니다. Codex와 Copilot은 같은 강제 hook이 없으므로 이 파일과 `AGENTS.md`, `.github/copilot-instructions.md`를 통해 같은 기준을 안내합니다.

## 작업 원칙
- 모든 작업은 먼저 `.harness/policy/ai-standard-guiding-policy.md` 위배 여부를 확인합니다.
- 작업 전에는 최소 `npm run harness:impact`로 영향 범위를 확인합니다. `npm run harness:check`는 사용자가 최종 검증을 승인한 뒤 실행합니다.
- 큰 작업이나 생소한 영역은 `npm run harness:sync` 후 `npm run harness:context -- "<작업 설명>"`로 에이전트 판단 컨텍스트를 먼저 만듭니다.
- 프로젝트가 session workstreams README로 workstream 운영을 opt-in 했다면, 매 요청 시작 시 현재 workstream과 선행/후행 workstream 필요 여부를 먼저 식별합니다.
- `harness:context` 결과의 Selected Skills를 보고 읽을 문서, 실행할 명령, 기록 위치를 좁힌 뒤 작업합니다.
- 개발 기준 문서, 스택 문서, `src/`를 변경하면 관련 반대편 문서/코드도 함께 검토합니다.
- 코드 변경 후에는 도메인, 아키텍처, 워크플로우 로컬룰로 승격할 반복 패턴이나 검증 기준이 생겼는지 반드시 점검합니다.
- 진행 상황을 개발자에게 설명할 때는 원시 내부 추론이 아니라 `[harness] request/context/impact/action/decision/verify` 형태의 visible trace로 요약합니다.
- 에이전트 작업에서는 로컬 git hook 설치 여부와 무관하게 기준 계층을 따릅니다. 다만 완료 승인 전에는 무거운 검증과 side effect 있는 작업을 실행하지 않고, 승인 후 최종화 단계에서 검사를 실행합니다.
- 새 프로젝트 방향이 비어 있으면 구현보다 `.harness/project/bootstrap.md` 인터뷰를 먼저 진행합니다.
