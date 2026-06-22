# 다음 세션 리마인더

새 세션을 열면 이 문서를 짧게 훑고 시작합니다. (SessionStart hook이 자동으로 보여줍니다.)

## 마지막 세션 마감 상태 (2026-06-22)
- 현재 본체 버전: **0.2.70** (push/배포 중복 검사 제거 — 전체 검증 git-tree 캐시). 직전 0.2.69 seed-only 배포 제외, 0.2.68 doc-link 오탐 수정, 0.2.67 마커 공존융합.
- 검증 캐시(0.2.70): `guard.mjs`가 전체 검증(정책/doc-link/test-init/스택verify)을 git tree 지문 캐시 게이트 뒤로 둠. 같은 tree면 전체 스킵(69s→0.1s). `validationCacheKey`는 strict/default + HEAD + 파일해시(fast/full은 레코드 mode로). full 통과 캐시를 fast가 재사용(full⊇fast) → commit(full) 1회만 실검증, push·양쪽원격·태그는 히트. 강제 재검증 `--no-cache`. 캐시 거동 변경 시 guard.mjs + test-init 캐시 회귀 4종 동기화.
- seed-only 배포 제외(0.2.69): `SEED_ONLY_DOC_PATHS`(현재 `body-release-checklist.md`)는 소비자(`.harness-seed-mode` 마커 없음)에 배포 안 함 + 기존본 미수정이면 정리/수정이면 보존. 본체는 유지. document-registry 제거 + doc-link-check `seedOnlyDocs` orphan/exists 예외. 두 상수 동기화 필수.
- doc-link 오탐(0.2.68): `isIgnorableCodePath`가 glob(`*`,`...`)·trailing-slash 디렉토리 예시(`.github/workflows/`)·`.github/workflows/` 하위(본체 CI 어댑터, 소비자 미주입)를 code-path 검사에서 제외. 구체 파일 참조는 계속 검사. doc-link-check.mjs는 직접 실행 가드로 감싸 isIgnorableCodePath를 export(test import 가능).
- 마커 머지(0.2.67): CLAUDE.md/AGENTS.md/.github/copilot-instructions.md는 `<!-- harness-managed:start/end -->` 블록 안(회사 영역)만 update가 갱신하고 블록 밖(소비자 영역)은 보존. 마커 없는 옛 파일은 미수정이면 자동 이전, 수정됐으면 보존+수동 이전 안내. 회사 영역을 소비자가 수정했으면 머지 전 `.harness-bak` 백업. 충돌은 standards-layers "충돌 해석 순서". manifest에 `managedRegionSha256`(manifestVersion 3).
- 통짜 안전망(0.2.65)은 마커 비대상 managed 파일(hook 스크립트, `.harness/bin/*` 등)에만 적용.
- dual-runtime(0.2.63): 프로젝트 `.nvmrc < 20.19`여도 설치/운영 가능. 상세는 `portability-guide.md` "Node 런타임 계약".
- 0.2.69 push/배포 완료: 양쪽 원격 + 태그 `v0.2.69`(=c84c00f), CI 통과. (0.2.69 첫 push 시 CI strict 2회 실패 → skill-selection 과매칭 정밀화 + seed-only 참조 exists 예외로 복구.)
- 0.2.70은 본 세션에서 push 진행. CLI는 consumer-facing(소비자 검증 속도 개선)이라 0.2.69+0.2.70 묶어 0.1.32로 base ref 반영 예정.

## ★ 후속 과제
- 본체 전용 문서 소비자 배포 제외는 0.2.69로 해소(body-release-checklist 1개 확정). 향후 새 본체 전용 문서가 생기면 `SEED_ONLY_DOC_PATHS` + `doc-link-check.mjs seedOnlyDocs`에 함께 등록.
- clubadm QA(2026-06-22) FEATURE 후보: `hooks:install`에 Claude settings.json 병합 옵션 추가 여부 검토 중(현재 init/update 경로에선 `mergeClaudeSettings`로 자동 병합됨 — 0.2.59).

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
