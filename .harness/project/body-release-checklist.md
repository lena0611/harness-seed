# 본체 변경 / 배포 체크리스트

> **적용 범위: harness-seed 본체 저장소(seed-mode) 전용.**
> 이 문서는 공통 하네스 *설치기 자체*를 고치고 내보낼 때의 절차입니다.
> 하네스를 설치한 소비자 프로젝트에는 적용되지 않습니다. 소비자 프로젝트의 커밋/푸시 기준은 [commit-push-rules.md](./commit-push-rules.md)를 따릅니다.
> 이 저장소가 본체인지 여부는 루트의 `.harness-seed-mode` 마커 존재로 판별합니다.

## 왜 이 문서가 필요한가

본체는 "남이 안전하게 일하도록 돕는 안전장치"를 만들지만, 정작 *본체 자신을 고치고 내보내는* 절차는 사람의 기억에 의존해 왔습니다. 그 결과:

- 한쪽 원격(GitHub/GitLab)에만 push해 미러가 뒤처지는 사고가 반복됐습니다.
- 버전 bump, CHANGELOG, downstream(CLI·스택 하네스) 통지가 빠지기 쉬웠습니다.

이 문서는 그 절차를 고정해 "기억"이 아니라 "체크리스트"로 만듭니다.

## 변경 분류

본체 변경은 [standards-layers.md](./standards-layers.md)의 계층과 충돌 해석 순서를 따릅니다. 변경 성격을 먼저 나눕니다.

- 공통 하네스 문서/기준 (`.harness/policy/**`, `.harness/project/**`, `.harness/session/**`)
- 런타임 스크립트/진입점 (`.harness/bin/**`, `scripts/**`)
- 어댑터 (`.claude/**`, `.codex/**`, `.github/**`)
- 설정/패키징 (`package.json`, `.githooks/**`, `CHANGELOG.md`)

## 1단계 — 작업 전

- [ ] `.harness/bin/harness impact`로 영향 범위를 먼저 확인한다. (`harness:check`는 최종화 승인 후)
- [ ] [ai-standard-guiding-policy.md](../policy/ai-standard-guiding-policy.md) 위배 여부를 확인한다.
- [ ] 정책 문서(`.harness/policy/**`)만 바꾸는 경우, 실제 실행 계약도 바뀌었는지 확인한다. 설명 보강이면 코드 수정이나 decision-log 기록 없이 진행한다.

## 2단계 — 구현과 동기화

- [ ] 문서 ↔ 코드 ↔ 검사를 같이 맞춘다. 정책을 추가했으면 `policy-registry.json`과 guard 연결을 확인한다.
- [ ] **새 검사·테스트를 만들면 실제 실행 경로를 확인한다** — 확인 절차는 [sync-protocol.md](../policy/sync-protocol.md)의 "변경 유형별 연결 확인 A"가 정본이다. **본체에서의 사실**: 관문은 `.harness/bin/guard.mjs`의 seed-mode 분기가 돌리는 것뿐이고, `npm run` 스크립트는 아무도 부르지 않는다(2026-09-07 실측).
- [ ] 새 `.md`를 추가하면 [document-registry.json](../documentation/document-registry.json)에 등록한다(미등록 = orphan → strict 검사 실패).
- [ ] **새 문서·범용 안내의 자리를 정할 때 소유 계층부터 판정한다** — managed(업데이트로 전파) / project-owned(기존 소비자에 전파 안 됨) / marker-managed. 범용 안내를 project-owned에 두면 공지가 기존 소비자에게 거짓이 된다(결정 81, 0.2.122 실증).
- [ ] **허용 값 목록(enum)을 좁히면 하네스가 써준 안내문도 함께 정리한다** — 본체 템플릿(profile notes 등)만 고치면 구설치 소비자에는 화석 안내가 남아 "파일이 시킨 대로 했는데 그 파일 때문에 차단"이 된다(2026-08-31 멀티사이트 실증: maintenance). 옛 문장 정확 치환 마이그레이션까지 한 세트로 검토한다.
- [ ] **소비자가 본체 스크립트의 함수·출력을 쓰기 시작하면 그 표면은 공개 계약이다** — 발견 즉시 회귀로 잠근다(결정 83, specSyncPublicSurfaceStaysLocked가 예). 바꿔야 하면 그 회귀를 깨뜨리는 커밋이 소비자 마이그레이션을 함께 안내한다.
- [ ] 새 작업 절차가 생기면 [skills/registry.json](../skills/registry.json)과 [context-registry.json](../documentation/context-registry.json)에 연결한다.
- [ ] 훅(`.githooks/**`)을 바꾸면 [commit-push-rules.md](./commit-push-rules.md)의 "변경 시 함께 확인할 것"도 갱신한다.
- [ ] **외부 리뷰 지적을 처리할 때는 재발 경로까지 닫는다.** 지적별로 셋을 확인한다 — ① 직접 원인과 영향받은 연결이 수정됐는가 ② **같은 구조의 누락이 관련 경로에 남아 있는가**(3라운드 모두 여기서 새 지적이 나왔다: 고친 곳 밖에 같은 문제가 남아 있었다) ③ 재발 방지가 실제로 동작하는가.
  - 기계적으로 판정할 수 있고 영향이 큰 조건은 **기존** 테스트·관문에 연결한다. 의미 판단이 필요한 조건은 기존 체크리스트에 구체적인 질문으로 남긴다.
  - **문서 문구를 그대로 복제한 테스트나 실행되지 않는 테스트는 재발 방지가 아니다.** 일회성 오탈자를 영구 규칙으로 승격하지도 않는다.
  - 지적을 수용하기 전에 **코드에서 재현**한다. 반박할 것이 있으면 근거와 함께 반박하고, 반박하지 않은 채 넘기지 않는다.
