# Style Harness

코딩 스타일을 문서와 자동 검사로 함께 유지하기 위한 하네스입니다.

## 목적
- 프로젝트 로컬 스타일 규칙과 실제 검사 설정을 연결합니다.
- 새 세션에서도 스타일이 구조 규칙과 별개로 중요한 검증 축임을 유지합니다.
- 코드가 늘어나도 프로젝트가 선택한 스타일 출처가 흔들리지 않게 합니다.

## 읽기 순서
1. [스타일 규칙](./style-rules.md)
2. [스타일 검증 규칙](./validation-rules.md)
3. [스타일 프리셋 후보](./presets.md)
4. [스타일 진화 규칙](./style-evolution.md)

## 실행 명령
```bash
npm run lint
```

## 운영 원칙
- 스타일 규칙은 로컬 방법론, formatter/linter 설정, 스택 프리셋 로컬 규칙이 함께 움직여야 합니다.
- 자주 반복되는 스타일 수정은 수동 리뷰가 아니라 자동 검사로 옮깁니다.
- 새로운 스타일 규칙을 추가하면 lint hook 또는 `harness:check` 포함 여부를 함께 판단합니다.
- `harness:scan`이 formatter/linter 설정에서 `Style Rule Draft`를 만들면, 개발자가 확인한 뒤 로컬 방법론에 승격합니다.
- 로컬 스타일 출처가 없으면 `presets.md`의 후보를 개발자에게 제안하고 선택을 기다립니다.
- 스타일이 쌓이면서 바뀌면 `style-evolution.md` 기준으로 후보를 승격합니다.
