# harness-seed

하네스시드는 프로젝트에 공통 개발 기준과 검증 절차를 설치하는 공통 시드입니다.

업무 코드나 scaffold를 직접 제공하는 템플릿이 아니라, 회사 공통 기준을 내부 베이스로 깔고 프로젝트가 선택한 스택 기준과 프로젝트 로컬 기준이 함께 동작하도록 연결합니다.

## 기본 관점

프롬프트는 의도를 전달하지만, 하네스는 실수했을 때 피해를 제한합니다.

하네스시드는 AI 에이전트를 완전한 천재 개발자로 전제하지 않습니다. 빠른 실행력을 가진 불완전한 자동화 도구로 보고, 그 주변에 테스트, 제한, 관찰, 복구, 차단 장치를 깔아 개발 중 발생할 수 있는 피해를 줄이는 것을 목표로 합니다.

## 목적

- AI 에이전트와 사람이 같은 개발 기준을 읽고 작업하게 합니다.
- 특정 기술스택에 종속되지 않는 공통 개발 흐름과 검증 절차를 프로젝트에 설치합니다.
- 회사 공통 기준, 스택 기준, 프로젝트 기준, 개인 기준이 공존할 수 있는 계층을 만듭니다.
- 기존 프로젝트의 코드 스타일, 아키텍처, 업무 규칙을 지우지 않고 로컬 기준으로 정리합니다.
- 기준 문서와 실제 코드, 설정, 검증 명령이 어긋나는 지점을 확인할 수 있게 합니다.

## 기대효과

- 새로 참여한 개발자나 AI 에이전트가 먼저 읽어야 할 기준 위치가 고정됩니다.
- 프로젝트마다 흩어져 있던 스타일, 도메인, 작업 절차를 문서와 명령으로 확인할 수 있습니다.
- 기존 전용 하네스나 개인 룰이 있더라도 보존하고, 필요한 연결 지점을 리포트로 제안합니다.
- `harness:doctor`로 현재 프로젝트의 스택, 문서, 스타일, 충돌 후보를 진단할 수 있습니다.
- `harness:check`로 문서 링크, 기준 동기화, 스택 적용 상태, lint/test/build 연결 상태를 검사할 수 있습니다.
- 스택 기준과 scaffold 템플릿을 분리해 기존 프로젝트와 새 프로젝트에 같은 방식으로 적용할 수 있습니다.

## 사용법

### 1. 프로젝트 폴더에서 스택 하네스 설치

실제 프로젝트 개발자는 보통 `harness-seed`를 직접 설치하지 않습니다. 프로젝트에 맞는 스택 하네스를 선택하면, 그 스택 하네스가 내부적으로 공통 하네스를 설치하거나 업데이트한 뒤 자기 기준을 로컬룰로 정착시킵니다.

이미 작업 중인 프로젝트라면 그 폴더로 이동합니다. 새 프로젝트라면 빈 폴더를 만든 뒤 같은 명령을 실행합니다.

```bash
cd my-project
npm run standards:list
npx -y git+<stack-harness-repo-url>#<tag> init
```

스택 하네스의 `init`은 다음 순서로 동작합니다.

1. 공통 하네스가 없으면 설치하고, 있으면 관리 파일을 업데이트합니다.
2. 기존 프로젝트의 package stack과 이미 적용된 하네스 스택이 선택한 스택 하네스와 맞는지 검사합니다.
3. 맞지 않으면 설치를 시작하기 전에 중단하고, 조회 가능한 후보 중 맞는 스택 하네스가 있으면 추천합니다.
4. 선택한 스택 기준을 `.harness/project/stack-preset-rules.md`에 프로젝트 로컬룰로 기록합니다.
5. 필요한 scaffold 템플릿을 별도로 적용하면 `.harness/project/template-contract.md`에 템플릿 사용 계약 브리지를 기록합니다.
6. `.harness/harness-lock.json`에 실제 설치된 공통 하네스, 스택 하네스, scaffold 템플릿의 repo, ref, version을 기록합니다.
7. 현재 프로젝트를 진단하고 `.harness/session/absorb-report.md`를 생성합니다.
8. `harness:check`로 문서 링크, 기준 동기화, 스택 적용 상태를 확인합니다.

자동 진단이나 검사를 끄고 싶으면 `--no-doctor`, `--no-check` 옵션을 사용합니다.

