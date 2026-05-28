# Workstream Chat Splitting Guide

긴 대화창에서 여러 업무가 섞여 에이전트의 현재 범위 인식이 흐려질 때 사용하는 선택형 운영 가이드입니다.

이 가이드는 모든 프로젝트에 강제하지 않습니다. 하나의 대화창으로 충분한 작은 프로젝트는 쓰지 않아도 됩니다. 장기 운영 프로젝트, 도메인이 많은 프로젝트, UI/도메인/데이터/인프라 작업이 자주 섞이는 프로젝트에서 opt-in으로 적용합니다.

## 목적

- 긴 대화창으로 인한 컨텍스트 비대화를 줄입니다.
- 업무 유형별 책임 범위를 명확히 합니다.
- 미완료 작업을 커밋 없이 다른 대화창으로 넘기는 방식을 표준화합니다.
- 사용자 완료 승인 전 검증, 커밋, 푸시 금지 원칙과 함께 동작합니다.

## 언제 분리할 것인가

아래 신호가 반복되면 workstream 분리를 검토합니다.

- 하나의 대화창에 기획, UI, 도메인 로직, 데이터, 배포, 버그픽스가 함께 쌓입니다.
- 에이전트가 현재 요청과 무관한 과거 논의를 계속 끌어옵니다.
- 작업이 느려지고 응답이 길어지며, 매번 읽어야 할 기준이 불명확해집니다.
- 특정 영역의 결정이 다른 영역 작업을 막는 선행 조건이 됩니다.
- 완료 전 추가 의견을 주려는 중인데 에이전트가 검증, 커밋, 푸시까지 진행하려고 합니다.

## Workstream 예시

프로젝트별로 이름과 개수는 다르게 정합니다. 아래는 강제 목록이 아니라 시작 예시입니다.

| workstream | 적합한 범위 |
| --- | --- |
| `harness-ops` | 하네스 설치, 업데이트, 훅, 기준 동기화 |
| `product-planning` | 요구사항, 범위, 사용자 플로우, 완료 조건 |
| `ui-experience` | 화면 구조, 컴포넌트, 스타일, 접근성 |
| `domain-logic` | 도메인 규칙, 계산, 상태 전이, 예외 |
| `data-integration` | API, DB, 외부 연동, 마이그레이션 |
| `quality-release` | 테스트 전략, 릴리스, 배포, 장애 대응 |

## 매 요청 시작 규칙

프로젝트가 session workstreams README를 만들어 workstream 운영을 opt-in 했다면, 에이전트는 매 요청 시작 시 아래를 먼저 판단합니다.

1. 현재 요청의 주 workstream은 무엇인가?
2. 다른 workstream의 선행 결정이 필요한가?
3. 이 대화창에서 처리 가능한 범위인가, 새 대화창으로 넘겨야 하는가?
4. 사용자가 명시한 완료 조건이 이 workstream 안에서 닫히는가?

현재 대화창에 역할이 있어도 선행 workstream이 있으면 바로 구현하지 않고 먼저 안내합니다.

```text
이 요청은 현재 창의 workstream과 맞지만, <선행 workstream>의 결정이 먼저 필요합니다.
커밋 없이 현재 diff를 유지한 채 새 창에서 아래 내용을 이어받는 것을 권장합니다.
```

## 창 이동 규칙

완료 승인 전 창 이동은 커밋 없이 진행합니다.

현재 창은 다음 정보를 임시 인수인계 문구로 남깁니다.

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

후속 창은 먼저 아래 순서로 이어받습니다.

```bash
git status --short
git diff
git diff --staged
```

`git diff --staged`는 staged 변경이 있을 때만 확인합니다. 후속 창은 사용자 변경을 되돌리지 않고 현재 diff를 사용자 소유 상태로 간주합니다.

## 완료 승인 규칙

사용자가 `완료`, `최종 검증`, `커밋`, `푸시`, `PR 생성`을 말해도 즉시 실행하지 않고 먼저 확인합니다.

