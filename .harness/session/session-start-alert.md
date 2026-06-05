# 세션 시작 알림

새 세션을 열면 이 문서를 가장 먼저 읽습니다.

바로 이어서 [`next-session-reminder.md`](./next-session-reminder.md)를 봅니다.

Claude Code에서는 `SessionStart` hook이 `next-session-reminder.md`를 자동으로 보여줍니다. Codex와 Copilot은 같은 hook 강제성이 없으므로 `CLAUDE.md`의 읽기 순서에 따라 직접 확인합니다.

## 지금 반드시 떠올릴 것
0. 루트에 `.harness/`, `AGENTS.md`, `CLAUDE.md` 중 하나라도 있으면 사용자가 하네스를 언급하지 않아도 하네스 프로젝트로 자동 인식합니다.
1. 모든 작업은 `.harness/policy/ai-standard-guiding-policy.md`의 위배 여부를 먼저 확인합니다.
2. 프로젝트 목적은 아직 `TBD`입니다. 새 기능 전에 `.harness/project/project-charter.md`를 먼저 확인합니다.
3. `src/`, 기준 문서, 하네스 문서를 손대면 시작 전에는 `npm run harness:impact`로 영향 범위를 확인합니다. `npm run harness:check`는 사용자가 최종 검증을 승인한 뒤 실행합니다.
4. 자동 검사가 통과해도 수동 검토 항목은 `.harness/policy/automation-coverage.md`를 보고 다시 판단합니다.
5. `.harness/session/developer-input-queue.md`의 `open`/`deferred` 항목은 새 세션에서 다시 확인합니다.
6. 문서를 키워야 한다면 먼저 `.harness/documentation/indexing-rules.md`에 맞게 인덱스/세부 문서 분리를 판단합니다.
7. 개발 방향을 유지하려면 하네스만 만들지 말고, 필요 시 trigger와 hook까지 함께 설계해야 합니다.
8. 강제 강도와 예외 허용 범위가 애매하면 `.harness/policy/enforcement-ladder.md`를 보고 사용자에게 묻습니다.
9. 코드 변경 시 스타일 검증도 구조 검증과 함께 보며, `npm run lint` 또는 `npm run harness:check`를 기준으로 판단합니다.
10. 새 환경을 준비한 뒤에는 `npm run hooks:install`로 로컬 훅과 커밋 템플릿을 연결합니다.
11. 에이전트 작업은 hook 설치 여부와 무관하게 기준 계층을 읽습니다. 다만 사용자 완료 승인 전에는 `build`, `test`, `harness:check`, commit, push, PR 생성을 실행하지 않고 검증 후보로 보고합니다.
12. 사용자가 `최종 검증만` 요청하면 `npm run harness:check`를 직접 실행합니다. 사용자가 `커밋/푸시`를 요청했고 hook이 설치되어 있으면 pre-commit/pre-push 검증을 신뢰하고 선행 `harness:check`를 중복 실행하지 않습니다.
13. 스타일이 반복 패턴으로 굳어지기 시작하면 `.harness/style/style-evolution.md` 기준으로 규칙 승격 후보를 확인합니다.
14. 코드 변경 후에는 도메인, 아키텍처, 워크플로우 로컬룰로 승격할 후보가 있는지 확인하고, 확신이 없으면 `.harness/session/developer-input-queue.md`에 질문으로 남깁니다.
15. 큰 작업이나 생소한 영역은 `npm run harness:sync`와 `npm run harness:context -- "<작업 설명>"`로 에이전트 판단 컨텍스트를 먼저 만듭니다.
16. 개발자에게 진행 상황을 보일 때는 원시 내부 추론이 아니라 `[harness] request/context/impact/action/decision/verify` 형태의 visible trace로 요약합니다.
17. 사용자가 하네스를 언급하지 않는 것은 하네스를 비활성화한다는 뜻이 아닙니다. 하네스 설치 프로젝트에서는 항상 이 문서의 절차를 적용합니다.

## 방향 유지 장치 원칙
- **Harness**는 방향과 작업 레일을 정합니다.
- **Trigger**는 어떤 상황에서 무엇을 다시 떠올려야 하는지 강제합니다.
- **Hook**은 실제 실행 단계에서 빠져나가지 못하게 막습니다.
- 새로운 운영 규칙을 추가할 때는 항상 “하네스만으로 충분한가, trigger가 필요한가, hook으로 강제해야 하는가”를 함께 판단합니다.
- 강제 강도(`inform/trigger/hook/block`)와 예외 허용 범위(`none/defer/waiver`)도 함께 판단합니다.

## 세션 종료 트리거
- 사용자가 `세션종료`라고 말하면 이 세션에서 남은 미결 사항, 다음에 바로 떠올려야 할 점, 개발자에게 다시 물어봐야 할 항목을 `next-session-reminder.md`에 갱신합니다.

## 새 세션에서 재계획해야 하는 미해결 항목
- 실제 프로젝트 목적과 문제 정의 채우기
- 비목표와 성공 기준 확정
- waiver가 필요한 예외 상황이 생기면 `waivers.json` 등록 프로세스 확정
- 프로젝트가 커지면 ownership map 또는 boundary map 추가 여부 재판단

## 개발자 입력 요청 원칙
- 개발자 정보 부족 때문에 완료되지 못한 `open`/`deferred` 항목은 `developer-input-queue.md`에 유지합니다.
- 새 세션에서는 큐의 `open` 또는 `deferred` 항목을 개발자에게 다시 확인합니다.
- `answered` 또는 `obsolete` 항목은 관련 문서 반영을 확인한 뒤 큐에서 제거하거나 아카이브합니다.
- 개발자는 다음 중 하나를 선택할 수 있습니다.
  1. 지금 답변
  2. 이번 세션에서는 유보
  3. 나중에 다시 묻기
- 답변을 거절하거나 유보하더라도 그 선택을 존중하고 상태만 갱신합니다.

## 세션 시작 기본 명령
```bash
git --no-pager status --short
npm run hooks:install
npm run harness:impact
# 최종화 승인 후에만 실행:
# HARNESS_AGENT_CHECK_APPROVED=1 npm run harness:check
```
