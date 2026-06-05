# Project Bootstrap

> **이 문서는 사람이 읽는 매뉴얼이 아니라 AI 코딩 에이전트가 따라 실행하는 절차서입니다.**
> 사용자가 "프로젝트 부트스트랩 인터뷰 시작해줘", "새 프로젝트 시작", "기존 프로젝트에 하네스 정리해줘" 같은 의사를 표현하면 에이전트가 현재 프로젝트 상태를 먼저 파악하고 필요한 산출물(`project-charter.md`, `profile.json` 등)을 갱신합니다.

이 절차는 새 프로젝트뿐 아니라 기존 안정 프로젝트의 유지보수, 마이그레이션, 운영 개선에도 사용할 수 있습니다.

## 목적
- 공통 하네스(세션·기준·문서·스타일 동기화 인프라)는 그대로 두고, 프로젝트마다 달라지는 부분(상태, 책임 범위, 운영 기준, 기술 스택 선택)을 한 자리에서 정리합니다.
- 입력 결과는 `project-charter.md`, `scope-contract.md`, `.harness/policy/profile.json`에 분산 저장됩니다.

## 인터뷰 순서

### 1. 프로젝트 상태 확인 (필수)
먼저 적용 대상이 어떤 상태인지 확인합니다.

1. 새로 만드는 프로젝트인가?
2. 이미 운영 중인 안정 프로젝트인가?
3. 마이그레이션 또는 큰 구조 전환 중인가?
4. 라이브러리, 배치, API, 도구처럼 사용자 인터페이스가 없는 프로젝트인가?
5. 이번 하네스 적용 목적은 신규 개발 가이드, 유지보수 안정화, 에이전트 작업 통제, 문서 정리 중 무엇인가?

답이 들어오는 즉시 `.harness/project/project-charter.md`의 "프로젝트 상태"와 "기본 식별"을 갱신합니다. 보류 항목은 `.harness/session/developer-input-queue.md`에 등록합니다.

### 2. 프로젝트 카드 작성 (필수)
상태에 따라 묻는 항목을 다르게 잡습니다.

신규 구축이면 다음을 묻습니다.

1. 해결하려는 문제는 무엇인가?
2. 주요 사용자 또는 연동 시스템은 무엇인가?
3. 핵심 목표와 의도적으로 하지 않을 것은 무엇인가?
4. 초기 성공 기준과 알려진 제약은 무엇인가?

기존 안정 프로젝트의 유지보수라면 다음을 묻습니다.

1. 이 저장소가 현재 책임지는 업무 범위는 무엇인가?
2. 자주 들어오는 변경 유형은 무엇인가?
3. 변경하면 위험한 영역이나 회귀가 잦은 영역은 무엇인가?
4. 운영 중 반드시 지켜야 하는 검증, 릴리스, 장애 대응 기준은 무엇인가?

마이그레이션이면 다음을 묻습니다.

1. 기존 구조와 목표 구조는 무엇인가?
2. 유지해야 하는 호환성 계약은 무엇인가?
3. 단계별 전환 범위와 되돌림 기준은 무엇인가?

이미 README, 운영 문서, CI 설정, 기존 하네스 문서에 답이 있으면 사용자에게 반복 질문하지 말고 먼저 근거를 찾아 요약합니다. 확신할 수 없는 항목만 질문으로 남깁니다.

### 3. 스택 하네스 선택 (필수)
사용 가능한 스택 하네스 또는 scaffold 템플릿 후보를 보여주고 하나를 선택받습니다. 목록 출처는 `.harness/stacks/README.md`입니다.

질문 예시:
> 사용할 스택 하네스를 골라주세요.
> - 사내 스택 하네스 — `npm run standards:list`로 `ai-standard/harnesses`의 스택 하네스 패키지 조회
> - scaffold 템플릿 — 스택 하네스 적용 후 `npm run templates:list`로 후보를 조회한 뒤 선택
> - 로컬 스택 자산 — 별도 폴더의 `manifest.json` 경로를 `stackManifest`에 기록
> - `none` — 예외적으로 공통 기준만 운영. 사유를 `decision-log.md`에 기록

