# CLAUDE

이 파일이 모든 에이전트의 기준 진입점입니다. 사내 표준 에이전트는 Claude입니다.

## 항상 읽는 최소 기준
1. `.harness/policy/ai-standard-guiding-policy.md`
2. `.harness/session/session-start-alert.md`
3. `.harness/session/active-context.md`

## 세션 재개 시 추가 확인
- `.harness/session/project-memory.md`
- `.harness/session/decision-log.md`
- `.harness/session/developer-input-queue.md`

## 작업별로 골라 읽는 기준
- `.harness/project/local-methodology.md`
- `.harness/project/standards-layers.md`
- `.harness/project/domain-rules.md`
- `.harness/project/architecture-rules.md`
- `.harness/project/workflow-rules.md`
- `.harness/project/stack-preset-rules.md`
- `.harness/project/template-contract.md`
- `.harness/project/bootstrap.md`
- `.harness/policy/context-protocol.md`
- `.harness/documentation/README.md`
- `.harness/stacks/README.md`

## 기준
- 하네스 본체는 `.harness/`에 있습니다.
- 플랫폼별 파일은 하네스 본체 밖의 어댑터입니다.
- `.claude/`는 Claude Code hooks, agents, slash command용 어댑터입니다.
- `AGENTS.md`는 이 파일을 가리키는 보조 진입점입니다.
- 개발 기준, 세션, 문서, 스택 기준은 `.harness/`를 단일 진실 출처로 봅니다.

## 작업 원칙
- 모든 작업은 먼저 `.harness/policy/ai-standard-guiding-policy.md` 위배 여부를 확인합니다.
- 작업 전 `npm run harness:check` 또는 최소 `npm run harness:impact`로 영향 범위를 확인합니다.
- 큰 작업이나 생소한 영역은 `npm run harness:sync` 후 `npm run harness:context -- "<작업 설명>"`로 작업별 읽을거리 후보를 먼저 만듭니다.
- 개발 기준 문서, 스택 문서, `src/`를 변경하면 관련 반대편 문서/코드도 함께 검토합니다.
- 코드 변경 후에는 도메인, 아키텍처, 워크플로우 로컬룰로 승격할 반복 패턴이나 검증 기준이 생겼는지 반드시 점검합니다.
- 진행 상황을 개발자에게 설명할 때는 원시 내부 추론이 아니라 `[harness] request/context/impact/action/decision/verify` 형태의 visible trace로 요약합니다.
- 에이전트 작업에서는 로컬 git hook 설치 여부와 무관하게 기준 계층을 따르고 완료 전 검사를 실행 대상으로 둡니다.
- 새 프로젝트 방향이 비어 있으면 구현보다 `.harness/project/bootstrap.md` 인터뷰를 먼저 진행합니다.