### 2. 진단 리포트 확인

설치 후 `.harness/session/absorb-report.md`를 먼저 봅니다. 이 리포트에는 감지된 기술 스택, 기존 스타일 설정, 기존 룰 문서, 충돌 후보, 확인 질문이 정리됩니다.

다시 진단하려면 다음 명령을 실행합니다.

```bash
npm run harness:doctor
```

### 3. 다른 스택 기준 조회

```bash
npm run standards:list
```

`standards:list`는 적용 가능한 스택 하네스 후보와 `npx ... init` 명령을 보여줍니다. 공통 하네스가 이미 설치된 관리자/고급 흐름에서는 `npm run stack:apply -- --preset-git <repo-url> --ref <tag>`로 직접 적용할 수도 있습니다.

### 4. 필요한 경우 scaffold 템플릿 선택

기존 프로젝트에 기준만 적용하는 경우에는 scaffold 템플릿이 필요하지 않을 수 있습니다. 새 프로젝트의 기본 파일 묶음이 필요할 때만 템플릿 목록을 확인합니다.

```bash
npm run templates:list
```

템플릿 적용 방식은 각 템플릿 저장소의 README와 manifest 계약을 기준으로 확인합니다.

공통 하네스가 설치된 상태에서 템플릿을 직접 적용하는 관리자/고급 흐름은 다음 명령을 사용합니다.

```bash
npm run template:apply -- --preset-git <template-repo-url> --ref <tag-or-branch>
```

템플릿의 전체 개발 가이드는 템플릿 저장소가 소유하고, 적용 프로젝트에는 `.harness/project/template-contract.md` 브리지만 생성됩니다. 프로젝트별 예외나 추가 규칙은 `domain-rules.md`, `architecture-rules.md`, `workflow-rules.md`에 남깁니다.

### 5. 검증과 커밋 차단 연결

개발 중에는 다음 명령으로 현재 기준과 프로젝트 상태를 확인합니다.

```bash
npm run harness:check
```

사람이 직접 커밋하는 흐름에서도 같은 검증을 강제하고 싶으면 git hook을 설치합니다.

```bash
npm run hooks:install
```

AI 에이전트 작업에서는 hook 선택 여부와 별개로 하네스 검증 기준을 따라야 합니다.

### 공통 하네스 직접 설치

`harness-seed` 직접 설치는 공통 기준 관리자, 스택 하네스 관리자, 또는 예외적으로 스택 기준 없이 공통 기준만 운영하는 프로젝트를 위한 고급 흐름입니다.

```bash
npx -y git+https://git.smartscore.kr/ai-standard/harnesses/harness-seed.git#v0.2.16 init
```

하네스시드는 계속 개선되므로 `main`, `master` 같은 움직이는 브랜치를 따라가며 최신 변경을 빠르게 받는 방식도 가능합니다. 다만 팀 프로젝트에서는 하네스 변경이 언제 들어왔는지 추적할 수 있도록 릴리스 태그인 `vX.Y.Z`를 고정해 주입하는 것을 권장합니다. 최신 버전으로 올릴 때는 스택 하네스의 새 태그로 다시 `init`을 실행하고, 생성된 변경분과 `harness:doctor`, `harness:check` 결과를 함께 확인합니다.

## 버전 추적과 업데이트

프로젝트에는 두 종류의 버전 정보가 남습니다.

| 파일 | 역할 |
| --- | --- |
| `.harness/install-manifest.json` | 공통 하네스가 어떤 파일을 설치/갱신했는지 추적하는 설치 manifest |
| `.harness/harness-lock.json` | 현재 프로젝트에 설치된 공통 하네스와 스택 하네스의 repo, ref, version을 기록하는 잠금 파일 |

스택 하네스의 `manifest.json`은 자신이 요구하는 공통 하네스를 `baseHarness`로 명시합니다. 예를 들어 스택 하네스 `v0.1.7`이 공통 하네스 `v0.2.16` 이상을 요구하면, 스택 하네스 `init`은 해당 공통 하네스를 먼저 설치하거나 업데이트합니다.

업데이트는 보통 다음처럼 진행합니다.

```bash
npm run harness:outdated
npm run harness:update
npm run harness:doctor
npm run harness:check
```

