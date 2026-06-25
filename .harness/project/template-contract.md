# 템플릿 사용 계약

이 문서는 scaffold 템플릿이 생성한 코드와 템플릿 개발 가이드를 프로젝트 하네스에 연결합니다.

템플릿 가이드 전체를 프로젝트 로컬룰로 복사하지 않습니다. 템플릿이 소유하는 사용 계약은 이 문서의 관리 섹션에 출처만 연결하고, 현재 프로젝트에서 추가하거나 바꾼 판단은 관리 섹션 밖 또는 다른 `.harness/project/*` 문서에 기록합니다.

<!-- harness-template-contract:start -->
적용된 scaffold 템플릿이 없습니다.
<!-- harness-template-contract:end -->

## 운영 원칙
- 이 파일의 관리 섹션은 `template:apply`와 `template:reset`이 갱신합니다.
- 관리 섹션 밖에는 현재 프로젝트가 템플릿 계약을 어떻게 해석하거나 예외 처리하는지 적을 수 있습니다.
- 스택 일반 기준은 `stack-preset-rules.md`에서 확인합니다.
- 템플릿 reset은 템플릿 계약과 템플릿 산출물만 대상으로 하며, `profile.json`의 스택 상태 복원은 `stack:reset`의 소유 범위를 따릅니다.
- 템플릿 계약과 프로젝트 로컬룰이 충돌하면 `decision-log.md`에 선택 이유를 남깁니다.
