<!-- harness-managed:start -->
<!--
  이 블록은 공통 하네스(harness-seed)가 소유하며 harness:update가 자동 갱신합니다.
  블록 안(harness-managed:start ~ harness-managed:end)은 직접 수정하지 마세요. 다음 업데이트 때 본체 정본으로 다시 채워집니다.
  프로젝트 고유 지침은 이 블록 "아래"(harness-managed:end 다음)에 작성하면 업데이트와 무관하게 영구 보존됩니다.
  관리 블록 기준과 프로젝트 영역 지침이 충돌하면 .harness/project/standards-layers.md의 "충돌 해석 순서"를 따릅니다.
  블록 아래 프로젝트 영역에는 "어디를 읽어라"만 둡니다 — 문서 포인터·읽기 순서 예외·짧은 진입 핵심. 규칙 본문(아키텍처 경계·도메인·워크플로우·커밋 규칙)은 룰 문서에 씁니다: .harness/project/*(domain-rules·architecture-rules·workflow-rules·commit-push-rules) 또는 팀이 정한 .claude/rules/*.md(paths로 경로 한정 가능). 규칙이 CLAUDE.md에 있으면 매 세션 통째로 실리고 하네스 도구(context·impact·scan)는 그 규칙을 보지 못합니다. 이미 있는 본문을 옮기는 시점은 팀이 정합니다 — 에이전트가 먼저 나서지 않습니다. 아래 안내문이 옛 문구("아키텍처 경계 … 자유롭게")로 남아 있으면 이 줄이 기준입니다.
-->
# CLAUDE

이 파일이 모든 에이전트의 기준 진입점입니다. 사내 표준 에이전트는 Claude입니다.

## 하네스 자동 인식 의무
- 작업 루트에서 `.harness/`, `AGENTS.md`, `CLAUDE.md` 중 하나라도 발견하면 사용자가 "하네스"를 언급하지 않아도 하네스 프로젝트로 간주합니다.
- 하네스 프로젝트에서는 기능 구현이나 파일 수정 전에 아래 "항상 읽는 최소 기준"을 먼저 읽습니다.
- 반복되는 도메인 규칙, 아키텍처 경계, 검증 흐름은 `.harness/session/*`에만 두지 말고 `.harness/project/*` 문서로 승격합니다.
- 판단이 불확실하면 구현을 추측으로 고정하지 말고 `.harness/session/developer-input-queue.md`에 질문을 남기거나 사용자에게 인터뷰합니다.
- **세션 주 폴더 확인**: 이 파일이 있는 저장소 루트가 세션의 주 작업 폴더가 아니면(상위 폴더로 열었거나 하위 서비스 폴더로 열었으면) 이 저장소의 훅 — 커밋 검사·위험 명령 차단·컨텍스트 주입 — 은 이 세션에서 하나도 실행되지 않습니다. 실패가 아니라 조용한 부재로 나타나므로, 알게 된 즉시 사용자에게 한 줄로 알리고 저장소 루트를 주 폴더로 다시 열도록 안내합니다. 판단 기준: 현재 작업 디렉터리가 이 CLAUDE.md의 폴더와 다르면 그 상태입니다.

## 항상 읽는 최소 기준
1. `.harness/policy/ai-standard-guiding-policy.md`
2. `.harness/session/session-start-alert.md`
3. `.harness/session/active-context.md`

## 세션 재개 시 추가 확인
- `.harness/session/project-memory.md`
- `.harness/session/decision-log.md` (현행 유효 결정만 유지 — `decision-log-*` 아카이브는 특정 결정의 배경이 필요할 때만 읽습니다)
- `.harness/session/developer-input-queue.md`

## 작업별로 골라 읽는 기준
- `.harness/project/terminology.md`
- `.harness/project/local-methodology.md`
- `.harness/project/standards-layers.md`
- `.harness/project/domain-rules.md`
- `.harness/project/architecture-rules.md`
- `.harness/project/workflow-rules.md`
- `.harness/project/commit-push-rules.md`
- `.harness/project/hook-coexistence.md` (husky 등 훅 도구와 공존 — 표준 prepare 패턴)
- `.harness/project/stack-preset-rules.md`
- `.harness/project/template-contract.md`
- `.harness/project/spec-authority-workflow.md` (기획 문서 연동 절차 정본 — `.harness/spec-lock.json`이 있으면 코드 변경 전 필수)
- `.harness/project/issue-adapter.example.md` (커밋·푸시 보고의 이슈 요약 — 프로젝트가 견본을 복사해 만든 실물 파일이 있으면 그 규칙 적용)
- `.harness/project/bootstrap.md`
- `.harness/project/new-project-checklist.md` (새 프로젝트 day-0 순서 — 리더용)
- `.harness/policy/context-protocol.md`
- `.harness/skills/README.md`
- `.harness/documentation/README.md`
- `.harness/stacks/README.md`

## 기준
- 하네스 본체는 `.harness/`에 있습니다.
- 플랫폼별 파일은 하네스 본체 밖의 어댑터입니다.
- `.claude/`는 Claude Code hooks, agents, slash command용 어댑터입니다.
- `AGENTS.md`는 이 파일을 가리키는 보조 진입점입니다.
- 개발 기준, 세션, 문서, 스택 기준은 `.harness/`를 단일 진실 출처로 봅니다.
- Claude Code에서는 `/reminder`, `/memory`, `/decision`, `/harness-scan` 명령을 사용해 세션 리마인더, 장기 메모리, 결정 로그, 프로젝트 스캔을 명시적으로 갱신합니다.
- Claude Code의 `SessionStart` hook은 `.harness/session/next-session-reminder.md`를 자동으로 보여주도록 구성합니다. Codex와 Copilot은 같은 강제 hook이 없으므로 이 파일과 `AGENTS.md`, `.codex/hooks/inject-context.sh`, `.github/copilot-instructions.md`를 통해 같은 기준을 안내합니다.

## 작업 원칙
- 모든 작업은 먼저 `.harness/policy/ai-standard-guiding-policy.md` 위배 여부를 확인합니다.
- 작업 전에는 최소 `.harness/bin/harness impact`로 영향 범위를 확인합니다.
- 큰 작업이나 생소한 영역은 `.harness/bin/harness sync` 후 `.harness/bin/harness context "<작업 설명>"`로 에이전트 판단 컨텍스트를 먼저 만듭니다.
- 프로젝트가 session workstreams README로 workstream 운영을 opt-in 했다면, 매 요청 시작 시 현재 workstream과 선행/후행 workstream 필요 여부를 먼저 식별합니다.
- `harness:context` 결과의 Selected Skills를 보고 읽을 문서, 실행할 명령, 기록 위치를 좁힌 뒤 작업합니다.
- 개발 기준 문서, 스택 문서, `src/`를 변경하면 관련 반대편 문서/코드도 함께 검토합니다.
- 코드 변경 후에는 도메인, 아키텍처, 워크플로우 로컬룰로 승격할 반복 패턴이나 검증 기준이 생겼는지 반드시 점검합니다.
- 실제 업무 진행을 개발자에게 보고할 때는 원시 내부 추론이 아니라 `[harness] request/context/impact/action/decision/verify` 형태의 visible trace로 요약합니다. 단순 질문 응답, 잡담, 메타 확인처럼 업무 진행 보고가 아닌 턴에는 이 형식을 강요하지 않습니다.
- 최종화 규칙(정본, 이 한 곳에만 둡니다): 완료 승인 전에는 `build`/`test`/`harness:check`/commit/push/PR 생성을 실행하지 않고 검증 후보로만 보고합니다. 승인 후 — `최종 검증만` 요청은 `.harness/bin/harness check` 직접 실행, `커밋/푸시` 요청은 설치된 hook 검증에 맡겨 중복 실행을 피하고, hook이 없거나 우회되는 환경이면 직접 `harness:check` 후 진행합니다. 기준 계층 준수는 hook 설치 여부와 무관합니다.
- 새 프로젝트 방향이 비어 있으면 구현보다 `.harness/project/bootstrap.md` 인터뷰를 먼저 진행합니다.
<!-- harness-managed:end -->

<!--
  이 줄 아래는 프로젝트 소유 영역입니다. 여기에는 "어디를 읽어라"만 둡니다 — 프로젝트 문서 포인터, 읽기 순서 예외, 5줄 안의 진입 핵심.
  규칙 본문(아키텍처 경계·도메인 규칙·워크플로우·커밋 규칙)은 여기 쓰지 말고 룰 문서에: .harness/project/*(domain-rules·architecture-rules·workflow-rules·commit-push-rules) 또는 팀 관례상 .claude/rules/*.md(paths로 경로 한정 가능).
  여기 쓰면 매 세션 통째로 실리고, 하네스 도구(context·impact·scan)는 그 규칙을 보지 못합니다.
  harness:update는 위 harness-managed 블록만 갱신하고 이 영역은 보존합니다.
-->

