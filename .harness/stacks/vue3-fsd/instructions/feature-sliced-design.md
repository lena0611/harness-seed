# Feature-Sliced Design

## Feature-Sliced Design Rules
- feature-specific 코드는 반드시 `features/{name}`에 속해야 합니다.
- 각 feature는 self-contained 해야 합니다.

## Feature Structure
```text
features/{feature-name}/
  model/
  ui/
  api/
```

## Shared Rules
- `shared`는 재사용 가능한 순수 유틸리티만 포함해야 합니다.
- 비즈니스 로직을 두면 안 됩니다.
- feature-specific 코드를 두면 안 됩니다.
