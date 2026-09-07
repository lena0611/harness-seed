# 제품 템플릿 작성 가이드

새 scaffold 템플릿을 만들 때의 기준입니다. 이 문서는 템플릿을 **만드는 사람**용이라 설치본에는 배포하지 않습니다.

스택 하네스를 만드는 것과는 부담이 다릅니다. **템플릿은 설치기를 만들지 않습니다** — 공통 하네스의 `template:apply`가 적용합니다. 대신 스택에는 없는 것이 하나 있습니다: **계약 항목 선언**입니다.

| | 스택 하네스 | 제품 템플릿 |
| --- | --- | --- |
| 주는 것 | 규칙 문서만 | 실제 파일 + 그 코드가 전제하는 계약 |
| 설치기 | 자기가 만든다(Node, 견본 복사) | **없다.** 본체 명령이 적용 |
| 사용자가 실행 | `npx -y git+<repo>#<태그> init` | `harness template:apply --preset-git <repo> --ref <태그>` |
| 대상 `package.json` | 건드리지 않는다 | 선언하면 병합한다 |
| 고유 장치 | 호환성 선검사 | **계약 항목(`contractChecks`)** |

스택 하네스 쪽 기준은 [../stacks/authoring-guide.md](../stacks/authoring-guide.md)입니다. 언제 어느 층에 두는지(공통 하네스 / 스택 / 템플릿 / 프로젝트 로컬룰 / 개인룰)는 그 문서의 표를 씁니다.

## 언제 새 템플릿을 만드는가

**제품 유형이 반복될 때**입니다. 같은 기술 스택으로 같은 성격의 제품을 여러 번 만든다면, 그 제품 유형이 전제하는 계약과 초기 파일이 템플릿입니다.

- 스택 하네스에 담을 것: 기술 조합에서 제품 유형과 무관하게 지켜야 하는 방법.
- 템플릿에 담을 것: 그 제품 유형만의 계약 — 관리자 메뉴, 권한 코드, 인증 진입, 서버 주도 메뉴, 응답 규약, 화면 골격.
- 프로젝트에 남길 것: 그 서비스의 도메인 용어, 업무 예외, 고객사별 규칙.

**제품 유형이 한 번뿐이면 만들지 않습니다.** 그 프로젝트의 코드가 곧 그 제품입니다. 두 번째 프로젝트가 같은 골격을 원할 때가 만드는 시점입니다.

## 두 가지 적용 방식을 처음부터 전제한다

이게 템플릿 설계에서 가장 중요합니다. 같은 템플릿이 두 방식으로 적용됩니다.

| 방식 | 무엇이 일어나나 | 언제 쓰나 |
| --- | --- | --- |
| scaffold(기본) | 파일을 복사하고 계약을 연결한다 | 빈 프로젝트, 새로 시작 |
| `--contract-only` | **업무 코드와 프로젝트 소유 파일은 건드리지 않고**, `.harness` 아래에 계약·가이드 스냅샷·적용 기록만 만든다 | 이미 업무 코드가 있는 프로젝트 |

`--contract-only`를 주면 본체가 `source.type`을 강제로 `none`으로 다룹니다. 즉 **복사 로직은 건너뛰고 계약 항목만 살아남습니다.** 그래서 계약 항목이 "복사한 파일이 있다"는 전제 위에 서 있으면 기존 프로젝트에서는 전부 갭으로 뜹니다. 항목을 쓸 때 "이 프로젝트가 이 계약을 채택했다면 무엇이 있어야 하나"로 생각하고, 채택하지 않는 경우의 해법을 `remediation`에 적습니다.

## 권장 저장소 구조

```text
my-product-template/
  package.json           # 템플릿 자신의 버전. 설치기 bin은 필요 없다
  manifest.json
  README.md
  developmentGuide/      # 이 코드를 어떻게 쓰는지 — 계약 항목의 근거 문서
    README.md
    ...
  src/ · public/ · ...   # 복사될 실제 코드
  scripts/               # 템플릿 자신의 도구가 있으면(페이지 생성기 등)
```

복사 범위는 `source.path`가 정하고, 복사에서 뺄 것은 `source.exclude`가 정합니다. 템플릿 저장소 자체의 살림살이(`.git`, 자기 문서, 개발용 설정)는 exclude에 넣습니다.

