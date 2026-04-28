# 프로젝트 메모리

세션이 바뀌어도 유지되는 안정적인 사실을 기록합니다.

## 프로젝트 성격
- 이 저장소는 **일반화된 프로젝트 시작 하네스**입니다.
- 일반 하네스(세션·정책·문서·스타일 동기화 인프라)와 스택 프리셋(프레임워크+디자인패턴 꾸러미)이 분리되어 있습니다.
- 새 프로젝트는 이 저장소를 템플릿으로 시작하고, 원하는 스택 프리셋을 `npm run stack:apply`로 적용합니다.

## 사용 가능한 스택 프리셋
- `vue3-fsd` — Vue 3 + Pinia + Vite + TypeScript / FSD + Clean Architecture + Headless Core + Adapter
- `none` — 일반 하네스만 사용

## 활성 스택 결정
- `.harness/policy/profile.json`의 `activeStack`이 단일 진실 출처입니다.
- 활성 스택의 `manifest.json`이 `instructions`, `policiesFile`, `checksKey`, `source`(scaffold 가져오는 방법)를 모두 정의합니다.

## 일반 하네스 구성
- `.harness/session/`: 세션 컨텍스트 복구
- `.harness/project/`: 프로젝트 목적/범위 + 부트스트랩 인터뷰 + 이식 가이드
- `.harness/policy/`: 정책↔코드 양방향 동기화, SYNC GAP 검출, waiver
- `.harness/documentation/`: 문서 인덱싱/분리 규칙, doc-link 무결성
- `.harness/style/`: 코딩 스타일 검증
- `.harness/stacks/`: 스택 프리셋 꾸러미 (자체-완결, 폴더 격리)

## 스택 적용 메커니즘
- `scripts/apply-stack.mjs`가 source adapter 패턴으로 동작:
  - `local`: `.harness/stacks/<id>/scaffold/`를 root로 복사 (현재 구현)
  - `tiged`: `npx tiged <ref> .` (스텁, 향후 마이그레이션 시 구현)
- 적용 시 root `package.json`에 `package.merge.json`을 머지하고 `.harness/.stack-applied.json` 마커 기록.
- `stack:reset`은 마커를 기준으로 복사된 파일 제거 + package.json 적용 전 상태로 복원.
- harness 스크립트는 충돌 시 항상 우선 (스택이 덮어쓰지 못함).

## 핵심 검증 명령
- `npm run guard`: 통합. policy + docs + (스택 적용 시) lint+test+build
- `npm run policy:guard` / `policy:guard:strict`
- `npm run docs:check` / `docs:check:strict`
- `npm run stack:status` / `stack:apply` / `stack:reset`
- `main` 푸시 시 GitHub Actions(`policy-guard.yml`)가 `--strict`로 실행

## 운영 장치 원칙
- 하네스는 방향과 읽기 순서를 제공.
- 트리거는 특정 변경/상황에서 검토를 다시 떠올리게 함.
- 훅은 CI나 실행 단계에서 실제 검사를 강제.
- 강제 강도: `inform → trigger → hook → block`.
- 예외 허용: `none / defer / waiver`.
- 강도/예외가 애매하면 사용자에게 먼저 확인.

## 격리 원칙 (반드시 지킬 것)
1. 일반 하네스 문서·스크립트는 어떤 스택 폴더도 import 하지 않음. 로더만 활성 스택을 읽음.
2. 한 스택 폴더는 다른 스택 폴더를 참조하지 않음 (`docs:check`가 자동 검증).
3. 스택 폴더는 자체-완결. 폴더 단위로 잘라 다른 저장소로 옮길 수 있어야 함.
4. 스택의 정책은 반드시 `policies.json`을 통해서만 일반 인프라에 노출.

## 향후 마이그레이션 (A-1)
- 트리거 조건: 스택 수 ≥ 2 또는 외부 저장소 공유 필요.
- 변경점: 해당 스택 `manifest.json`의 `source.type`을 `tiged`로 바꾸고 `ref` 활성화 + `apply-stack.mjs`의 `adapterTiged()` 구현.
- 일반 인프라는 영향 없음 (어댑터 인터페이스 동일).
