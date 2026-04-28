# harness-seed

AI 개발 에이전트가 프로젝트의 규칙, 문서, 코드 구조를 같은 기준으로 읽고 검증하도록 넣는 시드 하네스입니다.

이 저장소는 업무 프로젝트 자체가 아닙니다. 여러 프로젝트에 복사해 넣는 공통 개발 안전장치입니다.

## 리버덕을 위한 핵심 요약

리버덕이 새 프로젝트를 맡았다고 가정합니다.

1. 프로젝트 루트에서 `init`을 실행합니다.
2. `.harness/`, `CLAUDE.md`, `AGENTS.md`, 검증 스크립트가 추가됩니다.
3. 기존 `src/`, 기존 README, 기존 업무 코드는 덮어쓰지 않습니다.
4. AI 에이전트는 먼저 `CLAUDE.md`를 읽고 작업 기준을 잡습니다.
5. 개발자는 `npm run guard`로 정책, 문서 링크, 코드 동기화 상태를 확인합니다.

## 가장 흔한 사용법: 기존 프로젝트에 하네스만 주입

사내 GitLab, 개인 GitHub, npm 배포 중 어떤 방식을 쓰든 원칙은 같습니다. 릴리스 태그를 고정해서 실행합니다.

```bash
cd my-existing-project
npx -y git+<seed-repo-url>#vX.Y.Z init
npm run hooks:install
npm run guard
```

예시:

```bash
# 사내 GitLab 예시
npx -y git+https://git.example.com/group/harness-seed.git#vX.Y.Z init

# GitHub 예시
npx -y github:<owner>/<repo>#vX.Y.Z init
```

`main`, `master` 같은 움직이는 브랜치보다 `vX.Y.Z` 태그를 권장합니다. 같은 명령을 나중에 다시 실행해도 같은 하네스 버전이 들어가야 팀 결과가 흔들리지 않습니다.

## 설치 후 생기는 것

| 경로 | 역할 |
| --- | --- |
| `.harness/` | 하네스 본체. 정책, 문서, 세션, 스택 프리셋이 들어 있습니다. |
| `CLAUDE.md` | 기준 AI 에이전트 진입점입니다. Claude를 쓰지 않아도 이 파일을 기준 문서로 둡니다. |
| `AGENTS.md` | 다른 AI 에이전트가 읽기 쉬운 보조 진입점입니다. 실제 기준은 `CLAUDE.md`입니다. |
| `.github/` | GitHub Actions, Copilot shim 같은 GitHub 전용 어댑터입니다. |
| `scripts/` | `guard`, `stack:apply`, 문서 링크 검사, 정책 검사 실행 스크립트입니다. |
| `.githooks/` | 로컬 commit 전 검증 hook입니다. |
| `.nvmrc` | 권장 Node 버전입니다. 이미 있으면 보존합니다. |

기존 파일이 있으면 자동으로 덮어쓰지 않고 건너뜁니다. 충돌 파일은 init 출력에 표시됩니다.

## 주요 명령

```bash
npm run guard               # 통합 검증
npm run policy:guard        # 정책 영향 분석 + 위반 검사
npm run docs:check          # 문서 레지스트리, 링크, 코드 경로 검사
npm run hooks:install       # 로컬 git hook 등록

npm run stack:status        # 활성 스택과 적용 상태 확인
npm run stack:apply         # 활성 스택 scaffold 적용
npm run stack:reset         # 적용된 scaffold 제거
```

`npm run guard`는 스택이 아직 적용되지 않았으면 policy/docs만 검사하고 lint/test/build는 건너뜁니다.

## Node 버전

- 기준 버전은 `.nvmrc`의 Node `22.14.0`입니다.
- `package.json`의 `engines.node`는 `>=20.19.0 || >=22.13.0`입니다.
- 낮은 Node에서 실행하면 하네스 명령이 먼저 버전 안내를 출력합니다.
- vue3-fsd 스택의 `npm run dev`는 `scripts/dev.sh`가 nvm, `.nvmrc`, 의존성 동기화를 처리한 뒤 Vite를 실행합니다.

## 스택 프리셋

| id | 설명 |
| --- | --- |
| `vue3-fsd` | Vue 3 + Pinia + Vite + TypeScript / FSD + Clean Architecture |
| `none` | 프레임워크별 검사를 끄고 일반 하네스만 사용 |

기존 프로젝트에 하네스만 얹는 경우에는 먼저 `activeStack`을 확인하세요. 프레임워크 scaffold까지 필요할 때만 `npm run stack:apply`를 실행합니다.

## 빈 프로젝트를 새로 시작할 때

하네스 저장소 자체를 복제해 새 프로젝트의 시작점으로 쓸 수 있습니다.

```bash
npx degit <seed-repo-url> my-app
cd my-app
nvm install && nvm use
rm .harness-seed-mode
npm run stack:apply
npm install
npm run hooks:install
npm run guard
```

`.harness-seed-mode`는 이 저장소를 "하네스 본체"로 운영할 때만 남겨두는 마커입니다. 일반 업무 프로젝트로 쓸 때는 삭제합니다.

## 본체 저장소를 운영할 때

이 저장소를 하네스 본체로 계속 관리하는 경우:

- `.harness-seed-mode`를 유지합니다.
- 하네스 본체 변경 후 `npm run guard -- --strict`를 실행합니다.
- 배포는 태그 기준으로 합니다. 예: `v0.2.0`, `v0.2.1`.
- 사내 GitLab처럼 보호 브랜치를 쓰는 저장소에는 fast-forward 가능한 배포 커밋으로 반영합니다.

## AI 에이전트 기준점

사내 표준 에이전트가 Claude라면 `CLAUDE.md`를 기준점으로 둡니다. 다른 에이전트를 쓰더라도 `AGENTS.md`와 `.github/copilot-instructions.md`는 `CLAUDE.md`를 가리키는 보조 진입점입니다.

새 세션은 다음 순서로 읽으면 됩니다.

1. `CLAUDE.md`
2. `.harness/session/README.md`
3. `.harness/session/active-context.md`
4. `.harness/session/next-session-reminder.md`

## 더 읽을 문서

- 이식 절차: `.harness/project/portability-guide.md`
- 새 프로젝트 인터뷰: `.harness/project/bootstrap.md`
- 정책 동기화 모델: `.harness/policy/sync-protocol.md`
- 스택 프리셋 구조: `.harness/stacks/README.md`
