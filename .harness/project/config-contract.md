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
- 설치 완료 안내는 `.nvmrc`가 있을 때만 `nvm use`를 다음 단계로 보여줍니다. `.nvmrc`가 없으면 `nvm use` 단계는 건너뛰고, Node 계약이 필요할 때 `.nvmrc` 또는 `init --project-node <ver>`를 사용하라고 안내합니다. 이는 콘솔 안내 계약이며 프로젝트 런타임 설정을 자동 생성하지 않습니다.
- `init`은 package.json이 없으면 새로 만들지 않습니다(비-Node 프로젝트 보호). 이는 설치 표면 설정이며 프로젝트 런타임/환경값 계약을 바꾸지 않습니다. package.json이 있을 때만 harness npm 별칭을 멱등 머지하고, greenfield Node에서 강제로 만들려면 `init --with-package-json`을 사용합니다. package.json 유무와 무관하게 하네스 명령 실행에는 도구 런타임으로 Node 20.19 이상이 필요합니다(별칭이 없는 비-Node 프로젝트는 `.harness/bin/harness` 런처 또는 `node .harness/bin/<script>.mjs`로 직접 실행).
- npm 없이 하네스를 실행하는 `.harness/bin/harness` 런처도 각 명령 dispatch 전에 `.harness/bin/check-node-version.mjs`를 먼저 호출해 최소 Node(20.19+)를 강제합니다. npm 경로(`npm run node:check`)와 동일한 런타임 계약을 npm 없는 비-Node 프로젝트에도 적용하기 위함입니다.
- 플랫폼 어댑터(`.claude/`, `.codex/`, `.github/copilot-instructions*`) 설치와 갱신은 하네스 실행 표면 설정이며 프로젝트 런타임 `.nvmrc`, Jenkins Node 계약, 애플리케이션 환경값 계약을 바꾸지 않습니다.
- `.claude/settings.json`은 project-owned 설정이지만, 에이전트 안전 훅 wiring이 빠지지 않도록 `init`이 하네스의 hooks/permissions(deny·allow)/env/statusLine을 기존 소비자 설정에 멱등·비파괴로 병합합니다. 기존 키와 값은 보존하고 누락된 안전 표면만 추가하며, 이 병합은 프로젝트 런타임/환경값 계약을 바꾸지 않습니다.
- `init` 기본 출력은 설치 결과, 자동 스캔/인수인계/검사 성공 여부, 기존 AI 작업 룰 후보 수만 요약합니다. 내부 `node .harness/bin/...` 실행 명령과 원문 진단 로그는 실패 시 또는 `init --verbose`에서만 표시합니다. 이는 콘솔 표시 계약이며 설치 manifest, lock, Node 런타임 계약을 바꾸지 않습니다.
- 기존 AI 작업 룰 후보 감지는 리포팅 계약입니다. 하네스는 후보 문서를 자동으로 `profile.json sources[]`에 쓰지 않고, 팀 공유 기준으로 확정된 항목만 사용자가 프로젝트 소유 설정으로 등록합니다.
