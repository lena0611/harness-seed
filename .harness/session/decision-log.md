# 결정 로그

## 2026-05-14 - scan/handoff 공개 명령 정리
- 정식 공개 전 공개 명령을 `harness:scan`, `harness:handoff`, `harness:impact`, `harness:check` 중심으로 정리합니다.
- `harness:scan`은 프로젝트 구조, 스타일 출처, 기준 계층, 충돌 후보를 `.harness/session/project-scan-report.md`에 남깁니다.
- `harness:handoff`는 설치/업데이트 직후 개발자가 봐야 할 요약과 다음 액션을 `.harness/session/handoff.md`에 남깁니다.
- 에이전트 사고 흐름은 원시 내부 추론이 아니라 `[harness] request/context/impact/action/decision/verify` 형태의 visible trace로 설명합니다.
- 커밋 확정 단계는 `.github/commit-template.txt`의 한글 요약 + 하이픈 상세 + 검증 목록 형식을 따릅니다.

## 2026-05-14 - 로컬룰 누적 대응 원칙 추가
- 프로젝트 운영 기간이 길어져도 모든 로컬룰을 매번 프롬프트에 넣지 않습니다.
- 항상 읽는 최소 기준은 짧게 유지하고, `harness:context -- "<작업 설명>"`으로 작업별 읽을거리 후보만 좁힙니다.
- 길어진 룰은 인덱스, 최신 요약, 세부 문서, decision-log로 분리하고, 현재 따라야 할 기준만 상위 문서에 남깁니다.
- 한 번뿐인 구현 세부사항은 프로젝트 룰로 승격하지 않고, 반복 근거가 있는 도메인/구조/검증 기준만 승격합니다.

## 2026-05-14 - 개발자용 클릭형 가이드 도입
- 하네스 문서 전체를 개발자가 직접 읽고 이해하는 방식은 실제 도입 장벽이 높다고 판단했습니다.
- 정적 라이프사이클 이미지는 개요로 유지하되, 실제 사용 진입점은 `npm run harness:guide`로 생성되는 현재 상태 대시보드와 `.harness/documentation/guide/index.html` 클릭형 가이드로 둡니다.
- 클릭형 가이드는 요구 수신, 기준 탐색, 영향 판단, 구현, 검토, 검증, 커밋 확정 단계별로 관련 명령과 파일만 보여줍니다.
- `harness:guide`가 생성하는 `.harness/generated/harness-dashboard.html`은 런타임 산출물이므로 형상관리 대상에서 제외합니다.

## 2026-05-14 - 정식 공개 전 npm script alias 정리
- 정식 공개 전이라 과거 호환을 유지할 필요가 없으므로 오래된 공개 alias를 제거합니다.
- 개발자용 표준 명령은 `harness:guide`, `harness:scan`, `harness:check`, `standards:list`, `templates:list`, `stack:*`, `template:*`로 정리합니다.
- `policy:*`와 `docs:*`는 삭제하지 않고 하네스 관리자/CI용 세부 검사 명령으로 문서에서 분리합니다.

## 2026-05-14 - 소비자 프로젝트 npm script 축소
- 하네스 본체 개발용 npm script와 소비자 프로젝트에 주입되는 npm script를 분리합니다.
- `scripts/init.mjs`는 package.json의 모든 script를 병합하지 않고 소비자용 allowlist만 병합합니다.
- 소비자 프로젝트에는 `node:check`, `policy:*`, `docs:*`를 기본 주입하지 않고, 공개 명령인 `harness:impact`, `harness:check`를 통해 필요한 검사를 실행하게 합니다.
- 소비자용 script는 `node:check` npm script에 의존하지 않도록 `.harness/bin/check-node-version.mjs`를 직접 호출합니다.