선택 결과는 `.harness/policy/profile.json`의 `activeStack`에 기록합니다. 외부 스택 자산이면 `stackManifest`도 함께 기록합니다. `none`을 유지하면 왜 스택 기준을 선택하지 않았는지 `decision-log.md`에 사유를 한 줄 남깁니다.

### 4. 스택 호환성 검증 및 적용
선택된 스택이 동작 가능한 상태인지 다음으로 결정합니다.

```bash
npm run stack:status            # 현재 적용 상태 확인
npm run standards:list          # 사내 스택 하네스 후보 조회
npm run stack:apply             # 스택 기준 로컬룰 적용
npm run templates:list          # 새 프로젝트 scaffold가 필요할 때만 후보 조회
npm run template:apply -- --preset-git <repo-url> --ref <tag-or-branch>
npm install
npm run harness:check
```

- 스택 미적용 상태(`activeStack: none`)에서는 `npm run harness:check`가 일반 인프라 검사(기준 동기화 + 문서)만 실행하고 lint/test/build는 건너뜁니다.
- 스택 적용 후에는 `.harness/stacks/.applied/<stack>/manifest.json` 스냅샷을 기준으로 fresh clone, worktree, CI에서도 적용 상태를 복원합니다. `.harness/.stack-applied.json` 마커가 없더라도 스냅샷이 있으면 lint/test/build가 실행됩니다.
- `activeStack`이 설정됐지만 스택 스냅샷이 없으면 검증을 통과로 보지 않습니다. 이 경우 스택 하네스 init 또는 `npm run stack:apply`를 다시 실행합니다.
- 일반 프로젝트 개발자에게는 스택 하네스의 `npx ... init` 흐름을 우선 안내합니다. 위 `stack:apply` 흐름은 이미 공통 하네스가 설치된 관리자/고급 흐름입니다.
- `source.type=none`인 스택 기준은 파일 복사 없이 `.harness/project/stack-preset-rules.md`만 갱신합니다.
- 스택을 바꾸고 싶으면 `npm run stack:reset` 으로 먼저 적용을 되돌린 뒤 `activeStack`을 바꾸고 다시 `stack:apply`를 실행합니다.
- 원격 프리셋을 적용하려면 `npm run stack:apply -- --preset-git <repo-url> --ref <tag-or-branch>`를 사용합니다.
- 외부 프리셋을 일회성으로 적용하려면 `npm run stack:apply -- --preset-path <preset-dir>`를 사용합니다.
- scaffold 템플릿은 스택 기준과 분리해 `template:apply`로 적용합니다. 적용 후 템플릿 사용 계약은 `template-contract.md`에 브리지로 남깁니다.
- `"none"`으로 두면 스택 적용 없이 공통 하네스만 운영됩니다. 이 상태는 예외 또는 전환 중 상태로 보고 `harness:scan`의 충돌 후보를 확인합니다.

### 5. 첫 로컬룰 후보 정착 (선택)
프로젝트 카드가 채워졌고 스택이 정해졌다면 다음을 이어서 확인합니다.

- 첫 작업 후보
- 반복되는 도메인 규칙
- 반복되는 아키텍처 판단
- 반복되는 검증 또는 릴리스 절차
- 외부 API 또는 데이터 소스

이 답들은 `project-charter.md`, `domain-rules.md`, `architecture-rules.md`, `workflow-rules.md` 중 알맞은 위치에 들어갑니다.

## 인터뷰가 끝난 뒤
1. `npm run harness:check` 1회 실행해 일반 인프라 + 스택 기준이 모두 통과하는지 확인합니다.
2. `active-context.md`에 "프로젝트 상태=`<status>`, 스택=`<id>`" 한 줄을 남깁니다.
3. 작업 시작 시 `session-boot.md` 순서로 복귀합니다.

## 인터뷰를 건너뛰어도 되는 경우
- 이미 `project-charter.md`의 프로젝트 상태, 책임 범위, 현재 성공 기준이 채워져 있고 `profile.json`의 `activeStack`이 설정되어 있으면 인터뷰는 생략합니다.
- 단, 사용자가 "프로젝트 방향이 바뀌었다" 고 명시하면 다시 인터뷰를 시작합니다.
