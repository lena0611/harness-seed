# 작업 흐름 규칙

프로젝트 고유의 개발, 리뷰, 릴리스, 장애 대응 흐름을 기록합니다.

## 개발 흐름
- `TBD`

## 리뷰 기준
- `TBD`

## 릴리스 절차
- `TBD`

## 장애 대응
- `TBD`

## 검증 명령
- `TBD`

## 완료 승인 게이트
- 사용자의 일반 작업 지시는 기본적으로 `진행 중` 상태입니다.
- 사용자가 `완료`, `최종 검증`, `커밋`, `푸시`, `PR 생성`처럼 명시적으로 최종화 의사를 밝히기 전까지는 완료 승인 전으로 봅니다.
- 완료 승인 전에는 `npm run build`, `npm run test`, `npm run test:run`, `npm run e2e`, `npm run harness:check`, 배포, commit, push, PR 생성을 실행하지 않습니다.
- 무거운 검증이 필요해 보이면 실행하지 말고 `검증 후보`와 이유를 보고합니다.
- 완료 승인 뒤에만 변경 성격에 맞는 테스트, build, `harness:check`, commit, push를 실행합니다.
- git hook은 사용자가 commit/push를 승인한 뒤 실행되는 안전장치이며, 작업 완료 시점을 결정하는 장치가 아닙니다.

## 테스트 전략 선택지
테스트 루트나 `test` script가 없다면 아래 중 하나를 선택해 이 문서 또는 `decision-log.md`에 기록합니다.

1. 초기 단계: lint + build + 수동 확인
2. 단위 테스트: 프로젝트 스택에 맞는 unit test 도구 도입
3. 통합 테스트: API, 저장소, 외부 연동 경계 검증
4. E2E 테스트: 주요 사용자/운영 흐름 검증
5. 테스트 보류: 사유와 재검토 조건을 `decision-log.md`에 기록

## 변경 규칙
- 작업 흐름이 바뀌면 README, CI, hook, `harness:check` 명령과 함께 검토합니다.
- 임시 예외는 `waivers.json` 또는 `decision-log.md`에 범위와 만료 조건을 남깁니다.
- `npm run hooks:install`은 `core.hooksPath`를 `.githooks`로 설정합니다. 기존 `.git/hooks/*` 또는 기존 `core.hooksPath`의 hook은 삭제하지 않고 `harness.previousHooksPath`에 저장해 `.githooks/*`에서 먼저 체인 실행합니다.
- `pre-commit`은 사용자가 커밋을 승인하고 실제 commit이 실행될 때 전체 검증을 수행합니다.
- `pre-push`는 사용자가 push를 승인하고 실제 push가 실행될 때 `harness:check -- --fast`로 최종 안전 검사를 수행합니다.
