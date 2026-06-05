---
description: 다음 세션에서 자동으로 떠올릴 리마인더를 확인하고 갱신합니다.
allowed-tools: Read, Write, Edit
---

# /reminder

`CLAUDE.md`의 읽기 순서를 따른 뒤 `.harness/session/next-session-reminder.md`를 확인합니다.

## 수행
1. 현재 작업에서 다음 세션에 반드시 이어받아야 할 항목을 정리합니다.
2. 미완료 작업, 다시 물어봐야 할 질문, 검증하지 못한 항목을 구분합니다.
3. `.harness/session/next-session-reminder.md`를 짧게 갱신합니다.

## 기준
- 이 파일은 다음 세션 시작 시 Claude Code `SessionStart` hook으로 표시됩니다.
- 본체 릴리스 변경 이력은 `CHANGELOG.md`에 남기고, 프로젝트별 이어받을 맥락만 여기에 둡니다.
- `next-session-reminder.md`는 부트스트랩 체크리스트, 현재 미결 항목, 권위 문서 포인터만 담습니다.
- `project/*`, 특히 `workflow-rules.md`의 운영 규칙 본문을 복사하지 말고 링크나 파일 경로로 가리킵니다.
- 갱신 전에 기존 내용 중 `project/*`와 중복되는 규칙 본문이 있으면 먼저 포인터로 축약하고, 그 뒤에 새 항목을 추가합니다. append-only로 계속 늘리지 않습니다.
