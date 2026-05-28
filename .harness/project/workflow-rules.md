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
- commit/push 단계의 git hook 세부 기준은 [`commit-push-rules.md`](./commit-push-rules.md)에 둡니다.

## 테스트 전략 선택지
테스트 루트나 `test` script가 없다면 아래 중 하나를 선택해 이 문서 또는 `decision-log.md`에 기록합니다.

1. 초기 단계: lint + build + 수동 확인
2. 단위 테스트: 프로젝트 스택에 맞는 unit test 도구 도입
3. 통합 테스트: API, 저장소, 외부 연동 경계 검증
4. E2E 테스트: 주요 사용자/운영 흐름 검증
5. 테스트 보류: 사유와 재검토 조건을 `decision-log.md`에 기록

## 변경 규칙
- 작업 흐름이 바뀌면 README, CI, `harness:check` 명령과 함께 검토합니다.
- 임시 예외는 `waivers.json` 또는 `decision-log.md`에 범위와 만료 조건을 남깁니다.
- commit/push hook 정책을 바꾸는 변경은 [`commit-push-rules.md`](./commit-push-rules.md), `.githooks/**`, `.harness/bin/install-hooks.mjs`, `.harness/bin/run-previous-hook.mjs`를 함께 검토합니다.
