# 스타일 검증 규칙

## 현재 자동 검증 대상
- single quote
- no semicolon
- import 정렬
- 과도한 빈 줄 금지
- 파일 끝 개행 유지

## 현재 검증 진입점
- 로컬: `npm run lint`
- 통합 가드: `npm run guard`
- 원격: `.github/workflows/policy-guard.yml`

## 확장 원칙
- 스타일 규칙이 반복적으로 리뷰 코멘트가 된다면 lint 규칙으로 승격합니다.
- 스타일 규칙이 의미적 판단을 요구하면 바로 자동화하지 않고 문서 규칙으로 유지합니다.
- 강제 강도와 예외 허용 범위는 `policy-harness/enforcement-ladder.md` 기준으로 판단합니다.
- 새로운 스타일 패턴이 반복되면 `style-evolution.md` 기준으로 규칙 후보로 올립니다.
