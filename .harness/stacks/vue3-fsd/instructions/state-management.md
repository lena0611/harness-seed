# State Management

## Pinia Rules
- Pinia는 상태 관리에만 사용합니다.
- store 내부에 비즈니스 로직을 구현하면 안 됩니다.
- store 내부에서 검증이나 복잡한 변환을 수행하면 안 됩니다.
- store는 core 함수를 호출해야 합니다.

## Composable Rules
- composable은 로직 컨테이너가 아니라 adapter입니다.
- composable에 비즈니스 로직을 넣으면 안 됩니다.
- composable은 Vue reactivity와 core를 연결하는 역할만 해야 합니다.
