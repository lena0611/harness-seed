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

- [ ] `npm run harness:impact`로 영향 범위를 먼저 확인한다. (`harness:check`는 최종화 승인 후)
- [ ] [ai-standard-guiding-policy.md](../policy/ai-standard-guiding-policy.md) 위배 여부를 확인한다.
- [ ] 정책 문서(`.harness/policy/**`)만 바꾸는 경우, 그 정책을 강제하는 코드도 함께 봐야 하는지 판단한다(SYNC GAP). 코드 변경이 불필요하면 사유를 [decision-log.md](../session/decision-log.md)에 남긴다.

## 2단계 — 구현과 동기화

- [ ] 문서 ↔ 코드 ↔ 검사를 같이 맞춘다. 정책을 추가했으면 `policy-registry.json`과 guard 연결을 확인한다.
- [ ] 새 `.md`를 추가하면 [document-registry.json](../documentation/document-registry.json)에 등록한다(미등록 = orphan → strict 검사 실패).
- [ ] 새 작업 절차가 생기면 [skills/registry.json](../skills/registry.json)과 [context-registry.json](../documentation/context-registry.json)에 연결한다.
- [ ] 훅(`.githooks/**`)을 바꾸면 [commit-push-rules.md](./commit-push-rules.md)의 "변경 시 함께 확인할 것"도 갱신한다.

## 3단계 — 버전과 변경 이력

버전 등급은 [authoring-guide.md](../stacks/authoring-guide.md)의 버전 운영 기준을 따릅니다.

- [ ] `package.json`의 `version`을 SemVer로 bump한다. (patch=수정, minor=하위호환 추가, major=계약 변경)
- [ ] `CHANGELOG.md`에 같은 버전 항목과 변경 요약을 추가한다.
- [ ] **major나 기준 해석이 바뀌는 변경은 자동으로 올리지 않는다.** downstream 영향을 먼저 확인하고 명시적으로 결정한다.

## 4단계 — 최종화 (사용자 승인 후)

완료 승인 전에는 build/test/check/commit/push/PR을 실행하지 않습니다. 승인 후:

- [ ] `최종 검증만` 요청이면 `npm run harness:check`를 직접 실행한다.
- [ ] `커밋`/`커밋하고 푸시` 요청이고 hook이 설치돼 있으면 pre-commit(전체 `harness:check`)/pre-push(`harness:check -- --fast`)에 맡기고 선행 수동 검증을 중복 실행하지 않는다.
- [ ] 필요하면 릴리스 태그(`vX.Y.Z`)를 만든다.

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
- [ ] pre-push에 연결된 `.harness/bin/check-remote-sync.mjs` 가드가 어긋남을 알리면 빠진 원격에 push한다. (이 가드는 캐시된 remote-tracking 기준의 비차단 알림이며 push를 막지 않는다.)
- [ ] 각 push는 pre-push hook의 `harness check --fast`를 거친다. 저버전 Node 셸에서 push해도 hook이 dual-runtime으로 하네스 Node로 전환해 검증한다(0.2.63+).
- [ ] push 후 GitHub Actions `Policy Guard` 워크플로(`.github/workflows/policy-guard.yml`) 결과가 통과인지 확인한다. (`gh run list --branch main --limit 1`)

## 6단계 — downstream 반영/통지

소비자 *프로젝트*는 본체가 직접 push하지 않습니다. 각 프로젝트가 `harness:update`로 당겨갑니다(통지만). 단, 아래 downstream은 본체 릴리스 루틴의 일부로 **직접 반영**합니다.

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
  npm run check && npm test                             # 18 테스트 통과 확인
  git add -A && git commit -m "공통 하네스 v<본체버전> 설치 경로 반영"
  git tag -a v<CLI버전> -m "..." && git push origin master && git push origin v<CLI버전>
  ```

### 스택 하네스
- [ ] 각 스택 하네스가 새 본체 버전(`baseHarness.minVersion`/`range`)을 따라와야 하는지 판단한다(필요 시 각 스택 저장소에서 반영).
- [ ] 여러 소비 프로젝트 자동 MR 전파는 향후 `ai-standard-cli`가 담당한다. 현재는 통지/기록만 한다.

## 7단계 — 기록

- [ ] 구조 결정·예외 사유 → [decision-log.md](../session/decision-log.md)
- [ ] 다음 세션에서 이어야 할 항목 → [next-session-reminder.md](../session/next-session-reminder.md)
- [ ] 반복되는 본체 운영 지식 → 이 문서 또는 관련 기준 문서로 승격
