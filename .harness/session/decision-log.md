# 결정 로그

## 2026-04-28 - 하네스 본체를 .harness로 이동
- Copilot/GitHub 의존을 줄이기 위해 일반 하네스 본체를 `.github/`에서 `.harness/`로 이동했습니다.
- `.github/`에는 Copilot shim, GitHub Actions, GitHub issue/PR template처럼 GitHub 플랫폼에 속한 어댑터만 남깁니다.
- 범용 에이전트 진입점 `AGENTS.md`와 Claude 진입점 `CLAUDE.md`를 추가했습니다.
- 사내 표준 에이전트는 Claude로 정하고, `CLAUDE.md`를 모든 에이전트의 기준 진입점으로 승격했습니다. `AGENTS.md`와 Copilot instructions는 shim 역할만 합니다.
- `scripts/*`는 `.harness`를 우선 사용하고, 기존 `.github` 기반 설치본도 읽을 수 있도록 fallback을 유지합니다.
- stack 적용 마커는 새 구조에서 `.harness/.stack-applied.json`을 사용합니다.

## 2026-04-28 - Node 런타임 고정 및 init 안정화
- `.nvmrc`를 `22.14.0`으로 추가하고 `package.json`의 `engines.node`를 현재 Vite/ESLint 도구체인 요구사항(`>=20.19.0 || >=22.13.0`)에 맞췄습니다.
- 모든 npm harness 명령 앞에 `scripts/check-node-version.mjs`를 연결해 낮은 Node에서 문법 에러 대신 명확한 업그레이드 안내가 나오게 했습니다.
- `scripts/init.mjs`는 기존 프로젝트 병합 진입점이므로 낮은 Node에서도 최소한 버전 안내까지 도달하도록 최신 문법 사용을 피했습니다.
- vue3-fsd scaffold의 `npm run dev`는 clubadm의 `scripts/dev.sh` 패턴을 반영해 nvm 로드/설치, `.nvmrc` 전환, Node/패키지 변경 감지, 의존성 동기화, Vite 재기동 루프를 처리합니다.
- 팀 배포에서는 `github:lena0611/harness-seed#<tag>` 형태의 tag 고정 실행을 권장하고, 장기적으로 npm publish가 가능하도록 `bin`, `files`, `engines` 구성을 정리했습니다.

## 2026-04-27 - 시드 하네스 저장소 분리 및 이름 변경 (bareunmal → harness-seed)
- bareunmal은 원래 실제 작업 프로젝트로 의도되었으나, 작업 중 시드 하네스로 진화함을 인지했습니다.
- 시드 하네스의 정체성을 명확히 분리하기 위해 GitHub 저장소명을 `bareunmal` → `harness-seed`로 rename합니다.
- 코드/문서 내 참조를 일괄 교체했고 (`scripts/init.mjs`, `package.json`, `README.md`, `.harness-seed-mode`, scaffold의 기본 프로젝트명 등), 과거 결정 로그의 `bareunmal` 언급은 역사 기록으로 보존합니다.
- `scripts/apply-stack.mjs` 의 tmpdir prefix를 `bareunmal-stack-` → `harness-seed-stack-`으로 변경했습니다 (의미 변화 없음, 정체성 정합만 맞춤).
- 실제 작업 프로젝트는 추후 별도 repo로 분리합니다.

## 2026-04-22 - 기본 스캐폴드 채택
- Vue 3 + Pinia + Vite + TypeScript 조합으로 초기 스캐폴드를 구성했습니다.
- 도메인이 아직 없으므로 중립적인 예시 use-case만 두고 구조를 먼저 고정했습니다.

## 2026-04-22 - 아키텍처 규칙 문서 분리
- `.github/copilot-instructions.md`는 목차 역할만 하도록 유지했습니다.
- 세부 규칙은 주제별 문서로 분리해 긴 지침도 탐색하기 쉽게 만들었습니다.

