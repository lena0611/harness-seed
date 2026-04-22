# Policy Harness

정책 문서와 실제 소스 코드를 항상 동기화하기 위한 하네스입니다.

## 목적
- 정책 문서가 바뀌면 어떤 코드 영역을 재검토해야 하는지 자동으로 드러냅니다.
- 소스가 바뀌면 어떤 정책을 다시 확인해야 하는지 역으로 드러냅니다.
- 자동으로 검증 가능한 위반은 CI에서 실패 처리합니다.
- 새 세션에서도 이 트리거를 놓치지 않도록 세션 하네스와 연결합니다.

## 읽기 순서
1. [정책 담당 가이드](./policy-steward.md)
2. [동기화 프로토콜](./sync-protocol.md)
3. [강제 강도 기준](./enforcement-ladder.md)
4. [자동화 커버리지](./automation-coverage.md)
5. [Waiver 가이드](./waiver-guidelines.md)
6. `policy-registry.json`
7. `waivers.json`

## 실행 명령
```bash
npm run policy:impact
npm run policy:check
npm run policy:guard
```

## 구성 요소
- `policy-registry.json`: 정책 문서와 코드 영역의 연결 정보
- `enforcement-ladder.md`: 강제 강도와 예외 허용 범위 기준
- `automation-coverage.md`: 자동 검증/수동 검토 범위
- `waivers.json`: 승인된 예외 기록
- `scripts/policy-harness.mjs`: 영향 분석 및 위반 검사
- `.github/workflows/policy-guard.yml`: 푸시/PR 시 자동 실행

## 운영 원칙
- 정책 변경은 문서 수정으로 끝내지 않습니다. 영향을 받는 코드 영역을 반드시 다시 봅니다.
- 소스 변경은 기능 수정으로 끝내지 않습니다. 관련 정책 위반이 없는지 반드시 다시 봅니다.
- 새 세션은 작업 시작 전에 세션 하네스와 정책 하네스를 함께 읽습니다.
- 이 문서는 인덱스 역할을 유지하고, 세부 기준은 하위 문서로 계속 분리합니다.
