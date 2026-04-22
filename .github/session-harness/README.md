# Session Harness

새 세션에서 빠르게 컨텍스트를 복구하기 위한 하네스입니다.

## 읽기 순서
1. [세션 시작 알림](./session-start-alert.md)
2. [다음 세션 리마인더](./next-session-reminder.md)
3. [세션 부트 가이드](./session-boot.md)
4. [프로젝트 메모리](./project-memory.md)
5. [현재 컨텍스트](./active-context.md)
6. [결정 로그](./decision-log.md)
7. [개발자 입력 큐](./developer-input-queue.md)
8. [프로젝트 하네스](../project-harness/README.md)
9. [정책 하네스](../policy-harness/README.md)
10. [문서 하네스](../documentation-harness/README.md)

## 목적
- 새 세션에서 짧은 시간 안에 현재 프로젝트 상태를 파악합니다.
- 이전 세션의 핵심 결정을 빠르게 재구성합니다.
- 바로 다음 작업에 들어가기 전 필요한 사실과 제약을 확인합니다.

## 운영 규칙
- 장기적으로 유지되는 사실은 `project-memory.md`에 기록합니다.
- 최근 상태, 다음 작업, 확인이 필요한 항목은 `active-context.md`에 기록합니다.
- 중요한 구조 결정이나 방향 변경은 `decision-log.md`에 남깁니다.
- 새 세션 시작 시에는 항상 `session-boot.md`의 순서를 따릅니다.
- 새 세션 시작 시에는 항상 `session-start-alert.md`를 최우선으로 읽습니다.
- 사용자가 `세션종료`라고 말하면 그 세션의 미결 사항과 다음 세션 상기 사항을 `next-session-reminder.md`에 정리합니다.
- 정보 부족으로 막힌 항목은 `developer-input-queue.md`에 남겨 다음 세션에서 다시 묻습니다.
- 정책 문서 또는 `src/` 변경 작업은 항상 `policy:guard` 트리거와 함께 다룹니다.
- 문서가 길어지면 내용을 계속 누적하지 말고 `documentation-harness` 규칙에 따라 인덱스/세부 문서로 분리합니다.
