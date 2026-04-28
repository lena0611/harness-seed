# 현재 컨텍스트

이 문서는 최근 작업 상태와 다음 세션이 바로 이어받아야 할 정보를 담습니다.

## 현재 상태 (2026-04-27)
- 저장소가 **일반화 하네스 + 스택 프리셋** 구조로 분리되었습니다.
- `vue3-fsd` 스택의 모든 자산은 `.harness/stacks/vue3-fsd/scaffold/` 안으로 이동되었습니다.
- root는 일반 하네스 전용입니다 (vue/pinia/vite 의존성/설정 없음).
- `npm run stack:apply` / `stack:reset` / `stack:status` 로 스택 적용을 제어합니다.
- 적용 상태는 `.harness/.stack-applied.json` 마커로 기록됩니다 (gitignore — dev 머신/시드 사용자 머신마다 다른 상태).
- root `package.json`/`package-lock.json`은 항상 슬림 상태(stack:reset 후)로만 커밋합니다. CI는 `apply-stack` 후 `npm install`로 의존성을 설치합니다.
- B안(로컬 scaffold 복사) 채택 + A-1(`tiged`로 외부 저장소에서 가져오기) 어댑터 **실구현 완료**. 트리거 시점에 manifest의 source.type만 바꾸면 됩니다.
- 외부 빈 디렉토리에 풀어 시드 사용자 시나리오 e2e 검증 통과 (status → guard skip → apply → install → guard full pass).

## 핵심 파일 (일반 하네스)
- `.harness/policy/profile.json` — `activeStack` 단일 진실 출처
- `.harness/policy/policy-registry.json` — stack-agnostic 정책만
- `.harness/stacks/README.md` — 스택 프리셋 격리 원칙
- `.harness/project/bootstrap.md` — 신규 프로젝트 인터뷰
- `.harness/project/portability-guide.md` — 이식 절차
- `scripts/apply-stack.mjs` — 어댑터 패턴 (local + tiged **둘 다 구현됨**)
- `scripts/guard.mjs` — 미적용 시 lint/test/build 자동 스킵
- `scripts/doc-link-check.mjs` — scaffold 경로 자동 제외 + 활성 스택 fallback

## 핵심 파일 (vue3-fsd 스택)
- `.harness/stacks/vue3-fsd/manifest.json` — source 스펙 포함
- `.harness/stacks/vue3-fsd/policies.json` — 스택 전용 정책
- `.harness/stacks/vue3-fsd/scaffold/package.merge.json` — 적용 시 root package.json에 머지될 의존성/스크립트
- `.harness/stacks/vue3-fsd/scaffold/src/...` — 예시 도메인 코드 (헤드리스 코어 포함)
- `.harness/stacks/vue3-fsd/scaffold/.github/workflows/deploy-pages.yml`

## 다음 세션이 바로 이어받을 작업
- 프로젝트 헌장 `TBD` 항목 채우기
- 첫 실제 도메인 feature 후보 결정
- 필요 시 `npm run stack:apply` 후 개발 재개
- A-1 마이그레이션 트리거 조건 모니터링 (스택 ≥ 2개 또는 외부 공유 필요 시)

## 마지막 검증
- `npm run stack:apply` → `npm run guard` (lint+test+build 포함) 통과
- `npm run stack:reset` → `npm run guard` (lint/test/build 스킵) 통과
- 스택 격리 검사, doc-link 무결성, SYNC GAP, 정책 위반 검사 모두 OK
