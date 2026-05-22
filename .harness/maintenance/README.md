# Maintenance History

운영 업무와 유지보수 작업의 결과를 프로젝트 안에 누적하는 영역입니다.

## 목적

- JIRA로 들어온 운영 업무가 어떤 코드/문서 변경으로 이어졌는지 추적합니다.
- 에이전트와 개발자가 같은 업무 맥락을 다시 볼 수 있게 합니다.
- 반복되는 운영 지식이 생기면 `.harness/project/*` 로컬룰로 승격할 후보를 찾습니다.

## 기록 위치

업무별 요약은 연도별 폴더 아래에 남깁니다.

파일명은 연도별 폴더 아래에 `YYYY-MM-DD-<jira-key-or-summary-slug>.md` 형식으로 둡니다.

예:

```text
.harness/maintenance/work-history/2026/2026-05-22-ABC-123.md
```

## 업무 요약 필수 항목

- 요청 JIRA URL
- 요청 개요
- 핵심 개발 내용
- 검증 결과
- 잠재 이슈 또는 TODO

## 운영 원칙

- 업무 히스토리는 Git 형상관리 대상입니다. 팀원이 같은 운영 맥락을 공유할 수 있어야 합니다.
- 개인 메모, 토큰, 비밀번호, 고객 개인정보처럼 공유하면 안 되는 내용은 기록하지 않습니다.
- 에이전트의 1차 구현 완료만으로 히스토리를 확정하지 않습니다. 개발 완료 후보를 사용자에게 제시하고, 사용자가 완료 기록을 승인한 뒤 작성합니다.
- 단순 진행 로그를 무한히 쌓지 않습니다.
- 중요한 구조 결정, 예외, 기준 충돌 해결은 `.harness/session/decision-log.md`에도 남깁니다.
- 같은 판단이 반복되면 `.harness/project/domain-rules.md`, `architecture-rules.md`, `workflow-rules.md`로 승격합니다.
- 다음 세션에서 이어야 할 항목은 `.harness/session/next-session-reminder.md`에 별도로 남깁니다.
