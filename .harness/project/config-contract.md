# Configuration Contract

프로젝트 설정과 환경값을 일관되게 추가하기 위한 계약 문서입니다.

## 환경값 원칙
- 공개 가능한 값과 비밀값을 먼저 구분합니다.
- 비밀값은 `.env.example`에 넣지 않습니다.
- 새로운 환경값을 추가하면 예시 설정 파일과 이 문서를 함께 갱신합니다.
- 스택별 접두사나 설정 명명 규칙은 공통 하네스가 정하지 않고 적용된 스택 하네스 또는 프로젝트 로컬룰을 따릅니다.

## 설정 추가 절차
1. 설정이 런타임인지 빌드타임인지 구분합니다.
2. 공개 가능한 값인지 비밀값인지 구분합니다.
3. 스택별 접두사나 naming convention이 있으면 해당 스택 기준을 따릅니다.
4. 사용 위치와 기본값 전략을 문서에 남깁니다.

## 현재 계약
- 예시 설정 파일은 공개 가능한 예시값만 포함합니다.
- 실제 비밀값은 저장소에 커밋하지 않습니다.
- 설정 계약이 바뀌면 project harness와 session harness에 반영합니다.

## 하네스 메타데이터 계약
- `.harness/harness-lock.json`과 `.harness/install-manifest.json`의 source metadata는 하네스 업데이트 감지를 위한 설정 계약입니다.
- 공통 하네스가 git source로 설치 또는 업데이트되면 `repo`, `ref`, `packageVersion`, `spec`을 git source 기준으로 기록합니다.
- 이 metadata 정규화는 프로젝트 런타임 `.nvmrc`나 Jenkins Node 계약을 바꾸지 않습니다. 하네스 실행 최소 Node는 계속 `20.19.0` 이상입니다.
