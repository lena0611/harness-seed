# 하네스 용어

하네스 문서와 설치 안내에서 쓰는 용어를 아래처럼 통일합니다.

| 용어 | 의미 | 소비자 프로젝트에서 보이는 형태 |
| --- | --- | --- |
| 하네스 | AI 에이전트와 사람이 같은 기준으로 작업하도록 돕는 문서, 명령, 검증, 훅의 전체 체계 | `.harness/`, `CLAUDE.md`, `AGENTS.md`, npm scripts, hook |
| 공통 하네스 | 특정 기술스택과 무관한 회사 공통 개발 흐름, 세션 복구, 기준 동기화, 검증 절차 | `.harness/policy`, `.harness/session`, `.harness/bin`, `.harness/bin/harness <명령>` |
| 하네스시드 | 공통 하네스를 설치하거나 업데이트하는 저장소와 패키지 이름 | 설치 명령의 package/repo 이름으로만 노출 |
| 스택 하네스 | 특정 기술스택의 개발 기준을 공통 하네스 위에 얹는 패키지 | `.harness/project/stack-preset-rules.md`, `.harness/stacks/.applied/*` |
| 템플릿 | 실제 업무 코드 scaffold를 제공하는 별도 저장소 | `.harness/project/template-contract.md`, 적용된 코드 파일 |
| 프로젝트 하네스 | 적용 프로젝트 안에서 운영하며 누적하는 도메인, 아키텍처, 워크플로우 기준 | `.harness/project/*` |
| 개인 기준 | 개인만 참고하는 선호와 작업 방식 | 커밋하지 않는 개인 문서나 로컬 설정 |

## 사용 원칙

- 사용자-facing 문서에서는 “일반 하네스” 대신 “공통 하네스”라고 씁니다.
- “하네스시드”는 본체 저장소나 설치 패키지를 말할 때만 씁니다.
- 소비자 프로젝트의 개발자는 “하네스시드를 운영한다”가 아니라 “공통 하네스 또는 스택 하네스를 적용한다”고 이해하면 됩니다.
- 프로젝트에서 쌓이는 판단 기록은 하네스 본체 변경 이력이 아니라 해당 프로젝트의 프로젝트 하네스입니다.

## 쉬운 풀이 — 일하는 방식

| 용어 | 쉽게 말하면 | 실물 |
| --- | --- | --- |
| 로컬룰 승격 | 작업 중 반복된 패턴을 팀 규칙으로 올리는 것. 발명 금지 — 실제로 겪은 것만 | `.harness/project/domain-rules.md` 등 |
| 결정 로그 | "왜 이렇게 했나"의 기록장. 코드에 git log가 있듯 판단에도 log | `.harness/session/decision-log.md` |
| 세션 리마인더 | 다음 세션의 에이전트가 자동으로 읽는 인수인계 메모 | `.harness/session/next-session-reminder.md` |
| 프로젝트 메모리 | 오래 유지되는 사실들 — 리마인더보다 수명이 긴 기억 | `.harness/session/project-memory.md` |
| 핸드오프 | 긴 작업 중 대화가 비대해지면 상태를 파일에 적고 대화를 리셋하는 절차 | `.harness/session/handoff.md` |
| 판단 컨텍스트 | 이번 작업에 관련된 문서·명령만 색인에서 골라 싣는 것 — 백과사전 통독 대신 색인 | `.harness/bin/harness context "작업 설명"` |
| 스킬 | 작업 유형별 절차서. 슬래시 명령으로 호출 | `.harness/skills/registry.json`, `/기획확인` 등 |
| visible trace | 에이전트가 속마음 대신 요청→영향→실행→검증 형식으로 정리해 보고하는 것 | `[harness] request/.../verify` |

## 쉬운 풀이 — 검증·차단