- [ ] 개발자 대면 명령·절차(스크립트, 훅, 스킬, 커밋 규칙, 기획 연동)가 바뀌면 클릭형 가이드([guide/index.html](../documentation/guide/index.html))와 대시보드 생성기(`.harness/bin/harness-guide.mjs`)도 갱신한다. `harness:impact`의 `guide-sync` 항목이 이 확인을 지목한다 (0.2.98→0.2.124 방치 실증의 재발 방지).

## 3단계 — 버전과 변경 이력

버전 등급은 [authoring-guide.md](../stacks/authoring-guide.md)의 버전 운영 기준을 따릅니다.

- [ ] `package.json`의 `version`을 SemVer로 bump한다. (patch=수정, minor=하위호환 추가, major=계약 변경)
- [ ] `CHANGELOG.md`에 같은 버전 항목과 변경 요약을 추가한다.
- [ ] **major나 기준 해석이 바뀌는 변경은 자동으로 올리지 않는다.** downstream 영향을 먼저 확인하고 명시적으로 결정한다.

## 4단계 — 최종화 (사용자 승인 후)

완료 승인 전에는 build/test/check/commit/push/PR을 실행하지 않습니다. 승인 후:

- [ ] `최종 검증만` 요청이면 `.harness/bin/harness check`를 직접 실행한다.
- [ ] `커밋`/`커밋하고 푸시` 요청이고 hook이 설치돼 있으면 hook에 맡기고 선행 수동 검증을 중복 실행하지 않는다. 본체는 2단계 게이트(0.2.134)다: **pre-commit은 가벼운 검사만**(정책·문서·계약, 회귀 스위트 생략 — `HARNESS_GUARD_STAGE=commit`), **pre-push가 회귀 포함 전량**(`check --fast`, 첫 push가 전량을 돌고 캐시를 남겨 둘째 원격·태그 push는 캐시 재사용). 회귀는 push 전에 반드시 한 번 돈다 — 커밋만 하고 끝나는 작업이라도 push 시점에 걸린다.
- [ ] **릴리스 태그(`vX.Y.Z`)는 마지막 커밋에 찍는다.** 순서: 본체 변경 커밋 → `npm run release:version-net`(자기 버전 ↔ CHANGELOG 정합) → **태그** → 양쪽 원격에 브랜치·태그 push. (2026-09-07 이전에는 여기서 스택·템플릿 동반 범프를 기다려야 했다 — 태그를 먼저 찍으면 신규 설치가 한 세대 낡은 스택 ref를 받았기 때문이다. **이제 본체 릴리스가 위성을 따라 올리지 않으므로 그 대기가 없다.** 카탈로그 `ref` 갱신은 위성 소유자의 요청으로 별건 처리한다 — 아래 6단계.)

## 5단계 — 양쪽 원격 동기화 (필수)

본체는 두 원격을 **항상 같은 커밋**으로 유지합니다. 기본 브랜치명이 다른 점에 주의합니다.

| 원격 | 호스트 | 기본 브랜치 |
| --- | --- | --- |
| `origin` | GitHub | `main` |
| `company` | GitLab | `master` |

- [ ] 브랜치를 양쪽에 모두 push한다.
  ```bash
  git push origin main
  git push company main:master
  ```
