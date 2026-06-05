---
description: 중요한 구조 결정, 예외, 충돌 해결 이유를 결정 로그에 기록합니다.
allowed-tools: Read, Write, Edit
---

# /decision

`CLAUDE.md`의 읽기 순서를 따른 뒤 `.harness/session/decision-log.md`를 확인합니다.

## 수행
1. 결정한 내용, 선택지, 선택 이유, 포기한 대안을 짧게 정리합니다.
2. 회사 공통, 스택, 템플릿, 프로젝트, 개인 기준이 충돌했다면 우선순위와 해결 방식을 남깁니다.
3. `.harness/session/decision-log.md`에 날짜별 항목으로 기록합니다.

## 기준
- 소비자 프로젝트의 `decision-log.md`는 하네스 릴리스 노트가 아닙니다.
- 릴리스 변경사항은 본체 저장소의 `CHANGELOG.md`에 둡니다.
- 결정이 `.harness/project/*` 규칙으로 굳으면 기존 결정 항목 본문을 삭제하지 말고 `→ <대상 문서> 참조` 포인터로 축약합니다.
- 파일이 일정 규모를 넘으면 오래된 결정은 `decision-log-YYYYH1.md`, `decision-log-YYYYH2.md`, `thread-handoff-YYYY-MM-DD.md` 같은 날짜 스냅샷으로 아카이브하고, 현재 파일은 최근/유효 결정만 유지합니다.
- append-only로만 늘리지 말고, 갱신 전에 supersede된 항목을 먼저 축약하거나 아카이브합니다.
