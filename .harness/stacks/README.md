# Stacks

이 저장소의 본체는 **공통 하네스(generic harness)** 입니다. 스택 기준과 scaffold 템플릿은 본체 밖에서 받아오는 선택형 자산입니다.

## 정의
- **공통 하네스**: 세션 복구, 기준 동기화, 문서 인덱싱, 스타일 출처 감지, doc-link 검사 등 어떤 프레임워크에서도 동일하게 쓰는 설치 엔진과 인프라.
- **스택 하네스**: 공통 하네스를 내부 베이스로 설치하거나 업데이트한 뒤, 특정 프레임워크, 런타임, 디자인 패턴에 맞춘 기준을 프로젝트 로컬룰로 정착시키는 사용자-facing 진입점.
- **스택 기준**: 스택 하네스가 제공하는 instruction 문서와 기준 매핑.
- **스택 템플릿**: 실제 프로젝트 scaffold 파일 묶음. 기준과 분리될 수 있습니다.

## 기본 상태
| id | 설명 | status |
| --- | --- | --- |
| `none` | 스택 기준을 아직 고르지 않았거나 예외적으로 공통 기준만 운영 | internal |

공통 하네스 본체는 특정 스택 기준이나 scaffold 템플릿을 포함하지 않습니다. 실제 프로젝트 개발자는 보통 스택 하네스의 `init`을 실행하고, 필요한 경우 별도 템플릿 저장소에서 scaffold를 적용합니다.

새 스택 하네스를 만들어야 한다면 먼저 [스택 하네스 작성 가이드](./authoring-guide.md)를 봅니다. API, 배치, 모바일, 라이브러리 패키지, 운영 도구처럼 서로 다른 스택도 같은 계약으로 만들 수 있습니다.

공통 하네스의 실행 로직은 소비자 프로젝트 루트의 `scripts/`에 드러내지 않고 `.harness/bin/` 아래에 둡니다. 스택 하네스의 사용자-facing `scripts/init.mjs`는 해당 스택 저장소의 설치 진입점으로만 두고, 적용 대상 프로젝트에는 공통 하네스 런타임을 `.harness/bin/` 형태로 정착시킵니다.

## 스택 하네스 후보 조회
사내 GitLab에서는 `ai-standard/harnesses` 하위 저장소를 스택 하네스 후보로 조회합니다.

```bash
npm run standards:list
```

비공개 그룹이면 토큰을 함께 전달합니다.

```bash
GITLAB_TOKEN=<private-token> npm run standards:list
```

스택 하네스 후보가 조회되면 각 후보의 설치 명령을 확인합니다.

```bash
npx -y git+<stack-harness-repo-url>#<tag> init
```

기본 조회 대상:
- GitLab URL: `https://git.smartscore.kr`
- 그룹: `ai-standard/harnesses`

필요하면 환경변수로 바꿉니다.

```bash
HARNESS_GITLAB_URL=https://git.example.com \
HARNESS_STACK_STANDARD_GROUP=ai-standard/harnesses \
npm run standards:list
```

## scaffold 템플릿 후보 조회
scaffold 템플릿은 업무 파일을 생성하거나 복사할 수 있는 별도 자산입니다. 스택 기준만 적용하려는 경우에는 필요하지 않습니다.

사내 GitLab에서는 `ai-standard/stacks` 하위 저장소를 템플릿 후보로 조회합니다.

```bash
npm run templates:list
```

비공개 그룹이면 토큰을 함께 전달합니다.

```bash
GITLAB_TOKEN=<private-token> npm run templates:list
```

현재 등록된 템플릿 후보 예시입니다. 실제 적용 방법은 해당 템플릿 저장소의 README와 manifest 계약을 먼저 확인합니다.

```bash
npm run template:apply -- --preset-git https://git.smartscore.kr/ai-standard/stacks/cloud-front-admin-template.git --ref <tag-or-branch>
```

템플릿을 적용하면 코드와 템플릿 개발 가이드는 프로젝트에 복사되고, `.harness/project/template-contract.md`에는 템플릿 사용 계약 브리지가 생성됩니다. 템플릿 가이드 전체를 프로젝트 로컬룰로 다시 복사하지 않고, 프로젝트별 예외와 보충 규칙만 `.harness/project/*`에 남깁니다.

기본 조회 대상:
- GitLab URL: `https://git.smartscore.kr`
- 그룹: `ai-standard/stacks`

필요하면 환경변수로 바꿉니다.

```bash
HARNESS_GITLAB_URL=https://git.example.com \
HARNESS_TEMPLATE_GROUP=ai-standard/stacks \
npm run templates:list
```

권장 그룹 구조:

