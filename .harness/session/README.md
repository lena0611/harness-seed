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
8. [수동 조치 목록](./manual-actions.md)
9. [프로젝트 하네스](../project/README.md)
10. [프로젝트 시작 인터뷰 (Bootstrap)](../project/bootstrap.md)
11. [정책 하네스](../policy/README.md)
12. [컨텍스트 합성 프로토콜](../policy/context-protocol.md)
13. [하네스 스킬](../skills/README.md)
14. [문서 하네스](../documentation/README.md)
15. [스택 프리셋 목록](../stacks/README.md)

## 목적
- 새 세션에서 짧은 시간 안에 현재 프로젝트 상태를 파악합니다.
- 이전 세션의 핵심 결정을 빠르게 재구성합니다.
- 바로 다음 작업에 들어가기 전 필요한 사실과 제약을 확인합니다.

## 본체와 소비자 프로젝트 구분
- 하네스 본체 저장소의 `decision-log.md`, `active-context.md`, `project-memory.md`는 본체 개발을 위한 세션 기록입니다.
- 소비자 프로젝트에 설치할 때는 본체 세션 기록을 그대로 복사하지 않고, 소비자 프로젝트용 초기 템플릿을 생성합니다.
- 소비자 프로젝트의 `decision-log.md`는 하네스 릴리스 노트가 아니라 해당 프로젝트의 기준 충돌, 예외, 아키텍처 선택 이유를 남기는 문서입니다.
- 하네스 본체 변경 이력은 본체 저장소의 `CHANGELOG.md`와 릴리스 태그를 기준으로 확인합니다.

## 명시적 세션 명령

Claude Code에서는 아래 slash command를 사용합니다. Codex와 Copilot은 같은 명령을 강제 실행하지 못하므로 대상 파일을 직접 읽고 갱신합니다.

| 명령 | 대상 파일 | 목적 |
| --- | --- | --- |
| `/reminder` | `.harness/session/next-session-reminder.md` | 다음 세션에서 반드시 떠올릴 항목 정리 |
| `/memory` | `.harness/session/project-memory.md` | 오래 유지되는 프로젝트 사실 기록 |
| `/decision` | `.harness/session/decision-log.md` | 구조 결정, 예외, 충돌 해결 이유 기록 |
| `/harness-scan` | `.harness/session/project-scan-report.md` | 현재 프로젝트 스캔과 로컬 기준 후보 정리 |
| `/하네스업데이트` | `.harness/harness-lock.json`, `.harness/session/decision-log.md` | 공통/스택 하네스 업데이트 후보를 확인하고 안전한 업데이트 명령 선택 |
| `/운영업무` | .harness/maintenance/work-history/연도별 폴더 | JIRA 운영 업무를 접수하고 업무 유형별 흐름으로 연결 |
| `/업무요약` | .harness/maintenance/work-history/연도별 폴더 | 완료 후보를 사용자가 승인한 운영 업무의 요청, 변경, 검증, TODO 기록 |

Claude Code는 `SessionStart` hook으로 `next-session-reminder.md`를 자동 표시합니다. 다른 에이전트는 `CLAUDE.md`와 이 README의 읽기 순서를 통해 같은 기준을 따라야 합니다.

## 운영 규칙
- 장기적으로 유지되는 사실은 `project-memory.md`에 기록합니다.
- 최근 상태, 다음 작업, 확인이 필요한 항목은 `active-context.md`에 기록합니다.
- `active-context.md`는 프로젝트 고정 사실, 최신 작업 상태, 핸드오프만 짧게 남깁니다. 운영 규칙 본문은 복사하지 말고 `workflow-rules.md`, `commit-push-rules.md`, `CLAUDE.md` 같은 권위 문서를 단일 출처로 가리킵니다.
- `next-session-reminder.md`는 다음 세션 부트스트랩 체크리스트와 미결 항목만 남깁니다. `project/*` 규칙 본문을 붙여 넣지 말고 포인터로 축약합니다.
- 중요한 구조 결정이나 방향 변경은 `decision-log.md`에 남깁니다.
- 에이전트가 직접 처리할 수 없는 외부 콘솔, secret, capability, Pages/배포 설정은 `manual-actions.md`에 남깁니다.
- 큰 작업이나 생소한 영역은 `harness:sync`로 생성 컨텍스트를 최신화하고 `harness:context`로 에이전트 판단 컨텍스트를 만듭니다.
- `harness:context`의 Selected Skills는 작업별 읽을거리, 실행 명령, 기록 위치를 좁히는 기준으로 사용합니다.
- 설치/업데이트 직후 개발자에게 넘길 요약은 `harness:handoff`로 다시 생성합니다.
- 실제 업무 진행 보고에서 보이는 사고 흐름은 원시 내부 추론이 아니라 visible trace 단계와 판단 결과로 정리합니다. 단순 질문, 잡담, 메타 확인에는 trace 형식을 강요하지 않습니다.
- 긴 대화창 때문에 작업 범위가 흐려지면 [Workstream 대화창 분리 가이드](../documentation/workstream-chat-splitting-guide.md)를 참고합니다. 프로젝트가 session workstreams README를 만들어 opt-in 한 경우에만 매 요청 시작 시 현재 workstream을 식별합니다.
- 새 세션 시작 시에는 항상 `session-boot.md`의 순서를 따릅니다.
- 새 세션 시작 시에는 항상 `session-start-alert.md`를 최우선으로 읽습니다.
- 사용자가 `세션종료`라고 말하면 그 세션의 미결 사항과 다음 세션 상기 사항을 `next-session-reminder.md`에 정리합니다.
- 정보 부족으로 막힌 항목은 `developer-input-queue.md`에 남겨 다음 세션에서 다시 묻습니다.
- 정책 문서 또는 `src/` 변경 작업은 시작 전 `harness:impact`, 사용자 최종화 승인 후 `harness:check` 흐름으로 다룹니다.
- 문서가 길어지면 내용을 계속 누적하지 말고 `documentation` 하네스 규칙에 따라 인덱스/세부 문서로 분리합니다.

## 기억 표면 정리

매 세션 또는 재개 시 로드되는 `active-context.md`, `next-session-reminder.md`, `project-memory.md`, `decision-log.md`, `developer-input-queue.md`, `MEMORY.md`류 인덱스는 부트스트랩, 핸드오프, 현재 유효 항목만 유지합니다. 규칙 본문은 `.harness/project/*` 단일 출처로 보내고, 오래된 이력은 날짜별 아카이브나 thread handoff 스냅샷으로 분리합니다. `answered`/`obsolete` 큐 항목과 supersede된 결정/기억은 현재 파일에 상주시키지 않습니다.