## `manifest.json` — 본체가 실제로 읽는 것

키마다 누가 읽는지가 다릅니다. 아래는 코드에서 확인한 목록입니다(추측이 아닙니다).

```json
{
  "kind": "scaffold-template",
  "id": "my-product-template",
  "title": "관리자형 업무 앱 템플릿",
  "description": "한 줄 설명입니다.",
  "version": "0.1.0",
  "template": {
    "repo": "https://git.smartscore.kr/<scaffold 그룹>/my-product-template.git",
    "ref": "v0.1.0",
    "range": "^0.1.0",
    "guideRoot": "developmentGuide/README.md",
    "docs": [
      "developmentGuide/README.md",
      "developmentGuide/project-structure-guide.md"
    ]
  },
  "requiredStackHarness": {
    "id": "vue3-vite-pinia-router",
    "repo": "https://git.smartscore.kr/<스택 그룹>/vue3-vite-pinia-router.git",
    "ref": "v0.2.47",
    "minVersion": "0.2.47"
  },
  "baseHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git",
    "ref": "v0.2.142",
    "minVersion": "0.2.142"
  },
  "contractChecks": [],
  "source": {
    "type": "local",
    "path": ".",
    "packageMerge": "package.merge.json",
    "exclude": [".git", "developmentGuide", "manifest.json"]
  }
}
```

| 필드 | 하는 일 |
| --- | --- |
| `kind` | 본체가 스택인지 템플릿인지 가른다. `scaffold-template` |
| `id` | 프로젝트에 기록될 템플릿 식별자. 저장소 이름과 같게 |
| `template.repo` · `ref` · `range` | 이 템플릿 자신의 주소와 버전. **릴리스할 때 자기 태그 번호로 먼저 맞춘다** |
| `template.guideRoot` | 개발 가이드의 진입 문서. 적용 결과 문서가 이 경로를 가리킨다 |
| `template.docs` | 스냅샷에 남길 가이드 문서 목록. **계약 항목의 `docs`는 전부 여기 등록돼 있어야 한다** |
| `requiredStackHarness.id` | 이 템플릿이 요구하는 스택. 현재 프로젝트의 스택과 다르면 **적용이 중단된다** |
| `requiredStackHarness.minVersion` | 그 스택의 최소 버전. **0.2.143부터 실제로 비교하고, 낮으면 중단한다** |
| `requiredStackHarness.repo` · `ref` | 중단 안내에 찍히는 설치 명령을 만든다 |
| `baseHarness` | **기록용 필드다.** 설치 기록에 남고 사람이 읽지만, **본체는 이 값을 비교하지 않는다**(실측: guard·scan은 스택의 `baseHarness`만 본다). 공통 하네스 요구는 `requiredStackHarness`가 간접 보장한다 — 그 스택이 자기 `baseHarness`로 본체 버전을 강제하기 때문이다. 적을 때는 검증된 정확한 태그로 |
| `contractChecks` | 이 템플릿의 계약을 구조화한 검사 목록. 아래 절 |
| `source.type` | `local`(저장소 안 경로 복사) · `tiged`(원격에서 받아 복사) · `none`(복사 없음). `--contract-only`를 주면 강제로 `none` |
| `source.path` · `exclude` | 복사 범위와 제외 목록 |
| `source.packageMerge` | 대상 `package.json`에 병합할 파일. **선언하지 않으면 병합하지 않는다** |

**`minVersion`이 실제로 판정되려면 그 스택이 버전을 기록해야 합니다.** 스택 버전은 그 스택 프리셋의 `package.json`에서 읽힙니다. 스택 하네스의 `init`으로 설치하면 자동으로 기록되지만, 관리자가 `stack:apply --preset-path`로 `package.json` 없는 폴더를 붙였다면 기록이 없습니다. 그때 `minVersion`은 통과가 아니라 **판정 불능으로 차단**되고, 안내가 스택을 다시 적용하라고 알려줍니다(2026-09-07 실측).

`packageMerge`는 Node 제품 템플릿에서만 선언합니다. 대상 저장소에 `package.json`이 없는 제품이라면 선언하지 마세요 — 없던 파일이 생깁니다.

