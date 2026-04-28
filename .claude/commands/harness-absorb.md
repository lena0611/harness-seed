---
description: 현재 프로젝트를 분석해 .harness의 프로젝트/정책/세션 문서에 반영합니다.
allowed-tools: Read, Glob, Grep, Write, Edit, Bash
---

# /harness-absorb

이 명령은 Claude Code 어댑터용 프로젝트 흡수 절차입니다. 기준 산출물은 `.claude/`가 아니라 `.harness/`입니다.

## 0. 사전 점검
1. `CLAUDE.md`를 읽고 지정된 순서의 `.harness/` 문서를 확인합니다.
2. `npm run policy:impact`를 실행해 현재 변경 영향 범위를 봅니다.
3. `.harness/project/project-charter.md`가 비어 있으면 `.harness/project/bootstrap.md`의 인터뷰 절차를 먼저 수행합니다.

## 1. 프로젝트 구조 조사
다음을 병렬로 확인합니다.
- 매니페스트: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`
- 빌드/작업: `Makefile`, `Justfile`, `Taskfile.yml`, `Dockerfile`, workspace 설정
- CI: `.github/workflows/`, `.gitlab-ci.yml`, 기타 파이프라인 파일
- 품질 도구: lint, formatter, test, typecheck 설정
- 문서: `README*`, `docs/`, architecture/ADR 문서

## 2. 코드 샘플링
소스 루트와 테스트 루트를 식별한 뒤 핵심 파일 10개 안팎을 읽습니다.
- 진입점
- 가장 큰 파일
- 최근 변경 파일
- import가 많은 허브 파일
- 대표 테스트 파일

## 3. 하네스 반영
분석 결과를 다음 파일에 반영합니다.
- `.harness/project/project-charter.md`: 목적, 사용자, 목표, 비목표, 제약
- `.harness/project/scope-contract.md`: 범위와 금지 범위
- `.harness/policy/profile.json`: active stack 또는 `none`
- `.harness/session/active-context.md`: 현재 작업 맥락
- `.harness/session/decision-log.md`: 선택한 구조와 이유
- `.harness/session/developer-input-queue.md`: 확인이 필요한 질문

## 4. 검증
마지막에 다음을 실행하고 결과를 보고합니다.

```bash
npm run guard
```

실패하면 실패한 검사와 후속 조치만 짧게 남깁니다.