## 2026-04-22 - GitHub Pages 자동 배포 채택
- 무료 정적 배포를 위해 GitHub Pages + GitHub Actions 구성을 채택했습니다.
- 저장소명을 반영하기 위해 Vite `base`를 `/bareunmal/`로 설정했습니다.

## 2026-04-22 - 세션 하네스 도입
- 새 세션이 이전 상태를 빠르게 복구할 수 있도록 `.harness/session/`를 추가했습니다.
- 장기 메모리와 단기 컨텍스트를 분리해 읽기 순서를 고정했습니다.

## 2026-04-22 - 정책 동기화 하네스 도입
- 정책 문서와 소스 코드의 상호 영향을 놓치지 않도록 `.harness/policy/`를 추가했습니다.
- 정책 영향 분석과 위반 검사를 `scripts/policy-harness.mjs` 및 GitHub Actions `policy-guard.yml`에 연결했습니다.

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
- 통합 가드(`npm run guard`)에 lint를 포함해 구조/정책 검증과 스타일 검증을 함께 돌리도록 했습니다.

## 2026-04-22 - 사전준비 운영 세트 확장
- 저장소 관리형 로컬 git hook, 테스트 기반, 협업 템플릿, 설정 계약을 추가했습니다.
- commit/push 이전 검증과 협업 입력 품질을 도메인 정의 전 단계에서 미리 고정했습니다.

## 2026-04-27 - 일반화 하네스와 스택 프리셋 분리
- 저장소를 일반 하네스(프레임워크 독립 인프라)와 스택 프리셋(프레임워크+디자인패턴 꾸러미)으로 분리했습니다.
- `vue3-fsd` 스택 자산을 `.harness/stacks/vue3-fsd/scaffold/`로 이동해 root가 스택-독립적이 되게 했습니다.
- `apply-stack.mjs`를 source adapter 패턴(`local` 구현, `tiged` 스텅)으로 설계해 향후 외부 저장소로 분리가 저비용으로 가능하도록 했습니다 (B안 + A-1 호환).
- `npm run stack:apply` / `stack:reset` / `stack:status` 명령과 `.github/.stack-applied.json` 마커를 도입했습니다.
- `guard.mjs`는 스택 미적용 시 lint/test/build를 자동 스킵하고 일반 검사만 실행합니다.
- `doc-link-check.mjs`는 scaffold 폴더를 orphan/링크 검사에서 제외하고, 코드 경로 참조는 활성 스택의 scaffold 내부도 허용하도록 해서 미적용 상태에서도 문서 참조가 유효하게 했습니다.
- A-1 마이그레이션 트리거 조건: 스택 수 ≥ 2 또는 외부 공유 필요 시.

## 2026-04-27 - tiged 어댑터 실구현 + 시드 검증 통한 결함 수정
- `apply-stack.mjs`의 `adapterTiged()`를 실제 구현했습니다 (`npx -y tiged --force <ref> <tmp>` → subdir 분리 → 파일 복사 + packageMerge 처리). 어댑터 반환 형태를 `{ copied, packageMergeData }` 객체로 통일했습니다.
- 외부 빈 디렉토리에 저장소를 풀어 시드 사용자 시나리오를 e2e 검증하던 중 두 가지 치명적 결함 발견:
  - `.github/.stack-applied.json` 마커가 tracked 상태였음 → 시드 사용자가 dev 머신의 적용 상태를 그대로 받음.
  - `package.json`이 머지된 상태(vue/pinia/vite 의존성 포함)로 tracked → root가 슬림이 아님.
- 두 결함 모두 수정: marker는 `.gitignore`로, root `package.json`/`package-lock.json`은 항상 슬림 상태(stack:reset 후)로만 커밋합니다.
- CI 워크플로(`policy-guard.yml`)에 `node scripts/apply-stack.mjs` 단계와 `npm install` 호출을 추가해, 슬림 root에서도 CI가 머지된 의존성으로 검증하도록 했습니다.
- `.gitignore`에 `.harness-backup/`도 미리 추가해 향후 흡수/백업 기능 도입을 위한 자리만 비워뒀습니다.
