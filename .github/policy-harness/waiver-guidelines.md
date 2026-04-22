# Waiver Guidelines

자동 또는 수동 정책에 대해 예외를 허용해야 할 때의 기록 기준입니다.

## 언제 waiver를 남기는가
- 정책 위반이지만 의도적이고 제한된 예외일 때
- 즉시 수정이 어렵고 이후 정리 계획이 있을 때
- 자동 검사만으로는 현재 의도를 표현할 수 없을 때

## waiver 최소 기록 항목
- `id`
- `policyId`
- `scope`
- `reason`
- `approvedBy`
- `createdAt`
- `expiresAt` 또는 `reviewAt`

## 원칙
- waiver는 영구 해법이 아닙니다.
- 이유 없이 기간 없는 waiver를 만들지 않습니다.
- 가능한 한 코드보다 문서와 레지스트리에 예외를 남깁니다.
- waiver 적용 여부가 애매하면 먼저 `enforcement-ladder.md` 기준으로 사용자 판단이 필요한지 확인합니다.
