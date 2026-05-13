# 스택 하네스 작성 가이드

이 문서는 새 스택 하네스를 만들 때의 기준입니다. API, 배치, 모바일, 라이브러리 패키지, 운영 도구처럼 실제 개발 스택은 달라질 수 있지만, 작성 방식은 같은 구조를 따릅니다.

## 언제 새 스택 하네스를 만드는가

새 스택 하네스는 특정 기술스택에서 반복되는 개발 기준을 여러 프로젝트에 공유해야 할 때 만듭니다.

| 상황 | 둘 곳 |
| --- | --- |
| 모든 프로젝트가 따라야 하는 AI 작업 흐름, 세션 복구, 문서 동기화, 검증 절차 | 일반 하네스 |
| 특정 스택에서 반복되는 구조, 명령, 검증 기준 | 스택 하네스 |
| 새 프로젝트의 초기 파일 묶음, 샘플 코드, 설정 파일 scaffold | 스택 템플릿 |
| 한 프로젝트의 도메인, 업무 예외, 운영 관례, 팀 고유 의사결정 | 프로젝트 로컬룰 |
| 개발자 개인의 선호나 개인 작업 방식 | 개인룰 |

스택 하네스에는 “이 스택으로 개발할 때 일반적으로 지켜야 하는 방법”만 넣습니다. 특정 프로젝트의 마이그레이션 사정, 임시 예외, 업무 도메인 용어, 고객사별 규칙은 프로젝트 로컬룰에 남깁니다.

## 작성 순서

1. 기준이 될 실제 프로젝트를 1개 이상 분석합니다.
2. 반복 패턴과 프로젝트 특수 사정을 분리합니다.
3. 스택 하네스가 다룰 범위를 정합니다.
4. `manifest.json`, `policies.json`, `instructions/`를 작성합니다.
5. 사용자-facing `init`을 만들어 일반 하네스를 설치한 뒤 자기 스택 기준을 적용합니다.
6. 호환성 검사로 맞지 않는 프로젝트에는 설치 전에 중단합니다.
7. 빈 프로젝트와 기존 프로젝트 양쪽에서 설치를 검증합니다.
8. tag를 만들고 소비 프로젝트에서는 `npx -y git+<repo>#<tag> init`으로 적용합니다.

## 실제 프로젝트에서 추출할 것

기준 프로젝트를 볼 때는 아래 항목을 먼저 확인합니다.

| 항목 | 확인할 내용 |
| --- | --- |
| 런타임 | Node, Java, Python, Go 등 실행 환경과 버전 범위 |
| 프레임워크 | 사용하는 런타임, 프레임워크, 주요 라이브러리 |
| 폴더 구조 | 진입점, application, domain, infrastructure, test가 나뉘는 방식 |
| 데이터 흐름 | 상태 관리, API 호출, transaction, validation, error 처리 |
| 검증 명령 | lint, typecheck, test, build, contract test, migration check |
| 설정 출처 | `.editorconfig`, ESLint, Prettier, tsconfig, framework config |
| CI 관례 | PR에서 반드시 돌리는 명령과 실패 처리 기준 |
| 문서 관례 | README, API 문서, ADR, 변경 기록을 남기는 방식 |

분석 결과가 한 프로젝트에만 해당하면 바로 스택 기준으로 올리지 않습니다. 같은 스택의 다른 프로젝트에도 적용 가능한지 확인하거나 “로컬룰 후보”로 남깁니다.

## 포함하지 말아야 할 것

- 회사 전체 AI 작업 원칙
- 특정 프로젝트의 업무 도메인 규칙
- 고객사명, 내부 계정, 비밀 URL, 토큰, 실서비스 데이터
- 마이그레이션 중에만 필요한 임시 우회
- 프로젝트 scaffold 전체 파일 묶음
- 개발자 개인 취향만 반영한 규칙

scaffold가 필요하면 스택 하네스에 억지로 넣지 말고 `ai-standard/stacks` 하위 템플릿 저장소로 분리합니다. 스택 하네스는 기준과 설치 흐름을 맡고, 템플릿은 초기 파일 생성을 맡습니다.

## 권장 저장소 구조

