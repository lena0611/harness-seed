# 세션 부트 가이드

새 세션은 아래 구분으로 컨텍스트를 복구합니다.

## 1. 빠른 사실 확인
- 저장소 목적과 실행 명령은 `README.md`에서 확인합니다.
- 코드 생성 규칙과 아키텍처 규칙은 `CLAUDE.md`, 프로젝트 하네스, 활성 스택 instructions에서 확인합니다. `AGENTS.md`는 같은 기준을 가리키는 보조 진입점입니다.

## 2. 항상 읽는 최소 기준
1. `../policy/ai-standard-guiding-policy.md`
2. `session-start-alert.md`
3. `active-context.md`

## 3. 세션 재개 시 추가 확인
- `project-memory.md`
- `decision-log.md`
- `developer-input-queue.md`

## 4. 작업별로 골라 읽는 기준
- `../project/README.md`
- `../project/project-charter.md`
- `../project/local-methodology.md`
- `../project/standards-layers.md`
- `../project/stack-preset-rules.md`
- `../project/template-contract.md`
- `../project/bootstrap.md`
- `../policy/README.md`
- `../policy/sync-protocol.md`
- `../policy/context-protocol.md`
- `../policy/enforcement-ladder.md`
- `../policy/automation-coverage.md`
- `../documentation/README.md`
- `../documentation/indexing-rules.md`
- `../style/style-evolution.md`
- `../stacks/README.md` (활성 스택 메타 확인용)

## 5. 작업 시작 전 체크
- `ai-standard-guiding-policy.md`의 위배 여부를 먼저 확인합니다.
- 새 작업이 공통 기준, 스택 기준, 프로젝트 로컬룰 중 어느 계층의 영향을 받는지 먼저 판단합니다.
- 큰 작업이나 낯선 영역이면 에이전트가 `harness:sync`와 `harness:context`로 작업별 판단 컨텍스트를 먼저 만듭니다.
- 진행 상황은 원시 내부 추론이 아니라 visible trace로 남길 수 있는 단계와 판단 결과 중심으로 정리합니다.
- 업무 판단, 단순 변환, 외부 연동, 검증 책임이 어느 모듈에 속하는지 먼저 정합니다.
- `developer-input-queue.md`에 `open` 항목이 있으면 개발자 입력이 필요한지 먼저 확인합니다.
- 문서를 추가하거나 확장한다면 먼저 인덱스 문서로 둘지, 세부 문서로 둘지 역할을 결정합니다.
- 방향 유지를 위한 새 장치를 만든다면 harness, trigger, hook 중 어디까지 필요한지 함께 판단합니다.
- 강제 강도와 예외 허용 범위가 애매하면 사용자에게 먼저 확인합니다.
- 스타일 drift가 보이면 `style-evolution.md` 기준으로 문서 규칙 또는 lint 규칙 승격을 검토합니다.

## 6. 빠른 점검 명령
```bash
git --no-pager status --short
npm run harness:impact
# 최종화 승인 후:
# HARNESS_AGENT_CHECK_APPROVED=1 npm run harness:check
```

## 7. 작업 재개 원칙
- 현재 진행 상태는 `active-context.md`를 우선 신뢰합니다.
- 장기 규칙은 `project-memory.md`와 `CLAUDE.md`를 우선 신뢰합니다.
- 둘이 충돌하면 `active-context.md`에 충돌 사실을 기록하고 최신 코드 기준으로 다시 정리합니다.
- 기준 문서나 업무 코드를 건드리는 작업이면 시작 전 `harness:impact`를 실행 대상으로 취급합니다.
- 에이전트 작업에서는 로컬 git hook 설치 여부와 무관하게 기준 계층을 읽습니다. 사용자 완료 승인 전에는 `harness:check`, build/test, commit/push/PR을 실행하지 않고 검증 후보로 보고합니다.
- 사용자가 `최종 검증만` 요청하면 `npm run harness:check`를 직접 실행합니다. 사용자가 `커밋/푸시`를 요청했고 hook이 설치되어 있으면 hook 검증을 신뢰하고 commit 직전 수동 `harness:check`를 중복 실행하지 않습니다.
- hook이 설치되지 않았거나 `--no-verify` 등으로 우회되는 환경이면 commit/push 전에 에이전트가 직접 `npm run harness:check`를 실행합니다.
- 프로젝트 상태나 책임 범위가 `TBD`인 상태라면 새 작업 설계 전에 `project-charter.md` 재계획 여부를 먼저 판단합니다.
- 사용자가 "새 프로젝트 시작" 또는 "기존 프로젝트 하네스 정리" 의사를 보이면 `../project/bootstrap.md`의 절차(프로젝트 상태 확인 + 스택 선택)를 먼저 수행합니다.
- 개발자 입력이 필요한 항목은 묻지 않고 넘기지 말고, 최소한 `지금 답변 / 이번 세션 유보 / 나중에 다시 묻기` 중 하나로 상태를 남깁니다.
- 문서가 길어질 조짐이 있으면 한 문서에 계속 누적하지 말고 `documentation` 하네스 기준으로 분리합니다.
- 로컬룰이 많아지면 모든 룰을 항상 읽지 말고 에이전트 판단 컨텍스트와 상단 요약을 우선합니다.
- 반복해서 놓치는 작업은 운영 문서에만 두지 말고 trigger 또는 hook으로 승격할지 검토합니다.
- `inform/trigger/hook/block`와 `none/defer/waiver` 판단이 불명확하면 추정하지 말고 사용자에게 묻습니다.
