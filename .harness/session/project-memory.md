# 프로젝트 메모리

세션이 바뀌어도 유지되는 안정적인 사실을 기록합니다.

## 프로젝트 성격
- 이 저장소는 **일반화된 프로젝트 시작 하네스**입니다.
- 공통 하네스(세션·정책·문서·스타일 동기화 인프라)만 본체에 포함합니다.
- 스택 기준(프레임워크+디자인패턴 기준 꾸러미)은 외부 폴더나 원격 저장소에서 받아와 적용합니다.

## 사용 가능한 스택 기준
- `none` — 공통 하네스만 사용
- 사내 스택 기준 — `npm run standards:list`, `--preset-path`, `--preset-git`, `stackManifest`로 연결
- scaffold 템플릿 — 토큰 없이 `npm run templates:list`로 승인 목록을 조회한 뒤 `template:apply`로 별도 적용

## 활성 스택 결정
- `.harness/policy/profile.json`의 `activeStack`이 단일 진실 출처입니다.
- 외부 프리셋의 `manifest.json`이 `instructions`, `policiesFile`, `checksKey`, `source`를 정의합니다.
- `source.type=none`이면 스택 기준만 정착하고 scaffold 파일은 복사하지 않습니다.

## 공통 하네스 구성
- `.harness/session/`: 세션 컨텍스트 복구
- `.harness/project/`: 프로젝트 목적/범위 + 부트스트랩 인터뷰 + 이식 가이드
- `.harness/policy/`: 정책↔코드 연결 기준, 한쪽 변경 검토 후보 분석, 명시적 강제 정책의 waiver
- `.harness/documentation/`: 문서 인덱싱/분리 규칙, doc-link 무결성
- `.harness/style/`: 코딩 스타일 검증
- `.harness/stacks/`: 외부 프리셋 계약과 적용 방법 문서
- `.harness/bin/list-stack-standards.mjs`: 사내 스택 하네스 후보 조회
- `.harness/bin/outdated-harness.mjs`: lock 기준으로 같은 SemVer caret 범위의 업데이트 후보만 조회
- `.harness/bin/update-harness.mjs`: lock에 기록된 스택 하네스를 다시 실행해 compatible/latest/locked 전략으로 업데이트

## 스택 적용 메커니즘
- `.harness/bin/apply-stack.mjs`가 source adapter 패턴으로 동작:
  - `--preset-path`: 로컬 프리셋 폴더의 `manifest.json` 사용
  - `--preset-git`: 원격 저장소를 임시 clone해 `manifest.json` 사용
  - `stackManifest`: 프로젝트에 고정된 외부 manifest 경로 사용
- 스택 적용 시 `.harness/project/stack-preset-rules.md`에 instruction을 정착하고 `.harness/.stack-applied.json` 마커를 기록합니다.
- 템플릿 적용 시 `.harness/project/template-contract.md`에 사용 계약 브리지를 정착하고 `.harness/.template-applied.json` 마커를 기록합니다.
- `stack:reset`은 마커를 기준으로 복사된 파일 제거 + package.json 적용 전 상태로 복원.
- `template:reset`은 템플릿 마커를 기준으로 복사된 파일 제거 + package.json 적용 전 상태로 복원.
- `harness:outdated`는 `.harness/harness-lock.json`의 스택 하네스 repo/version을 읽고 원격 tag에서 업데이트 후보만 확인. 프로젝트 파일은 수정하지 않음.
- `harness:update`는 `.harness/harness-lock.json`의 스택 하네스 repo/version을 읽고 기본 `compatible` 전략으로 같은 SemVer caret 범위의 최신 태그를 다시 실행.
- harness 스크립트는 충돌 시 항상 우선 (스택이 덮어쓰지 못함).

## 시각 자료 갱신
- `.harness/documentation/assets/request-lifecycle-flow.svg`는 요구사항 수신부터 커밋 확정까지의 전체 라이프사이클 스냅샷입니다.
- `.harness/documentation/assets/agent-development-flow.png`는 에이전트 개발 전 사고 흐름의 세부 스냅샷입니다.
- 에이전트 진입 흐름, 기준 우선순위, 충돌 해석, 검증 절차, 요청 라이프사이클이 바뀌면 README 설명과 두 이미지를 함께 갱신합니다.
- `ai-standard/docs`에도 같은 이미지가 있으므로 원문 정책 쪽 자산도 함께 갱신합니다.

## 핵심 검증 명령
- `npm run harness:scan`: 현재 프로젝트 스캔 리포트 생성
- `npm run harness:handoff`: 설치/업데이트 직후 인수인계 요약 생성
- `npm run harness:check`: 통합 검사. policy + docs + (스택 적용 시) lint+test+build. `최종 검증만` 요청에는 직접 실행하고, hook 설치 후 `커밋/푸시` 요청에는 pre-commit/pre-push hook이 실행합니다.
- `npm run harness:check:strict`: CI/릴리스용 엄격 검사
- `npm run harness:outdated`: 현재 적용된 스택 하네스 업데이트 후보 확인
- `npm run harness:update`: 현재 적용된 스택 하네스 기준 업데이트
- `npm run harness:impact`: 소비자 프로젝트에 노출되는 영향 범위 확인
- `npm run policy:impact` / `policy:check` / `policy:guard`: 하네스 본체 저장소 전용 세부 기준 검사
- `npm run docs:check` / `docs:check:strict`: 하네스 본체 저장소 전용 문서 검사
- `npm run standards:list` / `stack:status` / `stack:apply` / `stack:reset`
- `npm run templates:list` / `template:status` / `template:apply` / `template:reset`
- CI에서는 `npm run harness:check:strict`를 기준으로 실행

## 운영 장치 원칙
- 하네스는 방향과 읽기 순서를 제공.
- 트리거는 특정 변경/상황에서 검토를 다시 떠올리게 함.
- 훅은 CI나 실행 단계에서 실제 검사를 강제.
- 강제 강도: `inform → trigger → hook → block`.
- 예외 허용: `none / defer / waiver`.
- 강도/예외가 애매하면 사용자에게 먼저 확인.

## 격리 원칙 (반드시 지킬 것)
1. 공통 하네스 문서·스크립트는 특정 스택을 직접 참조하지 않음.
2. 프리셋은 자체-완결. 폴더 단위나 저장소 단위로 옮길 수 있어야 함.
3. 스택의 정책은 반드시 `policies.json`을 통해서만 일반 인프라에 노출.
4. 프리셋 전용 자동 검사는 해당 스택 기준 또는 템플릿 저장소의 guard에 둠.
5. 템플릿 사용 계약은 `.harness/project/template-contract.md` 브리지로만 연결하고, 템플릿 가이드 전체를 프로젝트 로컬룰로 복사하지 않음.