## 2026-05-08 - 하네스 실행 Node와 프로젝트 빌드 Node 분리
- 공통 하네스, 스택 하네스, scaffold 템플릿이 서로 다른 `.nvmrc` 기준을 보이면 적용 프로젝트 개발자가 어떤 런타임을 선택해야 하는지 헷갈릴 수 있습니다.
- Jenkins 파이프라인에서 프로젝트 `.nvmrc`를 `nvm use`로 읽는 기존 프로젝트가 있으므로, 하네스 실행 기준과 프로젝트 빌드 기준을 분리합니다.
- 하네스 실행 최소 Node는 `20.19.0`으로 낮추고, 하네스 스크립트는 이 버전에서 동작하도록 유지합니다.
- 공통/스택 하네스는 소비자 프로젝트에 `.nvmrc`를 주입하지 않습니다.
- 적용 프로젝트의 `.nvmrc`는 프로젝트/Jenkins 빌드 계약으로 보고, scaffold 템플릿 적용 시에도 기존 파일을 자동 덮어쓰지 않습니다.
- Node 20은 2026-04-30에 EOL이므로 신규 프로젝트는 Jenkins 검증이 준비되는 대로 Node 22/24 전환을 검토합니다.

## 2026-04-30 - 최상위 기준 정책 위배 항목 보정
- `ai-standard/docs`의 최상위 길라잡이는 원본으로 두고, 하네스시드에는 참조 문서만 둡니다.
- `harness:scan` 리포트에 회사/스택/템플릿/프로젝트/개인 기준 계층과 충돌 후보 섹션을 추가해, 기준 충돌을 개발자가 선택할 수 있게 합니다.
- 프로젝트 적용 흐름은 공통 기준 직접 사용이 아니라 스택 기준 선택 중심으로 설명합니다. `none`은 예외 또는 전환 중 상태로 둡니다.
- scaffold 템플릿은 기본값이 아니라 후보 목록으로 표현하며, 현재 등록된 후보 예시만 문서에 남깁니다.
- 에이전트 작업은 로컬 git hook 설치 여부와 무관하게 완료 시 `harness:check`를 실행하는 Claude Code hook을 추가합니다.

## 2026-04-30 - policy 용어 설명 정리
- 외부 설명에서는 policy를 회사 규정처럼 보이게 쓰지 않고, "프로젝트가 반복적으로 지키기로 한 개발 기준"으로 풀어 설명합니다.
- `.harness/policy/` 폴더명과 `policy:*` 명령은 내부 구조명으로 유지하되, README와 하네스 문서에서는 개발 기준, 검증 기준, 기준 동기화라는 표현을 우선 사용합니다.

## 2026-04-29 - scan/check 설치 흐름 도입
- 처음 주입할 때는 기존 프로젝트 구조를 파악하는 `harness:scan`이 `.harness/session/project-scan-report.md`를 자동 생성합니다.
- 설치 직후 `harness:check`를 자동 실행해 하네스 문서, 정책, 링크, 스택 적용 상태가 기본적으로 맞는지 확인합니다.
- 새 문서와 CI 표기는 `harness:scan`과 `harness:check`를 기준으로 정리합니다.
- 자동 실행이 부담되는 환경을 위해 `init --no-scan --no-check` 옵션을 둡니다.

## 2026-04-28 - 하네스 본체를 .harness로 이동
- 특정 플랫폼 의존을 줄이기 위해 일반 하네스 본체를 `.harness/`로 이동했습니다.
- 플랫폼별 파일은 하네스 본체 밖의 어댑터로만 남깁니다.
- 범용 에이전트 진입점 `AGENTS.md`와 Claude 진입점 `CLAUDE.md`를 추가했습니다.
- 사내 표준 에이전트는 Claude로 정하고, `CLAUDE.md`를 모든 에이전트의 기준 진입점으로 승격했습니다. `AGENTS.md`는 보조 진입점 역할을 합니다.
- 하네스 실행 스크립트는 `.harness/bin/*`을 우선 사용하고, 과거 구조 기반 설치본도 읽을 수 있도록 fallback을 유지합니다.
- stack 적용 마커는 새 구조에서 `.harness/.stack-applied.json`을 사용합니다.

