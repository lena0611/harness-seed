# 스택 프리셋 로컬 규칙

이 문서는 `npm run stack:apply`가 활성 스택 프리셋을 프로젝트 로컬 규칙으로 정착시키는 장소입니다.

프리셋은 공통 하네스의 강제 규칙이 아닙니다. 프로젝트가 특정 스택을 선택했을 때, 그 선택을 로컬 개발방법론의 일부로 기록합니다.

<!-- harness-stack-rules:start -->
적용된 스택 프리셋이 없습니다.
<!-- harness-stack-rules:end -->

## 운영 원칙
- 이 파일의 관리 섹션은 `stack:apply`와 `stack:reset`이 갱신합니다.
- 관리 섹션 밖에는 프로젝트 고유 보충 규칙을 적을 수 있습니다.
- 기존 로컬 방법론과 충돌하면 `.harness/project/local-methodology.md`의 우선순위 기준을 따릅니다.

## 스택 업데이트 기준
- `harness:outdated`는 공통 하네스와 스택 하네스의 업데이트 후보를 함께 보여줘야 합니다.
- `harness:update` 기본 동작은 현재 적용된 스택 하네스를 갱신하는 것입니다. 공통 하네스만 갱신할 때는 `npm run harness:update -- --base-only`를 사용합니다.
- 단, lock/install manifest의 base source가 `bundled`이고 repo를 스택의 `requiredBaseHarness.repo`에서만 복구한 경우 `--base-only`는 실행 가능한 갱신 경로가 아닙니다. 이때 `harness:outdated`는 최신 스택 하네스 `npx ... init` 재실행을 안내해야 합니다.
- 스택 manifest의 `baseHarness.minVersion`은 최소 요구 버전이고, `baseHarness.ref`는 검증된 기준 ref입니다.
- 이미 설치된 공통 하네스가 `minVersion` 이상이면 스택 업데이트가 더 낮은 `baseHarness.ref`로 자동 downgrade하지 않습니다.
- 정확한 공통 하네스 ref 고정이 필요한 스택만 `baseHarness.exactRefRequired: true`를 명시합니다.
- 스택 lock의 `requiredBaseHarness.repo`는 base source metadata가 누락된 소비자 프로젝트에서 `harness:outdated`가 공통 하네스 원격 저장소를 복구하는 fallback으로도 사용됩니다.
