# 스택 하네스 작성 가이드

새 스택 하네스를 만들 때의 기준입니다. **언어와 프레임워크를 가리지 않습니다.** Node, PHP, Java, Python, Go — 어느 스택이든 저장소 모양, manifest 계약, 설치기의 순서, 검증, 배포 절차가 같습니다. 언어마다 다른 것은 "의존성을 어느 파일에서 읽고 호환성을 무엇으로 판정하는가" 하나뿐이고, 그것은 아래 「런타임별 차이」 표 한 개로 끝납니다. 언어별 가이드는 따로 만들지 않습니다(결정 105).

## 스택 하네스는 두 부분이다

| 부분 | 언어 | 하는 일 |
| --- | --- | --- |
| 설치기 | 항상 Node — `scripts/init.mjs` | `npx` 한 줄로 실행돼 호환성을 검사하고, 공통 하네스를 설치·업데이트한 뒤, 자기 지침을 프로젝트 로컬룰로 적용 |
| 지침 | 스택의 언어로 쓴 문서 — `instructions/*.md`, `policies.json` | 에이전트와 개발자가 작업 중 읽는 기준 |

설치기가 Node인 이유는 공통 하네스가 Node이고 `npx -y git+<repo>#<tag> init` 한 줄로 배포되기 때문입니다. PHP나 Java 스택이라도 저장소에는 설치기용 `package.json`이 있고, 소비자 프로젝트에는 Node 20.19 이상이 필요합니다 — 공통 하네스가 이미 요구하는 조건이라 새 부담은 아닙니다. **설치기는 견본을 복사해 쓰고, 지침만 새로 씁니다.** 설치기 700줄을 언어마다 다시 짤 일은 없습니다.

## 언제 새 스택 하네스를 만드는가

새 스택 하네스는 특정 기술스택에서 반복되는 개발 기준을 여러 프로젝트에 공유해야 할 때 만듭니다.

| 상황 | 둘 곳 |
| --- | --- |
| 모든 프로젝트가 따라야 하는 AI 작업 흐름, 세션 복구, 문서 동기화, 검증 절차 | 공통 하네스 |
| 특정 언어·프레임워크·런타임 조합에서 반복되는 기술 구조, 명령, 검증 기준 | 스택 하네스 |
| 관리자 앱 등 제품 유형별 계약, 초기 파일 묶음, 샘플 코드, 설정 파일 scaffold | 제품 템플릿 |
| 한 프로젝트의 도메인, 업무 예외, 운영 관례, 팀 고유 의사결정 | 프로젝트 로컬룰 |
| 개발자 개인의 선호나 개인 작업 방식 | 개인룰 |

스택 하네스에는 "이 기술 조합으로 개발할 때 제품 유형과 무관하게 지켜야 하는 방법"만 넣습니다. 관리자 메뉴, 권한, 인증 진입, 콘텐츠 SEO처럼 제품 유형에 종속된 계약은 제품 템플릿에 둡니다. 특정 프로젝트의 마이그레이션 사정, 임시 예외, 업무 도메인 용어, 고객사별 규칙은 프로젝트 로컬룰에 남깁니다.

한 저장소에는 스택을 하나만 적용할 수 있습니다(`profile.json`의 `activeStack`은 하나). 레거시 층과 모던 층처럼 한 저장소에 결이 다른 층이 여럿이면, **두 층이 함께 지키는 규칙만 스택에 담고** 한 층에만 해당하는 규칙은 그 프로젝트의 `.harness/project/*` 로컬룰이나 폴더 룰에 둡니다. 층마다 스택을 만들지 않습니다.

## 구성 순서 — 견본 복사에서 태그까지

순서대로 하면 하루 안에 첫 태그까지 갑니다. 각 단계의 판단 기준은 뒤 절에 있습니다.

