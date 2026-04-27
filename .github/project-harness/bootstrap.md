# Project Bootstrap

> **이 문서는 사람이 읽는 매뉴얼이 아니라 AI 코딩 에이전트(Copilot/Claude/Cursor 등)가 따라 실행하는 절차서입니다.**
> 사용자가 "프로젝트 부트스트랩 인터뷰 시작해줘" 또는 "새 프로젝트 시작" 의사를 표현하면 에이전트가 이 문서의 1~4단계를 순서대로 사용자에게 묻고, 답변을 받는 즉시 해당 산출물(`project-charter.md`, `profile.json` 등)을 갱신합니다.

이 저장소를 새 프로젝트의 시작점으로 사용할 때 따르는 표준 인터뷰입니다.

## 목적
- 일반 하네스(세션·정책·문서·스타일 동기화 인프라)는 그대로 두고, 프로젝트마다 달라지는 부분(목적, 사용자, 성공 기준, 기술 스택 선택)을 한 자리에서 입력받습니다.
- 입력 결과는 `project-charter.md`, `scope-contract.md`, `.github/policy-harness/profile.json`에 분산 저장됩니다.

## 인터뷰 순서

### 1. 프로젝트 개요 (필수)
다음 항목을 사용자에게 묻습니다. 답이 없으면 `TBD`로 두지 않고 "지금 답하기"/"이번 세션은 유보"/"다음 세션에서 다시 질문"을 선택지로 제공합니다.

1. 해결하려는 문제는 무엇인가?
2. 주요 사용자(또는 대상)는 누구인가?
3. 왜 지금 필요한가?
4. 핵심 목표 (최대 3개)
5. 비목표 (의도적으로 하지 않을 것, 최대 3개)
6. 성공 기준 (기능/운영/품질 각각)
7. 알려진 제약 (제품/기술/일정)

답이 들어오는 즉시 `.github/project-harness/project-charter.md`를 갱신합니다. 보류 항목은 `.github/session-harness/developer-input-queue.md`에 등록합니다.

### 2. 기술 스택 선택 (필수)
사용 가능한 스택 프리셋을 보여주고 하나를 선택받습니다. 목록 출처는 `.github/stacks/README.md`입니다.

질문 예시:
> 사용할 스택 프리셋을 골라주세요.
> - `vue3-fsd` — Vue 3 + Pinia + Vite + TypeScript / FSD + Clean Architecture + Headless Core + Adapter
> - `none` — 어떤 프리셋도 적용하지 않음 (일반 하네스만 사용)

선택 결과는 `.github/policy-harness/profile.json`의 `activeStack`에 기록합니다. 기본값 변경 시 `decision-log.md`에 사유를 한 줄 남깁니다.

### 3. 스택 호환성 검증 및 적용
선택된 스택이 동작 가능한 상태인지 다음으로 결정합니다.

```bash
npm run stack:status            # 현재 적용 상태 확인
npm run stack:apply             # scaffold 복사 + package.json 머지 + .stack-applied.json 기록
npm install
npm run guard
```

- 스택 미적용 상태에서도 `npm run guard`는 일반 인프라 검사(policy + docs)만 실행하고 lint/test/build는 건너뜁니다.
- 스택을 바꾸고 싶으면 `npm run stack:reset` 으로 먼저 적용을 되돌린 뒤 `activeStack`을 바꾸고 다시 `stack:apply`를 실행합니다.
- `"none"`으로 두면 스택 적용 없이 일반 하네스만 운영됩니다.

### 4. 첫 도메인 항목 정착 (선택)
프로젝트 개요가 채워졌고 스택이 정해졌다면 다음을 이어서 묻습니다.

- 첫 feature 후보
- 첫 use-case
- 외부 API 또는 데이터 소스
- 초기 MVP 범위

이 답들은 `project-charter.md`의 "첫 도메인 정의가 들어오면 바로 채워야 할 항목" 섹션에 들어갑니다.

## 인터뷰가 끝난 뒤
1. `npm run guard` 1회 실행해 일반 인프라 + 스택 정책이 모두 통과하는지 확인합니다.
2. `active-context.md`에 "프로젝트 개요 입력 완료, 스택=`<id>`" 한 줄을 남깁니다.
3. 작업 시작 시 `session-boot.md` 순서로 복귀합니다.

## 인터뷰를 건너뛰어도 되는 경우
- 이미 `project-charter.md`의 1~5절에 `TBD`가 없고 `profile.json`의 `activeStack`이 설정되어 있으면 인터뷰는 생략합니다.
- 단, 사용자가 "프로젝트 방향이 바뀌었다" 고 명시하면 다시 인터뷰를 시작합니다.
