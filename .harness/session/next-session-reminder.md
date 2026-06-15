# 다음 세션 리마인더

새 세션을 열면 이 문서를 짧게 훑고 시작합니다. (SessionStart hook이 자동으로 보여줍니다.)

## 마지막 세션 마감 상태 (2026-06-15)
- 현재 본체 버전: **0.2.66** (0.2.65 안전망의 hybrid managed 진입점 회귀 5종 추가 — test-only patch). 직전 0.2.65는 PaceLAB 0.2.56→0.2.64 업데이트 시 CLAUDE.md 무단 삭제 사고 차단(안전망 옵션 C).
- 안전망(0.2.65): managed 파일이 `install-manifest.json` 기록 sha와 다르면(=소비자 수정) 기본 보존, `--force --confirm-overwrite-project-files`로만 `<파일>.harness-bak` 사이드카 백업 후 덮어씀, 후처리에 보존/덮어쓴 managed 파일 목록을 항상 출력. CLAUDE.md/AGENTS.md/copilot-instructions.md 모두 같은 분기로 보호되며 0.2.66 회귀가 셋 다 명시 잠금. 옵션 A(마커 영역)·옵션 B(project-owned 재분류 + Markdown 머지)는 후속 검토.
- dual-runtime(0.2.63): 프로젝트 `.nvmrc < 20.19`여도 설치/운영 가능. hook/런처는 하네스 Node로 자동 전환, 프로젝트 검증은 `.nvmrc` Node로 실행. 상세는 `portability-guide.md` "Node 런타임 계약".
- 0.2.65 push/배포 완료: 양쪽 원격(origin/main `a7ff994`, company/master `a7ff994`) + 태그 `v0.2.65` 양쪽 push, GitHub Actions Policy Guard 통과(41s). 0.2.66은 본 세션에서 push 진행.
- CLI(`../ai-standard-cli`)는 0.1.29로 base ref v0.2.65 반영 완료(GitLab master `24c5f50`, 태그 `v0.1.29`). 0.2.66은 test-only라 CLI 반영 생략.

## ★ 본체 개발 후 "배포 마무리 루틴" (빠뜨리기 쉬움 — 반드시 상기)
본체 변경을 끝내고 사용자가 커밋/푸시/배포를 승인하면 아래가 **한 세트**입니다. 상세·명령은 `body-release-checklist.md`.
1. 버전 bump(`package.json`) + `CHANGELOG.md` 항목 추가.
2. 커밋 (pre-commit hook이 dual-runtime으로 `harness check` 실행 — 저버전 셸에서도 동작).
3. 태그 `vX.Y.Z` 생성.
4. **양쪽 원격에 push**: `git push origin main` + `git push company main:master` + **태그도 양쪽**(`git push origin vX.Y.Z` / `git push company vX.Y.Z`). 브랜치만 push하면 태그는 안 따라간다.
5. 세 ref + 태그가 양쪽에서 동일한지 `ls-remote`로 확인.
6. GitHub Actions `Policy Guard` 통과 확인 (`gh run list --branch main --limit 1`).
7. **downstream 반영** — 잊지 말 것:
   - **ai-standard-cli**(`../ai-standard-cli`, GitLab `origin/master`): consumer-facing 릴리스면 CLI 자체 버전(0.1.x) patch bump + README `AI_STANDARD_BASE_HARNESS_REF`/테스트 픽스처를 새 본체 태그로 갱신 + `npm run check && npm test` + 커밋 `공통 하네스 vX.Y.Z 설치 경로 반영` + 태그 + push. (문서/유지보수만 바뀐 릴리스는 생략 가능.)
   - 스택 하네스: `baseHarness.minVersion` 추종 필요 여부 판단.
8. 기록: `decision-log.md` + 이 리마인더 갱신.

## 세션 시작 시 확인
1. `git --no-pager status --short` / 미배포 변경 여부
2. `npm run harness:impact`로 영향 범위 (작업 전), `npm run harness:check`는 최종화 승인 후
3. 새 환경이면 `npm run hooks:install` — 저버전 Node면 dual-runtime 진단도 함께 출력됨
4. 큰 작업/생소 영역은 `npm run harness:sync` 후 `npm run harness:context -- "<작업 설명>"`

## 아직 비어 있는 중요한 것 (프로젝트 헌장)
- 핵심 문제 / 주요 사용자 / 성공 기준 / 비목표 / 개요 — `bootstrap.md` 인터뷰로 채우기.
- `developer-input-queue.md`의 `charter-*` 항목 다시 확인.

## 알아둘 절차 (스택 관련)
- 후보 조회 `npm run standards:list` / 적용 `npm run stack:apply` / 전환 `npm run stack:reset`
- 공통 하네스만: `activeStack: "none"` (자동 lint/test/build 스킵)
- 새 스택 기준은 본체가 아니라 별도 저장소 + `.harness/stacks/README.md` 외부 프리셋 계약