1. **범위와 이름을 정합니다.** 위 표로 스택에 담을 것과 뺄 것을 가르고 이름을 하나 고릅니다. 저장소 이름 = `manifest.json`의 `id` = `package.json`의 `bin` 키. 소문자와 하이픈만 씁니다(예: `php-backend`, `spring-boot-api`, `vue3-vite-pinia-router`).
2. **견본을 복사합니다.** `.harness/bin/harness standards:list`가 보여주는 기존 스택 하네스 하나를 clone 해 `.git`을 지우고 새 저장소로 올립니다. 그대로 두는 것: `scripts/` 세 파일(설치기·자기 검사·자기 회귀), `package.json`, `.nvmrc`, `.gitignore`. 새로 쓰는 것: `manifest.json`, `policies.json`, `instructions/`, `README.md` 본문.
3. **`package.json`을 고칩니다.** `name`, `bin`의 키(= 스택 id), `version`(`0.1.0`부터). `files` 목록과 `engines`는 그대로 둡니다. 설치기는 의존성 없이 유지합니다 — `npx`가 매번 받아 실행하는 패키지입니다.
4. **`manifest.json`을 채웁니다.** 아래 계약 절의 표대로. `source.type`은 `none`으로 두고, package.json 병합이나 scaffold 절은 넣지 않습니다(다른 언어 저장소에 `package.json`을 만들어 버립니다).
5. **설치기에서 바꿀 곳은 셋뿐입니다.** ① 대상 프로젝트의 의존성 파일을 읽는 함수와 호환성 판정 함수 — 견본은 `package.json`을 읽으니 「런타임별 차이」 표의 자기 파일로 바꿉니다. ② 스택 id와 문구 상수(자기 검사 스크립트의 id 단언 포함). ③ 자기 회귀의 픽스처 — 견본의 "Vue 2 프로젝트면 중단" 테스트를 자기 언어의 "맞지 않는 프로젝트" 픽스처로. 공통 하네스 설치 → `stack:apply` → lock 기록 → scan/handoff/check로 이어지는 체인은 건드리지 않습니다.
6. **지침을 씁니다.** 첫 문서는 적용 범위와 제외 범위(overview), 마지막 문서는 그 언어의 검증 명령(verification). 사이는 그 스택의 진입점·데이터 흐름·외부 연동·배포 전 확인을 한 관심사씩 한 파일로 나눕니다.
7. **`policies.json`을 씁니다.** 본체가 요구하는 모양(아래 절)으로 5~10개. `ownedAreas`는 그 언어 저장소의 실제 폴더 glob입니다.
8. **저장소 안에서 검증합니다.** `npm run check`(manifest·정책·지침 정합)와 `npm run test:init`(설치기 회귀).
9. **실제 저장소에서 검증합니다.** 대상 저장소를 연습 폴더에 새로 clone 하고 `npx -y git+<repo>#<branch> init`을 실행해 아래 체크리스트를 확인합니다. 팀이 쓰는 저장소에 바로 하지 않습니다.
10. **태그를 만듭니다.** `manifest.json`의 `stackHarness.ref`와 `package.json`의 `version`을 만들 태그에 맞추고(`v0.1.0` ↔ `0.1.0`) 커밋한 뒤 태그를 push 합니다.
11. **카탈로그 등록을 요청합니다.** 본체 팀에 id·repo·ref를 전달하면 `.harness/stacks/registry.json`에 실려 다음 본체 릴리스부터 `standards:list`에 보입니다. 등록 전에도 `npx -y git+<repo>#<tag> init`으로 설치는 됩니다.

## 런타임별 차이 — 언어를 타는 유일한 곳

호환성 검사는 **스택 설치기가 혼자 합니다.** 본체는 `manifest.json`의 `compatibility`를 읽지 않으므로 그 안의 모양은 스택이 정하고, 판정 코드도 스택 저장소에 있습니다. 견본은 `package.json`을 읽으니 다른 런타임은 읽는 파일과 판정 근거만 바꿉니다.