| 용어 | 쉽게 말하면 | 실물 |
| --- | --- | --- |
| harness:check | 전체 검사 한 방 — 정책·문서·회귀·(옵트인 시) 프로젝트 검증까지 | `.harness/bin/harness check` |
| harness:impact | 커밋 전 "이 변경이 어디에 영향 주나" 미리보기. 가볍고 안 막음 | `.harness/bin/harness impact` |
| 훅(hook) | 커밋/푸시 순간 자동으로 도는 검사 관문 — 평소엔 존재감 없는 안전벨트 | `.githooks/`, `.harness/bin/harness hooks:install` |
| 회귀 | 한 번 잡은 사고가 재발하면 커밋을 막는 자동 테스트 — "다시는 안 깨진다"의 박제 | 본체 `scripts/test-init.mjs` |
| harnessMode | 동기화 신호 3단 다이얼 — bootstrap(정착기 완화)/active(기본)/strict(차단 승격) | `.harness/policy/profile.json` |
| waiver | "이 규칙, 이 범위에서 잠깐 예외" — 사유·만료와 함께 기록하는 면제증 | `.harness/policy/waivers.json` |
| sync-gap | 문서와 코드 중 한쪽만 바뀌었다는 신호 — "반대쪽도 봐야 하나?" 알림 | impact 출력의 동기화 후보 |

## 쉬운 풀이 — 기획 연동

| 용어 | 쉽게 말하면 | 실물 |
| --- | --- | --- |
| spec-lock (기준 시점) | "우리 팀은 이 시점의 기획을 보고 개발했다"는 도장 — package-lock의 기획판 | `.harness/spec-lock.json` |
| 수화(hydrate) | 팀 기준 시점의 기획 본문을 내 PC로 내려받기 — node_modules 받는 것과 같은 급 | `generated/spec-cache/` |
| 정산(settle) | "바뀐 기획 봤고 반영했다"는 확인 도장 — 찍어야 기준이 전진 | `.harness/bin/harness spec:settle` |
| drift (어긋남) | 기획서와 코드가 서로 다른 말을 하는 상태 | `harness:spec:status` |
| spec-map (매핑) | "이 기획서는 이 코드로 구현했다"의 연결표 — 도면↔시공 대응표 | `.harness/project/spec-map.md` |
| advisory / gate | 기획 어긋남을 참고로만 알릴지, push를 막을지의 집행 등급 | profile의 `specEnforcement` |
| 이슈 어댑터 | push 완료 보고에 열린 이슈 요약 한 줄을 붙이는 스위치 — 파일이 있으면 켜짐 | 프로젝트가 견본을 복사해 만든 issue-adapter 파일 (견본: `issue-adapter.example.md`) |

## 쉬운 풀이 — 계층·계약

| 용어 | 쉽게 말하면 | 실물 |
| --- | --- | --- |
| 기준 계층 | 회사 공통 → 프로젝트 → 템플릿 → 스택 → 개인 순의 규칙 층 — 덮어쓰기가 아니라 공존 | `standards-layers.md` |
| 충돌 해석 순서 | 층끼리 부딪히면 누가 이기는지의 순서표 — 회사 필수 차단 1순위, 사용자 명시 지시 2순위 | 정책 문서의 해석 순서 |
| managed / project-owned | 파일 소유권 — managed는 하네스 것(업데이트가 갱신), project-owned는 프로젝트 것(안 건드림) | 설치기 보존 목록 |
| 정본 / 파생 뷰 | 진실은 한 곳(정본)에만, 나머지는 그걸 비추는 화면 — 사본 두 개는 분열 | 결정 82·85 |
| 공개 계약 | 다른 팀·스크립트가 쓰기 시작한 내부 기능 — 그 순간부터 함부로 못 바꾸는 약속 | 회귀로 잠금 (결정 83) |
| 결번 | 사고로 오염된 버전 번호는 영구 폐기하고 건너뜀 — 재사용하면 과거 기록과 헷갈림 | 배포 체크리스트 결번 목록 |
