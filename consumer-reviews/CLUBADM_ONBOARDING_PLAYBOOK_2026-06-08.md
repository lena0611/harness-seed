# clubadm 하네스 온보딩 플레이북

작성일: 2026-06-08
대상: **clubadm** (club-admin-vue3) — 회사의 실질적 첫 공통 하네스 소비자 프로젝트
근거: harness-seed에서 clubadm 복사본(node_modules/.git/dist 제외)에 실제 설치한 고스트 테스트.

> 이 문서는 harness-seed 본체 저장소의 운영 기록입니다(`consumer-reviews/`, 미배포). 실제 clubadm 저장소는 이 테스트에서 한 번도 변경되지 않았습니다.

## 1. clubadm 현황 (설치 전)

| 항목 | 값 |
| --- | --- |
| 스택 | Vue 3 + Vite (`vite.config.js`, `src/`, `index.html`, `jsconfig.json`) |
| Node | `.nvmrc = v24.14.0` (하네스 최소 `20.19.0` 충족) |
| 기존 에이전트 자산 | `CLAUDE.md`(자체), `.claude/`(settings.json 포함), `.cursorrules`, `.agents/`, `developmentGuide/` |
| 하네스 설치 여부 | 미설치 (`.harness/`·`AGENTS.md`·`.githooks/`·`.codex/` 없음) |
| git | branch `dev`, clean |

핵심: clubadm은 **이미 자체 규칙 파일을 가진 기존 프로젝트**입니다. 온보딩의 성패는 "기존 것을 지우지 않고 하네스를 얹을 수 있는가"입니다.

## 2. 고스트 테스트로 검증된 것 (PASS)

- `.nvmrc` v24.14.0 보존.
- 기존 `CLAUDE.md` / `.cursorrules` / `.claude/settings.json` **byte 단위 보존**(설치 전후 sha 동일).
- `.harness`(19 bin)·`AGENTS.md`·`.codex`·`.githooks` 설치.
- `package.json`에 harness 스크립트 12개 병합 + 기존 `dev`/`build` 보존. `harness:changelog` 포함, 소비자형으로 변환.
- `npm run harness:check` 통과(스택 미적용이라 lint/test/build 스킵, review-suggested 1건 비차단).
- `harness:update` 시 변경 내역 인라인 출력 + `harness-lock.json`의 `lastUpdate` 보존 + `npm run harness:changelog` 재생.
- 스캔이 `club-admin-vue3` 인식, 기존 `CLAUDE.md`를 Bridge 후보로 제안.
- **`.claude/settings.json` 안전 훅 자동 병합**(0.2.59에서 수정): 기존 설정 보존 + 하네스 hooks/deny/allow/env/statusLine를 멱등 병합. clubadm의 기존 `UserPromptSubmit` 훅은 유지되고 inject-context·scan-secrets·block-dangerous·protect-paths·SessionStart·Stop 등이 wiring됨. 재설치해도 중복되지 않음.

## 3. 실제 온보딩 절차 (체크리스트)

### 사전
- [ ] clubadm 작업 트리 clean, 전용 브랜치에서 진행(예: `chore/harness-onboarding`).
- [ ] Node ≥ 20.19 (`.nvmrc` v24.14.0 OK).

### 설치
- [ ] **스택 선택**: Vue 스택 하네스가 있으면 그걸로 설치(권장). `npm`/`npx`로 후보 조회:
  ```bash
  npm run standards:list   # 또는 사내 GitLab ai-standard/harnesses 조회
  npx -y git+<vue-stack-harness-repo-url>#<tag> init
  ```
  Vue 스택 하네스가 아직 없으면 공통 하네스만 설치하고 `activeStack: none`으로 시작(lint/test/build는 스킵됨 — 추후 스택 적용 시 활성화).
- [ ] 설치 출력에서 다음을 확인:
  - `기존 하네스가 있지만 install manifest는 없습니다 ... 기존 파일은 기본적으로 보존` (정상)
  - `.claude/settings.json: 기존 설정 보존하고 하네스 안전 표면 병합 (...)` (훅 wiring 확인)
  - `backup: .harness-backup/<timestamp>` (기존 파일 백업됨)

### 설치 후 연결
- [ ] **CLAUDE.md 브리지**: 기존 `CLAUDE.md`에 `.harness` 읽기 순서 브리지 섹션 추가(스캔이 Bridge 후보로 제안). 기존 내용은 지우지 말고 보충.
- [ ] **훅 설치**: `npm run hooks:install` (pre-commit/pre-push + 커밋 템플릿). 기존 hook이 있으면 체인 실행됨.
- [ ] **스타일 출처 연결**: 스캔이 "로컬 스타일 출처 없음"이라면 기존 ESLint/팀 표준을 연결하거나 스택 프리셋의 스타일 기준을 따르도록 정리.
- [ ] **프로젝트 헌장**: `.harness/project/project-charter.md`, `scope-contract.md`를 clubadm 도메인으로 채우기.

### 검증
- [ ] `npm run harness:check` 통과 확인(필수 조치 0). 스택 적용 시 lint/test/build까지 포함.
- [ ] 커밋은 앱 기능 변경과 분리해 "하네스 온보딩" 단위로 정리.

### 운영
- [ ] 이후 본체 업데이트: `npm run harness:outdated` → `npm run harness:update` → 변경 내역은 설치 직후 출력 + `npm run harness:changelog`로 재확인.

## 4. 주의 / 알려진 고려사항

- **Vue 스택 부재 시**: 공통 하네스만으로는 `activeStack=none`이라 Vue 린트/빌드/테스트가 자동 검증에 안 묶입니다. 가능하면 Vue 스택 하네스를 먼저 준비.
- **`.claude/settings.json` 병합 범위**: 0.2.59부터 하네스 안전 훅·deny·allow·env·statusLine을 병합합니다. 병합은 추가만 하고 기존 값을 덮지 않습니다(statusLine은 없을 때만 설정). 소비자가 의도적으로 비활성화한 항목이 다시 추가될 수 있으니, 원치 않으면 설치 후 settings.json에서 제거하고 사유를 남깁니다.
- **개인 파일**: `.claude/settings.local.json`, `CLAUDE.local.md`는 project-owned로 보존되고 커밋 대상이 아닙니다.
- **기존 `.cursorrules`/`.agents/`**: 하네스가 건드리지 않습니다. 필요하면 브리지로만 연결.

## 5. 한 줄 결론

clubadm은 기존 자산을 지우지 않고 공통 하네스를 얹을 수 있음이 검증됨. 실전 온보딩의 유일한 선결 과제는 **Vue 스택 하네스 준비 여부**이며, 안전 훅 wiring 갭은 0.2.59에서 해소됨.