| 런타임 | 의존성 선언 파일 | 호환성 판정 근거 | 참고 |
| --- | --- | --- | --- |
| Node | `package.json` | dependencies/devDependencies의 패키지와 major | 견본 그대로 |
| PHP | `composer.json` | `require.php` 범위, `require`의 패키지(예: `laravel/framework`) | `require`가 비어 있는 저장소가 흔합니다 → "정보 부족" 행으로 |
| Java / Kotlin | `pom.xml`, `build.gradle(.kts)` | groupId:artifactId와 버전(예: Spring Boot 2와 3), Java 버전 | XML·Gradle DSL은 정규식으로 충분합니다. 파서 의존성을 설치기에 추가하지 않습니다 |
| Python | `pyproject.toml`, `requirements.txt` | `requires-python`, 의존성(예: Django와 FastAPI) | |
| Go | `go.mod` | `go` 지시자, `module` 경로, `require` | |

판정 원칙은 언어와 무관하게 같습니다.

| 감지 결과 | 동작 |
| --- | --- |
| 의존성 파일이 없음(빈 프로젝트) | `allowEmptyProject`가 true면 진행 |
| 기대 의존성이 있고 버전이 맞음 | 진행 |
| 기대 의존성은 있지만 major가 다름 | 중단하고 이유 출력 |
| 명확히 다른 스택의 표지가 있음 | 중단하고 후보 추천 |
| 이미 다른 스택 하네스가 lock에 있음 | 중단하고 명시적 전환 절차 요구 |
| 정보가 부족함 | 중단보다 확인 질문 또는 `--dry-run` 안내 |

중단은 **공통 하네스를 설치하기 전에, 파일을 하나도 쓰지 않은 상태에서** 해야 합니다. 견본의 회귀(맞지 않는 프로젝트에서 `.harness/`도 `CLAUDE.md`도 생기지 않는지 확인)를 자기 언어 픽스처로 바꿔 유지합니다. 마이그레이션 목적의 불일치 설치는 `--allow-mismatch`처럼 명시 옵션으로만 허용하고, 일반 흐름에서 조용히 덮어쓰지 않습니다.

그 언어의 검증 명령(`php -l`, PHPStan, `mvn verify`, `pytest`, `go vet` 등)은 **지침에 문서로** 적습니다. manifest에 선언하지 않습니다 — 본체는 코드 품질 검사를 실행하지 않고 그 소유는 각 프로젝트입니다(0.2.131).

## 실제 프로젝트에서 추출할 것

기준 프로젝트를 볼 때는 아래 항목을 먼저 확인합니다.

| 항목 | 확인할 내용 |
| --- | --- |
| 런타임 | 언어와 버전 범위(레거시와 모던이 공존하면 교집합) |
| 프레임워크 | 프레임워크와 주요 라이브러리, 자체 제작 공통 라이브러리 |
| 폴더 구조 | 진입점, application, domain, infrastructure, test가 나뉘는 방식 |
| 데이터 흐름 | 상태 관리, DB 접근, API 호출, transaction, validation, error 처리 |
| 검증 명령 | lint, typecheck, test, build, contract test, migration check |
| 설정 출처 | `.editorconfig`, 린터·포매터 설정, 컴파일러·프레임워크 설정 |
| CI 관례 | PR에서 반드시 돌리는 명령과 실패 처리 기준 |
| 문서 관례 | README, API 문서, ADR, 변경 기록을 남기는 방식 |

분석 결과가 한 프로젝트에만 해당하면 바로 스택 기준으로 올리지 않습니다. 같은 스택의 다른 프로젝트에도 적용 가능한지 확인하거나 "로컬룰 후보"로 남깁니다.

## 포함하지 말아야 할 것

- 회사 전체 AI 작업 원칙
- 특정 프로젝트의 업무 도메인 규칙
- 관리자 앱, 회사 소개 사이트처럼 특정 제품 유형만 전제하는 메뉴, 권한, 화면 골격
- 고객사명, 내부 계정, 비밀 URL, 토큰, 실서비스 데이터
- 마이그레이션 중에만 필요한 임시 우회
- 프로젝트 scaffold 전체 파일 묶음
- 개발자 개인 취향만 반영한 규칙