**병합 파일은 `package.json`이 아니라 별도 파일(`package.merge.json`)로 두세요.** 템플릿 저장소의 `package.json`은 그 저장소 자신의 것이고, 대상에 얹을 항목은 다릅니다(대상의 `name`·기존 script·기존 의존성을 지우면 안 됩니다). 병합 파일은 복사 대상에서 제외되고 `dependencies`·`devDependencies`·`scripts` 같은 섹션 단위로 **대상에 없는 키만 추가**됩니다. 템플릿 저장소의 `package.json` 자체를 대상에 복사하고 싶지 않다면 `exclude`에도 넣으세요.

## `contractChecks` — 이 템플릿만의 핵심

계약 항목은 **자연어 가이드를 기계가 확인할 수 있는 형태로 요약한 것**입니다. `harness template:gap`이 이 선언과 현재 프로젝트를 비교해 리포트를 냅니다. 본체는 가이드 문장의 의미를 추론하지 않습니다 — 여기 선언된 경로, 의존성, npm script, 문서 연결만 봅니다.

```json
{
  "id": "admin-app-shell",
  "title": "관리자 앱 shell과 route 진입점",
  "severity": "required",
  "pathsAll": ["src/layouts/AdminLayout.vue", "src/router/index.js"],
  "docs": [
    "developmentGuide/project-structure-guide.md",
    "developmentGuide/auth-entry-guide.md"
  ],
  "remediation": "관리자 shell을 채택하지 않는다면 프로젝트 예외를 decision-log.md에 기록합니다."
}
```

### 필수 조건 둘 (안 지키면 `invalid`)

1. **`docs`를 반드시 선언합니다.** 비어 있으면 그 항목은 `invalid`입니다. 그리고 적은 문서는 **모두 `template.docs`에 등록돼 있어야 하고 스냅샷에 실제로 있어야** 합니다. 근거 없는 계약을 만들지 못하게 하는 장치입니다.
2. **프로젝트에서 확인할 기대값을 최소 하나 선언합니다.** 아래 넷 중 하나라도 비어 있지 않아야 합니다. 다 비면 `invalid`입니다.

| 기대값 | 판정 |
| --- | --- |
| `pathsAll` | 나열한 경로가 **전부** 있어야 통과 |
| `pathsAny` | 나열한 경로 중 **하나라도** 있으면 통과 |
| `dependenciesAll` | 나열한 의존성이 전부 있어야 통과 |
| `scriptsAll` | 나열한 npm script가 전부 있어야 통과 |

경로는 glob 패턴을 씁니다. 구현이 여러 형태를 허용하는 계약이면 `pathsAll` 대신 `pathsAny`를 씁니다.

### 등급과 상태

- `severity`는 `recommended` 또는 그 밖(=`required`)입니다. **`recommended`라고 정확히 적지 않으면 필수로 취급됩니다.** 권장 항목은 반드시 그 낱말을 씁니다.
- 항목마다 결과가 셋입니다.

| 상태 | 뜻 |
| --- | --- |
| `matched` | 기대값을 만족한다 |
| `gap` | 만족하지 않는다. 무엇이 없는지 리포트에 나온다 |
| `invalid` | **선언 자체가 잘못됐다.** 근거 문서가 없거나 미등록이거나, 기대값이 하나도 없다 |

`invalid`는 프로젝트 잘못이 아니라 **템플릿 작성자 잘못**입니다. 릴리스 전에 0이어야 합니다.

### 몇 개를 만드나

실제 리뷰에서 반복적으로 지적되는 것 5개에서 10개로 시작합니다. 견본은 6개입니다. 항목마다 "이게 없으면 이 템플릿의 코드가 전제한 것이 깨진다"가 말이 되는지 확인하고, 안 되면 그건 계약이 아니라 취향입니다.

## `remediation`을 반드시 씁니다

`gap`이 떴을 때 프로젝트가 할 일을 적습니다. **"채택하지 않기로 했다면 어떻게 하는지"까지** 적으세요. 기존 프로젝트에 `--contract-only`로 연결하면 갭이 여럿 뜨는 것이 정상이고, 그때 이 문장이 "고치라는 건가 예외로 남기라는 건가"를 판정해 줍니다. 이 문장이 없으면 리포트가 잔소리가 됩니다.

## 개발 가이드 문서

`template.docs`에 적은 문서가 스냅샷으로 프로젝트에 남고, 적용 결과 문서(`.harness/project/template-contract.md`)가 그 진입점을 가리킵니다.

