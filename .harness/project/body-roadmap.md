# 본체 로드맵

> 적용 범위: harness-seed 본체 저장소(seed-mode) 전용.
> 이 문서는 하네스 제품 방향과 향후 에픽 후보를 기록합니다.
> 소비자 프로젝트에는 배포하지 않습니다.

## Epic: clubadm 소비자 채택 안정화

### 배경
2026-07-09 clubadm 실사용 리뷰가 `consumer-reviews/CLUBADM_HARNESS_IMPROVEMENT_REQUEST_2026-07-09.md`로 접수되었습니다. clubadm은 회사 첫 실질 공통 하네스 소비자이므로, 이 문서는 단순 의견이 아니라 본체 채택성/안전성 개선 입력으로 승격합니다.

### 우선순위
1. P0: 처음 설치하는 개발자가 문서와 CLI만 보고 성공할 수 있게 합니다.
2. P0: 안전장치가 조용히 꺼지지 않게 fail-closed와 복구 경로를 제공합니다.
3. P1: `harness:check`와 설치 리포트가 실제 검증 강도만큼만 말하게 합니다.
4. P1/P2: 버전 동기화, 템플릿 상태, Windows/부분 실패 복구는 후속 안정화로 다룹니다.

### 1차 작업 범위
- 퀵스타트에서 설치 전 실행 불가능한 명령을 제거하고, 실제 CLI/스택 예시 명령을 제공합니다.
- 설치 전후 파일 풋프린트와 되돌리는 방법을 명시합니다.
- 배포 패키지에서 세션 운영 문서와 개인 local 설정이 유출되지 않게 합니다.
- 위험 차단 hook이 node 부재/파싱 실패 시 조용히 통과하지 않게 합니다.
- install-manifest 기반 제거 명령을 dry-run 기본으로 제공합니다.
- 정책 검사 통과 문구를 스키마/정합성 통과로 좁혀 표현합니다.

## Epic: score-print 신호 회복과 차단 승격

### 배경
2026-08-04 score-print 실사용 피드백(base 0.2.89 / vue3 스택 0.1.47)이 `consumer-reviews/SCORE_PRINT_HARNESS_IMPROVEMENT_REQUEST_2026-08-04.md`로 접수되었습니다. 총평은 "기억·연속성 A급, 예방 C급" — 회귀 4건을 하네스가 못 막았고, 그중 2건은 하네스가 옳은 신호를 줬는데 노이즈에 묻혀 에이전트가 무시했습니다. 공통 뿌리 두 축: ①노이즈가 신호를 죽인다(P2·P3·P4), ②조언을 차단으로 승격해야 한다(P1·P6).

### 판정 (2026-08-04)
6건 중 5건 수용, P1 축소 수용, 거부 없음. 상세 근거는 decision-log 2026-08-04.

### 차수 계획
1. **1차 (0.2.90, 노이즈 제거) — 배포 완료 (2026-08-04)**: P4 guard 출력 기본 요약(152줄→약 30줄, `--verbose`로 상세, 확인 필수/차단 후보는 요약에서도 상세 유지) + P3 decision-log 계열 백틱 코드 경로 "역사 참조" 분류(dead code-path 검사 제외, 마크다운 링크는 유지, 동적 아카이브 orphan 예외) + doc-link 직접 실행 가드 fail-open 수정(덤).
2. **2차 (0.2.91, 차단 승격) — 구현 완료, 검증 대기**: 폐기/번복 배너 관례를 본체 표준으로 승격·문서화(session/README.md "결정 로그 작성 관례" — score-print 자체 관례를 표준화, 요청서 "최고 자산" 지목) → P2 정책 번복 커밋 감지(현행 decision-log diff의 추가 라인에서 배너 마커 감지 시 그 커밋의 동기화 후보를 '확인 필수'로 승격, strict 시 차단) + P1 비권장 뒤집기 엔트리 필수 필드(`근거 반박:` 등) lint. 두 기능은 같은 decision-log diff 스캐너를 공유.
   - 주의: 감지 범위는 현행 `decision-log.md` 한 파일로 한정(아카이브 파일로의 이동이 배너 "추가"로 오인되는 함정 방지).
   - P1 축소 사유: 본체는 감사·리뷰 결과를 생성/집계하지 않으므로(에이전트 세션 산출물) "감사 발생 자체" 감지는 불가. 기록 관례 표준화 + 기록된 엔트리의 필수 필드 lint까지가 기계 강제 범위이고, 기록 의무 자체는 프롬프트 계층(CLAUDE.md/session-start-alert). 정책 원문 반영은 `ai-standard/docs` 동반 작업.
3. **3차 (지속가능성)**: P5 decision-log 현행/이력 2계층 — 관례는 `/decision` 스킬에 이미 있으므로 실행 장치를 채움(임계 넘김 안내, harness:context 현행 우선 로드, CLAUDE.md 읽기 순서 조정) + P6 로컬룰 승격 시 "문서 규칙 vs 실행 가능한 검증(테스트/CI 가드)" 분기 질문(Project rule candidate check 문구, enforcement-ladder, workflow-rules, /decision·/harness-scan 스킬).

### 비목표
- 요약 모드가 `syncEnforcement` 강제 후보나 실패 원인을 가리지 않습니다(필수 신호는 항상 상세).
- 이력 예외를 살아있는 문서(active-context, project-memory, 기준 문서)로 넓히지 않습니다.
- 배너 마커 감지를 표준 관례 문서화 없이 휴리스틱으로 도입하지 않습니다.

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