제품 유형별 계약이나 scaffold가 필요하면 스택 하네스에 억지로 넣지 말고 제품 템플릿 저장소로 분리합니다(그룹 위치는 `.harness/stacks/README.md`의 권장 그룹 구조). 스택 하네스는 기술 기준을 맡고, 템플릿은 제품 계약과 초기 파일 생성을 맡습니다.

제품 템플릿 manifest에는 `requiredStackHarness`와 `contractChecks`를 선언합니다. `contractChecks`는 각 계약 항목의 근거 문서와 기대 경로, 의존성, npm script를 연결하며, 하네스는 이를 `.harness/session/template-gap-report.md`로 검사합니다. 기존 프로젝트에는 `template:apply -- --contract-only`로 업무 코드 복사 없이 계약만 연결할 수 있어야 합니다.

## 권장 저장소 구조

```text
my-stack-harness/
  package.json          # 설치기용 — 대상 언어와 무관하게 있어야 한다(bin, files, engines)
  .nvmrc                # 설치기 개발용. 소비자 프로젝트에 주입하지 않는다
  manifest.json
  policies.json
  README.md
  scripts/
    init.mjs            # 설치기: 호환성 검사 → 공통 하네스 설치 → stack:apply → lock → scan/handoff/check
    check.mjs           # 저장소 자기 검사: manifest·정책·지침 정합
    test-init.mjs       # 설치기 회귀: 빈 폴더·맞는 프로젝트·맞지 않는 프로젝트
  instructions/
    overview.md
    ...
    verification.md
```

scaffold를 함께 제공해야 하는 특수한 경우에만 아래를 추가합니다.

```text
  scaffold/
    package.merge.json
    ...
```

스택 기준만 제공한다면 `manifest.json`의 `source.type`은 `none`으로 둡니다. Node가 아닌 스택은 scaffold 절도 package.json 병합 절도 두지 않습니다.

## `manifest.json` 계약 — 본체가 읽는 키와 설치기 관례

`manifest.json`은 공통 하네스가 스택 기준을 읽는 계약입니다. 키마다 **누가 읽는지**가 다릅니다 — 본체가 읽는 키는 모양이 고정이고, 설치기만 읽는 키는 스택이 모양을 정합니다.

```json
{
  "id": "php-backend",
  "title": "PHP 백엔드 기술 스택 하네스",
  "description": "서비스 종류와 무관하게 이 회사의 PHP 백엔드 저장소에 적용하는 기술 기준입니다.",
  "version": 1,
  "stackHarness": {
    "repo": "https://git.smartscore.kr/<스택 그룹>/php-backend.git",
    "ref": "v0.1.0",
    "range": "^0.1.0"
  },
  "baseHarness": {
    "repo": "https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git",
    "ref": "v0.2.141",
    "minVersion": "0.2.141"
  },
  "compatibility": {
    "allowEmptyProject": true,
    "runtime": { "file": "composer.json", "label": "PHP >= 7.2", "range": ">=7.2" },
    "expected": [],
    "incompatible": [
      { "package": "laravel/framework", "label": "Laravel" }
    ]
  },
  "framework": { "language": "PHP 7.2–8.4", "data": "DAO", "i18n": "lang" },
  "designPattern": ["진입 스크립트 + 공통 라이브러리"],
  "instructions": [
    "instructions/overview.md",
    "instructions/verification.md"
  ],
  "policiesFile": "policies.json",
  "checksKey": null,
  "source": { "type": "none" }
}
```

