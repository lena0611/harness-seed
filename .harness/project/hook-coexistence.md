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
- 프로젝트 쪽 검사(lint·test·build)를 어떻게 구성할지는 이 문서의 범위가 아닙니다 — 견본 정본은 회사 툴킷 `ai-standard/toolkits/quality-gates`(https://git.smartscore.kr/ai-standard/toolkits/quality-gates)이고, 에이전트에게 요청하면 조달해 설치합니다(`/검증게이트설치`). 이 문서는 그 구성과 하네스 깃훅이 **공존하는 배선**만 정합니다.
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

## 이미 체인 중인 저장소에 husky를 나중에 얹는 경우 (0.2.135)

하네스의 "이전 훅 보관함"(`harness.previousHooksPath`)은 **한 칸**입니다. 하네스는 자기 훅을 돌린 뒤
보관함에 적힌 경로의 훅을 이어 부르는데, 보관함에는 마지막으로 밀려난 경로 하나만 남습니다.

그래서 이 순서를 밟으면 —

1. 하네스가 옛 커스텀 훅(`.git/hooks` 등)을 보관함에 담아 체인 중이었고
2. 나중에 husky를 도입하면(`prepare`가 `core.hooksPath=.husky/_` 설정)
3. 다음 `hooks:install`(postprepare)이 보관함을 `.husky/_`로 갈아끼웁니다

husky 훅은 잘 돌지만, **옛 `.git/hooks` 훅들은 실행 경로에서 조용히 빠집니다.** 파일은 그대로라
"삭제하지 않는다"는 약속은 지켜지지만 기능은 사라지므로, 0.2.135부터 교체가 일어나는 순간
`hooks:install`이 무엇이 밀려나는지 경고 1줄을 출력합니다.

밀려난 훅이 여전히 필요하면 **새 체인(husky) 쪽에서 직접 호출**하세요:

```sh
# .husky/pre-commit 등에서
sh "$(git rev-parse --show-toplevel)/.git/hooks/pre-commit"
```

## husky가 없는 프로젝트(PHP 등)의 자체 훅 폴더 (0.2.141)

Node가 아닌 프로젝트(PHP 모놀리스 등)가 자기 커밋 검사(예: PHP 7.2∩8.4 파스 검사, PHPStan)를 팀 전체에 걸고 싶을 때의 패턴입니다. 원리는 husky와 같습니다 — **프로젝트 훅 폴더를 "이전 훅"으로 두고 하네스가 체인**합니다.

- **어디에 두나**: 저장소에 커밋되는 자기 폴더 — 예를 들어 scripts/git-hooks/pre-commit 같은 파일(실행 권한). 이름은 프로젝트가 정합니다. 두 가지는 피합니다 — `.githooks/*`에 직접 쓰기(하네스 관리 파일이라 업데이트 때 보존·동결 문제), `.git/hooks/*`에 쓰기(내 PC 전용, 팀에 안 퍼짐).
- **순서(핵심)**: `core.hooksPath`를 자기 폴더로 **먼저** 두고, 그 다음 `node .harness/bin/install-hooks.mjs`. 하네스가 그 경로를 `harness.previousHooksPath`에 보관하고 `core.hooksPath`를 `.githooks`로 바꿔, 커밋 때 자기 훅 → 하네스 검사 순으로 돕니다. 거꾸로 하면 하네스 훅이 밀려나거나 순환합니다.
- **팀원마다 자동으로**: Node의 `prepare` 자리는 composer 스크립트가 맡습니다.
  ```json
  "scripts": {
    "post-install-cmd": ["@git-hooks"],
    "post-update-cmd":  ["@git-hooks"],
    "git-hooks": ["git config core.hooksPath scripts/git-hooks", "node .harness/bin/install-hooks.mjs"]
  }
  ```
  composer를 쓰지 않으면 각자 한 번 `git config core.hooksPath scripts/git-hooks && node .harness/bin/install-hooks.mjs`.
- **확인**: `git config core.hooksPath` → `.githooks`, `git config harness.previousHooksPath` → 자기 훅 폴더(예: scripts/git-hooks).
- **훅 스크립트가 지킬 것**: 입력은 `git diff --cached --name-only`(이번 커밋의 파일), 검사 대상은 `git show ":$f"`(스테이징된 내용), 실패는 `exit 1`. 필요한 실행 파일이 없을 때 조용히 통과시키지 말고 실패시킵니다 — 검사가 빠지는 것이 이 게이트가 막으려는 사고입니다. 2번째 줄에 `# scope: project`를 적어 두면 다중 저장소 세션 안내가 정확히 가리킵니다.
- **왜 Claude 세션 훅이 아니라 git 훅인가**: 세션 훅은 그 저장소를 주 폴더로 연 창에서만 돕니다. 연결 프로젝트(다른 저장소 창에서 이 저장소를 고치는 경우)나 사람·Codex 커밋에는 닿지 않습니다. git 훅은 커밋이 그 저장소에서 일어나는 한 항상 돕니다. 규칙 본문은 `domain-rules.md`에(에이전트가 읽음), 물리 차단은 git 훅에.
- 회사 quality-gates 툴킷에 PHP 스택 견본은 아직 없습니다(2026-09-03). 위 패턴으로 만든 훅이 자리 잡으면 `stacks/php/` MR로 역제안하세요.

## 하지 않는 것

- `install-hooks.mjs`가 `"prepare": "husky"`를 감지해 경고하는 코드 개입은 하지 않습니다(코드는 최후 수단, 2026-08-13 합의). `postprepare` 대안에서는 `prepare`가 husky 단독인 것이 정상이므로, 값만 보고 경고하면 오탐이 됩니다. 같은 질문이 실전에서 반복되면 재고합니다.

## 이력

- 0.2.121에서 [commit-push-rules.md](./commit-push-rules.md)에 처음 승격했으나, 그 문서는 project-owned라 기존 소비자에게 업데이트로 전파되지 않아 0.2.122에서 이 문서(managed)로 이동했습니다. 범용 안내는 project-owned 문서에 두지 않습니다(결정 81).
