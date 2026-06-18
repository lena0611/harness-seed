<!-- harness-managed:start -->
<!--
  이 블록은 공통 하네스(harness-seed)가 소유하며 harness:update가 자동 갱신합니다.
  블록 안(harness-managed:start ~ harness-managed:end)은 직접 수정하지 마세요. 다음 업데이트 때 본체 정본으로 다시 채워집니다.
  프로젝트 고유 지침은 이 블록 "아래"(harness-managed:end 다음)에 작성하면 업데이트와 무관하게 영구 보존됩니다.
  관리 블록 기준과 프로젝트 영역 지침이 충돌하면 .harness/project/standards-layers.md의 "충돌 해석 순서"를 따릅니다.
-->
# Copilot Instructions

GitHub Copilot용 shim입니다. 기준 진입점은 루트의 `CLAUDE.md`입니다.

먼저 [CLAUDE.md](../CLAUDE.md)를 읽고, 필요한 세부 문서는 아래 목차를 사용합니다.

루트에 `.harness/`가 있으면 사용자가 하네스를 언급하지 않아도 하네스 프로젝트로 간주합니다. 코드나 문서를 변경하기 전에는 `CLAUDE.md`의 "하네스 자동 인식 의무"를 따르고, 반복 규칙은 `.harness/project/*`로 승격하며, 불확실한 항목은 `.harness/session/developer-input-queue.md`에 남깁니다.

Copilot은 Claude Code의 `SessionStart` hook이나 slash command를 강제 실행하지 않습니다. 새 작업을 시작할 때는 `CLAUDE.md`의 읽기 순서를 수동 기준으로 삼고, 리마인더/메모리/결정 기록은 아래 파일을 기준으로 갱신합니다.

실제 업무 진행을 보고할 때는 `[harness] request/context/impact/action/decision/verify` visible trace 형식으로 요약합니다. 단순 질문 응답, 잡담, 메타 확인처럼 업무 진행 보고가 아닌 턴에는 이 형식을 강요하지 않습니다.

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
<!-- harness-managed:end -->

<!--
  이 줄 아래는 프로젝트 소유 영역입니다. 프로젝트 고유의 Copilot 지침을 자유롭게 작성하세요.
  harness:update는 위 harness-managed 블록만 갱신하고 이 영역은 보존합니다.
-->

