# 커밋/푸시 안전장치 규칙

commit/push 단계에서 동작하는 git hook, 커밋 템플릿, 최종 검증 기준을 기록합니다.

이 문서는 `.harness/project/workflow-rules.md`의 일반 작업 흐름과 분리합니다. 대화창 운영, 업무 진행 방식, workstream 운영 문구만 바뀌는 경우에는 이 문서를 수정하지 않습니다.

## 완료 승인 이후에만 실행
- 사용자의 일반 작업 지시는 commit/push 승인으로 보지 않습니다.
- 사용자가 `커밋`, `푸시`, `배포`, `PR 생성`, `최종 검증`처럼 명시적으로 최종화 의사를 밝힌 뒤에만 commit/push 단계로 이동합니다.
- git hook은 작업 완료 시점을 결정하지 않고, 사용자가 승인한 commit/push 직전에 실행되는 안전장치입니다.

## hook 설치 기준
- `npm run hooks:install`은 `core.hooksPath`를 `.githooks`로 설정합니다.
- 기존 `.git/hooks/*` 또는 기존 `core.hooksPath`의 hook은 삭제하지 않습니다.
- 기존 hook 경로는 `harness.previousHooksPath`에 저장하고, `.githooks/*`에서 먼저 체인 실행합니다.
- `.github/commit-template.txt`를 git commit template로 연결합니다.

## pre-commit
- 사용자가 커밋을 승인하고 실제 `git commit`이 실행될 때 동작합니다.
- 기존 pre-commit hook이 있으면 먼저 실행합니다.
- 하네스 seed-mode 확인 후 `npm run harness:check`를 실행합니다.
- 이 단계는 전체 검증에 가깝기 때문에 사용자의 완료 승인 없이 에이전트가 임의로 유도하지 않습니다.

## pre-push
- 사용자가 push를 승인하고 실제 `git push`가 실행될 때 동작합니다.
- 기존 pre-push hook이 있으면 먼저 실행합니다.
- 반복 검증 부담을 줄이기 위해 `npm run harness:check -- --fast`를 실행합니다.

## 변경 시 함께 확인할 것
- `.githooks/pre-commit`
- `.githooks/pre-push`
- `.harness/bin/install-hooks.mjs`
- `.harness/bin/run-previous-hook.mjs`
- `.github/commit-template.txt`
- README의 hook 안내

## 예외 기록
- 프로젝트 사정으로 hook을 설치하지 않는 것은 허용할 수 있습니다.
- 단, 에이전트 작업은 hook 설치 여부와 무관하게 완료 승인 게이트와 최종 검증 원칙을 따릅니다.
- hook 정책 자체를 바꾸는 예외는 `decision-log.md` 또는 `waivers.json`에 범위, 사유, 만료 조건을 남깁니다.