```text
my-stack-harness/
  package.json
  manifest.json
  policies.json
  README.md
  scripts/
    init.mjs
    check.mjs
    test-init.mjs
  instructions/
    architecture.md
    workflow.md
    validation.md
```

scaffold를 함께 제공해야 하는 특수한 경우에만 아래를 추가합니다.

```text
  scaffold/
    package.merge.json
    ...
```

스택 기준만 제공한다면 `manifest.json`의 `source.type`은 `none`으로 둡니다.

## `manifest.json` 계약

`manifest.json`은 일반 하네스가 스택 기준을 읽는 계약입니다.

```json
{
  "id": "backend-api-node",
  "title": "Backend API Node",
  "stackHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/backend-api-node.git",
    "ref": "v1.0.0",
    "range": "^1.0.0"
  },
  "baseHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git",
    "ref": "v0.2.18",
    "minVersion": "0.2.18"
  },
  "compatibility": {
    "allowEmptyProject": true,
    "expected": [
      { "package": "fastify", "major": 4, "label": "Fastify 4" }
    ],
    "incompatible": [
      { "package": "other-runtime", "label": "Other runtime project" },
      { "package": "other-framework", "label": "Other framework project" }
    ]
  },
  "instructions": [
    "instructions/architecture.md",
    "instructions/workflow.md",
    "instructions/validation.md"
  ],
  "policiesFile": "policies.json",
  "checksKey": "backend-api-node",
  "source": {
    "type": "none"
  }
}
```

필수 의미는 다음과 같습니다.

| 필드 | 역할 |
| --- | --- |
| `id` | 적용 프로젝트에 기록될 스택 식별자 |
| `title` | 사람이 읽는 스택 이름 |
| `stackHarness` | 이 스택 하네스 자신의 repo, ref, 업데이트 범위 |
| `baseHarness` | 내부적으로 설치할 일반 하네스 버전 |
| `compatibility` | 기존 프로젝트와 맞는지 설치 전 확인할 기준 |
| `instructions` | 프로젝트 로컬룰로 정착될 스택 기준 문서 |
| `policiesFile` | 스택 기준 검사에 노출할 정책 목록 |
| `checksKey` | 스택 전용 검사 식별자. 구현 전이면 `null` 가능 |
| `source` | scaffold 적용 방식. 기준만 있으면 `none` |

## instruction 문서에 쓸 내용

instruction은 에이전트와 개발자가 실제 작업 중 읽는 문서입니다. “좋은 코드 작성”처럼 추상적인 문장보다 이 스택에서 판단을 좁혀주는 기준을 적습니다.

백엔드 API 하네스라면 예를 들어 아래 항목이 의미 있습니다.

| 문서 | 예시 내용 |
| --- | --- |
| `architecture.md` | entrypoint, application, domain, infrastructure의 책임 경계 |
| `workflow.md` | API 추가, DB 변경, 배포 전 검증, 에러 재현 절차 |
| `validation.md` | request schema, response contract, error format, auth guard, transaction 검증 |
| `testing.md` | unit, integration, contract test를 언제 요구하는지 |
| `observability.md` | log field, trace id, metric, alert에 남길 최소 정보 |

다른 스택에서는 해당 스택의 진입점, 상태/데이터 흐름, 외부 연동, 배포 전 검증 기준을 같은 방식으로 분리해 기록합니다.

## `policies.json` 작성 기준

`policies.json`은 instruction을 검증 가능한 항목으로 요약합니다.

```json
{
  "policies": [
    {
      "id": "api-boundary",
      "title": "API Boundary",
      "summary": "Route handler는 요청 파싱과 응답 매핑을 맡고, 업무 판단은 service 계층에 둔다.",
      "severity": "warning",
      "evidence": [
        "instructions/architecture.md"
      ]
    }
  ]
}
```

정책은 너무 많이 만들지 않습니다. 처음에는 실제 리뷰에서 반복적으로 지적되는 5개에서 10개 정도를 시작점으로 두고, 작업 중 반복되는 문제를 근거로 늘립니다.

## `init`이 해야 할 일

스택 하네스의 `init`은 일반 프로젝트 개발자가 실행하는 진입점입니다.

