# 스타일 검증 규칙

## 현재 자동 검증 대상
- 프로젝트에 설치된 formatter/linter 설정
- 프로젝트에 적용된 스택 기준의 스타일 instruction
- scaffold가 적용된 경우 해당 scaffold의 lint 설정
- 공통 하네스의 문서/정책/링크 검증

세미콜론, quote, import 정렬 방식은 공통 하네스가 직접 정하지 않습니다. 해당 프로젝트의 로컬 방법론, formatter/linter 설정, 스택 프리셋 로컬 규칙을 따릅니다.

## 현재 검증 진입점
- 로컬: `npm run lint`
- 통합 검사: `.harness/bin/harness check`
- 원격: 프로젝트가 사용하는 CI에서 `.harness/bin/harness check --strict` 실행

## 확장 원칙
- 스타일 규칙이 반복적으로 리뷰 코멘트가 된다면 lint 규칙으로 승격합니다.
- 스타일 규칙이 의미적 판단을 요구하면 바로 자동화하지 않고 문서 규칙으로 유지합니다.
- 강제 강도와 예외 허용 범위는 `policy/enforcement-ladder.md` 기준으로 판단합니다.
- 새로운 스타일 패턴이 반복되면 `style-evolution.md` 기준으로 규칙 후보로 올립니다.