- [ ] 태그를 만들었으면 **태그도 양쪽 원격에 push**한다. (브랜치만 push하면 태그는 따라가지 않는다.)
  ```bash
  git push origin vX.Y.Z
  git push company vX.Y.Z
  ```
- [ ] 세 ref와 태그가 양쪽에서 같은지 확인한다.
  ```bash
  git fetch origin --quiet && git fetch company --quiet
  git rev-parse --short main origin/main company/master              # 셋이 동일해야 한다
  git ls-remote --tags origin vX.Y.Z && git ls-remote --tags company vX.Y.Z   # 양쪽에 존재해야 한다
  ```
- [ ] **형제 저장소(스택·템플릿·CLI) 작업이 섞이는 릴리스에서는 모든 git 명령에 `git -C <경로>`를 명시한다** — `cd`로 옮겨 다니면 셸 작업 디렉터리가 남아 엉뚱한 저장소에 태그·커밋이 실행된다(2026-08-14 오태그 실증: v0.2.123 태그가 스택 저장소에 push됐다 즉시 삭제).
- [ ] pre-push에 연결된 `.harness/bin/check-remote-sync.mjs` 가드가 어긋남을 알리면 빠진 원격에 push한다. (이 가드는 캐시된 remote-tracking 기준의 비차단 알림이며 push를 막지 않는다.)
- [ ] 각 push는 pre-push hook의 `harness check --fast`를 거친다. 저버전 Node 셸에서 push해도 hook이 dual-runtime으로 하네스 Node로 전환해 검증한다(0.2.63+).
- [ ] push 후 GitHub Actions `Policy Guard` 워크플로(`.github/workflows/policy-guard.yml`) 결과가 통과인지 확인한다. (`gh run list --branch main --limit 1`)
- [ ] **⛔ 번복 배너를 담은 push는 CI가 반드시 빨개진다 — 알고 있어야 한다**(2026-09-07 실측). CI는 `harness:check:strict`를 `--base <이전 push> --head <이번 push>`로 돌린다. 그 범위의 decision-log diff에 ⛔가 있으면 기준 동기화 후보가 **확인 필수로 승격**되고, strict에서 확인 필수는 실패다. 게다가 정책 검사 단계에서 멈추므로 **그 뒤의 회귀 스위트는 아예 돌지 않는다** — "CI 빨감 = 테스트 실패"가 아니다.
  - 승격은 **diff 범위**로 판정하므로 다음 push의 범위에는 그 ⛔가 없어 저절로 통과한다. 기다리는 것이 정상 처리다.
  - **릴리스 태그를 찍는 push의 범위에 ⛔를 넣지 말 것.** 릴리스 커밋은 초록 CI가 필요한데 그 push가 빨개진다. 번복 커밋을 먼저 별도로 push해 초록을 받고, 그다음 push에 태그를 얹는다.
  - 후보를 침묵시키려고 연결 문서를 억지로 만지지 않는다. 승격은 "반대 서술이 남았는지 확인하라"는 요구이고, 확인 결과와 판정은 커밋 메시지에 남긴다.
  - **번복 배너 커밋을 먼저, 문서·회귀 커밋을 나중에**(2026-09-08 실측 — 순서를 거꾸로 해서 CI를 한 번 빨갛게 만들었다). 번복은 보통 **반대로 말하던 문서를 고치는 작업과 한 몸**이고, 그 정합을 트리 전역 회귀로 잠그는 경우가 많다. 그때 순서가 결과를 가른다.
    - 배너 먼저(로그 단독 커밋) → 안내만 뜨고 통과. 그 트리에는 아직 새 회귀가 없어 문서가 낡아도 잡히지 않는다.
    - 문서·회귀 나중 → 그 diff에 ⛔가 없어 승격이 없고, 트리는 이미 정합이라 새 회귀도 통과한다.
    - 거꾸로 하면 **문서·회귀 커밋의 트리에 배너가 아직 없어 자기 회귀에 걸린다**(`ceb429e` 실패). HEAD는 초록이어도 자기 검사를 통과하지 못하는 커밋이 이력에 남는다.
  - 승격을 "확인했다"고 표시해 해소하는 수단은 **없다**(실측). diff에서 빠지기를 기다리는 것이 유일한 처리이므로, 위 순서가 사실상의 계약이다.

## 6단계 — downstream 반영/통지

소비자 *프로젝트*는 본체가 직접 push하지 않습니다. 각 프로젝트가 `harness:update`로 당겨갑니다(통지만). 단, 아래 downstream은 본체 릴리스 루틴의 일부로 **직접 반영**합니다.