```text
ai-standard
├── harnesses
│   ├── harness-seed
│   └── <stack-harness>
├── stacks
│   └── <scaffold-template>
├── agents
│   └── ai-standard-cli
├── policies
└── docs
```

- `harnesses`: AI 작업 규칙과 설치기 저장소 모음
- `stacks`: 프로젝트 scaffold 템플릿 모음
- `agents`: 자동화 CLI/라우터 모음
- `policies`: 회사 공통 기준 문서
- `docs`: 표준 문서 진입점

## 외부 스택 자산 계약
외부 스택 자산은 아래 구조를 가진 독립 폴더 또는 별도 저장소입니다. 사용자에게 직접 제공되는 스택 하네스라면 `package.json`의 `bin`과 `scripts/init.mjs` 같은 설치 진입점을 함께 둡니다.

```text
my-stack-preset/
  package.json              # 사용자-facing init bin이 필요한 경우
  manifest.json
  policies.json
  scripts/
    init.mjs                # 공통 하네스 설치 + 자기 스택 기준 적용
  instructions/
    architecture.md
  scaffold/                 # scaffold가 있는 경우에만 필요
    package.merge.json
    ...
```

`manifest.json`의 상대 경로는 manifest가 있는 폴더 기준으로 해석합니다.

```json
{
  "id": "my-stack",
  "title": "My Stack",
  "stackHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/my-stack.git",
    "ref": "v1.0.0",
    "range": "^1.0.0"
  },
  "baseHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git",
    "ref": "v0.2.18",
    "minVersion": "0.2.18"
  },
  "compatibility": {
    "allowEmptyProject": true,
    "expected": [
      { "package": "my-runtime", "major": 1, "label": "My Runtime 1" }
    ],
    "incompatible": [
      { "package": "other-runtime", "label": "Other Runtime" }
    ]
  },
  "instructions": ["instructions/architecture.md"],
  "policiesFile": "policies.json",
  "checksKey": null,
  "verify": {
    "lint": "composer lint",
    "test": "./gradlew test",
    "build": "./gradlew assemble"
  },
  "source": {
    "type": "local",
    "path": "scaffold",
    "packageMerge": "scaffold/package.merge.json"
  }
}
```

`verify`는 선택 섹션입니다. 비-Node 스택(PHP/Java/Swift/Kotlin 등)이 lint/test/build 검증을 npm script 없이 raw shell 명령으로 선언할 때 사용합니다. `harness check`(guard)는 stage별로 `verify.<stage>`가 있으면 그 명령을 프로젝트 루트에서 shell로 실행하고, 없으면 기존처럼 적용 프로젝트 `package.json`의 같은 이름 script로 fallback합니다. `verify` 섹션이 없는 기존 Node 스택은 이전과 동일하게 동작합니다. fast check(pre-push)에서는 npm script와 동일하게 test/build stage를 건너뜁니다.

스택 기준만 있고 scaffold가 없으면 `source.type`을 `none`으로 둡니다.

```json
{
  "id": "my-stack",
  "title": "My Stack",
  "stackHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/my-stack.git",
    "ref": "v1.0.0",
    "range": "^1.0.0"
  },
  "baseHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git",
    "ref": "v0.2.18",
    "minVersion": "0.2.18"
  },
  "compatibility": {
    "allowEmptyProject": true,
    "expected": [
      { "package": "my-runtime", "major": 1, "label": "My Runtime 1" }
    ],
    "incompatible": [
      { "package": "other-runtime", "label": "Other Runtime" }
    ]
  },
  "instructions": ["instructions/architecture.md"],
  "policiesFile": "policies.json",
  "checksKey": null,
  "source": {
    "type": "none"
  }
}
```

`stackHarness`는 사용자-facing 스택 하네스 자체의 저장소와 ref입니다. `range`는 `harness:update`가 같은 major 안에서 최신 버전을 다시 받을 때 우선 사용하는 SemVer 범위입니다. `baseHarness`는 그 스택 하네스가 내부적으로 설치해야 하는 공통 하네스입니다. 프로젝트 적용 결과에는 두 값이 모두 `.harness/harness-lock.json`에 기록됩니다.

## 적용 방법
일반 프로젝트 개발자는 스택 하네스의 `init`을 실행합니다.

```bash
npx -y git+<stack-harness-repo-url>#<tag> init
```

스택 하네스 `init`은 일반적으로 다음 순서로 동작합니다.