`harness:update`는 `.harness/harness-lock.json`을 읽고 현재 적용된 스택 하네스를 다시 실행합니다. 기본 전략은 `compatible`이며, 현재 설치된 버전의 SemVer caret 범위 안에서 최신 태그를 선택합니다. 예를 들어 `1.0.0`이 설치되어 있으면 `^1.0.0` 범위의 최신 패치/마이너를 받습니다.

```bash
npm run harness:outdated -- --json
npm run harness:outdated -- --fail-on-outdated
npm run harness:update -- --dry-run
npm run harness:update -- --strategy locked
npm run harness:update -- --strategy latest
npm run harness:update -- --range ^1.0.0
```

`harness:outdated`는 원격 tag를 조회해 업데이트 후보가 있는지만 확인하고 프로젝트 파일은 수정하지 않습니다. 향후 `ai-standard-cli`에서 여러 프로젝트에 업데이트 MR을 만들 때도 이 명령을 먼저 호출하는 방식으로 확장합니다.

같은 스택 하네스를 새 버전으로 다시 실행하면 공통 하네스 관리 파일은 업데이트되고, 스택 기준은 기존 적용분을 reset한 뒤 다시 적용됩니다. 프로젝트 소유 문서와 기존 업무 코드는 보존됩니다. 적용 후 `stack:status`와 `harness:doctor`에서 공통/스택 하네스 버전 상태를 확인할 수 있습니다.

## 하네스시드가 하는 일

하네스시드는 프로젝트에 다음을 추가합니다.

| 항목 | 역할 |
| --- | --- |
| `.harness/` | 회사 공통 기준 참조, 프로젝트 기준, 검증 기준, 세션 문맥을 담는 본체 |
| `.harness/project/local-methodology.md` | 프로젝트 고유 개발방법론의 진입점 |
| `.harness/project/stack-preset-rules.md` | 선택한 스택 기준이 프로젝트 로컬룰로 정착되는 문서 |
| `CLAUDE.md` | AI 에이전트가 가장 먼저 읽는 기준 진입점 |
| `AGENTS.md` | Claude가 아닌 에이전트도 같은 기준을 읽게 하는 보조 진입점 |
| `.claude/` | Claude Code용 명령, hook, 보조 에이전트 연결 |
| 플랫폼 어댑터 | 사용하는 코드 호스팅, CI, 에이전트 도구와 하네스를 연결하는 선택형 파일 |
| `scripts/` | 기준 동기화 검사, 문서 링크 검사, 프로젝트 분석, 스택 적용 명령 |
| `.githooks/` | 커밋 전 검증 연결 |

중요한 점은 업무 코드 자체를 대신 작성하는 것이 아니라, 작업 기준과 검증 경로를 프로젝트 안에 고정한다는 점입니다.

## 강제되는 것과 강제되지 않는 것

하네스시드는 모든 규칙을 처음부터 강제하지 않습니다. 규칙의 성격에 따라 단계가 다릅니다.

| 단계 | 의미 | 예시 |
| --- | --- | --- |
| 안내 | 사람이 읽고 판단해야 하는 기준 | 프로젝트 목적, 도메인 설명, 작업 원칙 |
| 초안 | 기존 설정이나 문서를 분석해 제안한 기준 | `.editorconfig`, `.eslintrc`에서 추출한 스타일 초안 |
| 로컬룰 | 프로젝트가 선택한 기준 | 프로젝트 고유 방법론, 적용한 스택 기준 |
| 검증 | 명령으로 확인 가능한 기준 | 문서 링크, 기준-코드 동기화, lint/test/build |
| 차단 | 통과하지 못하면 커밋이나 CI를 막는 기준 | git hook, CI check |

따라서 하네스시드는 모든 프로젝트에 같은 스타일을 강제하는 도구가 아닙니다.

예를 들어 기존 프로젝트가 세미콜론을 사용한다면, 하네스시드는 그것을 지우지 않습니다. `.eslintrc`, `.editorconfig`, formatter 설정을 읽고 `Style Rule Draft`로 정리한 뒤, 프로젝트 로컬룰로 승격할 수 있게 합니다.

## 기존 프로젝트에 넣으면 어떻게 되는가

기존 프로젝트에 하네스시드를 설치하면 다음 원칙을 따릅니다.

