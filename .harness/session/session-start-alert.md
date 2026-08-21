# 세션 시작 알림

새 세션을 열면 이 문서를 가장 먼저 읽습니다.

바로 이어서 [`next-session-reminder.md`](./next-session-reminder.md)를 봅니다.

Claude Code에서는 `SessionStart` hook이 `next-session-reminder.md`를 자동으로 보여줍니다. Codex와 Copilot은 같은 hook 강제성이 없으므로 `CLAUDE.md`의 읽기 순서에 따라 직접 확인합니다.

## 지금 반드시 떠올릴 것

작업 절차의 정본은 `CLAUDE.md`(작업 원칙·최종화 규칙)입니다. 아래는 이 문서가 소유한 항목과, 놓치기 쉬운 것의 짧은 상기만 둡니다.

1. 루트에 `.harness/`, `AGENTS.md`, `CLAUDE.md` 중 하나라도 있으면 하네스 프로젝트로 자동 인식합니다. 사용자가 하네스를 언급하지 않는 것은 하네스를 비활성화한다는 뜻이 아닙니다.
2. 모든 작업은 `.harness/policy/ai-standard-guiding-policy.md`의 위배 여부를 먼저 확인합니다.
3. 프로젝트 목적은 아직 `TBD`입니다. 새 기능 전에 `.harness/project/project-charter.md`를 먼저 확인합니다.
4. 최종화는 `CLAUDE.md`의 정본 규칙대로 — 완료 승인 전 무거운 검증·커밋 금지, 커밋/푸시는 hook 검증에 맡겨 선행 `harness:check`를 중복 실행하지 않습니다.
5. 자동 검사가 통과해도 수동 검토 항목은 `.harness/policy/automation-coverage.md`를 보고 다시 판단합니다.
6. `.harness/session/developer-input-queue.md`의 `open`/`deferred` 항목은 새 세션에서 다시 확인합니다.
7. 문서를 키워야 한다면 먼저 `.harness/documentation/indexing-rules.md`에 맞게 인덱스/세부 문서 분리를 판단합니다.
8. 강제 강도와 예외 허용 범위가 애매하면 `.harness/policy/enforcement-ladder.md`를 보고 사용자에게 묻습니다.
9. 프로젝트 품질 검사(lint/test/build)는 profile의 `verify` 선언을 따릅니다 — 하네스는 자동 실행하지 않으며, 담당 설정은 `/검증설정`으로 합니다(결정 86).
10. 새 환경을 준비한 뒤에는 `npm run hooks:install`로 로컬 훅과 커밋 템플릿을 연결합니다.
11. 스타일이 반복 패턴으로 굳어지기 시작하면 `.harness/style/style-evolution.md` 기준으로 규칙 승격 후보를 확인합니다.
12. 로컬룰 승격 시 "문서 규칙인가, 실행 가능한 검증인가"를 먼저 판단합니다 — 사람이 매번 기억해야 지켜지는 런타임 불변식은 문서 대신 테스트/CI/lint 가드로 만듭니다(`enforcement-ladder.md` 0번).
13. 감사·리뷰가 근거와 함께 비권장한 것을 뒤집어 채택할 때는 채택 전에 `decision-log.md`에 `[권고 뒤집기]` 항목(`근거 반박:` 필수)을 남기고, 결정 폐기/번복은 원문 삭제 대신 `⛔ 폐기됨`/`⛔ 번복됨` 배너를 붙입니다(상세: `.harness/session/README.md`).

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