## 2026-04-28 - Node 런타임 고정 및 init 안정화
- `.nvmrc`를 `22.14.0`으로 추가하고 `package.json`의 `engines.node`를 현재 Node 기반 도구체인 요구사항(`>=20.19.0 || >=22.13.0`)에 맞췄습니다.
- 모든 npm harness 명령 앞에 `.harness/bin/check-node-version.mjs`를 연결해 낮은 Node에서 문법 에러 대신 명확한 업그레이드 안내가 나오게 했습니다.
- `scripts/init.mjs`는 기존 프로젝트 병합 진입점이므로 낮은 Node에서도 최소한 버전 안내까지 도달하도록 최신 문법 사용을 피했습니다.
- 당시 내장 scaffold의 실행 명령은 nvm 로드/설치, `.nvmrc` 전환, Node/패키지 변경 감지, 의존성 동기화 흐름을 처리하도록 설계했습니다.
- 팀 배포에서는 `git+<seed-repo-url>#<tag>` 형태의 tag 고정 실행을 권장하고, 장기적으로 npm publish가 가능하도록 `bin`, `files`, `engines` 구성을 정리했습니다.

## 2026-04-27 - 시드 하네스 저장소 분리 및 이름 변경 (bareunmal → harness-seed)
- bareunmal은 원래 실제 작업 프로젝트로 의도되었으나, 작업 중 시드 하네스로 진화함을 인지했습니다.
- 시드 하네스의 정체성을 명확히 분리하기 위해 저장소명을 `bareunmal` → `harness-seed`로 변경합니다.
- 코드/문서 내 참조를 일괄 교체했고 (`scripts/init.mjs`, `package.json`, `README.md`, `.harness-seed-mode`, scaffold의 기본 프로젝트명 등), 과거 결정 로그의 `bareunmal` 언급은 역사 기록으로 보존합니다.
- `.harness/bin/apply-stack.mjs` 의 tmpdir prefix를 `bareunmal-stack-` → `harness-seed-stack-`으로 변경했습니다 (의미 변화 없음, 정체성 정합만 맞춤).
- 실제 작업 프로젝트는 추후 별도 repo로 분리합니다.

## 2026-04-22 - 기본 스캐폴드 채택
- 초기에는 특정 스택 조합으로 스캐폴드를 구성했습니다.
- 도메인이 아직 없으므로 중립적인 예시 use-case만 두고 구조를 먼저 고정했습니다.

## 2026-04-22 - 아키텍처 규칙 문서 분리
- 세부 규칙은 주제별 문서로 분리해 긴 지침도 탐색하기 쉽게 만들었습니다.

## 2026-04-22 - 정적 배포 자동화 채택
- 정적 배포 자동화 구성을 채택했습니다.
- 저장소명을 반영하기 위해 당시 정적 빌드 base path를 설정했습니다.

## 2026-04-22 - 세션 하네스 도입
- 새 세션이 이전 상태를 빠르게 복구할 수 있도록 `.harness/session/`를 추가했습니다.
- 장기 메모리와 단기 컨텍스트를 분리해 읽기 순서를 고정했습니다.

## 2026-04-22 - 정책 동기화 하네스 도입
- 정책 문서와 소스 코드의 상호 영향을 놓치지 않도록 `.harness/policy/`를 추가했습니다.
- 정책 영향 분석과 위반 검사를 `.harness/bin/policy-harness.mjs` 및 CI 검증에 연결했습니다.

## 2026-04-22 - 프로젝트 하네스 및 세션 시작 알림 도입
- 아직 도메인이 없더라도 프로젝트 목적과 범위를 담을 수 있도록 `.harness/project/`를 추가했습니다.
- 새 세션에서 미해결 항목을 반드시 다시 보도록 `session-start-alert.md`를 최우선 읽기 대상으로 추가했습니다.

