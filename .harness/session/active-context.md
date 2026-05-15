# 현재 컨텍스트

이 문서는 최근 작업 상태와 다음 세션이 바로 이어받아야 할 정보를 담습니다.

## 현재 상태 (2026-05-06)
- 저장소가 **일반화 하네스 + 외부 스택 기준 런타임** 구조로 분리되었습니다.
- 본체에는 특정 스택 기준이나 스택 템플릿을 포함하지 않습니다.
- root는 일반 하네스 전용입니다.
- `npm run standards:list` / `stack:apply` / `stack:reset` / `stack:status` 로 스택 기준 적용을 제어합니다.
- `npm run templates:list` / `template:apply` / `template:reset` / `template:status` 로 scaffold 템플릿 적용을 제어합니다.
- 적용 상태는 `.harness/.stack-applied.json` 마커로 기록됩니다 (gitignore — dev 머신/시드 사용자 머신마다 다른 상태).
- 템플릿 적용 상태는 `.harness/.template-applied.json` 마커로 기록됩니다.
- 설치된 일반/스택 하네스 버전은 `.harness/harness-lock.json`에 기록됩니다.
- `npm run harness:outdated`는 lock을 읽고 같은 SemVer caret 범위의 업데이트 후보만 조회합니다.
- `npm run harness:update`는 lock을 읽고 현재 스택 하네스를 같은 SemVer caret 범위 안에서 최신으로 다시 실행합니다.
- `source.type=none`인 스택 기준은 scaffold 없이 instruction만 로컬룰로 정착합니다.
- 외부 프리셋은 `--preset-path`, `--preset-git`, `stackManifest`로 연결합니다.
- scaffold 템플릿은 `kind=scaffold-template` manifest로 구분하고, 적용 시 `.harness/project/template-contract.md`에 사용 계약 브리지를 남깁니다.
- 공개 명령은 `harness:scan`, `harness:handoff`, `harness:impact`, `harness:check` 중심으로 정리합니다.
- 에이전트 진행 설명은 원시 내부 추론이 아니라 visible trace 단계와 판단 결과로 요약합니다.
- 프로젝트 룰이 누적되면 항상 모두 읽지 않고 `harness:context -- "<작업 설명>"`으로 작업별 후보를 좁힙니다.

## 핵심 파일 (일반 하네스)
- `.harness/policy/profile.json` — `activeStack` 단일 진실 출처
- `.harness/policy/policy-registry.json` — stack-agnostic 정책만
- `.harness/stacks/README.md` — 스택 기준과 scaffold 템플릿 격리 원칙
- `.harness/project/template-contract.md` — 템플릿 사용 계약 브리지
- `.harness/project/bootstrap.md` — 신규 프로젝트 인터뷰
- `.harness/project/portability-guide.md` — 이식 절차
- `.harness/bin/apply-stack.mjs` — 외부 스택 기준과 scaffold 템플릿 적용 런타임
- `.harness/bin/list-stack-standards.mjs` — 원격 스택 하네스 후보 조회
- `.harness/bin/list-templates.mjs` — 원격 템플릿 후보 조회
- `.harness/bin/guard.mjs` — 미적용 시 lint/test/build 자동 스킵
- `.harness/bin/doc-link-check.mjs` — scaffold 경로 자동 제외 + 활성 스택 fallback

## 다음 세션이 바로 이어받을 작업
- 프로젝트 헌장 `TBD` 항목 채우기
- 첫 실제 도메인 feature 후보 결정
- 필요 시 `npm run standards:list`로 외부 스택 하네스 후보를 조회한 뒤 일반 프로젝트에는 `npx ... init`, 관리자/고급 흐름에는 `npm run stack:apply -- --preset-git <repo-url> --ref <tag>` 실행
- scaffold가 필요할 때만 `npm run templates:list`로 템플릿 후보를 조회하고 `npm run template:apply -- --preset-git <repo-url> --ref <tag>` 실행

## 마지막 검증
- 외부 프리셋 fixture로 `npm run stack:apply` → `npm run stack:reset` 통과
- `npm run harness:check` (lint/test/build 스킵) 통과
- 스택 격리 검사, doc-link 무결성, SYNC GAP, 정책 위반 검사 모두 OK
