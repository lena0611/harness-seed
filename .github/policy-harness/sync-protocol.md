# 동기화 프로토콜

## 언제 반드시 실행하는가
- `.github/copilot-instructions/**`가 바뀔 때
- `.github/policy-harness/**`가 바뀔 때
- `src/**`가 바뀔 때
- 구조, 상태 관리, feature 경계에 영향을 줄 수 있는 리팩터링을 할 때

## 기본 실행 순서
1. `npm run policy:impact`
2. `npm run policy:check`
3. 필요 시 관련 정책 문서와 영향 영역을 함께 수정
4. 최종 확인은 `npm run guard`

## 세션 트리거
- 새 세션 시작 시 `session-boot.md`를 읽은 직후 이 프로토콜을 확인합니다.
- 정책 또는 소스 코드를 손대는 작업을 시작하면 `policy:guard`를 먼저 떠올립니다.
- 작업 완료 전에도 `policy:guard`를 다시 실행해 최종 위반이 없는지 확인합니다.

## 해석 원칙
- `policy:impact`는 "어디를 다시 봐야 하는지" 알려줍니다.
- `policy:check`는 "지금 바로 위반인지"를 알려줍니다.
- `policy:impact`가 출력한 영역이 넓더라도, 검토 대상에서 제외하지 않습니다.
- 자동 검사로 다 잡히지 않는 항목은 `automation-coverage.md`와 `waivers.json` 기준으로 추가 판단합니다.