1. 기존 업무 코드는 덮어쓰지 않습니다.
2. 기존 하네스나 개인 룰 파일이 있으면 먼저 보존합니다.
3. 하네스시드가 만든 파일은 `.harness/install-manifest.json`으로 추적합니다.
4. 실제 설치된 공통/스택 하네스 버전은 `.harness/harness-lock.json`으로 추적합니다.
5. 출처를 알 수 없는 기존 파일은 기본적으로 프로젝트 소유로 봅니다.
6. 기존 로컬 방법론은 `.harness/project/` 아래 문서와 연결합니다.

즉, 기존 프로젝트의 개발 방식을 삭제하는 것이 아니라 다음처럼 공존시킵니다.

| 기존 프로젝트에 있는 것 | 하네스시드의 처리 |
| --- | --- |
| 기존 코드 스타일 설정 | 스타일 출처로 감지하고 초안 작성 |
| 기존 개인/전용 룰 문서 | 보존하고 브리지 섹션 후보 제안 |
| 기존 아키텍처 규칙 | 로컬 방법론 문서에 연결 |
| 기존 테스트/빌드 명령 | 검증 후보로 감지 |
| 기존 CI | 보존하고 필요한 check 연결만 검토 |

## 새 프로젝트와 기존 프로젝트

| 상황 | 권장 방식 |
| --- | --- |
| 기존 프로젝트에 회사 기준 적용 | 프로젝트에 맞는 스택 하네스 `init` 실행 후 기존 프로젝트 기준과 충돌 여부 확인 |
| 빈 프로젝트를 새로 시작 | 스택 하네스 `init` 실행 후 필요한 scaffold 템플릿 적용 |
| 이미 팀 전용 하네스가 있음 | 기존 하네스를 보존하고 브리지로 연결 |
| 스타일 기준이 이미 있음 | 설정 파일을 읽어 로컬룰 초안 생성 |
| 스타일 기준이 없음 | 프리셋 후보 중 선택 |

## 로컬 룰은 어떻게 자라는가

스택 하네스만 설치된 초기 프로젝트에는 프로젝트 고유의 도메인 규칙이 거의 없을 수 있습니다. 이 상태에서 AI 에이전트가 버그 수정을 맡으면, 하네스는 완성된 답을 주기보다 기존 코드에서 반복 패턴을 찾고 로컬 룰 후보를 남기게 합니다.

프로젝트 하네스를 의도적으로 만들거나 보강해야 한다면 `.harness/project/project-harness-guide.md`를 기준으로 삼습니다. 이 문서는 공통 하네스, 스택 하네스, 프로젝트 로컬룰, 개인룰의 역할을 나누고, 어떤 내용을 `domain-rules.md`, `architecture-rules.md`, `workflow-rules.md`로 승격할지 안내합니다.

예를 들어 "외부 시스템 동기화 작업에서 같은 이벤트를 재처리하면 중복 결과가 생긴다"는 버그가 들어왔다고 가정합니다.

1. 에이전트는 먼저 공통 기준과 스택 기준을 읽고, 입력 수집, 중복 판단, 저장, 외부 시스템 호출 중 어디가 책임 영역인지 좁힙니다.
2. 기존 처리 흐름들을 확인해 같은 외부 이벤트는 고유 키로 중복 처리를 막는다는 반복 패턴을 찾습니다.
3. 현재 버그도 같은 기준으로 수정하고 `npm run harness:check`로 검증합니다.
4. 이 패턴을 `.harness/project/architecture-rules.md`에 "외부 이벤트 처리에는 재처리 안전성을 확인할 수 있는 고유 키를 둔다"는 로컬 룰 후보로 기록합니다.
5. 같은 문제가 반복되면 `.harness/project/workflow-rules.md`에 외부 시스템 연동 변경 시 확인 항목으로 승격하고, 가능하면 테스트로 옮깁니다.

이 흐름에서 하네스가 하는 일은 프로젝트 도메인 규칙을 임의로 발명하는 것이 아닙니다. 기존 코드, 반복 패턴, 사용자 확인을 근거로 프로젝트의 기억을 `.harness/project/*`에 쌓아 다음 작업부터 에이전트가 추측 대신 로컬 기준을 따르게 만드는 것입니다.

## 설치 후 먼저 볼 것

