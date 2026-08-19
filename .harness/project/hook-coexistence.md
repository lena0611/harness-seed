# 기존 hook 도구 공존 (husky 등)

husky, lefthook처럼 `core.hooksPath`를 쓰는 git 훅 도구와 하네스 훅을 한 저장소에서 함께 쓰는 기준입니다.

> 이 문서는 업데이트로 전파되는 본체 문서입니다. 프로젝트 고유의 훅 운영 규칙은 이 문서가 아니라 [commit-push-rules.md](./commit-push-rules.md)(project-owned)에 기록합니다.

## 왜 충돌하나

- git은 `core.hooksPath`를 하나만 봅니다. 마지막에 설정한 도구가 이기고, 진 쪽 훅은 **조용히** 꺼집니다.
- 충돌의 실제 원인은 husky 자체가 아니라 `"prepare": "husky"` 스크립트입니다 — 매 `npm install`마다 `core.hooksPath`를 husky 경로로 무조건 덮어써 하네스 훅을 끕니다. 커밋 시점에는 아무 경고가 없고, `harness:check`의 "git hook 미설치" 안내로만 드러납니다.

## 공존은 이미 설계되어 있다

- `npm run hooks:install`(`install-hooks.mjs`)은 기존 hook 경로를 `harness.previousHooksPath`에 저장하고 `core.hooksPath`를 `.githooks`로 설정합니다. 기존 훅 도구의 파일은 삭제하거나 수정하지 않습니다.
- 커밋/푸시 시 `.githooks/*`가 기존 hook(husky 등)을 먼저 체인 실행하고(`run-previous-hook.mjs`, 전환 전 프로젝트 PATH인 `HARNESS_PREV_PATH` 사용), 그다음 하네스 검사를 실행합니다.
- 따라서 husky 쪽 훅(lint-staged 등)은 그대로 동작하고, 실패하면 하네스 검사 전에 커밋이 막힙니다.

## 표준 공존 패턴

```json
"prepare": "husky && node .harness/bin/install-hooks.mjs"
```

- 멱등입니다: husky가 자기 경로로 설정 → `install-hooks.mjs`가 그 경로를 저장·체인하고 `.githooks`로 재설정. `npm install`을 반복해도 같은 상태로 수렴합니다.
- 부수 이점: 훅 설치는 git 로컬 설정이라 clone으로 공유되지 않는데, prepare에 물리면 팀원이 `npm install`만 해도 husky 훅과 하네스 훅이 함께 장착됩니다(별도 온보딩 단계 불필요).
- 적용 후 확인:
  - `git config core.hooksPath` → `.githooks`
  - `git config harness.previousHooksPath` → husky 경로(버전에 따라 `.husky` 또는 `.husky/_`)이면 체인 연결 완료

## lint 이중 실행은 이제 기본으로 없다 (0.2.126)

- 과거에는 하네스가 package.json의 `lint`/`test`/`build` 스크립트를 감지하면 자동으로 커밋 검증에 포함해, husky(lint-staged)와 **같은 커밋에서 lint가 두 번** 돌고 커밋에 담기지 않은 파일의 오류까지 커밋을 막을 수 있었습니다(멀티사이트 실측, 결정 86).
- 0.2.126부터 **하네스는 프로젝트 npm script를 기본으로 실행하지 않습니다.** husky 사용자는 업데이트만 받으면 lint는 husky만 돌립니다(추가 설정 불필요).
- 하네스로 돌리고 싶은 프로젝트만 `.harness/policy/profile.json`에 옵트인합니다: `"verify": { "lint": "harness" }`. 외부 도구 담당을 문서화하고 싶으면 `"external"`을 선언하면 검증 출력에 위임 사실이 표기됩니다. 상세 계약: [config-contract.md](./config-contract.md)의 verify 절.

## 하지 않는 것

- `install-hooks.mjs`가 `"prepare": "husky"`를 감지해 경고하는 코드 개입은 하지 않습니다(코드는 최후 수단, 2026-08-13 합의). 같은 질문이 실전에서 반복되면 재고합니다.

## 이력

- 0.2.121에서 [commit-push-rules.md](./commit-push-rules.md)에 처음 승격했으나, 그 문서는 project-owned라 기존 소비자에게 업데이트로 전파되지 않아 0.2.122에서 이 문서(managed)로 이동했습니다. 범용 안내는 project-owned 문서에 두지 않습니다(결정 81).
