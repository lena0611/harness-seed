# Architecture

## Architecture Principles
이 프로젝트는 다음 아키텍처를 조합해 따릅니다.
- Feature-Sliced Design (FSD)
- Clean Architecture
- Headless Core Pattern
- Adapter Pattern

목표는 프레임워크 의존성을 최소화하고 모든 비즈니스 로직을 프레임워크에 독립적으로 유지하는 것입니다.

## Folder Structure
```text
src/
  app/
  pages/
  widgets/
  features/
  entities/
  shared/

  core/                    // framework-independent
    domain/
    application/

  adapters/                // framework bindings
    vue/
      stores/              // Pinia
      composables/
```

## Core Principles
1. Core Isolation (Most Important)
   - 모든 비즈니스 로직은 `core/`에 존재해야 합니다.
   - `core/`는 순수 TypeScript여야 합니다.
   - Vue, Pinia, DOM, browser API를 사용하면 안 됩니다.
2. Dependency Direction
   - 의존 방향은 `UI -> Adapter -> Core`여야 합니다.
   - Core는 Vue나 어떤 프레임워크에도 의존하면 안 됩니다.
3. Headless Logic
   - Core는 Vue 없이도 실행 가능하고 테스트 가능해야 합니다.

## API Rules
- API 로직은 추상화되어야 합니다.
- Core는 인터페이스(contracts)를 정의해야 합니다.
- 실제 API 구현은 adapters에 존재해야 합니다.

## Naming Conventions
- `core/domain`: 순수 비즈니스 엔티티와 규칙
- `core/application`: use-cases
- `adapters/vue/stores`: Pinia stores
- `adapters/vue/composables`: Vue bindings

## Strict Prohibitions
- `core` 내부에서 `ref`/`reactive`를 사용하면 안 됩니다.
- Vue 컴포넌트 내부에 비즈니스 로직을 두면 안 됩니다.
- Pinia 내부에 비즈니스 로직을 두면 안 됩니다.
- feature 경계를 섞으면 안 됩니다.
- `"common"` 또는 `"utils"` 같은 dumping folder를 만들면 안 됩니다.
