# Portability Guide

이 저장소를 다른 프로젝트(다른 프레임워크 또는 다른 도메인)로 옮기거나 새 저장소에서 같은 하네스 구조를 재사용할 때의 절차입니다.

## 분리 원칙
- 일반 인프라(세션/문서/기준 동기화/스타일 하네스, doc-link 검증, SYNC GAP 검출)는 모든 프로젝트에서 그대로 재사용합니다.
- 프레임워크-특화 검사는 프로파일로만 켜고 끕니다.
- 스택 기준과 scaffold 템플릿은 본체 내부에 고정하지 않고 외부 `manifest.json`으로 연결합니다.
- 플랫폼 어댑터(`.claude/`, `.codex/`, `.github/copilot-instructions*`)는 실행 도구별 진입 표면일 뿐이며 단일 진실 출처는 계속 `.harness/`입니다.

## 이식 절차
1. 기존 프로젝트 루트에서 프로젝트에 맞는 스택 하네스의 `npx -y git+<stack-harness-repo-url>#<tag> init`을 실행합니다. 안정 재현을 위해 `main`/`master` 대신 릴리스 tag를 사용합니다.
2. 스택 하네스가 내부적으로 공통 하네스를 설치하거나 업데이트하고, 자기 스택 기준을 로컬룰로 정착했는지 확인합니다.
3. `.harness/harness-lock.json`에서 실제 설치된 공통 하네스와 스택 하네스의 repo, ref, version을 확인합니다.
4. `.harness/session/project-scan-report.md`에서 기존 프로젝트 기준, 스타일 출처, 버전 상태, 충돌 후보를 확인합니다.
5. `npm run hooks:install`로 로컬 hook을 연결합니다.
6. scaffold가 필요하면 `npm run templates:list`로 별도 템플릿 후보를 확인하고 `template:apply`로 적용합니다.
7. scaffold 템플릿이 적용되었으면 `.harness/project/template-contract.md`에서 템플릿 사용 계약 브리지를 확인합니다.
8. scaffold가 함께 적용되었으면 `npm install` 후 `npm run harness:check`로 lint/test/build까지 검증합니다.
9. 새 스택 하네스가 필요하면 `.harness/stacks/authoring-guide.md`를 먼저 보고 외부 프리셋 저장소를 만듭니다. 기본 계약은 `package.json bin + scripts/init.mjs + manifest.json + policies.json + instructions/`입니다.
10. 새 scaffold 템플릿이 필요하면 `kind=scaffold-template`, `requiredStackHarness`, `template.guideRoot`, `source` 계약을 가진 별도 저장소로 둡니다.
11. `policy-registry.json`은 일반 개발 기준만 유지합니다. 스택-특화 기준은 스택의 `policies.json`으로만 둡니다.
12. `policy-harness.mjs`의 framework-specific 블록은 새 `checksKey`를 원할 때만 분기 확장합니다.
13. `project-charter.md`, `scope-contract.md`를 새 도메인 정보로 채웁니다.

## 플랫폼 어댑터 계약
- `.claude/`, `.codex/`, `.github/copilot-instructions*`는 공통 하네스가 설치할 수 있는 어댑터입니다.
- 어댑터는 context injection, tool hook, instructions처럼 실행 도구별 표면만 담당합니다.
- 어댑터를 추가하거나 제거하면 `package.json` files 목록, `scripts/init.mjs`, `scripts/test-init.mjs`, README, sync protocol을 함께 갱신합니다.
- 응답 형식 리마인더처럼 런타임 행동을 보강하는 항목은 정적 검사로 강제하지 않고, 어댑터 주입 문구와 진입점 문서로 유지합니다.

## Node 런타임 계약
- 하네스 실행 최소 Node는 `20.19.0`입니다. 하네스 스크립트는 이 버전에서 동작하도록 유지합니다.
- `package.json`의 `engines.node`는 `>=20.19.0`로 고정합니다.
- **하네스 실행 Node와 프로젝트 빌드 Node는 별개 계약입니다(dual-runtime, 0.2.63).** 프로젝트 Node가 20.19 미만이어도 하네스를 설치할 수 있습니다. hook/런처는 활성 Node가 낮으면 nvm 설치본 중 최신(>=20.19)으로 하네스 스크립트만 전환하고(`.harness/bin/dual-node.sh`), lint/test/build 등 프로젝트 검증은 guard가 `.nvmrc` Node로 되돌려 실행합니다(`.harness/bin/node-env.mjs`).
- 하네스 패키지는 소비자 프로젝트에 자신의 Node 버전을 `.nvmrc`로 주입하지 않습니다. 단, `.nvmrc`가 없는 프로젝트에서 사용자가 `init --project-node <ver>`로 확인해 주면 그 프로젝트의 기존 Node 버전을 `.nvmrc`로 기록합니다(프로젝트 버전 선언이지 하네스 버전 강요가 아닙니다).
- 적용 프로젝트의 `.nvmrc`는 프로젝트/Jenkins 빌드 계약입니다. 하네스 설치나 scaffold 템플릿 적용은 기존 `.nvmrc`를 자동 덮어쓰지 않습니다.
- 기존 `.nvmrc`가 Node 20.19 이상이면 그대로 단일 런타임으로 사용합니다(전환 없음). 더 낮은 버전이면 dual-runtime 모드로 설치하며, 설치 시 nvm·하네스 Node·프로젝트 Node 설치 여부를 진단합니다. nvm 자체가 없으면 전환 수단이 없으므로 설치를 중단하고 안내합니다(nvm 자동 설치는 하지 않습니다).
- `.nvmrc` 없는 Node 프로젝트에서 저버전 신호(package.json engines, .node-version, Dockerfile, CI)가 감지되면 추측으로 확정하지 않고 `--project-node` 인터뷰를 요구합니다. 비-Node 프로젝트(package.json 부재)는 `.nvmrc` 계약이 원래 없으므로 인터뷰 없이 설치됩니다.
- 저버전 `.nvmrc` 프로젝트에서 해당 Node가 nvm에 없으면 guard는 프로젝트 검증을 하네스 Node로 대신 실행하지 않고 `nvm install <ver>` 안내와 함께 실패합니다(검증 신뢰성 우선).
- Node 20은 2026-04-30에 EOL이므로 신규 프로젝트는 Jenkins 검증이 준비되는 대로 Node 22/24 전환을 검토합니다.
- 낮은 Node에서 harness 명령을 실행하면 `.harness/bin/check-node-version.mjs`가 먼저 실패해 문법 에러 대신 업그레이드/dual-runtime 안내를 보여줍니다. Windows(nvm-windows)는 dual-runtime 전환 없이 PATH node + 게이트 거동을 유지합니다.
- 최소 버전을 올릴 때 함께 바꿀 파일: `.harness/bin/check-node-version.mjs`, `.harness/bin/dual-node.sh`, `.harness/bin/node-env.mjs`, `scripts/init.mjs`, `package.json engines`.
- 각 프리셋이 추가 런타임 제약을 갖는 경우 해당 프리셋의 instruction 또는 manifest에 기록합니다.

