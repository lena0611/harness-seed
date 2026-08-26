# 기존 hook 도구 공존 (husky 등)

husky, lefthook처럼 `core.hooksPath`를 쓰는 git 훅 도구와 하네스 훅을 한 저장소에서 함께 쓰는 기준입니다.

> 이 문서는 업데이트로 전파되는 본체 문서입니다. 프로젝트 고유의 훅 운영 규칙은 이 문서가 아니라 [commit-push-rules.md](./commit-push-rules.md)(project-owned)에 기록합니다.

## 왜 충돌하나

- git은 `core.hooksPath`를 하나만 봅니다. 마지막에 설정한 도구가 이기고, 진 쪽 훅은 **조용히** 꺼집니다.
- 충돌의 실제 원인은 husky 자체가 아니라 `"prepare": "husky"` 스크립트입니다 — 매 `npm install`마다 `core.hooksPath`를 husky 경로로 무조건 덮어써 하네스 훅을 끕니다. 커밋 시점에는 아무 경고가 없고, `harness:check`의 "git hook 미설치" 안내로만 드러납니다.

## 공존은 이미 설계되어 있다

- `.harness/bin/harness hooks:install`(`install-hooks.mjs`)은 기존 hook 경로를 `harness.previousHooksPath`에 저장하고 `core.hooksPath`를 `.githooks`로 설정합니다. 기존 훅 도구의 파일은 삭제하거나 수정하지 않습니다.
- 커밋/푸시 시 `.githooks/*`가 기존 hook(husky 등)을 먼저 체인 실행하고(`run-previous-hook.mjs`, 전환 전 프로젝트 PATH인 `HARNESS_PREV_PATH` 사용), 그다음 하네스 검사를 실행합니다.
- 따라서 husky 쪽 훅(lint-staged 등)은 그대로 동작하고, 실패하면 하네스 검사 전에 커밋이 막힙니다.

## 표준 공존 패턴

```json
"prepare": "husky && node .harness/bin/install-hooks.mjs"
```

동등한 대안 — `prepare` 값을 husky 단독으로 두고 싶으면 `postprepare`에 겁니다. npm이 `prepare` 다음에 `postprepare`를 실행하므로 순서와 결과가 위와 같습니다.

```json
"prepare": "husky",
"postprepare": "node .harness/bin/install-hooks.mjs"
```

- 순서가 지켜져야 하는 이유(실측): husky 9.1.7은 실행 시 `core.hooksPath`를 **조건 없이** 자기 경로로 덮어씁니다. 따라서 하네스 설치는 항상 husky *뒤에* 와야 하며, 두 패턴 모두 그 순서를 보장합니다.
- 하한선(실측 2026-08-26): `postprepare`는 **npm 7부터** 생명주기로 인정됩니다. npm 6(Node 12·14 동봉분)은 `prepare`가 있어도 `postprepare`를 실행하지 않습니다. husky 9 자체가 Node 18+를 요구하므로 이 공존 패턴을 쓸 프로젝트는 하한선이 자동 충족되고, husky 없이 하네스 훅만 쓰는 프로젝트는 `prepare` 직행이면 npm 6에서도 동작합니다. 덤: npm 7+에서는 `prepare`를 지워도 `postprepare`가 단독으로 실행되므로, husky를 걷어내도 하네스 훅 설치는 살아남습니다.
- 멱등입니다: husky가 자기 경로로 설정 → `install-hooks.mjs`가 그 경로를 저장·체인하고 `.githooks`로 재설정. `npm install`을 반복해도 같은 상태로 수렴합니다.
- 부수 이점: 훅 설치는 git 로컬 설정이라 clone으로 공유되지 않는데, prepare에 물리면 팀원이 `npm install`만 해도 husky 훅과 하네스 훅이 함께 장착됩니다(별도 온보딩 단계 불필요).
- 적용 후 확인:
  - `git config core.hooksPath` → `.githooks`
  - `git config harness.previousHooksPath` → husky 경로(버전에 따라 `.husky` 또는 `.husky/_`)이면 체인 연결 완료

## lint 이중 실행은 없다 — 하네스는 lint를 실행하지 않는다 (0.2.131)

- 과거에는 하네스가 package.json의 `lint`/`test`/`build` 스크립트를 감지하면 자동으로 커밋 검증에 포함해, husky(lint-staged)와 **같은 커밋에서 lint가 두 번** 돌고 커밋에 담기지 않은 파일의 오류까지 커밋을 막을 수 있었습니다(멀티사이트 실측).
- **하네스는 lint를 실행하지 않습니다. husky 등 프로젝트 도구가 담당합니다.** test/build도 마찬가지이며, 옵트인 설정도 없습니다 — 코드 품질 검사의 소유는 전적으로 프로젝트입니다. 상세 계약: [config-contract.md](./config-contract.md).
- 하네스 훅이 하는 일은 체인 실행(기존 husky 훅 먼저)과 하네스 자신의 관문 검사뿐입니다. 그래서 husky 쪽 lint 설정을 그대로 두면 됩니다.

## 하지 않는 것

- `install-hooks.mjs`가 `"prepare": "husky"`를 감지해 경고하는 코드 개입은 하지 않습니다(코드는 최후 수단, 2026-08-13 합의). `postprepare` 대안에서는 `prepare`가 husky 단독인 것이 정상이므로, 값만 보고 경고하면 오탐이 됩니다. 같은 질문이 실전에서 반복되면 재고합니다.

## 이력

- 0.2.121에서 [commit-push-rules.md](./commit-push-rules.md)에 처음 승격했으나, 그 문서는 project-owned라 기존 소비자에게 업데이트로 전파되지 않아 0.2.122에서 이 문서(managed)로 이동했습니다. 범용 안내는 project-owned 문서에 두지 않습니다(결정 81).
