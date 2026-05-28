# Documentation Harness

문서가 길어질수록 한 파일에 모든 내용을 쌓지 않고, 인덱스 문서와 세부 문서로 분리하기 위한 하네스입니다.

## 목적
- 긴 문서를 빠르게 탐색 가능하게 유지합니다.
- 새 세션이 필요한 문서를 순서대로 읽을 수 있게 합니다.
- 문서가 커져도 구조가 무너지지 않도록 목차화 규칙을 고정합니다.

## 읽기 순서
1. [문서 인덱싱 규칙](./indexing-rules.md)
2. [문서 분리 기준](./split-thresholds.md)
3. [개념 비교 맵](./concept-map.md)
4. [결과물 생성 흐름](./decision-flow.md)
5. [Workstream 대화창 분리 가이드](./workstream-chat-splitting-guide.md)
6. [클릭형 하네스 가이드](./guide/index.html)
7. `document-registry.json`

## 핵심 원칙
- 진입 문서는 **목차와 짧은 요약**만 담당합니다.
- 상세 내용은 주제별 하위 문서로 분리합니다.
- 문서가 길어지면 같은 파일을 계속 늘리지 말고 먼저 분리 여부를 판단합니다.
- 새 하네스나 개발 기준 문서를 만들면 registry에 등록합니다.
- npx init 진입점인 `scripts/init.mjs`처럼 사용자 프로젝트에 복사하지 않는 seed-only 파일은 문서에 남아 있어도 링크 검사에서 허용할 수 있습니다. 예외를 추가하면 이유를 함께 기록합니다.
- `.claude/` 아래의 Markdown 어댑터 문서도 문서 레지스트리 검사 대상입니다.
- `.harness/session/project-scan-report.md`, `.harness/session/handoff.md`, `.harness/install-manifest.json`, `.harness/harness-lock.json`처럼 명령 실행으로 생기는 런타임 산출물은 registry 필수 문서가 아니라 동적 산출물 예외로 둡니다.
- `profile.json`의 `stackManifest`가 외부 프리셋을 가리키면, doc-link 검사는 해당 manifest 기준 scaffold 경로도 활성 스택 산출물로 해석할 수 있습니다.

## 개발자 진입점
- 전체 문서를 읽기보다 `npm run harness:guide`로 현재 상태 대시보드와 클릭형 가이드에서 시작합니다.
- 클릭형 가이드는 요구 수신, 기준 탐색, 영향 판단, 구현, 검토, 검증, 커밋 확정의 각 단계에서 관련 명령과 파일만 보여줍니다.
- `npm run harness:guide -- --open`을 사용하면 생성된 대시보드를 브라우저로 열 수 있습니다.
- `harness:context`는 일반 개발자가 매 요청마다 실행하는 명령이 아니라, 에이전트가 큰 작업 전에 `Agent Decision Context`를 만들 때 사용하는 보조 명령입니다.
- 긴 대화창으로 작업 범위가 흐려지면 `workstream-chat-splitting-guide.md`를 참고해 프로젝트가 opt-in으로 대화창 분리 운영을 도입할 수 있습니다.
