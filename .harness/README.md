# Harness Files

`.harness/`는 공통 기준, 프로젝트 로컬룰, 세션 기록, 검증 설정을 담는 하네스 본체입니다.

처음 보는 개발자는 모든 파일을 직접 수정하려고 하지 말고, 아래 구분을 먼저 봅니다.

전체 문서를 훑기보다 먼저 클릭형 가이드와 현재 상태 대시보드를 엽니다.

```bash
npm run harness:guide
```

출력된 `file://` 주소를 브라우저에서 열면 요구 수신, 기준 탐색, 영향 판단, 구현, 검토, 검증, 커밋 확정 단계별로 관련 명령과 파일만 좁혀 볼 수 있습니다.

## 자주 직접 수정하는 문서

| 파일 | 언제 수정하나 |
| --- | --- |
| `.harness/project/project-charter.md` | 프로젝트 상태, 책임 범위, 성공 기준이 바뀔 때 |
| `.harness/project/scope-contract.md` | 이 저장소가 다루는 범위와 제외 범위가 바뀔 때 |
| `.harness/project/domain-rules.md` | 업무 용어, 불변식, 외부 시스템 계약이 드러날 때 |
| `.harness/project/architecture-rules.md` | 모듈 경계, 의존 방향, 반복 구조 규칙이 생길 때 |
| `.harness/project/workflow-rules.md` | 검증 명령, 리뷰 기준, 릴리스/장애 대응 흐름이 바뀔 때 |
| `.harness/session/decision-log.md` | 기준 충돌, 예외, 아키텍처 선택의 이유를 남길 때 |
| `.harness/session/active-context.md` | 현재 세션의 진행 상태와 다음 작업을 남길 때 |
| `.harness/session/developer-input-queue.md` | 확인이 필요한 질문을 보류하거나 해소할 때 |

## 자동 생성 또는 하네스 관리 파일

| 파일 | 의미 |
| --- | --- |
| `.harness/install-manifest.json` | 공통 하네스가 설치/갱신한 파일 목록과 해시 |
| `.harness/harness-lock.json` | 설치된 공통 하네스와 스택 하네스 버전 |
| `.harness/.stack-applied.json` | 적용된 스택 기준과 복사된 파일 기록 |
| `.harness/stacks/.applied/**` | 적용된 스택 기준의 스냅샷 |
| `.harness/generated/**` | `harness:sync`가 만든 프로젝트 맵, import 맵, 패턴 후보 |
| `.harness/generated/harness-dashboard.html` | `harness:guide`가 만든 현재 상태 대시보드 |
| `.harness/generated/agent-events.ndjson` | Claude Code 어댑터가 redaction 후 capped 기록하는 최근 tool 실패/권한 거부 이벤트 |
| `.harness/session/project-scan-report.md` | `harness:scan`이 생성한 현재 프로젝트 스캔 리포트 |
| `.harness/session/handoff.md` | `harness:handoff`가 생성한 설치/업데이트 인수인계 요약 |
| `.harness/session/task-context.md` | `harness:context`가 생성한 에이전트 판단 컨텍스트 |

자동 생성 파일은 직접 고치기보다 관련 명령을 다시 실행합니다.

## 항상 읽는 최소 기준

1. `../CLAUDE.md`
2. `.harness/policy/ai-standard-guiding-policy.md`
3. `.harness/session/session-start-alert.md`
4. `.harness/session/active-context.md`

## 필요할 때 추가로 볼 문서

- 세션 재개: `.harness/session/project-memory.md`, `.harness/session/decision-log.md`, `.harness/session/developer-input-queue.md`
- 프로젝트 기준 확인: `.harness/project/README.md`, `.harness/project/*.md`
- 스택/템플릿 기준 확인: `.harness/stacks/README.md`, `.harness/project/stack-preset-rules.md`, `.harness/project/template-contract.md`

## 컨텍스트 합성

큰 작업이나 낯선 영역을 다룰 때 에이전트는 모든 문서를 한 번에 읽기보다 작업별 판단 컨텍스트를 합성합니다. 개발자가 업무 지시 때마다 직접 실행할 필요는 없습니다.

```bash
npm run harness:sync
npm run harness:context -- "수정하거나 분석할 작업 설명"
```

`harness:sync`는 `.harness/generated/**`를 재생성하고, `harness:context`는 `.harness/session/task-context.md`에 작업 유형, 관련 기준, 충돌 우선순위, 영향 후보, 검증 요구사항을 남깁니다. 두 산출물은 원본 문서와 실제 코드를 대신하지 않습니다.
