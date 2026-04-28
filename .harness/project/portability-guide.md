# Portability Guide

이 저장소를 다른 프로젝트(다른 프레임워크 또는 다른 도메인)로 옮기거나 새 저장소에서 같은 하네스 구조를 재사용할 때의 절차입니다.

## 분리 원칙
- 일반 인프라(세션/문서/정책 동기화/스타일 하네스, doc-link 검증, SYNC GAP 검출)는 모든 프로젝트에서 그대로 재사용합니다.
- 프레임워크-특화 검사(현재는 Vue/Pinia/FSD)는 프로파일로만 켜고 끕니다.

## 이식 절차
1. 기존 프로젝트 루트에서 `npx -y git+<seed-repo-url>#<tag> init`을 실행합니다. 안정 재현을 위해 `main`/`master` 대신 릴리스 tag를 사용합니다.
2. `npm run hooks:install`로 로컬 hook을 연결합니다.
3. `.harness/policy/profile.json`의 `activeStack`을 원하는 값으로 변경합니다 (구조만 쓰고 싶으면 `"none"`).
4. `npm run guard`로 일반 하네스가 통과하는지 먼저 확인합니다.
5. 스택 scaffold가 필요하면 `npm run stack:apply`를 실행합니다.
6. `npm install` 후 `npm run guard`로 lint/test/build까지 검증합니다.
7. 새 스택이 필요하면 `.harness/stacks/<new-id>/`를 추가하고(manifest.json + policies.json + instructions/ + scaffold/ + package.merge.json), `.harness/stacks/README.md` 표에 등록합니다.
8. `policy-registry.json`은 일반 정책만 유지합니다. 스택-특화 정책은 스택의 `policies.json`으로만 둡니다.
9. `policy-harness.mjs`의 framework-specific 블록은 새 `checksKey`를 원할 때만 분기 확장합니다.
10. `project-charter.md`, `scope-contract.md`를 새 도메인 정보로 채웁니다.

## Node 런타임 계약
- 기준 Node는 `.nvmrc`의 `22.14.0`입니다.
- `package.json`의 `engines.node`는 현재 Vite/ESLint 도구체인 요구사항에 맞춰 `>=20.19.0 || >=22.13.0`로 고정합니다.
- 낮은 Node에서 harness 명령을 실행하면 `scripts/check-node-version.mjs`가 먼저 실패해 문법 에러 대신 업그레이드 안내를 보여줍니다.
- vue3-fsd의 `npm run dev`는 `scripts/dev.sh`를 사용합니다. 이 스크립트는 nvm을 로드하거나 설치하고, `.nvmrc` 버전으로 전환하며, `package.json` 변경이나 Node 버전 변경 시 의존성을 동기화한 뒤 로컬 Vite 바이너리를 실행합니다.

## 소스 어댑터 (`source.type`)
- `local`: 스택의 `scaffold/` 폴더에서 직접 복사. 현재 기본.
- `tiged`: 외부 GitHub 저장소에서 `npx tiged`로 가져오기. 현재 `scripts/apply-stack.mjs`에 구현되어 있으며, 스택 수가 늘거나 외부 공유가 필요해지면 활성화합니다.
- 마이그레이션 시점: 스택 수 ≥ 2 또는 스택을 다른 저장소에서 공유해야 하는 시점. 그전까지는 `local` 유지.
- 전환 방법: 스택 `manifest.json`의 `source` 섹션을 `{ "type": "tiged", "ref": "owner/repo#tag-or-branch" }`로 바꾸면 됩니다 (인터페이스 동일).

## 릴리스와 실행 방식
- 문서와 샘플에서는 저장소 종류와 무관하게 `<seed-repo-url>` placeholder를 사용합니다.
- 팀 배포 절차에는 `git+<seed-repo-url>#vX.Y.Z`처럼 tag를 고정합니다.
- GitHub 저장소를 직접 쓰는 개인 환경에서는 `github:<owner>/<repo>#vX.Y.Z` 형식도 사용할 수 있습니다.
- 사내 GitLab처럼 방화벽 내부 저장소를 쓰는 환경에서는 `git+https://git.example.com/group/harness-seed.git#vX.Y.Z` 형식이 가장 명시적입니다.
- npm publish로 전환할 때는 현재 `bin.harness-seed`, `files`, `engines`, `.nvmrc` 구조를 그대로 사용할 수 있습니다. publish 전에는 패키지명을 확정하고 `npm pack --dry-run`으로 포함 파일을 확인합니다.


## 그대로 두는 것
- 세션 하네스 구조와 문서들
- 문서 인덱싱 규칙과 분리 기준
- 정책 동기화 프로토콜과 강제 강도 기준
- doc-link 검증, SYNC GAP 검출, waiver 체계
- CI 워크플로 골격(`policy-guard.yml`)

## 검증
- 이식 직후 `npm run guard`를 실행합니다. CI나 릴리스 검증에서는 `npm run guard -- --strict`로 SYNC GAP을 실패 처리합니다.
