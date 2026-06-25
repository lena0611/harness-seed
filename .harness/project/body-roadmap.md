# 본체 로드맵

> 적용 범위: harness-seed 본체 저장소(seed-mode) 전용.
> 이 문서는 하네스 제품 방향과 향후 에픽 후보를 기록합니다.
> 소비자 프로젝트에는 배포하지 않습니다.

## Epic: Spec Authority 기반 스펙-코드 싱크 하네스

### 배경
현재 회사의 기획 정책, 세부 기능 정책, 기능 스펙은 문서, 메신저, 회의, 이슈 등 스트림성 정보로 흩어지기 쉽습니다. 시간이 지나면 코드와 현재 동작이 사실상 최종 기준점이 되고, 기획팀 입장에서는 의도된 정책과 구현된 동작의 경계가 흐려집니다.

하네스가 지향해야 할 방향은 코드와 스펙의 양방향 동기화가 아니라, 스펙을 기준점으로 두는 단방향 권위 모델입니다.

### 목표
- 기획/정책/기능 스펙을 코드보다 상위 기준으로 둡니다.
- 개발 시점마다 외부 스펙 저장소를 read-only로 가져와 필요한 스펙만 읽습니다.
- 코드 저장소에는 스펙 본문을 복사하지 않고, 기준이 된 스펙 저장소 commit/ref만 기록합니다.
- 스펙과 코드가 다르면 기본 판정은 코드 drift로 봅니다.
- 코드가 현실을 더 잘 반영하더라도 스펙 자동 수정은 금지하고, 스펙 변경 요청/승인 흐름으로 분리합니다.

### 비목표
- 소비자 프로젝트에 이 로드맵을 배포하지 않습니다.
- 코드 저장소에 기획 스펙 본문을 vendoring하지 않습니다.
- 코드 변경을 근거로 스펙을 자동 승격하거나 자동 수정하지 않습니다.
- 초기 버전에서 LLM 판정만으로 blocking 결정을 내리지 않습니다.

### 제안 구조
```text
planning-specs repo
  products/<project>/
    registry.json
    policies/
    features/
    operations/

consumer code repo
  .harness/spec-sources.json
  .harness/spec-lock.json
  .harness/generated/spec-cache/   # gitignore
```

### 핵심 모델
- `spec-sources.json`: 외부 기획/스펙 저장소의 repo, ref, scope를 선언합니다.
- `spec-lock.json`: 작업/PR 기준으로 해석한 외부 스펙의 resolved commit을 기록합니다.
- `registry.json`: 스펙 id, 상태, owner, code/test mapping, acceptance criteria를 가집니다.
- `spec-cache`: 하네스가 읽기 위해 가져온 임시 캐시이며 git 추적 대상이 아닙니다.

### 주요 명령 후보
- `harness:spec:fetch`: 외부 spec repo를 read-only로 fetch하고 commit을 고정합니다.
- `harness:spec:status`: 현재 코드 repo가 어떤 spec source/ref를 기준으로 작업 중인지 보여줍니다.
- `harness:context`: 작업 설명과 변경 파일을 기준으로 관련 active spec만 컨텍스트에 포함합니다.
- `harness:impact`: 코드 변경이 연결된 spec 범위 안인지, 스펙/코드/테스트 중 한쪽만 바뀌었는지 표시합니다.
- `harness:check`: spec-code-test mapping 누락, unscoped implementation, high-risk spec drift 후보를 검사합니다.
- `harness:spec:change-request`: 코드가 아니라 스펙을 바꿔야 할 때 별도 요청을 생성합니다.

### 검증 규칙 후보
- 스펙이 바뀌면 관련 코드/테스트 변경 또는 영향 없음 근거가 필요합니다.
- 코드가 바뀌면 연결된 active spec 확인이 필요합니다.
- 연결된 스펙 없는 기능 코드 변경은 unscoped implementation으로 경고하거나 차단합니다.
- 코드와 스펙이 다르면 기본 판정은 코드 drift입니다.
- 스펙 변경 필요성이 생기면 스펙 자동 수정 대신 변경 요청을 생성합니다.

### 1차 구현 범위
1. 외부 spec source/lock 파일 스키마 설계
2. spec fetch/cache 명령 추가
3. spec registry와 code/test mapping 모델 정의
4. `harness:impact`에 spec drift 후보 표시
5. `harness:context`에 관련 spec 주입
6. read-only advisory 중심으로 시작하고 blocking은 high-risk spec에만 후속 검토

### 후속 확장
- GitHub/GitLab issue 또는 MR 기반 spec-change-request 생성
- 기획팀 spec repo PR 승인자 규칙
- high-risk spec의 blocking 검증
- acceptance criteria와 테스트 결과 연결
- LLM 기반 spec 준수 리뷰 단계

