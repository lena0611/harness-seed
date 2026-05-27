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
- `pre-commit`은 전체 검증을 유지하고, `pre-push`는 `harness:check -- --fast`로 test/build 반복을 줄입니다.