1. 현재 workstream 안에서 닫을 수 있는가?
2. 후속 workstream 확인이 필요한가?
3. 수동 조치나 외부 콘솔 작업이 남았는가?
4. 문서화할 가치가 있는 결정, 규칙, 히스토리가 있는가?

후속 workstream 확인이 필요하면 검증과 커밋 전에 안내합니다.

```text
현재 workstream 기준 구현 후보는 닫혔습니다.
다만 <후속 workstream> 확인이 필요합니다.
최종 검증과 커밋은 후속 확인 뒤 진행하는 것을 권장합니다.
```

## 기록 기준

진행 중 창 이동은 원칙적으로 임시 복붙 문구로 처리합니다.

최종 완료 승인 뒤에만 남길 가치가 있는 내용을 문서화합니다.

| 내용 | 기록 위치 |
| --- | --- |
| 반복되는 도메인 규칙 | `.harness/project/domain-rules.md` |
| 반복되는 구조/경계 결정 | `.harness/project/architecture-rules.md` |
| 반복되는 검증/릴리스 절차 | `.harness/project/workflow-rules.md` |
| 중요한 선택 이유, 예외, 충돌 해결 | `.harness/session/decision-log.md` |
| 다음 세션에서 반드시 이어야 할 항목 | `.harness/session/next-session-reminder.md` |
| 외부 콘솔, secret, 권한, 배포 수동 조치 | `.harness/session/manual-actions.md` |

모든 진행 중 메모를 영구 문서로 승격하지 않습니다. 기준이 아닌 임시 상태는 대화창 인수인계 문구로 충분합니다.

## 새 Workstream 추가 기준

기존 workstream으로 처리하기 어려운 주제가 2회 이상 반복되면 새 workstream 추가를 검토합니다.

추가 전에 아래를 확인합니다.

- 기존 workstream 이름이나 범위를 조정하면 해결되는가?
- 새 workstream이 독립적인 완료 조건과 책임 범위를 갖는가?
- 다른 workstream과 선행/후행 관계를 설명할 수 있는가?
- 장기적으로 팀이 같은 구분을 이해할 수 있는가?

새 workstream을 추가하면 session workstreams README에 목적, 범위, 선행/후행 관계를 짧게 기록합니다.

## 하지 말아야 할 것

- 모든 프로젝트에 workstream을 강제하지 않습니다.
- 예시 workstream 목록을 프로젝트 표준으로 그대로 복사하지 않습니다.
- 진행 중 상태를 전부 영구 문서로 남기지 않습니다.
- 완료 승인 전 build/test/harness:check/commit/push를 실행하지 않습니다.
- workstream을 기준 우선순위 계층처럼 취급하지 않습니다. workstream은 세션 운영 레인입니다.

## 선택형 템플릿

복사용 예시는 아래에 있습니다.

- [workstreams README 템플릿](./templates/workstreams/README.md)
- [개별 workstream 템플릿](./templates/workstreams/workstream.md)

프로젝트에 적용하려면 직접 session workstreams directory를 만들고 필요한 템플릿만 복사합니다.

```bash
WORKSTREAM_DIR="<project-workstream-dir>"
mkdir -p "$WORKSTREAM_DIR"
cp .harness/documentation/templates/workstreams/README.md "$WORKSTREAM_DIR/README.md"
cp .harness/documentation/templates/workstreams/workstream.md "$WORKSTREAM_DIR/01-example.md"
```

## 향후 자동화 후보

아래는 1차 반영 범위가 아니라 향후 판단사항입니다.

- `harness:workstream:init`: 선택형 workstream 폴더와 예시 파일 생성
- `harness:workstream:status`: 현재 diff와 workstream 매칭 후보 출력
- `harness:handoff`와 연동해 active workstream과 후속 workstream 후보 표시
- `harness:context`에서 작업 설명을 기반으로 workstream 후보를 함께 추천
- Claude/Codex/Copilot 어댑터에서 workstream 존재 시 요청 시작 visible trace에 workstream 식별 결과 표시