`init`은 설치가 끝나면 기본적으로 현재 프로젝트를 진단하고, 하네스 설치 상태를 검사합니다. 그래서 일반적인 설치에서는 아래 명령을 따로 실행하지 않아도 됩니다. 프로젝트 상태를 다시 확인하고 싶을 때 같은 명령을 다시 실행합니다.

```bash
npm run harness:doctor
npm run harness:check
```

`harness:doctor`는 현재 프로젝트를 훑고 `.harness/session/absorb-report.md`를 생성합니다.

- 소스 루트
- 테스트 루트
- 빌드/CI 파일
- formatter/linter 설정
- 스타일 룰 초안
- 회사/스택/프로젝트/개인 기준 계층
- 공통/스택 하네스 버전 상태
- 기준 충돌 후보
- 기존 룰 문서와 하네스 연결 후보
- 확인이 필요한 질문

`harness:check`는 현재 하네스 기준으로 문서, 검증 기준, 링크, 적용된 스택 상태를 검사합니다. 스택이 아직 적용되지 않았으면 기준 동기화와 문서 검사만 실행하고 lint/test/build는 건너뜁니다.

실행 단계는 다음과 같습니다.

| 단계 | 실행 내용 | 적용 프로젝트에서의 의미 |
| --- | --- | --- |
| Node 버전 검사 | `npm run node:check --silent` | 공통 하네스 명령을 실행할 수 있는 Node 범위인지 확인합니다. 스택별 추가 런타임 요구사항은 해당 스택 하네스의 기준을 따릅니다. |
| 기준 영향도/가드 | `scripts/policy-harness.mjs guard` | 변경 파일이 어떤 개발 기준, 세션 기준, 스택 계약에 영향을 주는지 분석합니다. |
| SYNC GAP 탐지 | `policy-harness.mjs guard` 내부 | 문서만 바뀌었는지, 코드만 바뀌었는지 감지합니다. 일반 `harness:check`에서는 경고 중심이고, `harness:check:strict`에서는 실패 기준으로 봅니다. |
| 문서 링크/레지스트리 검사 | `scripts/doc-link-check.mjs` | 하네스 문서 registry, 마크다운 링크, 코드 경로 참조가 유효한지 확인합니다. |
| 하네스 버전 확인 | `.harness/harness-lock.json`, stack manifest | 적용된 스택 하네스가 요구하는 공통 하네스 버전과 현재 설치된 버전이 맞는지 확인합니다. |
| seed init 테스트 | `.harness-seed-mode`일 때 `scripts/test-init.mjs` | 하네스시드 본체 저장소에서만 init/reinstall/reset 흐름을 smoke test합니다. 일반 적용 프로젝트에서는 보통 실행되지 않습니다. |
| lint | `package.json`에 `lint` script가 있을 때 `npm run lint` | 적용 프로젝트의 linter/formatter/정적 검사 기준을 실행합니다. 실제 도구는 스택 하네스나 프로젝트 설정을 따릅니다. |
| test | `package.json`에 `test` script가 있을 때 `npm run test` | 적용 프로젝트가 정의한 테스트를 실행합니다. script가 없으면 건너뜁니다. |
| build | `package.json`에 `build` script가 있을 때 `npm run build` | 적용 프로젝트가 정의한 빌드 또는 패키징 검증을 실행합니다. script가 없으면 건너뜁니다. |

lint/test/build는 스택이 적용되어 `.harness/.stack-applied.json`이 있을 때만 실행됩니다. 스택 미적용 상태에서는 공통 하네스 검사만 실행하고, 프로젝트 업무 코드 검증은 스택 선택 이후로 미룹니다.

변경 파일 출력은 기본적으로 feature/source, 로컬 하네스, 설정, 하네스 baseline으로 그룹화합니다. 설치 baseline 파일 전체가 필요할 때만 상세 옵션을 사용합니다.

```bash
npm run harness:check -- --show-baseline
npm run harness:check -- --verbose
```

프로젝트 성숙도는 `.harness/policy/profile.json`의 `harnessMode`로 표현합니다.

| mode | 대상 | 검사 해석 |
| --- | --- | --- |
| `bootstrap` | 프로젝트 초입 또는 하네스 첫 적용 직후 | TBD와 초기 기준 추가를 정보성 안내로 봅니다. |
| `active` | 일반 개발 중 | 기준 후보와 decision-log 기록을 권장합니다. |
| `maintenance` | 안정화된 운영/유지보수 프로젝트 | 변경 영향도, 예외, 회귀 위험을 더 중요하게 봅니다. |
| `strict` | CI, 릴리스, 보호 브랜치 | SYNC GAP과 기준 누락을 실패 기준으로 봅니다. 보통 `harness:check:strict`와 함께 씁니다. |

