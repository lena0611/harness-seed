# 현재 컨텍스트

이 문서는 최근 작업 상태와 다음 세션이 바로 이어받아야 할 정보를 담습니다.

## 현재 상태
- Vue 3 + Pinia + Vite + TypeScript 기본 스캐폴드가 생성되어 있습니다.
- GitHub Actions 기반 GitHub Pages 자동 배포가 구성되어 있습니다.
- GitHub Pages 배포가 정상 동작하며 공개 URL로 접근 가능합니다.
- 프로젝트 목적/범위를 위한 project harness가 추가되어 있습니다.
- 정책 문서와 소스 변경을 연결하는 policy harness가 추가되어 있습니다.
- 긴 문서를 인덱스 구조로 유지하기 위한 documentation harness가 추가되어 있습니다.
- ESLint 기반 style harness가 추가되어 있습니다.
- 로컬 git hook, 테스트 기반, 협업 템플릿, 설정 계약이 추가되었습니다.
- 스타일 규칙은 `style-evolution.md`를 통해 코드 패턴에 맞게 점진적으로 보완하도록 되어 있습니다.

## 현재 UI/구조 요약
- 홈 화면은 스캐폴드 상태를 보여주는 최소 UI입니다.
- 예시 흐름은 `core/application -> Pinia store -> composable -> feature UI -> page`입니다.
- 실제 도메인 기능은 아직 정의되지 않았습니다.

## 현재 중요 파일
- `src/core/application/get-scaffold-status.ts`
- `src/adapters/vue/stores/scaffoldStatus.store.ts`
- `src/adapters/vue/composables/useScaffoldStatus.ts`
- `src/features/scaffold-status/ui/ScaffoldStatusCard.vue`
- `.github/workflows/deploy-pages.yml`
- `.github/project-harness/project-charter.md`
- `.github/project-harness/scope-contract.md`
- `.github/session-harness/developer-input-queue.md`
- `.github/documentation-harness/document-registry.json`
- `.github/style-harness/style-rules.md`
- `.githooks/pre-push`
- `src/core/application/get-scaffold-status.test.ts`
- `.github/pull_request_template.md`
- `.github/project-harness/config-contract.md`
- `eslint.config.mjs`
- `.github/policy-harness/policy-registry.json`
- `.github/policy-harness/automation-coverage.md`
- `.github/policy-harness/waivers.json`
- `scripts/policy-harness.mjs`
- `.github/workflows/policy-guard.yml`

## 다음 작업을 시작할 때 유의할 점
- 새 기능은 반드시 `core`부터 설계합니다.
- store/composable은 연결 계층으로만 유지합니다.
- 프로젝트 개요 문서는 아직 비어 있으며 나중에 별도 작성 예정입니다.
- 프로젝트 목적, 사용자 문제, 성공 기준은 아직 `TBD` 상태입니다.
- 위 항목들은 `developer-input-queue.md`에서 새 세션마다 다시 물어보도록 관리합니다.
- 정책 문서 또는 `src/`를 수정하면 `npm run policy:guard`를 함께 실행합니다.
- 스타일 일관성은 `npm run lint`와 `npm run guard`에서 검증합니다.
- 로컬 훅은 `npm run hooks:install` 이후 commit/push 시점에 동작합니다.
- 문서 내용을 늘릴 때는 인덱스 문서와 세부 문서로 분리하는 것을 기본값으로 둡니다.

## 바로 이어서 하기 좋은 작업
- 실제 도메인 정의 및 feature 선정
- 프로젝트 헌장 항목 채우기
- 개발자 입력 큐의 open 항목 해소
- `features/{name}` 기준의 첫 실사용 feature 추가
- API contract를 `core` 기준으로 정리
- 프로젝트 개요 문서 작성

## 마지막 확인 시점 기준
- 최신 배포 성공 런: `24770533831`
- 최신 배포 트리거 커밋: `0e1fa10`
- 세션 시작 알림 문서: `.github/session-harness/session-start-alert.md`
- 통합 가드 명령: `npm run guard`
- 정책 검사 명령: `npm run policy:guard`