- 진입 문서(`guideRoot`)는 "이 템플릿이 무엇을 전제하고 무엇을 주는지"를 한 화면에 담습니다.
- 계약 항목마다 근거 문서가 있어야 하므로, **항목과 문서를 같이 설계합니다.** 문서를 다 쓰고 나서 항목을 붙이면 근거 없는 항목이 생깁니다.
- 특정 서비스의 도메인 용어, 고객사명, 실서비스 값은 쓰지 않습니다.

## 검증 체크리스트

릴리스 전에 최소한 아래를 확인합니다.

- 빈 폴더에서 스택 하네스 설치 → `template:apply`가 성공하는가
- 업무 코드가 있는 폴더에서 `template:apply --contract-only`가 **업무 코드와 프로젝트 소유 파일을 하나도 바꾸지 않는가**(`.harness` 아래 계약·스냅샷·기록은 생깁니다 — 그건 정상입니다)
- 요구 스택이 다른 프로젝트에서 적용이 중단되는가
- 요구 스택 최소 버전보다 낮은 프로젝트에서 중단되는가(0.2.143+)
- `harness template:gap` 리포트에 `invalid`가 0인가
- `template.docs`에 적은 문서가 스냅샷에 모두 들어가는가
- `package.json`이 없는 대상에 적용했을 때 그 파일이 새로 생기지 않는가(`packageMerge` 미선언 확인)
- `.harness/project/template-contract.md`와 `.harness/templates/.applied/<id>/manifest.json`이 남는가
- `harness check`가 통과하는가

**자기 검사 스크립트를 두는 것을 권합니다.** 스택 하네스에는 `npm run check`가 있어 manifest·정책·지침 정합을 자기 저장소에서 확인합니다. 템플릿에는 견본이 없지만, 최소한 이 정도는 스크립트로 잠글 가치가 있습니다 — `kind`가 맞는지, `contractChecks`의 모든 `docs`가 `template.docs`에 있고 파일로 실존하는지, 항목마다 기대값이 하나 이상인지, `packageMerge`를 선언했다면 그 파일이 있는지.

## 버전 운영과 릴리스

**이 저장소가 자기 릴리스를 소유합니다.** 공통 하네스나 스택 하네스가 새 버전을 냈다는 것만으로는 낼 이유가 되지 않습니다(결정 108).

`requiredStackHarness.ref`는 **검증된 정확한 태그**로 적습니다(`baseHarness`는 기록용이지만 같은 규칙을 씁니다). 범위 표기(`semver:<range>`)는 쓰지 않습니다 — 릴리스 시점 검증이 그 이후에 나올 본체·스택을 보장하지 못합니다(2026-09-07 외부 리뷰). 그래서 그 둘을 올리는 판단은 **그 버전을 대상으로 실제로 검증했을 때만** 합니다. 검증하지 않은 버전을 가리키면 신규 설치가 검증 안 된 조합을 받습니다.

| 변경 | 버전 |
| --- | --- |
| 오탈자, 가이드 보강 | patch |
| 새 계약 항목(권장 등급), 새 문서, 파일 추가 | minor |
| 필수 계약 항목 추가·강화, 복사 범위 축소, 요구 스택 상향 | major |

릴리스 순서입니다.

1. `package.json`의 `version`을 올립니다.
2. **`manifest.json`의 자기 ref를 만들 태그 번호로 먼저 맞춥니다** — `template.ref`와 `template.range`. 빼먹으면 배포된 태그가 한 세대 뒤 self-ref를 담습니다.
3. 위 체크리스트를 확인합니다.
4. 커밋 → 태그(`vX.Y.Z`) → 브랜치와 태그를 push 합니다.
5. 본체 카탈로그(`.harness/templates/registry.json`)는 **검증된 태그를 고정합니다.** 새 태그를 냈으면 본체 팀에 그 태그의 카탈로그 반영을 요청하세요 — 본체가 알아서 따라가지 않습니다. 새로 만든 템플릿을 목록에 처음 올릴 때도 같은 창구입니다. **등록 전에도 주소와 태그를 알면 적용됩니다.**

결번(재사용 금지 번호)이 있는 템플릿은 그 저장소의 릴리스 문서가 소유합니다. 본체 문서는 들고 있지 않습니다.