이전 명령인 `npm run absorb:report`와 `npm run guard`도 계속 동작하지만, 새 문서에서는 `harness:doctor`, `harness:check`를 기준으로 설명합니다.

## 주요 명령

| 명령 | 역할 |
| --- | --- |
| `npm run harness:doctor` | 현재 프로젝트 진단 리포트 생성 |
| `npm run harness:check` | Node, 기준 영향도, 문서 링크, 버전, seed test, lint/test/build를 순서대로 실행하는 통합 검사 |
| `npm run harness:check:strict` | CI/릴리스용 엄격 검사 |
| `npm run policy:guard` | 개발 기준의 영향 분석과 위반 검사 |
| `npm run docs:check` | 문서 레지스트리, 링크, 코드 경로 검사 |
| `npm run absorb:report` | `harness:doctor` 호환 alias |
| `npm run guard` | `harness:check` 호환 alias |
| `npm run hooks:install` | 로컬 git hook 등록 |
| `npm run harness:outdated` | lock 기준으로 같은 major 범위의 업데이트 후보 조회. 파일 수정 없음 |
| `npm run harness:update` | lock에 기록된 스택 하네스를 다시 실행해 같은 major 범위의 최신 기준으로 업데이트 |
| `npm run standards:list` | 원격 스택 하네스 후보 조회 |
| `npm run stack:list` | `standards:list` alias |
| `npm run templates:list` | 원격 템플릿 후보 조회 |
| `npm run stack:status` | 활성 스택, 적용 상태, 공통/스택 하네스 버전 확인 |
| `npm run stack:apply` | 선택한 스택 기준을 로컬룰로 적용 |
| `npm run stack:reset` | 적용된 스택 기준 관리 섹션과 스택 산출물 제거 |
| `npm run template:status` | 적용된 scaffold 템플릿, 계약 브리지, 복사 파일 상태 확인 |
| `npm run template:apply` | 선택한 scaffold 템플릿을 적용하고 `template-contract.md` 브리지 생성 |
| `npm run template:reset` | 적용된 scaffold 템플릿 산출물과 계약 브리지 되돌림 |

## 스택 기준과 템플릿

하네스시드 본체는 특정 프레임워크를 전제로 하지 않습니다. 프로젝트에서는 회사 공통 기준을 직접 고르는 대신, 보통 회사 공통 기준을 기반으로 한 스택 하네스를 선택합니다.

현재 실제 스택 하네스가 하나뿐이어도 구조는 특정 스택에 묶여 있지 않습니다. API, 배치, 모바일, 라이브러리 패키지, 운영 도구처럼 다른 개발 스택도 같은 방식으로 별도 스택 하네스를 만들 수 있습니다. 새 스택 하네스를 만들 때는 `.harness/stacks/authoring-guide.md`를 기준으로 범위, manifest 계약, compatibility 검사, instruction 작성, 릴리스 절차를 정리합니다.

`none`은 스택 기준을 아직 고르지 않았거나, 예외적으로 공통 기준만 운영하는 내부 상태입니다. 일반 프로젝트 적용 흐름에서는 `harness:doctor` 리포트의 충돌 후보를 확인하고 스택 기준 선택 여부를 기록합니다.

본체에는 특정 스택 기준이나 템플릿을 넣지 않습니다. 스택 기준은 `ai-standard/harnesses` 쪽에서, 실제 scaffold 템플릿은 `ai-standard/stacks` 쪽에서 관리합니다.

스택 하네스 후보는 다음 명령으로 조회합니다.

```bash
npm run standards:list
GITLAB_TOKEN=<private-token> npm run standards:list
```

스택 하네스 후보가 조회되면 각 후보의 설치 명령을 확인합니다.

```bash
npx -y git+<stack-harness-repo-url>#<tag> init
```

`stack:apply`는 선택한 스택의 instruction을 `.harness/project/stack-preset-rules.md`에 로컬룰로 기록합니다. 스택 기준 패키지가 `source.type=none`이면 파일 복사 없이 기준 문서만 정착합니다.

