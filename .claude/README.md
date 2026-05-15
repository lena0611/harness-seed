# Claude Code Adapter

이 폴더는 Claude Code 전용 어댑터입니다. 기준 진실 출처는 여전히 `.harness/`와 `CLAUDE.md`입니다.

## 역할
- Claude Code의 settings, hooks, agents, slash command 표면을 하네스에 연결합니다.
- 정책, 문서, 세션, 스택 기준은 `.harness/`에서 읽습니다.
- 프로젝트별 메모리와 정책 변경은 `.harness/session/`과 `.harness/policy/`에 남깁니다.

## 구성
- `settings.json`: Claude Code 권한, hook, status line 설정
- `commands/harness-scan.md`: 프로젝트 스캔 절차
- `agents/code-reviewer.md`: 변경 리뷰
- `agents/debug-detective.md`: 실패 원인 분석
- `agents/test-writer.md`: 테스트 작성
- `agents/security-auditor.md`: 보안 점검
- `hooks/inject-context.sh`: 프롬프트마다 하네스 상태 요약 주입
- `hooks/enforce-check.sh`: 에이전트 응답 종료 시 `npm run harness:check` 실행
- `hooks/statusline.sh`: 현재 브랜치, dirty 상태, active stack 표시

## 원칙
- 이 어댑터는 `.harness/`를 대체하지 않습니다.
- Claude Code가 아닌 에이전트는 `CLAUDE.md`와 `AGENTS.md`만 읽어도 같은 기준을 따를 수 있어야 합니다.
- 프롬프트 주입 hook은 상태 정보만 제공합니다.
- 에이전트 완료 hook은 `npm run harness:check` 실패를 그대로 실패로 전달합니다. 일시적으로 해제해야 하면 `HARNESS_AGENT_CHECK_DISABLED=1`을 명시적으로 설정합니다.