### 배포 현황판 머리말 갱신 (매 릴리스 · 태그 push 직후)
- [ ] 태그를 양쪽 원격에 push한 뒤 `.harness/bin/harness report:install -- --rebuild-history`를 본체 저장소에서 실행한다. 현황판 이슈(라벨 `설치이력표`)의 머리말이 새 태그로 바뀐다.
- [ ] 머리말 값은 **본체 저장소의 릴리스 태그**에서 온다 — 표의 최대값이 아니다. 그래서 아무도 아직 업데이트하지 않은 릴리스도 곧바로 보인다.
- [ ] 이 단계를 건너뛰어도 현황판은 다음 소비자 리포트 때 스스로 최신으로 그려진다(재생성 파생 뷰). 이 단계는 그 사이의 시차를 없애는 것이다.
- [ ] 태그 조회가 실패하면 머리말은 직전 값을 그대로 유지한다(지어내지 않는다). 출력에 확인 실패 줄이 뜨면 토큰 권한이나 네트워크를 본다.

### ai-standard-cli 반영 (consumer-facing 릴리스마다 — 별도 저장소)
- 위치: 형제 디렉터리 `../ai-standard-cli` (GitLab 단일 원격 `origin`, 기본 브랜치 `master`, 자체 `.harness` 없음 → hook 검증 없음, 검사는 수동).
- CLI 자체 버전은 본체와 **별개 라인(0.1.x)**이며, 본체 태그를 base ref로 "반영"한다. 커밋 컨벤션: `공통 하네스 vX.Y.Z 설치 경로 반영`.
- 유지보수/문서만 바뀐 본체 릴리스(consumer 동작 불변)는 CLI base ref를 굳이 올리지 않아도 된다. 기능/버그/계약 변경 릴리스에서 반영한다.
- 절차(Node ≥20.19 셸에서):
  ```bash
  cd ../ai-standard-cli && git fetch origin            # clean + master 최신 확인
  # 1) package.json version patch bump
  npm install --package-lock-only --ignore-scripts     # lock 동기 (수동 lock 편집은 hook 차단)
  # 2) README의 AI_STANDARD_BASE_HARNESS_REF=v<본체새버전> 갱신 + 테스트 픽스처 예시 ref 갱신
  npm run check && npm test                             # 전체 통과 확인(테스트 수는 CLI 저장소가 소유)
  git add -A && git commit -m "공통 하네스 v<본체버전> 설치 경로 반영"
  git tag -a v<CLI버전> -m "..." && git push origin master && git push origin v<CLI버전>
  ```

### 스택 하네스 · scaffold 템플릿
**본체 릴리스는 이들을 손대지 않습니다**(결정 108, 2026-09-07). 각 저장소가 자기 릴리스를 소유하고, 자기 `manifest.json`의 `baseHarness.ref`로 본체를 어떻게 따라갈지 스스로 정합니다. **그 값은 그 저장소가 실제로 검증한 정확한 태그입니다 — 범위 표기(`semver:<range>`)는 쓰지 않습니다**(2026-09-07 외부 리뷰: 릴리스 시점 검증이 그 뒤에 나올 본체를 보장하지 못한다). 이유와 판단 기준은 [authoring-guide.md](../stacks/authoring-guide.md)의 `baseHarness.ref` 절.

- [ ] **본체 릴리스마다 위성을 따라 올리지는 않습니다.** 버전 정합 검사(`npm run release:version-net`)도 본체 자기 것(`package.json` ↔ `CHANGELOG` 최상단)만 봅니다. 위성 manifest를 찾아 써주지 않습니다 — 남이 운영하는 스택은 그 자리에 없기 때문입니다.
- [ ] **위성 소유자가 검증한 새 태그의 카탈로그 반영을 요청하면 본체가 `ref`를 갱신합니다.** 배포 카탈로그(`.harness/stacks/registry.json`·`.harness/templates/registry.json`)는 **검증된 태그를 고정합니다** — 그 값이 소비자가 복사해 실행하는 설치·적용 명령을 만듭니다. `#semver:*`(최신 자동 해석)를 잠시 썼다가 되돌렸습니다: zsh가 `*`를 파일 패턴으로 해석해 복사한 명령이 죽고(실측), 템플릿 적용은 git ref를 요구해 자리표시자로는 실행할 수 없습니다.
  - 이 갱신은 **본체 릴리스 절차의 일부가 아니라 별건 요청 처리**입니다. 위성이 태그를 냈다고 본체가 알아서 따라가지 않습니다 — 알려오면 갱신합니다.
  - 새 자산을 목록에 처음 올릴 때도 같은 창구입니다(`id`·`repo`·`ref`).
