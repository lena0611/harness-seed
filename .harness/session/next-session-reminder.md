# 다음 세션 리마인더

새 세션을 열면 이 문서를 짧게 훑고 시작합니다. (SessionStart hook이 자동으로 보여줍니다.)

## 마지막 세션 마감 상태 (2026-08-06)
- 현재 본체 버전: **0.2.99 준비 완료(1차+2차 합본, 미커밋)** — 기획 문서 연동(Spec Authority) 1차(연결·매핑·기준시점 코드 소유, advisory) + **2차 푸시 정산 게이트**(사용자 설계 운영 모델: 리더/노티 없이 각자 로컬 기준 개발 → push 순간 내 범위만 정산). `specEnforcement: "gate"` 옵트인(기본 advisory=1차 그대로), fail-open, `spec:settle`(내 몫만), fetch `--cache-only`/`--at-lock` 분리(npm install/ci 대응물), 연동 정합 검사 doc-link 편입(gate 프로젝트는 차단), CI 백스톱 견본. 회귀 총 103종 통과 + harness:check. 상세: decision-log 2026-08-06 결정 7~11.
- ⛔ **로컬 multisite(개발 프로젝트) 전면 손대기 금지(2026-08-06 사용자 지시, 에이전트 메모리 multisite-hands-off)**: 커밋·수정·훅 실행 일절 금지. 스테이징 잔여물은 사용자 지시로 전부 원복 완료(작업 트리 클린) — 개발팀이 배포 후 정식 `harness:update`로 수령. 검증은 seed test-init 픽스처로 재현. 기획 저장소(policies/multisite)는 금지 대상 아님.
- 기획 저장소 정리 완료(2026-08-06): ① policies/multisite README에 "push=확정 사양(작성 중 문서는 push 보류)" 안내(`6965873`). ② **안내·견본을 `policies/planning-example` 저장소로 분리**(사용자 발의·생성) — 견본 4종을 실제 폴더 구조(features/ 등)로 배치해 복사-시작 가능(`94d6152`), multisite는 example/ 제거 + README 슬림화(실사양 폴더 + planning-example 링크, `5d741d5`). 새 기획 프로젝트 온보딩 = planning-example 복사 안내. 스킬 exclude 기본값(example/**)은 방어적으로 유지.
- **0.2.99 배포 완료(2026-08-06)**: 본체 `a3b5611` 양원격+태그. 동반 범프 **스택 v0.2.6**(`5dcea8e`) + **템플릿 v0.2.5**(`991d228`), `release:version-net` all-ok, 레지스트리 반영. ⚠️ **스택 v0.2.5·템플릿 v0.2.4 태그는 참조 금지**(결함 — 자기 참조 키 오편집, 소비자 노출 0 확인, decision-log 2026-08-06 배포 항목). 동반 범프는 수동 편집 말고 version-net --write부터.
- 직전 0.2.98 — 라이프사이클 가이드 0.2.90~97 갱신 + 참조 요약본 확인 질문 복원. 동반 `ai-standard/docs` 현행화(`2251b02`, Pages 재배포 확인). ⚠️ **미착수 후속**: ①가이드 단일 원본화(본체 → docs 복사 + 오버레이 3곳)를 릴리스 루틴에 넣는 구조 정비, ②정책 원문 새 원칙 4개 추가 판단 대기(런타임 불변식/신호 대 잡음/ref가 신규 설치 결정/승인 게이트), ③multisite 프론트에 0.2.99 정식 업데이트 후 `/기획문서연동` 실사용 시작.
- 직전 0.2.97 — 의존성 미설치 진단(node_modules 부재 시 원인 불명 도구 에러 대신 "npm install 후 harness:check" 명확 안내, 온보딩 실측 2회 반영). 레지스트리 동반 범프: 스택 v0.2.4·템플릿 v0.2.3(base v0.2.97 추종). 회귀 94종.
- ⚠️ **스택 ref 추종 교훈(2026-08-05)**: downstream 판단 시 minVersion(기존 소비자 강제)만 보지 말 것 — 스택 `baseHarness.ref`가 **신규 설치가 받는 base 버전**을 고정한다. 실측: 6릴리스 방치로 신규 설치가 0.2.89로 깔렸음. 절차는 body-release-checklist downstream 절. 0.2.97부터 동반 범프를 기본 루틴으로 운영.
- 0.2.97 push/배포 완료(2026-08-05): 본체 `b15296a` 양쪽 원격 + 태그 양쪽, Policy Guard success(59s). 동반 범프 **스택 v0.2.4**(`932cd95`) + **템플릿 v0.2.3**(`7ad6b24`) + CLI **0.2.8**(`4de6f1e`). `release:version-net` all-ok. **E2E 실측: 신규 설치 base 0.2.97 + stack 0.2.4, 의존성 미설치 시 새 진단 메시지 정상 출력**(원인+`npm install` 안내+"하네스 설치는 정상" 문구).
- 0.2.96 push/배포 완료(2026-08-05): 본체 `e23f29b`(+fix-forward `6145834` — 레지스트리 픽스처 하드코딩 제거 + 레지스트리 회귀를 test-init 게이트에 편입, 총 93종) 양쪽 원격 + 태그, Policy Guard success 2건. **스택 v0.2.3**(`3d02cbb`, base v0.2.96 추종) + **템플릿 v0.2.2**(`5ae22ea`, base v0.2.96·스택 ^0.2.3) + CLI **0.2.7**(`0059dcc`). `release:version-net` all-ok. **E2E 실측: 신규 설치가 base 0.2.96 + 스택 0.2.3으로 설치됨.** 릴리스 순서 확립: 본체 태그 → version-net --write → 스택/템플릿 릴리스 → 정합 재확인.
- 교훈(fix-forward 사유): 레지스트리 테스트를 파이프(`npm run … | tail`)로 돌리면 종료코드가 가려진다 — 검증 명령은 파이프 없이 실행하거나 pipefail. 태그 v0.2.96은 픽스처 갱신 직전 커밋을 가리키나 레지스트리 내용은 정확(테스트 스크립트만 한 커밋 지연) — 불변 태그 원칙 유지로 fix-forward 처리.
- 직전 0.2.95 — 회귀 수정: 본체 세션 아카이브가 0.2.92~94에서 소비자로 유출(clubadm 요청서 3건 전부 수용). 패턴 차단 + project-owned 계약 선언 + 기존 소비자 정리 + 회귀 3종.
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
