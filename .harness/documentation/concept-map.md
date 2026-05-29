# 개념 비교 맵

헷갈리기 쉬운 `Harness`, `Trigger`, `Hook`, `Skill`의 차이를 한 번에 보기 위한 문서입니다.

## 한눈에 비교

| 개념 | 핵심 역할 | 언제 쓰나 | 강제력 | 현재 저장소 예시 | 실제 위치 예시 |
| --- | --- | --- | --- | --- | --- |
| **Harness** | 방향, 읽기 순서, 운영 레일을 잡음 | 프로젝트/세션/기준/문서 체계를 만들 때 | 중간 | `session-harness`, `policy-harness`, `project-harness`, `documentation-harness` | `.harness/session/`, `.harness/policy/`, `.harness/project/`, `.harness/documentation/` |
| **Trigger** | 특정 상황에서 무엇을 다시 떠올릴지 알려줌 | 파일 변경, 새 세션 시작, 문서 확장, 기준 수정 시 | 강함 | `session-start-alert.md`, `sync-protocol.md` | `.harness/session/session-start-alert.md`, `.harness/policy/sync-protocol.md` |
| **Hook** | 실제 실행 시점에서 검사를 자동 실행하거나 통과를 막음 | push, PR, 배포, 로컬 실행 전 검증 | 가장 강함 | `npm run harness:check`, CI 검증 | `.harness/bin/`, `package.json`, CI 설정 |
| **Skill** | 요청 유형별로 읽을 문서, 실행 명령, 기록 위치를 좁힘 | 버그 수정, 기능 개발, 최종 검증, 커밋/푸시 최종화처럼 반복 절차가 있을 때 | 낮음 | `harness.commit-push-finalization`, `harness.precommit-verification` | `.harness/skills/registry.json` |

## 쉽게 비유하면

| 개념 | 비유 |
| --- | --- |
| **Harness** | 레일 |
| **Trigger** | 경고등 / 알림 |
| **Hook** | 출입문 잠금장치 |
| **Skill** | 숙련된 작업 기술 |

## 이 저장소에서는 어떻게 쓰는가

### 1. Harness
- 세션 시작 시 무엇을 읽어야 하는지 고정
- 개발 기준 문서와 소스의 관계를 구조화
- 프로젝트 목적/범위가 비어 있어도 재계획 지점을 남김
- 긴 문서를 인덱스와 하위 문서로 분리하는 기준 제공

### 2. Trigger
- 새 세션 시작 시 어떤 문서를 먼저 보고 무엇을 다시 물어봐야 하는지 상기
- `src/`, 기준 문서, 하네스 문서를 바꾸면 `harness:impact`와 `harness:check`를 떠올리게 함
- 문서가 길어질 때 분리 여부를 먼저 판단하게 함

### 3. Hook
- push / PR / merge 전 프로젝트 CI가 기준 검사를 자동 실행
- 로컬에서는 `npm run harness:check`가 기준 동기화 검사, 문서 검사, 적용된 프리셋 검사를 연속 실행

### 4. Skill
- 하네스 내부 스킬은 플랫폼별 slash command가 아니라 작업 판단 레지스트리입니다.
- `.harness/skills/registry.json`에서 요청 유형별 읽을 문서, 실행 명령, 산출물, 기록 위치를 정의합니다.
- 예를 들어 `커밋/푸시 최종화 흐름`은 `최종 검증만`, `커밋`, `커밋하고 푸시` 요청을 구분하고 hook 설치 시 수동 `harness:check` 중복 실행을 피하게 합니다.
- Claude slash command, Codex skill, Copilot command는 이 레지스트리를 호출하거나 참고하는 어댑터가 될 수 있습니다.

## 가장 중요한 판단 기준

새로운 운영 장치를 만들 때는 아래 순서로 생각합니다.

1. **Harness가 필요한가?**
   - 방향, 읽기 순서, 상태 기록 구조가 필요한가
2. **Trigger가 필요한가?**
   - 어떤 상황에서 이걸 반드시 다시 떠올려야 하는가
3. **Hook이 필요한가?**
   - 실제 실행 단계에서 자동으로 돌거나 막아야 하는가
4. **Skill로 해결할 문제인가?**
   - 방향 유지가 아니라 특정 작업의 전문 실행을 돕는가

## 강제 강도와 예외 범위는 어떻게 보나

| 축 | 값 |
| --- | --- |
| 강제 강도 | `inform`, `trigger`, `hook`, `block` |
| 예외 허용 범위 | `none`, `defer`, `waiver` |

- 이 판단은 `.harness/policy/enforcement-ladder.md`를 기준으로 합니다.
- 애매하면 추정하지 말고 사용자에게 확인합니다.

## 현재 저장소 기준 한 줄 정리

- 방향을 잡는 것은 **Harness**
- 잊지 않게 만드는 것은 **Trigger**
- 빠져나가지 못하게 막는 것은 **Hook**
- 잘 수행하게 돕는 것은 **Skill**