- [ ] 본체 변경이 위성 계약을 깨는 경우(플래그·별칭 은퇴, 함수 표면 변경)에는 **소비처 grep이 선행 조건**입니다 — 형제 저장소가 쓰기 시작한 표면은 공개 계약이고 본체 회귀에 안 잡힙니다. 은퇴는 삭제가 아니라 무동작 수용입니다.
- [ ] 위성 쪽 절차(자기 ref 선반영, 결번, 검증한 본체 태그 대상 설치 회귀)는 그 저장소의 릴리스 문서가 소유합니다.

## 6-2단계 — 릴리스 공지 (매 릴리스 · 승인 필요)

체크리스트에 이 단계가 없어 매번 즉흥으로 처리돼 왔다(2026-09-07 0.2.142에서 발견).

- [ ] `node scripts/release-notice.mjs`로 문구를 뽑는다. CHANGELOG 최상단 절의 `### 공지` 목록을 그대로 쓰므로, **공지 줄을 다듬는 것은 CHANGELOG에서 한다**(스크립트나 채널에서 고치면 기록과 갈라진다).
- [ ] **문구를 사용자에게 보여 승인을 받는다. 태그 push 전에 받는다.** 승인 전에는 발송하지 않는다.
- [ ] 줄 수는 **릴리스당 0~3줄이 정상**이다. 넘으면 줄일 후보를 이유와 함께 제시한다 — 에이전트만 마주치는 변화(스택 작성자용 안내 등), 켠 프로젝트가 0인 옵션 제거, 겪은 팀이 없는 결함픽스, 신규 설치에서만 보이는 변화, 태그 없는 안내 변경은 빼는 쪽이다. 뺀 이유는 릴리스 커밋 메시지에 남긴다(0.2.142: 10줄 → 4줄).
- [ ] **발송은 GitLab CI가 태그 push 때 자동으로 한다** — 본체 `.gitlab-ci.yml`의 `release-notice` 잡이 `vX.Y.Z` 태그에서 `node scripts/release-notice.mjs --json`을 Mattermost 수신 훅(CI 변수 `MATTERMOST_WEBHOOK_URL`)으로 POST한다. 채널에는 훅 이름(webhook)으로 찍힌다. **그래서 승인은 태그 push 전에 받아야 한다 — 태그가 곧 발송이다**(2026-09-08 v0.2.145에서 "발송은 사용자 몫"이라고 잘못 안내해 혼선). 변수가 없거나 잡이 실패하면 사용자가 같은 스크립트 출력으로 손으로 보낸다(allow_failure).
- [ ] **에이전트는 공지를 직접 보내지 않는다.** 이 스크립트에는 네트워크 호출이 없다(stdout 전용) — 의도된 설계이고, 발송 경로를 스크립트에 넣지 않는다(CI 잡만 전달). 팀별 사전·사후 개별 안내도 보내지 않는다.

## 7단계 — 기록

- [ ] 구조 결정·예외 사유 → [decision-log.md](../session/decision-log.md)
- [ ] 다음 세션에서 이어야 할 항목 → [next-session-reminder.md](../session/next-session-reminder.md)
- [ ] 반복되는 본체 운영 지식 → 이 문서 또는 관련 기준 문서로 승격

## 모델 세대 교체 릴리스 (사내 표준 에이전트 모델이 바뀔 때만)

프롬프트·지시는 모델 버전에 묶인 감가상각 자산이다(컨텍스트 다이어트 에픽 참조). 사내 표준 모델의 세대가 바뀌는 릴리스에서는:

- [ ] 진입점·정책 문서의 행동 지시에 "이 지시, 새 모델에도 필요한가"를 재적용한다 — 4분류(고유 정보 유지 / 뻔한 정보 삭제 / 일반론 삭제·판단 기준으로 압축 / 중복 포인터화). 삭제·전환은 회귀나 실측을 동반한다(평가 없이 지우면 기대일 뿐).
- [ ] 워크플로우 모델·effort 배정 기준(개인 글로벌 지침 포함)을 새 모델 라인업으로 갱신한다.
- [ ] 멀티모델 환경 주의: 강한 모델 기준으로 지시를 지우면 약한 모델 경로가 조용히 깨진다 — 바닥 모델(현재 Sonnet 라인)에서의 거동을 확인한 뒤 지운다.
