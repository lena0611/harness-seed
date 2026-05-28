# Workstreams

이 폴더는 선택형입니다. 긴 대화창에서 작업 범위가 흐려질 때만 사용합니다.

## 사용 원칙

- workstream은 기준 우선순위가 아니라 세션 운영 레인입니다.
- 사용자의 일반 작업 지시는 기본적으로 진행 중 상태입니다.
- 완료 승인 전에는 build/test/harness:check/commit/push/PR 생성을 실행하지 않습니다.
- 창 이동은 커밋 없이 진행하고, 후속 창이 현재 diff를 이어받습니다.
- 진행 중 인수인계는 임시 문구로 처리하고, 최종 완료 승인 뒤 남길 가치가 있는 내용만 문서화합니다.

## 현재 Workstream 목록

| id | 목적 | 선행 workstream | 후행 workstream |
| --- | --- | --- | --- |
| `01-example` | 예시입니다. 프로젝트에 맞게 바꾸세요. | 없음 | 없음 |

## 요청 시작 체크

에이전트는 매 요청 시작 시 아래를 확인합니다.

1. 현재 요청의 주 workstream은 무엇인가?
2. 다른 workstream의 선행 결정이 필요한가?
3. 이 대화창에서 닫을 수 있는가?
4. 완료 승인 전에 검증이나 커밋을 실행하려고 하고 있지 않은가?

## 창 이동 인수인계 문구

```text
Workstream handoff
- current workstream: <id>
- target workstream: <id>
- branch: <branch>
- changed files: <요약>
- current status: <진행 중 / 질문 대기 / 구현 후보>
- open questions: <질문>
- do not run yet: build/test/harness:check/commit/push
- next chat first commands:
  - git status --short
  - git diff
  - git diff --staged  # staged 변경이 있을 때만
```

## 새 Workstream 추가 기준

- 같은 주제가 2회 이상 반복됩니다.
- 기존 workstream 범위를 넓히면 오히려 모호해집니다.
- 독립적인 완료 조건과 선행/후행 관계를 설명할 수 있습니다.
- 팀원이 이름만 보고 범위를 이해할 수 있습니다.
