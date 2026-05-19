# Policy Harness

여기서 policy는 회사 규정이 아니라, 프로젝트가 반복적으로 지키기로 한 **개발 기준**을 뜻합니다.

이 하네스는 개발 기준 문서와 실제 소스 코드를 항상 동기화하기 위한 영역입니다.

## 목적
- 개발 기준 문서가 바뀌면 어떤 코드 영역을 재검토해야 하는지 자동으로 드러냅니다.
- 소스가 바뀌면 어떤 기준을 다시 확인해야 하는지 역으로 드러냅니다.
- 자동으로 검증 가능한 위반은 CI에서 실패 처리합니다.
- 새 세션에서도 이 트리거를 놓치지 않도록 세션 하네스와 연결합니다.

## 읽기 순서
1. [AI Standard Guiding Policy](./ai-standard-guiding-policy.md)
2. [기준 담당 가이드](./policy-steward.md)
3. [Policy DB Readiness](./policy-db-readiness.md)
4. [컨텍스트 합성 프로토콜](./context-protocol.md)
5. [동기화 프로토콜](./sync-protocol.md)
6. [강제 강도 기준](./enforcement-ladder.md)
7. [자동화 커버리지](./automation-coverage.md)
8. [Waiver 가이드](./waiver-guidelines.md)
9. `policy-registry.json`
10. `waivers.json`

## 실행 명령
일반 설치 프로젝트는 아래 공개 명령을 먼저 사용합니다.

```bash
npm run harness:scan
npm run harness:handoff
npm run harness:impact
npm run harness:check
```

아래 명령은 하네스 본체 저장소에서 세부 원인 분석이나 CI 검증이 필요할 때 사용하는 내부 개발 명령입니다. `harness:sync`와 `harness:context`는 소비자 프로젝트에도 제공되지만, 일반 개발자가 업무 지시 때마다 직접 실행하는 명령이 아니라 에이전트가 큰 작업 전에 판단 컨텍스트를 만들 때 사용하는 보조 명령입니다.

```bash
npm run policy:impact
npm run policy:check
npm run policy:guard
npm run policy:guard:strict
npm run harness:sync
npm run harness:context -- "작업 설명"
npm run docs:check
```

## 검증 명령 구분

| 검증 | 본체 개발 | 소비자 프로젝트 | 역할 |
| --- | --- | --- | --- |
| `npm run harness:check` | 사용 | 사용 | 표준 통합 검사입니다. |
| `npm run harness:impact` | 사용 | 사용 | 변경 파일과 기준의 연결을 확인합니다. |
| `npm run harness:scan` | 사용 | 사용 | 프로젝트 구조와 기준 후보를 스캔합니다. |
| `npm run harness:handoff` | 사용 | 사용 | 설치/업데이트 후 확인할 일과 현재 상태를 요약합니다. |
| `npm run hooks:install` | 사용 | 사용 | commit/push 전 `harness:check` 자동 실행을 연결합니다. |
| `npm run policy:check` | 주로 사용 | 기본 script 아님 | 정책 레지스트리 자체를 직접 검사합니다. |
| `npm run docs:check:strict` | 사용 | 기본 script 아님 | 하네스 문서 레지스트리와 링크를 엄격히 검사합니다. |
| `node scripts/test-init.mjs` | 사용 | 사용 안 함 | 설치기 smoke test입니다. |
| `npm pack --dry-run` | 사용 | 사용 안 함 | 패키지 배포물 구성을 확인합니다. |
| downstream `check` / `test:init` / `test` | 스택/CLI 본체 개발 | 사용 안 함 | 스택 하네스와 CLI 저장소 자체를 검증합니다. |

## 구성 요소
- `policy-registry.json`: 개발 기준 문서와 코드 영역의 연결 정보. v3부터 DB화 전 필수 메타데이터를 포함합니다.
- `policy-db-readiness.md`: 정책을 DB로 옮기기 전 원자 정책 단위, 필수 필드, weak point 기준
- `ai-standard-guiding-policy.md`: `ai-standard` 그룹 전체 작업의 최상위 판단 기준
- `context-protocol.md`: 항상 읽는 기준, 에이전트 판단 컨텍스트, 생성 산출물, 실행 도구의 분리 원칙
- `profile.json`: 활성 프리셋과 프로젝트 모드 프로파일 (`activeStack`, `harnessMode`, 외부 프리셋 manifest)
- `enforcement-ladder.md`: 강제 강도와 예외 허용 범위 기준
- `automation-coverage.md`: 자동 검증/수동 검토 범위
- `waivers.json`: 승인된 예외 기록
- `.harness/bin/policy-harness.mjs`: 영향 분석 및 위반 검사 (`--strict`로 SYNC GAP을 실패로 취급)
- `.harness/bin/sync-context.mjs`: 프로젝트 맵, import 맵, 패턴 후보를 `.harness/generated/**`로 재생성
- `.harness/bin/build-context.mjs`: 작업 설명을 기준으로 `.harness/session/task-context.md`에 Agent Decision Context 생성
- `.harness/bin/doc-link-check.mjs`: 문서 레지스트리 일관성과 마크다운 링크/코드 경로 참조 검증
- CI 설정: 푸시/PR 시 `npm run harness:check:strict` 실행

## 운영 원칙
- 개발 기준 변경은 문서 수정으로 끝내지 않습니다. 영향을 받는 코드 영역을 반드시 다시 봅니다.
- 소스 변경은 기능 수정으로 끝내지 않습니다. 관련 기준 위반이 없는지 반드시 다시 봅니다.
- 새 세션은 작업 시작 전에 세션 하네스와 policy 하네스를 함께 읽습니다.
- 에이전트 판단 컨텍스트는 원본 문서와 실제 코드를 대신하지 않는 보조 산출물입니다.
- 이 문서는 인덱스 역할을 유지하고, 세부 기준은 하위 문서로 계속 분리합니다.
