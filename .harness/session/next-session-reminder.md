# 다음 세션 리마인더

새 세션을 열면 이 문서를 짧게 훑고 시작합니다. (SessionStart hook이 자동으로 보여줍니다.)

## 마지막 세션 마감 상태 (2026-08-04)
- 현재 본체 버전: **0.2.90** — score-print 개선요청 1차(P4 출력 요약 + P3 이력 참조 노이즈 + doc-link fail-open 수정). 최종 검증 통과(회귀 83종) 후 릴리스.
- 0.2.90 push/배포 완료: 양쪽 원격(origin/main + company/master = `17ff14a`) + 태그 `v0.2.90` 양쪽, GitHub Actions Policy Guard success(54s). CLI `ai-standard-cli` **0.2.1**로 README base ref 예시 v0.2.90 반영(GitLab master `8282135` + 태그, check + 21 tests). ※ CLI 0.2.0부터 base ref 기본 고정이 없어(env/--ref 없으면 최신 설치) 신규 설치는 코드 변경 없이도 0.2.90을 받는다 — 이번 CLI 반영은 문서 예시 최신화. 스택 하네스 `baseHarness.minVersion` 추종은 불필요(0.2.90에 스택이 의존할 신규 계약 없음).
- score-print 개선요청(2026-08-04) 판정: **6건 중 5건 수용, P1 축소 수용, 거부 없음.** 원문 `consumer-reviews/SCORE_PRINT_HARNESS_IMPROVEMENT_REQUEST_2026-08-04.md`, 판정 근거 decision-log 2026-08-04, 차수 계획 body-roadmap "score-print 신호 회복과 차단 승격" 에픽.
- 1차(0.2.90) 내용: guard 경로 기본 요약 출력(`summaryMode`, 154줄→약 30줄, `--verbose` 전개, `확인 필수/차단` 후보는 요약에서도 상세) + decision-log 계열 백틱 코드 경로 "역사 참조" 분류(`isHistoryLogPath`, dead code-path 제외, 마크다운 링크는 유지, 동적 아카이브 orphan 예외) + doc-link 통과 1줄. 회귀 6종 추가(총 83종). 짝 문서 `indexing-rules.md` §8.
- 이 리마인더는 0.2.73~0.2.89 구간(스택/템플릿 계약 분리, 승인 레지스트리, harness:uninstall 등) 동안 갱신이 누락됐었다. 그 구간 상세는 CHANGELOG와 decision-log 2026-07-10 항목 참조.
- 유효한 상시 주의사항(과거 세션에서 확립):
  - **`portability-guide.md`·`context-protocol.md`는 공유/ownedArea라 건드리면 minimum-node/force-overwrite/visible-trace/source-trace 정책 연쇄 → 수정 금지**(decision-log 2026-06-25). 짝 문서는 leaf 문서로 페어링.
  - 검증 캐시(0.2.70) 거동 변경 시 guard.mjs + test-init 캐시 회귀 4종 동기화. 강제 재검증 `--no-cache`.
  - 새 본체 전용 문서는 `scripts/init.mjs SEED_ONLY_DOC_PATHS` + `doc-link-check.mjs seedOnlyDocs` 동시 등록(0.2.69).
  - 정책 documents는 종합 문서가 아니라 "주제 전용 문서"로 두는 게 과매칭 노이즈 예방 원칙(0.2.70).

## ★ 후속 과제
- **score-print 2차 (차단 승격)**: ①폐기/번복 배너 관례를 본체 표준으로 승격·문서화(현재는 score-print 자체 관례 — 요청서가 "최고 자산"으로 지목) → ②P2: 현행 decision-log diff 추가 라인에서 배너 마커 감지 시 그 커밋의 동기화 후보를 '확인 필수'로 승격(strict 차단) → ③P1(축소): 비권장 뒤집기 엔트리 필수 필드(`근거 반박:`) lint. 감지 범위는 **현행 decision-log.md 한 파일로 한정**(아카이브 이동을 번복으로 오인 방지). P2·P1은 같은 diff 스캐너 공유 → 한 릴리스. 정책 원문은 `ai-standard/docs` 동반 갱신.
- **score-print 3차 (지속가능성)**: P5 decision-log 현행/이력 2계층 실행 장치(관례는 `/decision` 스킬에 이미 있음 — 임계 안내, harness:context 현행 우선 로드, CLAUDE.md 읽기 순서) + P6 로컬룰 승격 시 "문서 규칙 vs 실행 가능한 검증" 분기(Project rule candidate check 문구, enforcement-ladder, workflow-rules, 스킬).
- clubadm P0 잔여: P0-3(harnessMode 라이프사이클)·P0-4(commit/release 행위충돌 표면화)는 축소 형태(문서/read-only)로만 후속 후보. P0-2·P0-5는 거부 확정(오해 기반, decision-log 2026-06-25).

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