즉, 스택 기준은 공통 하네스가 모든 프로젝트에 강제하는 규칙이 아니라, 이 프로젝트가 선택한 기준으로 정착됩니다.

스택 하네스는 자체 `init` 명령을 제공하는 것이 기본입니다. 공통 하네스가 이미 설치된 관리자/고급 흐름에서는 `npm run stack:apply -- --preset-path ../my-stack-standard` 또는 `npm run stack:apply -- --preset-git <repo-url> --ref <tag-or-branch>`를 직접 사용할 수 있습니다. 프로젝트에 고정하려면 `.harness/policy/profile.json`의 `stackManifest`에 적용 스냅샷 `manifest.json` 경로를 기록합니다.

scaffold 템플릿은 업무 파일을 생성하거나 복사할 수 있는 별도 자산입니다. 스택 기준만 적용하려는 경우에는 필요하지 않습니다. 새 프로젝트의 기본 파일 묶음이 필요할 때만 `ai-standard/stacks` 하위 저장소를 조회합니다.

```bash
npm run templates:list
GITLAB_TOKEN=<private-token> npm run templates:list
```

현재 등록된 템플릿 후보 예시는 다음 저장소입니다. 실제 적용 방법은 해당 템플릿 저장소의 README와 manifest 계약을 먼저 확인합니다.

```bash
npm run template:apply -- --preset-git https://git.smartscore.kr/ai-standard/stacks/cloud-front-admin-template.git --ref <tag-or-branch>
```

scaffold 템플릿의 개발 가이드는 프로젝트 로컬룰 전체로 복사하지 않습니다. 템플릿을 적용하면 `.harness/project/template-contract.md`가 생성되어 템플릿 저장소의 가이드와 현재 프로젝트 하네스를 연결합니다. 현재 프로젝트에서 템플릿 계약을 다르게 해석하거나 예외를 두면 관리 섹션 밖 또는 다른 `.harness/project/*` 문서에 기록합니다.

권장 그룹 구조는 다음과 같습니다.

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

역할은 `harnesses`가 AI 작업 규칙과 설치기 저장소, `stacks`가 프로젝트 scaffold 템플릿, `agents`가 자동화 CLI/라우터, `policies`가 회사 공통 기준 문서, `docs`가 표준 문서 진입점입니다.

## 여기서 말하는 policy

문서와 명령에 남아 있는 `policy`는 회사 규정이라는 뜻이 아니라, **프로젝트가 반복적으로 지키기로 한 개발 기준**을 뜻합니다.

예를 들면 “문서를 추가하면 레지스트리에 등록한다”, “기준 문서를 바꾸면 관련 스크립트도 함께 본다”, “특정 계층은 다른 계층을 직접 참조하지 않는다” 같은 기준입니다. `.harness/policy/`는 이런 기준이 코드, 문서, CI와 어긋나지 않는지 추적하는 내부 하네스 영역입니다.

## init 업데이트 옵션

`init`은 기존 하네스 파일이 있으면 먼저 `.harness-backup/<timestamp>/`에 백업합니다. `.harness/install-manifest.json`으로 하네스시드가 만든 파일인지 판단하고, 관리 파일은 갱신하며, 프로젝트 소유 파일과 출처를 알 수 없는 기존 하네스 파일은 보존합니다.

```bash
npx -y git+<seed-repo-url>#vX.Y.Z init --dry-run
npx -y git+<seed-repo-url>#vX.Y.Z init --force
npx -y git+<seed-repo-url>#vX.Y.Z init --no-doctor --no-check
npx -y git+<seed-repo-url>#vX.Y.Z init --from-git <seed-repo-url> --ref vX.Y.Z
```

`--no-doctor`는 설치 직후 프로젝트 진단 리포트 자동 생성을 끕니다. `--no-check`는 설치 직후 하네스 기본 검사 자동 실행을 끕니다.

보존 대상 예시는 `.harness/project/project-charter.md`, `.harness/project/local-methodology.md`, `.harness/project/stack-preset-rules.md`, `.harness/project/domain-rules.md`, `.harness/project/architecture-rules.md`, `.harness/project/workflow-rules.md`, `.harness/session/active-context.md`, `.harness/policy/profile.json`, `.harness/policy/waivers.json`, `.claude/settings.local.json`입니다.

## Claude Code 어댑터