```bash
npx -y git+<stack-harness-repo-url>#v1.0.0 init
```

권장 동작 순서는 다음과 같습니다.

1. 현재 프로젝트의 `package.json`과 기존 `.harness/harness-lock.json`을 읽습니다.
2. 선택한 스택과 맞지 않으면 설치 전에 중단합니다.
3. 조회 가능한 후보 중 더 맞는 스택 하네스가 있으면 추천 명령을 보여줍니다.
4. `baseHarness`의 일반 하네스를 설치하거나 업데이트합니다.
5. `npm run stack:apply -- --preset-path <self>`로 자기 `manifest.json`을 적용합니다.
6. `.harness/harness-lock.json`에 일반/스택 하네스 버전을 남깁니다.
7. 기본적으로 `npm run harness:doctor`와 `npm run harness:check`를 실행합니다.

호환성 검사에 실패했는데 일부 파일을 이미 썼다면 원복해야 합니다. 가장 좋은 방식은 일반 하네스 설치 전에 호환성 검사를 끝내는 것입니다.

## 호환성 검사 기준

설치 중단 기준은 보수적으로 잡습니다.

| 감지 결과 | 권장 동작 |
| --- | --- |
| 빈 프로젝트 | `allowEmptyProject=true`이면 진행 |
| 기대 package와 major가 맞음 | 진행 |
| 기대 package는 있지만 major가 다름 | 중단하고 이유 출력 |
| 명확히 다른 스택 package가 있음 | 중단하고 후보 추천 |
| 이미 다른 스택 하네스가 lock에 있음 | 중단하고 명시적 전환 절차 요구 |
| package 정보가 불충분함 | 중단보다 확인 질문 또는 `--dry-run` 안내 |

불일치 설치가 꼭 필요한 마이그레이션 작업은 `--allow-mismatch`처럼 명시 옵션으로만 허용합니다. 일반 설치 흐름에서 조용히 덮어쓰면 안 됩니다.

## 검증 체크리스트

릴리스 전에는 최소한 아래를 확인합니다.

- 빈 폴더에 `npx ... init`을 실행해 성공하는가
- 호환되는 기존 프로젝트에 설치하면 기존 로컬룰과 설정을 보존하는가
- 맞지 않는 프로젝트에서는 설치 전에 중단하는가
- 설치 후 `.harness/project/stack-preset-rules.md`에 instruction이 들어가는가
- `.harness/harness-lock.json`에 `baseHarness`와 `stackHarness`가 모두 기록되는가
- `npm run harness:doctor`가 스택과 충돌 후보를 리포트하는가
- `npm run harness:check`가 통과하는가
- `npm run harness:update -- --dry-run`으로 업데이트 대상이 추적되는가
- `npm pack --dry-run`에 필요한 파일만 포함되는가

## 버전 운영

스택 하네스는 SemVer tag로 배포합니다.

| 변경 | 버전 |
| --- | --- |
| 오탈자, 설명 보강, 검사 메시지 개선 | patch |
| 새 instruction, 새 검사, 호환성 확장 | minor |
| 기존 프로젝트의 판단 기준을 바꾸거나 중단 조건을 강화 | major |

소비 프로젝트는 `harness:update`로 같은 major 범위의 최신 patch/minor를 받을 수 있습니다. major 변경은 자동으로 올리지 말고 변경 의도를 확인한 뒤 적용합니다.

## 백엔드 API 하네스 예시 범위

백엔드 API 스택 하네스를 만든다면 다음 정도를 공통화할 수 있습니다.

- entrypoint, application, domain, infrastructure 책임 경계
- request validation과 response schema 위치
- 공통 error response 형식
- auth, permission, tenant context 처리 위치
- transaction과 외부 API 호출 경계
- DB migration 작성과 rollback 확인 흐름
- unit, integration, contract test 기준
- log, trace id, metric의 최소 기록 항목
- API 문서 또는 OpenAPI 갱신 기준

반대로 특정 서비스의 주문 상태, 회원 등급, 정산 정책, 레거시 이전 일정은 스택 하네스가 아니라 프로젝트 로컬룰에 둡니다.
