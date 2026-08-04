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

## 결정 로그 작성 관례 — 배너와 뒤집기 기록

소비자 실사용(score-print 2026-08-04)에서 "죽은 결정을 원문 삭제 없이 죽었다고 표시하는 배너"가 에이전트 오판을 반복적으로 막은 것이 확인되어, 아래를 공통 관례로 승격합니다. 배너는 기계 감지 계약이기도 하므로 표기를 정확히 지킵니다.

### 폐기/번복 배너
- 더 이상 유효하지 않은 결정은 항목을 **삭제하지 말고** 제목이나 첫 줄에 배너를 붙입니다: `⛔ 폐기됨(YYYY-MM-DD, 사유/대체 결정 포인터)` 또는 `⛔ 번복됨(YYYY-MM-DD, 어느 결정으로)`.
- **⛔ 이모지가 기계 감지의 판별자입니다.** 본문 서술에 "폐기했다", "번복됐다"라고 쓰는 것은 자유이며 감지되지 않습니다. 배너를 붙일 때만 ⛔를 사용하고, 배너가 아닌 곳에는 ⛔를 쓰지 않습니다.
- 논의가 끝나 더 볼 필요 없는 항목은 `[종결]`로 표시할 수 있습니다(감지 대상 아님, 아카이브 이동 후보 표시).
- guard 거동: 현행 `decision-log.md`의 **이번 변경 diff에 ⛔ 배너가 추가되면** 그 커밋을 "정책 번복 커밋"으로 보고, 같은 실행의 기준 동기화 검토 후보를 `확인 필수`로 승격해 상세를 펼칩니다(strict에서는 실패). 폐기 결정이야말로 연결 계약/기준 문서에 반대 서술이 남기 가장 쉬운 지점이기 때문입니다. 아카이브 파일로의 이동은 감지하지 않습니다(현행 파일만 스캔).

### 현행/이력 2계층 유지 (아카이브 분리)
- `decision-log.md`는 **현행 유효 결정**만 유지하는 파일입니다. 폐기/번복 배너가 붙었거나 `[종결]`된 항목, 규칙 문서로 승격이 끝나 포인터만 남은 항목, 더 이상 판단에 쓰이지 않는 오래된 이력은 `decision-log-YYYYH1.md`/`decision-log-YYYYH2.md` 같은 날짜 아카이브로 **항목 단위로** 옮깁니다.
- guard는 현행 파일이 **안내 임계 400줄**을 넘긴 상태에서 그 파일을 만진 커밋에만 분리를 안내합니다(비차단 — 매 커밋 반복 안내는 노이즈라 하지 않습니다).
- 아카이브 파일은 orphan/코드 경로 검사에서 자동 제외되고(역사 참조), 안의 마크다운 링크만 계속 검사됩니다. 현행 파일 상단에 아카이브 링크 목록을 두면 탐색이 쉬워집니다.
- 세션 재개 시에는 현행 파일만 읽고, 아카이브는 특정 결정의 배경이 필요할 때만 찾아 읽습니다.

### 권고 뒤집기 기록 (필수 필드)
- 감사·리뷰·검토가 **비권장/권고와 그 근거를 함께 제시**했는데 이를 뒤집어 채택할 때는, 결정 항목 제목에 `[권고 뒤집기]` 토큰을 붙이고 아래 필드를 남깁니다.
  - `뒤집은 권고:` 어떤 감사/리뷰가 무엇을 비권장했는가 (권장)
  - `근거 반박:` 그 비권장 **근거**가 왜 이 경우에 성립하지 않는가 — **필수.** "이번엔 괜찮을 것"은 반박이 아닙니다.
  - `잔여 위험:` / `재검토 조건:` 반박이 틀렸을 때의 피해 범위와 되돌릴 트리거 (권장)
- guard 거동: 이번 변경 diff에 `[권고 뒤집기]`가 추가됐는데 같은 diff에 `근거 반박:` 필드가 없으면 `확인 필수`로 보고하고 strict에서는 실패합니다.
- 한계: 뒤집기를 기록조차 하지 않으면 기계가 알 수 없습니다. 감사·리뷰의 비권장을 뒤집는 순간 이 항목을 남기는 것은 에이전트/개발자의 작업 규칙입니다(`session-start-alert.md`).
