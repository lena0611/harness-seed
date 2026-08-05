# 다음 세션 리마인더

새 세션을 열면 이 문서를 짧게 훑고 시작합니다. (SessionStart hook이 자동으로 보여줍니다.)

## 마지막 세션 마감 상태 (2026-08-04)
- 현재 본체 버전: **0.2.95** — 회귀 수정: 본체 세션 아카이브(decision-log-2026H1.md)가 0.2.92~94에서 소비자로 유출(clubadm 보고·정식 요청서 3건 전부 수용). 패턴 차단 + project-owned 계약 선언 + 기존 소비자 정리 + 회귀 3종(총 92종). 최종 검증 통과 후 릴리스.
- 직전 0.2.94 — score-print 검수 후속(요약 분류 한 줄 압축 + strict 승격 안내). **score-print 에픽 종결**: 판정→0.2.90/91/92 구현→0.2.93 정책 동기화→현장 검수(P1~P6 전부 충족)→0.2.94 후속까지 완결. 상세는 body-roadmap 에픽 종결 절.
- 0.2.95 push/배포 완료(2026-08-05): 양쪽 원격(origin/main + company/master = `5bae778`) + 태그 `v0.2.95` 양쪽, Policy Guard success(53s). CLI `ai-standard-cli` **0.2.6**(GitLab `774d639` + 태그, check + 21 tests). 소비자 후속: clubadm·score-print 등 0.2.92~94 수급 프로젝트는 다음 업데이트에서 유출본 자동 정리/재분류 — clubadm에 "관례 파일명 회피책 해제 가능" 전달할 것.
- 2026-08-04 배포 이력: 0.2.90(`17ff14a`)→0.2.91(`d11aace`)→0.2.92(`3615592`)→0.2.93(`73e197b`)→0.2.94(`e211784`), CLI 0.2.1→0.2.5. 정책 원문 `ai-standard/docs`는 `854b523`. 스택 `baseHarness.minVersion` 추종 불필요(전 릴리스 스택 의존 신규 계약 없음).
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
- **score-print 에픽 — 종결(2026-08-04)**. 잔여 항목 없음. 소비자 검수에서 확인된 사실: score-print는 base 0.2.93 + 로그 2계층 분리 완료 상태(그들 커밋 fa6cc06). 다음 소비자 리뷰가 오면 clubadm(0.2.85)·score-print(0.2.90~94) 선례의 판정→차수 릴리스→현장 검수 흐름을 따른다.
- ⚠️ 본체 decision-log 작성 주의(0.2.91부터): 감지 리터럴(금지 이모지+폐기/번복 조합, 뒤집기 대괄호 토큰)을 서술 용도로 쓰면 그 커밋이 자기 감지를 오발한다 — 관례 설명은 서술로 적을 것. 실제 배너/뒤집기 기록은 정상 사용.
- **ai-standard/docs 동반 갱신 — 완료(2026-08-04)**: 원문 master `279a5d2`에 뒤집기 기록 의무 반영(push 완료). 본체 참조 요약 동기화는 **0.2.93 준비 중(미커밋, 문서만)**.
- ai-standard-docs의 이전 세션 미커밋 수정(템플릿 계약 분리 문구)은 사용자 승인으로 별도 커밋 완료(`854b523`). 원문 저장소 작업 트리 클린(.idea/ IDE 메타만 untracked).
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