1. `baseHarness`에 명시된 공통 하네스를 설치하거나 업데이트합니다.
2. `compatibility` 계약으로 기존 프로젝트의 package stack과 이미 적용된 하네스 스택이 맞는지 선검사합니다.
3. 맞지 않으면 공통 하네스 설치 전에 중단하고, 조회 가능한 스택 하네스 목록에서 호환 후보가 있으면 추천합니다.
4. 자기 저장소의 `manifest.json`을 `stack:apply -- --preset-path <self>`로 적용합니다.
5. `.harness/stacks/.applied/<stack-id>/`에 스택 기준 스냅샷을 남깁니다.
6. `.harness/harness-lock.json`에 공통 하네스와 스택 하네스의 repo, ref, version을 기록합니다.
7. `harness:scan`, `harness:handoff`, `harness:check`를 실행합니다.

터미널이 대화형이면 추천 후보로 계속 진행할지 물을 수 있습니다. 자동화 환경에서는 추천 명령만 출력하고 사용자가 직접 실행하게 합니다. 마이그레이션 목적의 불일치 적용은 스택 하네스가 `--allow-mismatch` 같은 명시 옵션으로만 허용합니다.

공통 하네스가 이미 설치된 관리자/고급 흐름에서는 아래 명령을 직접 사용할 수 있습니다.

로컬 폴더에서 적용:

```bash
npm run stack:apply -- --preset-path ../my-stack-preset
```

원격 저장소에서 바로 적용:

```bash
npm run stack:apply -- --preset-git <repo-url> --ref <tag-or-branch>
```

프로젝트에 고정:

```json
{
  "activeStack": "my-stack",
  "stackManifest": ".harness/stacks/.applied/my-stack/manifest.json"
}
```

`stack:apply`는 선택한 스택 자산의 instruction을 `.harness/project/stack-preset-rules.md`에 로컬룰로 기록합니다. `source.type=none`이면 파일 복사 없이 기준 문서만 정착합니다. 따라서 스택의 스타일/아키텍처 기준은 공통 하네스의 전역 강제가 아니라, 해당 프로젝트가 선택한 로컬 기준으로 해석합니다.

scaffold 템플릿은 스택 기준과 분리해서 적용합니다.

```bash
npm run template:apply -- --preset-path ../my-scaffold-template
npm run template:apply -- --preset-git <repo-url> --ref <tag-or-branch>
```

`template:apply`는 템플릿 manifest의 `requiredStackHarness`가 현재 적용된 스택 하네스와 맞는지 확인한 뒤 파일을 복사하고, `.harness/project/template-contract.md`와 `.harness/templates/.applied/<template-id>/manifest.json`에 출처를 남깁니다. 템플릿을 되돌릴 때는 `npm run template:reset`, 적용 상태만 확인할 때는 `npm run template:status`를 사용합니다.

적용 후에는 `npm run harness:check`로 공통 하네스 문서, 기준, 링크, 적용된 스택 상태를 함께 확인합니다.

현재 프로젝트에 기록된 버전은 `npm run stack:status`와 `npm run harness:scan`의 `Harness Versions` 섹션에서 확인합니다. 스택 기준을 제거하면 `stack:reset`이 스택 하네스 잠금 정보도 비웁니다. 공통 하네스 버전은 그대로 남겨 이후 스택 하네스 재적용이나 업데이트 기준으로 사용합니다.

패치나 마이너 업데이트를 각 프로젝트에 반영하려면 적용 프로젝트에서 다음 명령을 다시 실행합니다.

```bash
npm run harness:outdated
npm run harness:update
```

`harness:outdated`는 원격 tag를 조회해 업데이트 후보만 확인하고 파일은 수정하지 않습니다. `harness:update`의 기본 전략은 `compatible`입니다. lock에 기록된 현재 버전이 `1.0.0`이면 `#semver:^1.0.0` 범위로 스택 하네스를 다시 받아 실행합니다. 특정 태그를 그대로 재실행하려면 `npm run harness:update -- --strategy locked`, 기본 브랜치 최신을 직접 따라가려면 `npm run harness:update -- --strategy latest`를 사용합니다.

여러 소비 프로젝트에 자동 MR을 만드는 기능은 이 저장소가 아니라 향후 `ai-standard-cli`에서 담당합니다. 이 저장소는 개별 프로젝트 안에서 outdated 확인과 update 실행까지만 제공합니다.

## 격리 원칙
1. 공통 하네스 문서와 스크립트는 특정 스택 폴더를 직접 참조하지 않습니다.
2. 스택 하네스는 공통 하네스를 복사해서 품지 않고, `baseHarness` 참조로 설치기를 호출합니다.
3. 스택 기준과 템플릿은 자체 완결적인 폴더 또는 저장소여야 합니다.
4. 스택 기준은 `policies.json`을 통해서만 일반 인프라에 노출합니다.
5. 스택 전용 자동 검사는 본체가 아니라 해당 스택 기준 또는 템플릿 저장소의 guard에 연결합니다.
6. 본체는 manifest, policies, instructions, scaffold를 읽고 적용하는 런타임 역할만 담당합니다.