`.claude/`는 Claude Code 실행 표면을 하네스에 연결하는 선택형 어댑터입니다. 기준 문서와 검증 기준은 계속 `.harness/`에 있고, Claude Code에서는 다음 기능을 추가로 쓸 수 있습니다.

- `/harness-absorb`: 현재 프로젝트를 분석해 `.harness/project`, `.harness/policy`, `.harness/session` 문서에 반영합니다.
- `npm run harness:doctor`: `/harness-absorb` 전에 `.harness/session/absorb-report.md`를 생성해 자동 감지 결과를 남깁니다.
- 기존 개인/전용 룰 파일이 보존된 경우 `harness:doctor`가 브리지 섹션 추가 후보와 예시 문구를 제안합니다.
- `code-reviewer`, `debug-detective`, `test-writer`, `security-auditor`: 하네스 기준을 먼저 읽는 Claude Code 서브에이전트입니다.
- status line과 context hook: 브랜치, dirty 상태, active stack을 짧게 표시합니다.

## Node 버전

- 하네스 실행 최소 버전은 Node `20.19.0`입니다. 하네스 스크립트는 이 버전에서 동작하도록 유지합니다.
- `package.json`에는 `>=20.19.0`로 기록합니다.
- 하네스 패키지는 소비자 프로젝트에 `.nvmrc`를 주입하지 않습니다.
- 기존 프로젝트의 `.nvmrc`는 프로젝트/Jenkins 빌드 계약으로 보고 자동 덮어쓰기하지 않습니다.
- 기존 `.nvmrc`가 Node 20.19 이상이면 그대로 사용합니다. 더 낮은 버전이면 설치 전에 중단하고 안내하며, 의도적이면 `--allow-node-mismatch`로 진행할 수 있습니다.
- Node 20은 2026-04-30에 EOL이므로 신규 프로젝트는 Jenkins 검증이 준비되는 대로 Node 22/24 전환을 검토합니다.
- 스택 기준이나 템플릿이 더 높은 Node 버전을 요구하면 해당 자산의 `manifest.json` 또는 instruction 문서에 별도로 기록합니다.

## 빈 프로젝트를 새로 시작할 때

빈 폴더를 만든 뒤 프로젝트에 맞는 스택 하네스를 설치하고, 필요한 경우 scaffold 템플릿을 선택합니다.

```bash
mkdir my-app
cd my-app
npm run standards:list
npx -y git+<stack-harness-repo-url>#<tag> init
npm run stack:status
npm run templates:list      # scaffold 템플릿이 필요할 때만 조회
npm run hooks:install
npm run harness:check
```

## 본체 저장소를 운영할 때

이 저장소를 하네스 본체로 계속 관리하는 경우:

- `.harness-seed-mode`를 유지합니다.
- 하네스 본체 변경 후 `npm run harness:check:strict`를 실행합니다.
- seed-mode에서는 `harness:check`가 init smoke test를 함께 실행합니다.
- 배포는 태그 기준으로 합니다. 예: `v0.2.16`.
- 사내 GitLab처럼 보호 브랜치를 쓰는 저장소에는 fast-forward 가능한 배포 커밋으로 반영합니다.

## AI 에이전트 기준점

사내 표준 에이전트가 Claude라면 `CLAUDE.md`를 기준점으로 둡니다. 다른 에이전트를 쓰더라도 `AGENTS.md`는 같은 기준을 가리키는 보조 진입점입니다.

새 세션은 다음 순서로 읽으면 됩니다.

1. `CLAUDE.md`
2. `.harness/README.md`
3. `.harness/session/README.md`
4. `.harness/session/session-start-alert.md`
5. `.harness/session/project-memory.md`
6. `.harness/session/active-context.md`
7. `.harness/session/decision-log.md`
8. `.harness/session/developer-input-queue.md`
9. `.harness/session/next-session-reminder.md`

## 더 읽을 문서

- 이식 절차: `.harness/project/portability-guide.md`
- 프로젝트 하네스 작성 가이드: `.harness/project/project-harness-guide.md`
- 새 프로젝트 인터뷰: `.harness/project/bootstrap.md`
- 개발 기준 동기화 모델: `.harness/policy/sync-protocol.md`
- 스택 기준 구조: `.harness/stacks/README.md`
- 스택 하네스 작성 가이드: `.harness/stacks/authoring-guide.md`
