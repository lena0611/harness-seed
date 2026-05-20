# AGENTS

보조 에이전트 진입점입니다. 기준 진입점은 `CLAUDE.md`입니다.

Claude가 아닌 에이전트도 먼저 `CLAUDE.md`를 읽고 같은 순서와 원칙을 따릅니다.

하네스 본체는 `.harness/`에 있습니다. 플랫폼별 파일은 본체 밖의 어댑터입니다.

Codex나 Copilot 계열 에이전트는 Claude Code의 `SessionStart` hook과 slash command를 그대로 강제할 수 없습니다. 대신 새 작업을 시작할 때 `CLAUDE.md`의 읽기 순서를 따르고, 필요하면 아래 파일을 직접 갱신합니다.

- 리마인더: `.harness/session/next-session-reminder.md`
- 장기 메모리: `.harness/session/project-memory.md`
- 결정 로그: `.harness/session/decision-log.md`

큰 작업이나 낯선 요청은 `npm run harness:context -- "<작업 설명>"` 결과의 Selected Skills를 보고 읽을 문서, 실행할 명령, 기록 위치를 좁힙니다.
