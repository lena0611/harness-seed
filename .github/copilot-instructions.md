# Copilot Instructions

GitHub Copilot용 shim입니다. 기준 진입점은 루트의 `CLAUDE.md`입니다.

먼저 [CLAUDE.md](../CLAUDE.md)를 읽고, 필요한 세부 문서는 아래 목차를 사용합니다.

루트에 `.harness/`가 있으면 사용자가 하네스를 언급하지 않아도 하네스 프로젝트로 간주합니다. 코드나 문서를 변경하기 전에는 `CLAUDE.md`의 "하네스 자동 인식 의무"를 따르고, 반복 규칙은 `.harness/project/*`로 승격하며, 불확실한 항목은 `.harness/session/developer-input-queue.md`에 남깁니다.

Copilot은 Claude Code의 `SessionStart` hook이나 slash command를 강제 실행하지 않습니다. 새 작업을 시작할 때는 `CLAUDE.md`의 읽기 순서를 수동 기준으로 삼고, 리마인더/메모리/결정 기록은 아래 파일을 기준으로 갱신합니다.

- `.harness/session/next-session-reminder.md`
- `.harness/session/project-memory.md`
- `.harness/session/decision-log.md`

## 목차
- 프로젝트 개요: 추가 예정 (`.harness/project/project-charter.md`)
- [코딩 컨벤션](./copilot-instructions/coding-conventions.md)
- [Project Setup](./copilot-instructions/project-setup.md)
- [Development Workflow](./copilot-instructions/development-workflow.md)
- [Session Harness](../.harness/session/README.md)
- [Project Harness](../.harness/project/README.md)
- [Project Bootstrap](../.harness/project/bootstrap.md)
- [Policy Harness](../.harness/policy/README.md)
- [Documentation Harness](../.harness/documentation/README.md)
- [Style Harness](../.harness/style/README.md)
- [Stacks](../.harness/stacks/README.md)

## 활성 스택 instruction
기본값은 `activeStack=none`입니다. 외부 프리셋을 적용한 프로젝트에서는 `.harness/project/stack-preset-rules.md`와 `profile.json`의 `stackManifest`를 확인합니다.
