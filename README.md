# harness-seed

> **AI 코딩 에이전트가 헷갈리지 않게 정책↔코드↔문서를 자동 동기화 검증하는 프론트엔드 프로젝트 시드.**
> Vue 3 / FSD 스택이 기본 포함되어 있고, 다른 스택은 프리셋으로 추가 가능합니다.

## 30초 시작

### 시나리오 1: **이미 있는 프로젝트에 하네스만 얹기** (가장 흔함)

```bash
cd my-existing-project
npx -y github:lena0611/harness-seed init
npm run hooks:install
```

`.github/` `scripts/` `.githooks/` 와 `package.json` 의 harness scripts만 추가됩니다. 기존 `src/`, 의존성, 사용자 scripts는 그대로 보존됩니다(이미 존재하는 파일은 자동 skip). 끝나면 곧바로 `npm run guard` 가능.

### 시나리오 2: **빈 디렉토리에서 통째로 시작**

```bash
npx degit lena0611/harness-seed my-app
cd my-app
rm .harness-seed-mode          # 이 저장소를 내 프로젝트로 쓰기 (한 번만)
npm run stack:apply            # 활성 스택의 scaffold 복사 + 의존성 머지
npm install
npm run hooks:install
npm run dev                    # vite 개발 서버
```

`npm run stack:apply` 직후부터 `src/`, `vite.config.ts` 등이 생성되며 일반 Vue 프로젝트와 동일하게 작업할 수 있습니다.

## 용어 1줄 글로싸리

- **하네스(harness)**: 프로젝트의 정책·문서·세션 컨텍스트를 결정적으로 검증하는 메타 인프라. `.github/` 안에 있음.
- **스택 프리셋(stack preset)**: 특정 프레임워크+디자인패턴 꾸러미 (instructions + 정책 + scaffold). `.github/stacks/<id>/`.
- **활성 스택(activeStack)**: `.github/policy-harness/profile.json`이 가리키는 현재 스택. `none`도 가능.
- **시드 모드(seed mode)**: `.harness-seed-mode` 파일이 있으면 활성. harness-seed 본 저장소에서만 사용. 일반 사용자는 첫 사용 시 삭제.
- **SYNC GAP**: 정책과 코드 중 한쪽만 변경되어 동기화가 깨진 상태. `policy:impact`가 자동 검출.

## 두 가지 사용 모드

### A) 자기 프로젝트로 쓰는 경우 (보통의 사용자)
```bash
rm .harness-seed-mode
```
이후 `src/`, `index.html`, `vite.config.ts`, `package.json` 등 모든 파일을 자유롭게 commit할 수 있습니다.

### B) 시드 하네스로 계속 운영하는 경우 (harness-seed 본 저장소)
- `.harness-seed-mode`를 그대로 둡니다.
- pre-commit hook이 stack 산출물(scaffold 파일들 + 머지된 `package.json`)의 staging을 차단합니다.
- commit 직전 사이클: `npm run stack:reset` → `git commit` → (다시 작업하려면) `npm run stack:apply` + `npm install`.

## 사용 가능한 스택

| id | 설명 |
| --- | --- |
| `vue3-fsd` | Vue 3 + Pinia + Vite + TypeScript / FSD + Clean Architecture + Headless Core + Adapter |
| `none` | 일반 하네스만, 프레임워크-종속 검사 비활성화 |

새 스택 추가는 [.github/stacks/README.md](.github/stacks/README.md) 참고.

## 주요 명령

```bash
# 스택 라이프사이클
npm run stack:status        # 활성 스택 / 적용 상태 확인
npm run stack:apply         # 활성 스택 scaffold 적용 (+ package.json 머지)
npm run stack:reset         # 적용된 scaffold 제거 + package.json 복원

# 검증
npm run guard               # 통합 가드 (policy + docs + lint/test/build)
npm run policy:guard        # 정책 영향 분석 + 위반 검사
npm run docs:check          # 문서 레지스트리/링크/코드 경로 무결성

# 환경
npm run hooks:install       # 로컬 git pre-commit hook 등록
```

> `npm run guard`는 스택 미적용 상태에서는 policy + docs만 실행하고 lint/test/build를 자동으로 건너뜁니다.

## 새 프로젝트 부트스트랩 (AI 에이전트와 함께)

이 저장소를 fork/degit한 직후 Copilot/Claude 세션에서 다음 명령을 사용하세요.

> 사용자: "프로젝트 부트스트랩 인터뷰 시작해줘"

에이전트는 [.github/project-harness/bootstrap.md](.github/project-harness/bootstrap.md) 절차에 따라 프로젝트 개요(문제·사용자·목표·성공기준 등)와 스택을 묻고, [project-charter.md](.github/project-harness/project-charter.md)·[profile.json](.github/policy-harness/profile.json)을 채웁니다.

## 세션 컨텍스트 복구

- 새 세션은 [.github/session-harness/README.md](.github/session-harness/README.md)부터 읽어 컨텍스트를 복구합니다.
- 다음 세션에서 다시 확인할 항목은 [next-session-reminder.md](.github/session-harness/next-session-reminder.md)에 정리됩니다.

## 자동 배포 (vue3-fsd 스택 기준)

`main` 푸시 시 GitHub Actions가 빌드 후 GitHub Pages로 배포합니다. 배포 주소는 사용자 저장소명에 따라 결정되며, scaffold의 `vite.config.ts` 의 `base` 와 `.github/workflows/deploy-pages.yml` 을 본인 저장소명으로 수정하세요. (이 시드 저장소 자체는 페이지를 배포하지 않습니다.)

## 이식 / 더 읽을 거리

- 다른 프로젝트로 옮기는 절차: [.github/project-harness/portability-guide.md](.github/project-harness/portability-guide.md)
- 새 스택 추가: [.github/stacks/README.md](.github/stacks/README.md)
- 정책↔코드 동기화 모델: [.github/policy-harness/sync-protocol.md](.github/policy-harness/sync-protocol.md)
