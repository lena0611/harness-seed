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
- 업데이트로 공통 하네스 버전이 오르면 init은 이전 버전 → 새 버전 사이의 CHANGELOG 변경 항목을 `.harness/harness-lock.json`의 `lastUpdate`(`from`, `to`, `at`, `entries`)에 기록합니다. 이는 업데이트 변경 내역을 보여주기 위한 설정 데이터이며 `npm run harness:changelog`로 다시 읽습니다. 최초 설치처럼 이전 버전이 없으면 기록하지 않습니다.
- 이 metadata 정규화는 프로젝트 런타임 `.nvmrc`나 Jenkins Node 계약을 바꾸지 않습니다. 하네스 실행 최소 Node는 계속 `20.19.0` 이상입니다.
- 플랫폼 어댑터(`.claude/`, `.codex/`, `.github/copilot-instructions*`) 설치와 갱신은 하네스 실행 표면 설정이며 프로젝트 런타임 `.nvmrc`, Jenkins Node 계약, 애플리케이션 환경값 계약을 바꾸지 않습니다.
- `.claude/settings.json`은 project-owned 설정이지만, 에이전트 안전 훅 wiring이 빠지지 않도록 `init`이 하네스의 hooks/permissions(deny·allow)/env/statusLine을 기존 소비자 설정에 멱등·비파괴로 병합합니다. 기존 키와 값은 보존하고 누락된 안전 표면만 추가하며, 이 병합은 프로젝트 런타임/환경값 계약을 바꾸지 않습니다.