| 필드 | 누가 읽나 | 역할 |
| --- | --- | --- |
| `id` | 본체 | 적용 프로젝트에 기록될 스택 식별자. 저장소 이름·`bin` 키와 같게 |
| `title`, `description` | 본체 | 사람이 읽는 이름과 한 줄 설명 |
| `version` | 본체 | manifest 형식 버전. 견본과 같게 `1` |
| `stackHarness` | 본체 | 이 스택 하네스 자신의 repo, ref, 업데이트 범위(`range`는 `harness:update`가 같은 major 안에서 최신을 받는 SemVer 범위) |
| `baseHarness` | 본체 | 내부적으로 설치할 공통 하네스. `ref`는 검증된 기준, `minVersion`은 최소 요구 |
| `compatibility` | **설치기만** | 설치 전 호환성 판정에 쓰는 자료. 본체는 읽지 않으므로 모양은 스택이 정한다(위 예시의 `runtime`은 관례일 뿐 계약이 아니다) |
| `framework`, `designPattern` | 본체 | 적용 결과 문서 머리에 표시되는 요약 |
| `instructions` | 본체 | 프로젝트 로컬룰로 정착될 지침 문서. 이 순서대로 이어 붙는다 |
| `policiesFile` | 본체 | 정책 목록 파일. 생략하면 `policies.json` |
| `checksKey` | 본체 | 스택 전용 검사 식별자. 본체는 실행하지 않고 경고만 내므로 `null` |
| `source` | 본체 | scaffold 적용 방식. 기준만 있으면 `none` |

## instruction 문서에 쓸 내용

instruction은 에이전트와 개발자가 실제 작업 중 읽는 문서입니다. "좋은 코드 작성"처럼 추상적인 문장보다 이 스택에서 판단을 좁혀주는 기준을 적습니다.

- 한 관심사에 한 파일, 파일당 1~2KB. 견본의 파일 아홉 개가 모두 이 크기입니다.
- 적용 결과는 `.harness/project/stack-preset-rules.md`의 관리 구간에 파일 순서대로 이어 붙습니다. 각 파일은 앞뒤 문서 없이도 읽혀야 합니다.
- 특정 프로젝트의 경로, 고객사, 계정, 실서비스 값은 쓰지 않습니다. 여러 저장소에 같은 문장이 들어간다고 생각하고 씁니다.
- 그 언어의 검증 명령은 마지막 문서(verification)에 **문서로** 적습니다. 어떤 변경에 어떤 확인이 따르는지 표로 두면 에이전트가 그대로 따릅니다.

백엔드 API 하네스라면 예를 들어 아래 항목이 의미 있습니다.

| 문서 | 예시 내용 |
| --- | --- |
| `overview.md` | 적용 범위와 제외 범위, 기본 원칙 |
| `architecture.md` | entrypoint, application, domain, infrastructure의 책임 경계 |
| `workflow.md` | API 추가, DB 변경, 배포 전 검증, 에러 재현 절차 |
| `validation.md` | request schema, response contract, error format, auth guard, transaction 검증 |
| `testing.md` | unit, integration, contract test를 언제 요구하는지 |
| `observability.md` | log field, trace id, metric, alert에 남길 최소 정보 |
| `verification.md` | 변경별 확인 표와 그 언어의 검증 명령 |

다른 스택에서는 해당 스택의 진입점, 상태/데이터 흐름, 외부 연동, 배포 전 검증 기준을 같은 방식으로 분리해 기록합니다.

## `policies.json` 작성 기준

`policies.json`은 지침을 "어느 폴더의 변경이 어느 기준에 닿는가"로 요약합니다. 본체 검사가 요구하는 모양이 있습니다.

```json
{
  "version": 1,
  "stackId": "php-backend",
  "policies": [
    {
      "id": "request-io",
      "title": "요청 입력과 응답 규약",
      "documents": [".harness/project/stack-preset-rules.md"],
      "ownedAreas": ["lib/**", "public/**"],
      "checks": []
    }
  ]
}
```

- `id`, `title`, `documents`, `ownedAreas`는 필수입니다(본체 정책 검사). `documents`는 지침이 정착되는 `.harness/project/stack-preset-rules.md`를 가리키면 됩니다.
- `ownedAreas`는 커밋 검사가 "이번 변경이 어느 정책에 닿았나"를 판단하는 glob입니다. 그 언어 저장소의 실제 폴더로 씁니다.
- `checks`는 빈 배열입니다. 본체는 스택 검사를 실행하지 않습니다.
- 정책은 너무 많이 만들지 않습니다. 실제 리뷰에서 반복적으로 지적되는 5개에서 10개로 시작하고, 작업 중 반복되는 문제를 근거로 늘립니다.

## `init`이 해야 할 일