## 소스 어댑터 (`source.type`)
- `local`: manifest 기준 상대 경로의 `scaffold/` 폴더에서 직접 복사. 현재 기본.
- `tiged`: 외부 원격 저장소에서 `npx tiged`로 scaffold를 가져오기.
- `none`: scaffold 파일 복사 없이 instruction만 로컬룰로 정착.
- 외부 스택 기준 연결: 일반 프로젝트 개발자는 스택 하네스의 `npx ... init`을 사용합니다. 관리자/고급 흐름에서는 `npm run stack:apply -- --preset-path <preset-dir>` 또는 `profile.json`의 `stackManifest`를 직접 사용할 수 있습니다.
- 외부 scaffold 템플릿 연결: `npm run template:apply -- --preset-path <template-dir>` 또는 `npm run template:apply -- --preset-git <repo-url> --ref <tag-or-branch>`를 사용합니다.
- 분리 시점: 스택을 다른 저장소에서 공유해야 하는 시점. 본체에 새 프리셋을 계속 추가하지 않습니다.
- 전환 방법: 스택 `manifest.json`의 `source` 섹션을 `{ "type": "tiged", "ref": "owner/repo#tag-or-branch" }`로 바꾸면 됩니다 (인터페이스 동일).

## 릴리스와 실행 방식
- 문서와 샘플에서는 저장소 종류와 무관하게 `<stack-harness-repo-url>` placeholder를 우선 사용합니다.
- 팀 배포 절차에는 `git+<stack-harness-repo-url>#vX.Y.Z`처럼 tag를 고정합니다.
- 스택 하네스의 `manifest.json`은 내부에서 사용할 공통 하네스의 `baseHarness.ref`를 고정합니다.
- 적용 프로젝트는 `.harness/harness-lock.json`으로 실제 설치된 일반/스택 하네스 ref와 version을 기록합니다.
- 적용 후 패치나 마이너 업데이트 후보는 `npm run harness:outdated`로 확인하고, 반영하려면 `npm run harness:update`를 실행합니다. 기본 전략은 현재 설치 버전의 SemVer caret 범위 안에서 최신 태그를 다시 선택하는 방식입니다.
- 공통 하네스만 업데이트할 때는 `npm run harness:update -- --base-only`를 사용합니다. 이 경로는 다음 업데이트 감지를 위해 `.harness/harness-lock.json`과 `.harness/install-manifest.json`에 공통 하네스의 git repo/ref/version을 남겨야 합니다.
- update 경로에서 선택 ref가 `semver:*`이면 lock/manifest에는 실제 설치된 package version tag(`vX.Y.Z`)를 기록합니다. 그래야 다음 `harness:outdated`가 움직이는 range가 아니라 현재 설치된 기준을 명확히 비교합니다.
- 과거 설치물에 base source가 `bundled`로 남아 있어도 스택 lock의 `requiredBaseHarness.repo`와 현재 base version으로 repo/ref를 복구할 수 있어야 합니다.
- 여러 소비 프로젝트에 업데이트 MR을 만드는 자동화는 향후 `ai-standard-cli`가 담당합니다. 이식 대상 프로젝트 안에서는 outdated 확인과 update 실행까지만 다룹니다.
- 사내 GitLab처럼 방화벽 내부 저장소를 쓰는 환경에서는 `git+https://git.example.com/group/my-stack-harness.git#vX.Y.Z` 형식이 가장 명시적입니다.
- npm publish로 전환할 때는 현재 `bin.harness-seed`, `files`, `engines` 구조를 그대로 사용할 수 있습니다. publish 전에는 패키지명을 확정하고 `npm pack --dry-run`으로 포함 파일을 확인합니다.


## 그대로 두는 것
- 세션 하네스 구조와 문서들
- 문서 인덱싱 규칙과 분리 기준
- 개발 기준 동기화 프로토콜과 강제 강도 기준
- doc-link 검증, SYNC GAP 검출, waiver 체계
- CI 워크플로 골격(`policy-guard.yml`)

## 검증
- 이식 직후 `npm run harness:check`를 실행합니다. CI나 릴리스 검증에서는 `npm run harness:check:strict`로 SYNC GAP을 실패 처리합니다.
