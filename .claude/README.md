# Claude Code Adapter

이 폴더는 Claude Code 전용 어댑터입니다. 기준 진실 출처는 여전히 `.harness/`와 `CLAUDE.md`입니다.

## 역할
- Claude Code의 settings, hooks, agents, slash command 표면을 하네스에 연결합니다.
- 정책, 문서, 세션, 스택 기준은 `.harness/`에서 읽습니다.
- 프로젝트별 메모리와 정책 변경은 `.harness/session/`과 `.harness/policy/`에 남깁니다.

## 구성
- `settings.json`: Claude Code 권한, hook, status line 설정
- `commands/harness-scan.md`: 프로젝트 스캔 절차
- `commands/하네스업데이트.md`: 공통/스택 하네스 업데이트 후보 확인과 안전한 업데이트 경로 선택
- `commands/운영업무.md`: JIRA 운영 업무 접수와 업무 유형별 하네스 스킬 연결
- `commands/업무요약.md`: 운영 업무 완료 후 유지보수 히스토리 기록
- `agents/code-reviewer.md`: 변경 리뷰
- `agents/debug-detective.md`: 실패 원인 분석
- `agents/test-writer.md`: 테스트 작성
- `agents/security-auditor.md`: 보안 점검
- `hooks/inject-context.sh`: 프롬프트마다 하네스 상태 요약 주입
- `hooks/enforce-check.sh`: 사용자 완료 승인 플래그가 있을 때만 `npm run harness:check` 실행
- `hooks/statusline.sh`: 현재 브랜치, dirty 상태, active stack 표시

## 원칙
- 이 어댑터는 `.harness/`를 대체하지 않습니다.
- Claude Code가 아닌 에이전트는 `CLAUDE.md`와 `AGENTS.md`만 읽어도 같은 기준을 따를 수 있어야 합니다.
- 프롬프트 주입 hook은 상태 정보만 제공합니다.
- 에이전트 완료 hook은 `HARNESS_AGENT_CHECK_APPROVED=1`일 때만 `npm run harness:check`를 실행하고 실패를 그대로 전달합니다. 일시적으로 해제해야 하면 `HARNESS_AGENT_CHECK_DISABLED=1`을 명시적으로 설정합니다.
- 사용자가 `커밋` 또는 `커밋하고 푸시`를 승인했고 git hook이 설치되어 있으면 pre-commit/pre-push 검증을 신뢰합니다. 에이전트가 commit 직전에 별도 `npm run harness:check`를 먼저 실행해 같은 검증을 중복하지 않습니다.
