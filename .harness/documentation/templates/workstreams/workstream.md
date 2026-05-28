# <workstream-id>

## 목적

- `TBD`

## 포함 범위

- `TBD`

## 제외 범위

- `TBD`

## 선행 Workstream

- 없음

## 후행 Workstream

- 없음

## 시작 체크

- 현재 요청이 이 workstream 범위에 들어오는가?
- 선행 workstream 결정이 필요한가?
- 사용자 완료 승인 전 무거운 검증이나 커밋을 실행하려고 하고 있지 않은가?

## 완료 체크

- 현재 workstream 안에서 닫을 수 있는가?
- 후속 workstream 확인이 필요한가?
- 수동 조치가 남았는가?
- 문서화할 가치가 있는 결정이나 반복 규칙이 있는가?

## 인수인계 메모

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

## 영구 기록 후보

- 도메인 규칙: `.harness/project/domain-rules.md`
- 구조 결정: `.harness/project/architecture-rules.md`
- 검증/릴리스 절차: `.harness/project/workflow-rules.md`
- 중요한 결정 이유: `.harness/session/decision-log.md`
- 다음 세션 인계: `.harness/session/next-session-reminder.md`
