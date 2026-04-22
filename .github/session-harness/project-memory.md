# 프로젝트 메모리

세션이 바뀌어도 유지되는 안정적인 사실을 기록합니다.

## 프로젝트 성격
- 현재는 도메인 미정 상태의 기본 스캐폴드 프로젝트입니다.
- 목표는 프레임워크 의존성을 낮춘 프론트엔드 아키텍처 기반을 유지하는 것입니다.

## 기술 스택
- Vue 3 (Composition API)
- Pinia
- Vite
- TypeScript

## 아키텍처 핵심
- Feature-Sliced Design (FSD)
- Clean Architecture
- Headless Core Pattern
- Adapter Pattern
- 비즈니스 로직은 `src/core/`에 둡니다.
- 의존 방향은 `UI -> Adapter -> Core`입니다.

## 주요 경로
- `src/core/domain`: 순수 비즈니스 엔티티와 규칙
- `src/core/application`: use-case
- `src/adapters/vue/stores`: Pinia store
- `src/adapters/vue/composables`: Vue adapter
- `src/features`: feature-specific 코드
- `.github/copilot-instructions/`: 코드 생성 규칙 문서
- `.github/session-harness/`: 세션 컨텍스트 복구 문서
- `.github/session-harness/developer-input-queue.md`: 개발자 입력이 필요한 미해결 항목 큐
- `.github/project-harness/`: 프로젝트 목적/범위 하네스
- `.github/policy-harness/`: 정책-코드 동기화 하네스
- `.github/documentation-harness/`: 문서 인덱싱/분리 하네스
- `.github/style-harness/`: 코딩 스타일 규칙과 검증 하네스
- `.githooks/`: 저장소 관리형 로컬 git hooks

## 검증 및 배포
- 로컬 검증 명령: `npm run build`
- 스타일 검증 명령: `npm run lint`
- 테스트 검증 명령: `npm run test`
- 통합 가드 명령: `npm run guard`
- 정책 검증 명령: `npm run policy:guard`
- 로컬 훅 설치 명령: `npm run hooks:install`
- `main` 브랜치 푸시 시 GitHub Actions가 GitHub Pages로 자동 배포합니다.
- 배포 주소: `https://lena0611.github.io/bareunmal/`

## 운영 장치 원칙
- 하네스는 방향과 읽기 순서를 제공합니다.
- 트리거는 특정 변경/상황에서 검토를 다시 떠올리게 합니다.
- 훅은 CI나 실행 단계에서 실제 검사를 강제합니다.
- 중요한 운영 규칙은 가능하면 하네스만이 아니라 trigger와 hook까지 함께 설계합니다.
- 강제 강도는 `inform -> trigger -> hook -> block` 관점으로 봅니다.
- 예외 허용 범위는 `none / defer / waiver`로 구분합니다.
- 강도나 예외 범위가 애매하면 사용자에게 먼저 확인합니다.

## 금지 규칙 요약
- `core`에서 Vue, Pinia, DOM, browser API를 사용하지 않습니다.
- Pinia store와 composable에 비즈니스 로직을 두지 않습니다.
- feature 경계를 섞지 않습니다.
- dumping folder 성격의 `common`, `utils`는 만들지 않습니다.
