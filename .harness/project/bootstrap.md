# Project Bootstrap

> **이 문서는 사람이 읽는 매뉴얼이 아니라 AI 코딩 에이전트(Copilot/Claude/Cursor 등)가 따라 실행하는 절차서입니다.**
> 사용자가 "프로젝트 부트스트랩 인터뷰 시작해줘" 또는 "새 프로젝트 시작" 의사를 표현하면 에이전트가 이 문서의 1~4단계를 순서대로 사용자에게 묻고, 답변을 받는 즉시 해당 산출물(`project-charter.md`, `profile.json` 등)을 갱신합니다.

이 저장소를 새 프로젝트의 시작점으로 사용할 때 따르는 표준 인터뷰입니다.

## 목적
- 일반 하네스(세션·기준·문서·스타일 동기화 인프라)는 그대로 두고, 프로젝트마다 달라지는 부분(목적, 사용자, 성공 기준, 기술 스택 선택)을 한 자리에서 입력받습니다.
- 입력 결과는 `project-charter.md`, `scope-contract.md`, `.harness/policy/profile.json`에 분산 저장됩니다.

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

답이 들어오는 즉시 `.harness/project/project-charter.md`를 갱신합니다. 보류 항목은 `.harness/session/developer-input-queue.md`에 등록합니다.

### 2. 스택 하네스 선택 (필수)
사용 가능한 스택 하네스 또는 scaffold 템플릿 후보를 보여주고 하나를 선택받습니다. 목록 출처는 `.harness/stacks/README.md`입니다.

질문 예시:
> 사용할 스택 하네스를 골라주세요.
> - 사내 스택 하네스 — `npm run standards:list`로 `ai-standard/harnesses`의 스택 하네스 패키지 조회
> - scaffold 템플릿 — `npm run templates:list`로 후보를 조회한 뒤 선택
> - 로컬 스택 자산 — 별도 폴더의 `manifest.json` 경로를 `stackManifest`에 기록
> - `none` — 예외적으로 공통 기준만 운영. 사유를 `decision-log.md`에 기록

선택 결과는 `.harness/policy/profile.json`의 `activeStack`에 기록합니다. 외부 스택 자산이면 `stackManifest`도 함께 기록합니다. `none`을 유지하면 왜 스택 기준을 선택하지 않았는지 `decision-log.md`에 사유를 한 줄 남깁니다.

### 3. 스택 호환성 검증 및 적용
선택된 스택이 동작 가능한 상태인지 다음으로 결정합니다.

```bash
npm run stack:status            # 현재 적용 상태 확인
npm run standards:list          # 사내 스택 하네스 후보 조회
npm run stack:apply             # 스택 기준 로컬룰 적용, scaffold가 있으면 파일 복사와 package.json 머지
npm install
npm run harness:check
```

- 스택 미적용 상태에서도 `npm run harness:check`는 일반 인프라 검사(기준 동기화 + 문서)만 실행하고 lint/test/build는 건너뜁니다.
- 일반 프로젝트 개발자에게는 스택 하네스의 `npx ... init` 흐름을 우선 안내합니다. 위 `stack:apply` 흐름은 이미 일반 하네스가 설치된 관리자/고급 흐름입니다.
- `source.type=none`인 스택 기준은 파일 복사 없이 `.harness/project/stack-preset-rules.md`만 갱신합니다.
- 스택을 바꾸고 싶으면 `npm run stack:reset` 으로 먼저 적용을 되돌린 뒤 `activeStack`을 바꾸고 다시 `stack:apply`를 실행합니다.
- 원격 프리셋을 적용하려면 `npm run stack:apply -- --preset-git <repo-url> --ref <tag-or-branch>`를 사용합니다.
- 외부 프리셋을 일회성으로 적용하려면 `npm run stack:apply -- --preset-path <preset-dir>`를 사용합니다.
- `"none"`으로 두면 스택 적용 없이 일반 하네스만 운영됩니다. 이 상태는 예외 또는 전환 중 상태로 보고 `harness:doctor`의 충돌 후보를 확인합니다.

### 4. 첫 도메인 항목 정착 (선택)
프로젝트 개요가 채워졌고 스택이 정해졌다면 다음을 이어서 묻습니다.

- 첫 feature 후보
- 첫 use-case
- 외부 API 또는 데이터 소스
- 초기 MVP 범위

이 답들은 `project-charter.md`의 "첫 도메인 정의가 들어오면 바로 채워야 할 항목" 섹션에 들어갑니다.

## 인터뷰가 끝난 뒤
1. `npm run harness:check` 1회 실행해 일반 인프라 + 스택 기준이 모두 통과하는지 확인합니다.
2. `active-context.md`에 "프로젝트 개요 입력 완료, 스택=`<id>`" 한 줄을 남깁니다.
3. 작업 시작 시 `session-boot.md` 순서로 복귀합니다.

## 인터뷰를 건너뛰어도 되는 경우
- 이미 `project-charter.md`의 1~5절에 `TBD`가 없고 `profile.json`의 `activeStack`이 설정되어 있으면 인터뷰는 생략합니다.
- 단, 사용자가 "프로젝트 방향이 바뀌었다" 고 명시하면 다시 인터뷰를 시작합니다.