## 2026-04-22 - 개발자 입력 큐 도입
- 개발자 정보 부족으로 완료되지 못한 항목을 다음 세션에 다시 묻기 위해 `developer-input-queue.md`를 추가했습니다.
- 개발자에게는 항상 `지금 답변 / 이번 세션 유보 / 나중에 다시 묻기` 선택권을 남기도록 원칙을 고정했습니다.

## 2026-04-22 - 문서 인덱싱 하네스 도입
- 긴 문서가 한 파일에 계속 누적되지 않도록 `.harness/documentation/`를 추가했습니다.
- 문서군마다 인덱스 문서와 세부 문서를 나누는 규칙을 세션 시작 하네스에 연결했습니다.

## 2026-04-22 - 스타일 검증 하네스 도입
- 코딩 스타일을 문서와 자동 검사로 함께 유지하기 위해 `.harness/style/`와 ESLint 기반 검증을 추가했습니다.
- 통합 검사에 lint를 포함해 구조/정책 검증과 스타일 검증을 함께 돌리도록 했습니다.

## 2026-04-22 - 사전준비 운영 세트 확장
- 저장소 관리형 로컬 git hook, 테스트 기반, 협업 템플릿, 설정 계약을 추가했습니다.
- commit/push 이전 검증과 협업 입력 품질을 도메인 정의 전 단계에서 미리 고정했습니다.

## 2026-04-27 - 일반화 하네스와 스택 프리셋 분리
- 저장소를 일반 하네스(프레임워크 독립 인프라)와 스택 프리셋(프레임워크+디자인패턴 꾸러미)으로 분리했습니다.
- 스택 자산을 본체와 격리해 root가 스택-독립적이 되게 했습니다.
- `apply-stack.mjs`를 source adapter 패턴으로 설계해 향후 외부 저장소로 분리가 저비용으로 가능하도록 했습니다.
- `npm run stack:apply` / `stack:reset` / `stack:status` 명령과 stack 적용 마커를 도입했습니다.
- `guard.mjs`는 스택 미적용 시 lint/test/build를 자동 스킵하고 일반 검사만 실행합니다.
- `doc-link-check.mjs`는 scaffold 폴더를 orphan/링크 검사에서 제외하고, 코드 경로 참조는 활성 스택의 scaffold 내부도 허용하도록 해서 미적용 상태에서도 문서 참조가 유효하게 했습니다.
- A-1 마이그레이션 트리거 조건: 스택 수 ≥ 2 또는 외부 공유 필요 시.

## 2026-04-27 - tiged 어댑터 실구현 + 시드 검증 통한 결함 수정
- `apply-stack.mjs`의 `adapterTiged()`를 실제 구현했습니다 (`npx -y tiged --force <ref> <tmp>` → subdir 분리 → 파일 복사 + packageMerge 처리). 어댑터 반환 형태를 `{ copied, packageMergeData }` 객체로 통일했습니다.
- 외부 빈 디렉토리에 저장소를 풀어 시드 사용자 시나리오를 e2e 검증하던 중 두 가지 치명적 결함 발견:
  - stack 적용 마커가 tracked 상태였음 → 시드 사용자가 dev 머신의 적용 상태를 그대로 받음.
  - `package.json`이 프리셋 의존성 머지 상태로 tracked → root가 슬림이 아님.
- 두 결함 모두 수정: marker는 `.gitignore`로, root `package.json`/`package-lock.json`은 항상 슬림 상태(stack:reset 후)로만 커밋합니다.
- CI 검증에 `node .harness/bin/apply-stack.mjs` 단계와 `npm install` 호출을 추가해, 슬림 root에서도 머지된 의존성으로 검증하도록 했습니다.
- `.gitignore`에 `.harness-backup/`도 미리 추가해 향후 흡수/백업 기능 도입을 위한 자리만 비워뒀습니다.
