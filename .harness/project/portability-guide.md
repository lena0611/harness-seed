# Portability Guide

이 저장소를 다른 프로젝트(다른 프레임워크 또는 다른 도메인)로 옮기거나 새 저장소에서 같은 하네스 구조를 재사용할 때의 절차입니다.

## 분리 원칙
- 일반 인프라(세션/문서/기준 동기화/스타일 하네스, doc-link 검증, SYNC GAP 검출)는 모든 프로젝트에서 그대로 재사용합니다.
- 프레임워크-특화 검사는 프로파일로만 켜고 끕니다.
- 스택 기준과 scaffold 템플릿은 본체 내부에 고정하지 않고 외부 `manifest.json`으로 연결합니다.

## 이식 절차
1. 기존 프로젝트 루트에서 프로젝트에 맞는 스택 하네스의 `npx -y git+<stack-harness-repo-url>#<tag> init`을 실행합니다. 안정 재현을 위해 `main`/`master` 대신 릴리스 tag를 사용합니다.
2. 스택 하네스가 내부적으로 일반 하네스를 설치하거나 업데이트하고, 자기 스택 기준을 로컬룰로 정착했는지 확인합니다.
3. `.harness/harness-lock.json`에서 실제 설치된 일반 하네스와 스택 하네스의 repo, ref, version을 확인합니다.
4. `.harness/session/absorb-report.md`에서 기존 프로젝트 기준, 스타일 출처, 버전 상태, 충돌 후보를 확인합니다.
5. `npm run hooks:install`로 로컬 hook을 연결합니다.
6. scaffold가 필요하면 `npm run templates:list`로 별도 템플릿 후보를 확인합니다.
7. scaffold가 함께 적용되었으면 `npm install` 후 `npm run harness:check`로 lint/test/build까지 검증합니다.
8. 새 스택 하네스가 필요하면 외부 프리셋 저장소를 만들고 `package.json bin + scripts/init.mjs + manifest.json + policies.json + instructions/` 계약을 맞춥니다. scaffold가 있는 경우에만 `scaffold/ + package.merge.json`을 추가합니다.
9. `policy-registry.json`은 일반 개발 기준만 유지합니다. 스택-특화 기준은 스택의 `policies.json`으로만 둡니다.
10. `policy-harness.mjs`의 framework-specific 블록은 새 `checksKey`를 원할 때만 분기 확장합니다.
11. `project-charter.md`, `scope-contract.md`를 새 도메인 정보로 채웁니다.

## Node 런타임 계약
- 기준 Node는 `.nvmrc`의 `22.14.0`입니다.
- `package.json`의 `engines.node`는 기본 하네스와 현재 도구체인 요구사항에 맞춰 `>=20.19.0 || >=22.13.0`로 고정합니다.
- 낮은 Node에서 harness 명령을 실행하면 `scripts/check-node-version.mjs`가 먼저 실패해 문법 에러 대신 업그레이드 안내를 보여줍니다.
- 각 프리셋이 추가 런타임 제약을 갖는 경우 해당 프리셋의 instruction 또는 manifest에 기록합니다.

## 소스 어댑터 (`source.type`)
- `local`: manifest 기준 상대 경로의 `scaffold/` 폴더에서 직접 복사. 현재 기본.
- `tiged`: 외부 GitHub 저장소에서 `npx tiged`로 scaffold를 가져오기.
- `none`: scaffold 파일 복사 없이 instruction만 로컬룰로 정착.
- 외부 프리셋 연결: 일반 프로젝트 개발자는 스택 하네스의 `npx ... init`을 사용합니다. 관리자/고급 흐름에서는 `npm run stack:apply -- --preset-path <preset-dir>` 또는 `profile.json`의 `stackManifest`를 직접 사용할 수 있습니다.
- 분리 시점: 스택을 다른 저장소에서 공유해야 하는 시점. 본체에 새 프리셋을 계속 추가하지 않습니다.
- 전환 방법: 스택 `manifest.json`의 `source` 섹션을 `{ "type": "tiged", "ref": "owner/repo#tag-or-branch" }`로 바꾸면 됩니다 (인터페이스 동일).

## 릴리스와 실행 방식
- 문서와 샘플에서는 저장소 종류와 무관하게 `<stack-harness-repo-url>` placeholder를 우선 사용합니다.
- 팀 배포 절차에는 `git+<stack-harness-repo-url>#vX.Y.Z`처럼 tag를 고정합니다.
- 스택 하네스의 `manifest.json`은 내부에서 사용할 일반 하네스의 `baseHarness.ref`를 고정합니다.
- 적용 프로젝트는 `.harness/harness-lock.json`으로 실제 설치된 일반/스택 하네스 ref와 version을 기록합니다.
- 적용 후 패치나 마이너 업데이트 후보는 `npm run harness:outdated`로 확인하고, 반영하려면 `npm run harness:update`를 실행합니다. 기본 전략은 현재 설치 버전의 SemVer caret 범위 안에서 최신 태그를 다시 선택하는 방식입니다.
- 여러 소비 프로젝트에 업데이트 MR을 만드는 자동화는 향후 `ai-standard-cli`가 담당합니다. 이식 대상 프로젝트 안에서는 outdated 확인과 update 실행까지만 다룹니다.
- GitHub 저장소를 직접 쓰는 개인 환경에서는 `github:<owner>/<repo>#vX.Y.Z` 형식도 사용할 수 있습니다.
- 사내 GitLab처럼 방화벽 내부 저장소를 쓰는 환경에서는 `git+https://git.example.com/group/my-stack-harness.git#vX.Y.Z` 형식이 가장 명시적입니다.
- npm publish로 전환할 때는 현재 `bin.harness-seed`, `files`, `engines`, `.nvmrc` 구조를 그대로 사용할 수 있습니다. publish 전에는 패키지명을 확정하고 `npm pack --dry-run`으로 포함 파일을 확인합니다.


## 그대로 두는 것
- 세션 하네스 구조와 문서들
- 문서 인덱싱 규칙과 분리 기준
- 개발 기준 동기화 프로토콜과 강제 강도 기준
- doc-link 검증, SYNC GAP 검출, waiver 체계
- CI 워크플로 골격(`policy-guard.yml`)

## 검증
- 이식 직후 `npm run harness:check`를 실행합니다. CI나 릴리스 검증에서는 `npm run harness:check:strict`로 SYNC GAP을 실패 처리합니다.