스택 하네스의 `init`은 일반 프로젝트 개발자가 실행하는 진입점입니다.

```bash
npx -y git+<stack-harness-repo-url>#v0.1.0 init
```

권장 동작 순서는 다음과 같습니다.

1. 현재 프로젝트의 의존성 선언 파일(「런타임별 차이」 표)과 기존 `.harness/harness-lock.json`을 읽습니다.
2. 선택한 스택과 맞지 않으면 설치 전에 중단합니다.
3. 조회 가능한 후보 중 더 맞는 스택 하네스가 있으면 추천 명령을 보여줍니다.
4. `baseHarness`의 공통 하네스를 설치하거나 업데이트합니다.
5. `.harness/bin/harness stack:apply --preset-path <self>`로 자기 `manifest.json`을 적용합니다.
6. `.harness/harness-lock.json`에 공통/스택 하네스 버전을 남깁니다.
7. 기본적으로 `.harness/bin/harness scan`, `.harness/bin/harness handoff`, `.harness/bin/harness check`를 실행합니다.

호환성 검사에 실패했는데 일부 파일을 이미 썼다면 원복해야 합니다. 가장 좋은 방식은 공통 하네스 설치 전에 호환성 검사를 끝내는 것입니다.

## 검증 체크리스트

릴리스 전에는 최소한 아래를 확인합니다.

- 빈 폴더에 `npx ... init`을 실행해 성공하는가
- 호환되는 기존 프로젝트에 설치하면 기존 로컬룰과 설정을 보존하는가
- 맞지 않는 프로젝트에서는 설치 전에 중단하고 파일을 하나도 쓰지 않는가
- Node가 아닌 저장소에 설치했을 때 `package.json`이 새로 생기지 않는가
- 설치 후 `.harness/project/stack-preset-rules.md`에 instruction이 들어가는가
- `.harness/harness-lock.json`에 `baseHarness`와 `stackHarness`가 모두 기록되는가
- `.harness/bin/harness scan`이 스택과 충돌 후보를 리포트하는가
- `.harness/bin/harness check`가 통과하는가
- `.harness/bin/harness update --dry-run`으로 업데이트 대상이 추적되는가
- `npm pack --dry-run`에 필요한 파일만 포함되는가

## 버전 운영

스택 하네스는 SemVer tag로 배포합니다.

| 변경 | 버전 |
| --- | --- |
| 오탈자, 설명 보강, 검사 메시지 개선 | patch |
| 새 instruction, 새 검사, 호환성 확장 | minor |
| 기존 프로젝트의 판단 기준을 바꾸거나 중단 조건을 강화 | major |

소비 프로젝트는 `harness:update`로 같은 major 범위의 최신 patch/minor를 받을 수 있습니다. major 변경은 자동으로 올리지 말고 변경 의도를 확인한 뒤 적용합니다.

## 카탈로그 등록

소비자 프로젝트의 `standards:list`는 본체가 배포하는 `.harness/stacks/registry.json`을 읽습니다. 새 스택은 태그가 나온 뒤 본체 팀에 id·repo·ref를 전달해 등록을 요청하고, 다음 본체 릴리스부터 목록에 보입니다. 등록 전에도 `npx -y git+<repo>#<tag> init`으로 설치는 되므로 첫 팀 적용을 등록 때문에 기다릴 필요는 없습니다.

## 백엔드 API 하네스 예시 범위

백엔드 API 스택 하네스를 만든다면 다음 정도를 공통화할 수 있습니다.

- entrypoint, application, domain, infrastructure 책임 경계
- request validation과 response schema 위치
- 공통 error response 형식
- auth, permission, tenant context 처리 위치
- transaction과 외부 API 호출 경계
- DB migration 작성과 rollback 확인 흐름
- unit, integration, contract test 기준
- log, trace id, metric의 최소 기록 항목
- API 문서 또는 OpenAPI 갱신 기준

반대로 특정 서비스의 주문 상태, 회원 등급, 정산 정책, 레거시 이전 일정은 스택 하네스가 아니라 프로젝트 로컬룰에 둡니다.
