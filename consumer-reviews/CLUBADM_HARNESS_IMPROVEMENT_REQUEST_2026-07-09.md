# clubadm → harness-seed 개선 요청서

작성일: 2026-07-09
발신: **clubadm** (club-admin-vue3) — 회사 첫 실질 공통 하네스 소비자
대상: **harness-seed v0.2.84** 및 생태계(ai-standard-cli 0.1.44 · vue3-vite-pinia-router 0.1.46 · cloud-front-admin-template 0.1.1 · ai-standard-docs)
근거: 5개 저장소 + 소비자 실물(clubadm) 대상 9-소스 병렬 적대 리뷰 + harness-seed 핵심 7건의 코드 대조 재검증. 전 과정 읽기 전용.

> 이 문서는 harness-seed 본체 저장소의 운영 기록입니다(`consumer-reviews/`, 미배포). 실제 소비자 저장소는 이 리뷰에서 변경되지 않았습니다. 리뷰 직후 clubadm은 base 0.2.74→0.2.84 / stack 0.1.34→0.1.46 업데이트를 정상 수행했으며, 그 과정에서 아래 일부 항목이 실동작으로 재관측되었습니다.

---

## 0. 요약 — 좋은 물건인데 두 관문이 겉보기보다 약하다

하네스 자체 완성도는 높습니다. 문서 링크 91개 중 죽은 링크 0건, 마커 병합·사이드카 백업·force 이중동의 같은 안전망 설계와 78개 E2E 테스트, project-owned 보존 계약의 실제 동작(clubadm 업데이트로 재실증)이 그 근거입니다. 그러나 **제품의 운명을 가르는 두 관문**이 약합니다.

1. **처음 온 사람이 혼자 설치할 수 없다** — 문서가 시키는 첫 명령이 에러이고 핵심 URL이 placeholder입니다.
2. **`harness:check`의 「통과」가 실제 검증 강도보다 강하게 읽힙니다** — 보고는 풍부하나 기본 모드의 실패 조건이 희박합니다.

그리고 이 전부가 **한 사람이 손으로 당기는 버전·복붙 그물** 위에 있어, 「가장 먼저 끊길 고리」(템플릿·docs)가 이미 2개월째 끊겨 있습니다.

**요청 우선순위**: P0(채택·안전을 지금 막는 것) → P1(신뢰를 좀먹는 것) → P2(품질·이식성).

### 검증 등급 범례

| 표기 | 의미 |
| --- | --- |
| ✓검증 | 코드 직접 대조 적대 검증 완료 (원 리뷰 대비 심각도 교정 반영) |
| ⚡실증 | 재현·실행으로 확인 (npm pack / git / 훅 실행 / 빌드) |
| ○단일 | 1회 리뷰, 근거 인용은 있으나 독립 재검증 전 |

---

## P0 — 채택·안전을 지금 막는 것

### P0-1. 퀵스타트 첫 경로를 실동작으로 만들기 ⚡실증

- **현상**: `README.md:66-70`, `696-705`가 설치 **전** 프로젝트에서 `npm run standards:list`를 실행하라고 안내. 이 스크립트는 설치가 만들어주므로(`package.json:58` → `.harness/bin/list-stack-standards.mjs`) 미설치 프로젝트에선 `Missing script`, 빈 폴더에선 package.json 부재로 npm 자체가 실패. 이어지는 `npx git+<stack-harness-repo-url>`의 **스택-하네스** URL placeholder(`:69, 580, 597, 699`)를 채울 실제 값이 문서에 없음 — 단, 공통 하네스(seed) 구체 URL은 `:182`(`…harness-seed.git#v0.2.18`)에 존재하므로 "URL 전무"는 아님. 설계 의도(`:110`)는 `standards:list`가 스택 URL을 동적 열거하게 한 것이나, 그 명령이 설치 전 불가라 두 결함이 상호 증폭.
- **영향**: 신규 사용자의 첫 복붙이 에러로 끝남. 동료 없이는 셀프서비스 설치가 불가능 → 「설치 60KB 문서」의 존재 이유를 스스로 부정. 첫 30분 시뮬레이션상 8분경 첫 명령 실패에서 이탈 시작.
- **제안**:
  1. 설치 **전** 실행 명령을 퀵스타트에서 제거하거나, 설치 없이 도는 경로(내장 `stack list` 류)로 교체.
  2. 스택 URL을 **예시(example)로 표기** — 동적 조회 설계와 충돌하지 않게, 특정 스택 URL을 canonical로 하드코딩하지 않고 "예: `git+…/vue3-vite-pinia-router.git#<tag>`" 형태로. `GITLAB_TOKEN`이 필요하면 그 사실과 발급 링크를 같은 자리에.
  3. 퀵스타트 최상단에 「설치하면 생기는 것」 1줄 요약(아래 P0-4)과 「되돌리는 법」(아래 P0-3) 링크.
- **수용 기준**: 하네스를 모르는 개발자가 **문서만 보고** 빈 Vue 프로젝트에 설치를 완료할 수 있다(동료 문의 0회). README의 모든 명령이 해당 시점에 실행 가능하다.

### P0-2. 차단 훅 fail-closed 전환 + 표면 정규식 보강 ⚡실증

- **현상**: `.claude/hooks/block-dangerous.sh:4-17`·`protect-paths.sh:6-17`가 입력 파싱을 `node -e`에 의존. node가 PATH에 없으면 변수가 빈 문자열이 되어 `[ -z "$cmd" ] && exit 0`으로 **아무것도 차단하지 않고 통과**(PATH에서 node 제거 시 동일 `rm -rf`가 DENY→NOT DENIED로 바뀜을 실증). 또 패턴 `rm -rf?`가 `rm -fr /`·`rm --recursive --force`·`rm -r -f`·`find . -exec rm -rf {}`·`bash pwn.sh`를 통과(`:40-68`). `settings.json:10,16`의 allow-list `Bash(find *)`·`Bash(cat *)`가 위험을 자동 승인으로 증폭.
- **영향**: 「필수 차단 기준」의 토대가 조용히 꺼진다. git hook은 로그인 셸 PATH를 못 물려받는 경우가 많아 실사용에서 발생 가능. 보안 통제가 방어선이 아니라 안내판 수준.
- **제안**:
  1. node 부재 등 파싱 실패 시 **통과가 아니라 차단(또는 경고 후 보류)**. **단 중요 전제** — 현재 `deny()` 메커니즘 자체가 node 의존이라 그대로는 표적 시나리오(node 부재)에서 무효다. **node 비의존 차단 경로**(hook exit code 2 + stderr, 또는 `printf`로 하드코딩한 deny JSON)로 deny를 함께 교체해야 한다. 또 무차별 전면차단이 아니라 **node 종료코드를 별도 캡처해 "파싱 실패"만 선별 처리** + 사용자 고지(제안서의 '경고 후 보류')를 기본으로 — node가 정상 부재하는 컨텍스트에서 Bash·Write·Edit 전부가 막히지 않도록 범위를 좁힌다.
  2. 표면 문자열 매칭 대신 명령 토큰화 후 판정(플래그 순서·롱옵션·분리 플래그 정규화). 최소한 `-fr`, `--recursive --force`, `find -exec`, 파일 간접실행 케이스 추가.
  3. allow-list에서 `Bash(find *)`·`Bash(cat *)` 축소, Bash 경로도 시크릿/시스템 경로(리다이렉트 포함) 차단을 standard 프로파일로 승격.
- **수용 기준**: node 없는 셸에서 `rm -rf /`가 차단된다(node 비의존 deny 경로로). `rm -fr /`·`find . -exec rm -rf {} +`가 차단된다. `cat .env`가 자동 승인되지 않는다. node가 정상 부재하는 컨텍스트의 무해한 작업은 전면차단되지 않는다.

### P0-3. 제거(uninstall) 경로 제공 ⚡실증

- **현상**: `stack:reset`·`template:reset`은 있으나 **본체 제거 명령·문서가 전무**(README·`.harness/**` grep 0건). ~95개 관리 파일 + npm 스크립트 20개가 주입된 뒤 되돌리는 길이 문서화되지 않은 `.harness-backup/` 수동 복원뿐.
- **영향**: 「잘못되면 어떻게 빼지?」에 답이 없는 도구는 보수적 팀이 설치 자체를 미룬다. 신뢰가 자산인 제품 카테고리에서 채택의 직접 장벽.
- **제안**: `harness:uninstall`(dry-run 기본) 명령 추가 — install-manifest 기반으로 managed 파일 제거 + package.json 스크립트/관리블록 원복 + project-owned·로컬수정 파일은 보존하고 명시 리포트. 최소한 README에 수동 제거 절차 문서화.
- **수용 기준**: 설치 직후 `harness:uninstall`로 managed 파일과 주입 스크립트가 제거되고, 사용자 소유 파일과 로컬 수정은 남는다. dry-run이 삭제 대상 목록을 먼저 보여준다.

### P0-4. 설치 풋프린트 사전 고지 ⚡실증

- **현상**: clubadm 실측 — managedFiles **95개** + projectOwned 21개 + npm 스크립트 20개 주입 + 루트 진입문서 3종 관리블록 + `.claude/`·`.codex/`·`.githooks/`. `README.md:236-254`는 디렉토리 역할표만 있고 파일 개수·규모를 어디에도 말하지 않음.
- **영향**: 설치 후 `git status`를 본 순간이 2차 이탈 지점(13~18분).
- **제안**: 설치 전 dry-run 출력과 README에 「생성/수정되는 것: 관리 파일 약 N개, npm 스크립트 N개, 루트 문서 3종 관리블록」을 수치로 명시. 설치 완료 요약에도 실제 생성 카운트 표기.
- **수용 기준**: `--dry-run` 또는 README만으로 설치 전에 생성 파일 수·스크립트 수를 알 수 있다.

### P0-5. npm 패키지 유출 경로 차단 ⚡실증

- **현상**: `package.json` `files`가 `.harness`를 통째로 포함해 `.harness/session/decision-log.md`(89KB, 사내 식별자·소비자 의사결정), `active-context.md` 등 세션 운영 문서와 메인테이너 개인 `.claude/settings.local.json`이 tarball에 실림(`npm pack --dry-run` 확인). 설치기는 이를 빈 템플릿으로 대체하나 **tarball 원본에는 그대로**.
- **영향**: origin이 공개 GitHub(lena0611)거나 공개 레지스트리 배포라면 사내 정보·개인 권한 유출.
- **제안**: `files`에 부정 패턴 추가 — `!.harness/session/**`(현재 `handoff.md`/`task-context.md`/`project-scan-report.md`만 제외됨, `decision-log.md`·`active-context.md`·`next-session-reminder.md`·`developer-input-queue.md`·`project-memory.md` 누락), `!.claude/settings.local.json`. 배포 전 `npm pack --dry-run` 산출물에 세션 문서가 없는지 CI 게이트.
- **수용 기준**: `npm pack --dry-run` 목록에 `decision-log.md`·`settings.local.json`·세션 운영 문서 6종이 없다.

### P0-6. 템플릿을 파이프라인에 재편입하거나 「활성 경로」 안내 내리기 ○단일

- **현상**: `cloud-front-admin-template/manifest.json:32-33` baseHarness ref `v0.2.16`/minVersion `0.2.16`(현재 base 0.2.84, **약 68태그 뒤처짐**), `:26` requiredStackHarness ref `v0.1.7`(현재 stack 0.1.46, **약 39태그 뒤처짐**; `:27-28`은 range/minVersion 라인). 템플릿 HEAD(커밋 13fcc40 "0.1.1 배포")가 2026-05-08 이후 재동기화 0회. 그런데 `vue3/README.md:51`은 여전히 이 템플릿을 `--ref v0.1.1`로 적용하라고 **활성 경로로 안내**.
- **영향**: 선언한 「검증된 기준 ref」가 2개월 죽은 값이라 신뢰 불가. 배포하는 scaffold 소스가 스택 규약 약 39버전 진화와 무관하게 얼어붙어, 신규 프로젝트가 낡은 관례로 시작.
- **제안**: 둘 중 하나 — (a) 템플릿을 버전 그물에 편입(P1-2의 자동화 대상에 포함)하거나, (b) 미유지 상태면 vue3 README에서 활성 경로 안내를 내리고 상태를 「실험적/미유지」로 표기.
- **수용 기준**: 템플릿 manifest의 base/stack ref가 현재 릴리스와 정합하거나, 문서가 미유지 상태를 명시한다.

---

## P1 — 신뢰를 좀먹는 것 (조용한 격하와 드리프트)

### P1-1. install-manifest에 보존 파일 승계 ✓검증

- **현상**: `scripts/init.mjs:1407` `buildInstallManifest`가 이번 런에 **복사된 파일만** managedFiles에 기록하고 이전 manifest를 병합하지 않음. 로컬 수정으로 보존된 managed 파일은 다음 런부터 `managed=false`가 되어, (a) 마커 머지 분기(`:899` `exists && managed && isMarkerManaged`)가 영영 발동 안 해 「마커 두르면 자동 머지」 안내가 성립하지 않고, (b) `--force --confirm` 이중동의 시 per-file 사이드카 백업(`:958`) 없이 덮어써짐.
- **검증 교정**: 무조건 데이터 손실은 아님 — `--force` 없으면 계속 보존되고 전역 타임스탬프 백업(`backupExisting`)은 존재. **「안전망이 첫 보존 이후 조용히 격하」**가 실체.
- **제안**: `buildInstallManifest`에 이전 manifest를 인자로 전달, 이번 런에서 보존(skip)된 managed 파일의 엔트리를 승계. `preservedByGuard`/`needsMarkerMigration` 경로의 파일도 managed 상태·해시를 유지.
- **수용 기준**: 로컬 수정된 managed 파일을 보존한 뒤 마커를 추가하고 재설치하면 **3회차 런에서 자동 머지가 걸린다**(현재 테스트는 2회차까지만 검증 — P2-2 참조).

### P1-2. 버전 그물 자동화 + 복붙 헬퍼 공용화 ○단일 / ✓일부실증

> **재검증 정정**: 원 리뷰의 "seed `compareSemver`가 스택에 복붙되어 base 게이트를 지배한다"는 **부정확했다.** seed에는 그 이름의 함수가 없고 `parseSemverLoose`/`compareSemverLoose`(`init.mjs:1481/1487`)만 있으며 이는 **CHANGELOG delta 전용**이지 base 판정과 무관하다. base 판정 비교기(`installedBaseSatisfiesRequirement`)는 **vue3에만** 존재한다. 아래는 완화된 정확한 버전이다.

- **현상 (버전 그물, 실재)**: base 1회 릴리스 반영에 seed 내부 3곳 + 스택 2곳(`vue3/manifest.json:11-12`, 같은 값을 ref/minVersion 별도 필드에) + 템플릿 2~4곳 + 정책 2곳을 손으로 편집. `scripts/`에 bump/동기화 자동화 전무, pre-commit도 버전 정합 미검사.
- **현상 (헬퍼 lineage, 실재하나 게이트 지배는 아님)**: seed와 vue3의 semver 파서는 **lineage를 공유**(major/minor/patch 루프 동일)하나 이미 갈라졌다 — 정규식이 다르고(seed `init.mjs:1482`는 끝앵커·프리릴리스 없음, vue3 `:230`은 끝앵커+프리릴리스 허용), 호출 규약도 다르다(seed는 파싱 객체, vue3는 원시 문자열). vue3의 base 판정 비교기는 **파싱 실패 시 null→false→재설치**로 안전 폴백하므로 **능동적 base 오판 결함은 아니다** — "중복·유지보수 리스크"로 읽어야 정확. 다만 `readScanSectionLines`는 '감지 없음' 플레이스홀더 배제 로직이 seed(`:1912`)에만 있고 vue3(`:824`)엔 없어 **버그픽스가 한쪽에만 반영된 전례가 실재**(전파 실패 실증).
- **영향**: 드리프트가 예외가 아니라 기본 상태. caret 완충이 붕괴를 늦출 뿐. 지금은 안전 폴백 덕에 무해하나, 갈라진 헬퍼는 다음 픽스가 한쪽에만 반영될 확률을 계속 높인다.
- **제안**:
  1. base 릴리스 시 스택/템플릿 manifest ref·minVersion을 갱신하는 스크립트(단일 소스 → 파생) + pre-push 정합 검사(버전 그물 불일치 시 실패).
  2. semver 파서·`globToRegExp`(2벌)·`ignoredDirs`·changed-files를 공용 모듈로 승격(`node-env.mjs` 방식). **단 통합 시 호출 규약을 한쪽으로 통일하되 vue3의 "파싱 실패→안전 재설치" 동작과 `readScanSectionLines`의 '감지 없음' 배제·접두 strip 차이를 보존**할 것(그냥 한쪽 복사 시 다른 호출부 회귀).
- **수용 기준**: base 버전을 한 곳에서 올리면 스택/템플릿 참조가 자동 갱신되거나 최소한 CI가 불일치를 잡는다. semver 비교 로직이 단일 구현이며 기존 안전 폴백 동작이 회귀 없이 보존된다.

### P1-3. 「통과」의 의미를 좁히거나 강화 ✓검증 / ○일부

- **현상**: 본체 `runCheck`(`policy-harness.mjs:309-316`)의 「Policy check passed」 실체는 policy-registry 스키마 검증뿐이고 정책 `checksKey`는 매 런 warn 후 위임. 그런데 위임 대상인 `vue3/policies.json`은 6개 정책 전부 `checks:[]`(○단일) — **실효 자동 검증이 0에 가까움**. 동시에 `ownedAreas`가 `scripts/**`·`src/components/**` 수준으로 과광역이라 소비자 일상 커밋마다 sync-gap 오탐, strict에서 blocking 격상.
- **영향**: 「통과」가 실제 검증 강도보다 강하게 읽힘(과대 신호). 반대로 오탐은 잦아 경보 피로.
- **제안**: (a) 스택 `policies.json`의 빈 `checks`를 실제 검사로 채우거나, (b) 위임이 비었을 때 통과 문구를 「스키마 검증 통과(정책 checks 미정의)」로 정직하게 표기. `ownedAreas`를 실제 소유 경로로 좁힘.
- **수용 기준**: `checks`가 비어 있으면 요약이 「검증 없음」을 드러낸다. 스택 적용 소비자의 무해한 일상 커밋이 sync-gap 오탐을 만들지 않는다.

### P1-4. 손상 입력 방어 + 한글 파일명 캐시 정합 ✓검증 / ⚡실증

- **현상 (a)**: `scripts/init.mjs:1571` `readJson`이 존재만 보고 `JSON.parse` 예외를 안 잡음 → 소비자 package.json/manifest 손상 시 파일 복사 후 크래시(견고성 버그, 「영구 미업데이트」는 과장). 또 `mergeClaudeSettings`의 `parse-error`가 `verbose||dryRun`에서만 보고되어(`:2141-2147`) 일반 모드에선 **안전 훅 미배선이 무보고**.
- **현상 (b)**: `guard.mjs:56-76` — `git status --porcelain`이 비ASCII/공백 경로를 따옴표로 인용하는데 `line.slice(3).trim()`이 이를 안 벗겨 해시가 항상 `missing` → 캐시 키 불변. **한글 문서만 수정하면 「Validation cache hit」으로 전체 검증 스킵**(scratch repo 실측). 한글 문서 위주인 이 조직에서 현실적. clubadm 업데이트 직후 `harness:check`가 즉시 캐시 히트로 「통과」 보고 → `--no-cache` 강제 시에야 실제 build 실행을 재관측.
- **제안**: `readJson`에 try/catch + 손상 시 구체 안내(어느 파일이 왜). `parse-error`를 일반 모드에서도 상시 보고. `getChangedFiles`에서 git 인용 경로(`"..."` + 옥탈 이스케이프) 디코드 후 해시.
- **수용 기준**: 손상 package.json에서 스택트레이스 대신 「X 파일 JSON 손상」 안내 후 안전 중단. 안전 훅 미배선이 일반 모드에서 보고됨. 한글 파일명 문서만 수정해도 캐시가 미스되어 재검증된다.

### P1-5. 템플릿 보안 게이트 2건 ○단일

- **현상 (a)**: `cloud-front/src/utils/entryService.js:9,24-26` — `VITE_ENTRY_DEFAULT=direct`(양쪽 .env)라 `hasEntryAccess()`가 항상 truthy → `VITE_ALLOW_DIRECT_ACCESS=false`(운영)여도 로그인 리다이렉트 분기가 실행 안 됨. 운영 빌드에서 익명 사용자가 관리자 셸 진입(서버는 401로 막지만 광고한 게이트는 꺼짐).
- **현상 (b)**: `cloud-front/src/apis/auth.js`의 `exchangeTicket/me/login`이 코드 어디서도 호출 안 됨 — 최초 진입 시 서버 부트스트랩 오케스트레이션 부재. 신규 개발자가 「문서가 약속한 흐름이 왜 안 도는지」부터 헤맴.
- **부수**: 라우터 가드가 조상 메뉴 condition 미검사(URL 직접진입 우회), `allowAll:DEV`가 localStorage 영속 + dev/prod 동일 prefix 전제 시 권한 누수(`permission.js:9,19,38`), `template:apply`가 버전 계약 미강제(id만 비교) — 이 마지막은 `.harness/bin/apply-stack.mjs:899-902`(harness-seed 배포본)에 위치.
- **전제 (심각도 조건)**: (1)(2)가 진짜 보안 결함이 되려면 **이 템플릿이 실제 운영 인증을 전제**해야 한다. 현재 코드는 `allowAll:DEV`·storage 기반 mock 등 **데모/스캐폴드 성격**이 강하므로, 우선순위를 P1 보안으로 볼지 「템플릿이 아직 데모 단계임을 명시」로 볼지는 유지 의도에 달렸다.
- **영향**: 「받아서 바로 뜨는」 표준 시작점으로 안심하고 배포하기 어려움 — 또는 데모 단계라면 그 사실이 문서화되어야 함.
- **제안**: (운영 시작점을 지향한다면) 진입 게이트 기본값을 안전한 쪽으로(기본 `direct` 폐기 또는 `ALLOW_DIRECT_ACCESS` 실제 소비), 서버 부트스트랩(ticket 교환·me·menu 로드) 오케스트레이션 추가, 가드에 조상 condition 검사, `allowAll` 비영속화, `template:apply`에 minVersion/range 강제. (데모 단계로 남긴다면) README에 「운영 인증·부트스트랩 미완, 데모 스캐폴드」를 명시.
- **수용 기준**: 운영 env로 빌드 시 entry 없는 사용자가 로그인으로 리다이렉트된다. 최초 진입에서 서버 통신이 일어난다. — 또는 템플릿 상태가 문서에 정직하게 표기된다.

---

## P2 — 품질·이식성 (시간이 있을 때)

### P2-1. init.mjs 2,404줄 책임 분해 ✓검증(구조 근거)

- **현상**: CLI 파싱 / semver·nvm 진단(~300줄) / 설치 엔진 `installFiles`(`continue` 제어흐름 + 10필드 결과 객체) / 템플릿 리터럴(~160줄) / 4종 머저 / manifest·lock 영속화 / 진단 오케스트레이션 / `main()`(~370줄)이 한 파일에. P1-1 manifest 탈락 버그는 copiedFiles/skippedFiles 장부가 분기마다 흩어진 이 구조의 산물. SSOT 3중 분산(`shouldIncludeInstallFile` ↔ `files` 부정패턴 ↔ `SEED_ONLY_DOC_PATHS`)이 실제 `settings.local.json` 비대칭을 낳음.
- **제안**: 설치 엔진 / 머저 / 리포트 / 진단으로 모듈 분리. 결과 장부를 단일 자료구조로.
- **수용 기준**: `installFiles`의 분기별 장부 갱신이 한 곳으로 모이고, 파일 포함 규칙 SSOT가 하나.

### P2-2. 테스트 3회차 런·손상 입력·git 소스 경로 보강 ✓검증

- **현상**: E2E 78개는 mock 최소로 충실하나 2회차 런까지만 검증 → P1-1 격하 버그를 놓침. `--from-git`/`--ref` 설치 경로, 손상 package.json/manifest/settings.json(`parse-error` 분기), 마커 쌍 오염 미검증. ai-standard-cli 테스트 18개는 전부 plan 빌드만 봐 실행 계층 0% 커버(○단일).
- **제안**: 「보존→마커 추가→3회차 자동 머지」 테스트, 손상 입력 테스트, git 소스 설치 테스트, CLI 실행 계층 테스트 추가.
- **수용 기준**: P1-1·P1-4 수정이 회귀 테스트로 잠긴다.

### P2-3. Windows 지원 정합 + 부분 실패 롤백·복구 안내 ○단일

- **현상**: `guard.mjs:288`·`apply-stack.mjs:770`·`ai-standard-cli/src/cli.mjs:999`가 `spawnSync`를 shell 없이 `npm`/`npx`로 호출 → Windows ENOENT/EINVAL로 lint/test/build·라우팅 실패. win32 런처 분기·README Windows 안내와 모순. `cli.mjs:1004`는 `result.error` 미확인으로 무음 exit 1. `apply-stack` reset은 사용자 수정 파일까지 통째 삭제(`:1128-1136`), `manifest.id` 미검증 `rmSync`(`:220-223`)는 신뢰 안 되는 외부 프리셋 적용 시 경로 탈출 재귀삭제(✓검증). init 부분 실패 시 복구 안내 부재.
- **제안**: 하위 프로세스에 `shell:true`(또는 `.cmd` 해석) + `result.error` 표면화. reset은 해시 비교 후 미변경 파일만 삭제. `manifest.id`/`stackId` 형식 검증(경로 문자 차단). 실패 시 백업 위치 안내.
- **수용 기준**: Windows에서 `harness check`/`ai-standard-cli check`가 동작하거나 명확한 오류를 낸다. 오염된 `manifest.id`가 스냅샷 루트를 탈출하지 못한다.

### P2-4. docs를 SSOT 배선에 편입 ○단일

- **현상 (실재)**: 공용 라이프사이클 가이드(`guides/harness-lifecycle/index.html:563-571` verify 노드)가 「커밋 전」 레인에서 `harness:check`·`harness:check:strict`를 **에이전트가 직접 실행하는 자동 Tool 단계**로 제시한다. 그런데 최신 표준(`consumer-reviews/AGENT_FINALIZATION_GATE_REVIEW_2026-05-28.md`)은 「완료 승인 전 검증 금지, 검증 후보로 보고 / Stop hook 자동실행 금지」다. 즉 가이드는 **승인 게이트를 누락한 채 검증을 자동 단계로 제시**(SYNC GAP) — 다만 가이드의 커밋 노드는 Human 배지라 "승인 없이 커밋하라"는 능동 지시는 아니므로 "정반대"까지는 아니다. docs는 tag 전무·2026-05-15 정지. Pages 배포(`.gitlab-ci.yml` script 블록)가 assets/guides/index.html만 복사하고 `standards/`(정책 원문)·README를 제외.
- **정정**: 원 리뷰의 "최신 표준은 hook 위임"은 부정확 — 표준은 「승인 후 hook은 안전장치 + Stop hook 자동실행 금지」이며 `guiding-policy.md:45`는 오히려 검증을 선택사항으로 낮추지 말라고 한다. 또 "install/update 미배선"은 결함이 아니다 — docs는 package.json 없는 **정적 가이드 사이트**(로컬 대시보드 `harness:guide`와 역할 분리)라 애초에 배선 대상이 아니다. 유효한 관측은 "릴리스/버전 추적 부재"이지 "배선 누락"이 아님.
- **제안**: 가이드 verify 노드 텍스트를 승인 게이트 반영(「승인 전 검증 후보로 보고, `harness:check`는 완료 승인 뒤」)으로 개정 + `.gitlab-ci.yml` script에 `standards/`·README 복사 추가 + Pages에 「하네스란/설치법」 온보딩 포함. (정책 원본→seed 55줄 요약의 동기화 검증 장치는 별도로 있으면 좋으나 정적 사이트 배선과는 분리.)
- **수용 기준**: 가이드의 검증·커밋 지침이 최신 승인 게이트 표준과 일치. Pages 사이트에 최상위 정책 원문과 온보딩 진입로가 존재.

---

## 부록 A — 검증에서 하향/기각된 항목 (요청 아님, 참고용)

정직성을 위해 남깁니다. 아래는 **버그로 고쳐달라는 요청이 아니라** 표현·기대 정합 차원의 참고입니다.

| 항목 | 원 리뷰 | 재검증 | 결론 |
| --- | --- | --- | --- |
| blocking 갭 기본 모드 exit 0 | 치명 | PLAUSIBLE | **의도된 strict opt-in** — 갭은 콘솔 출력됨. 다만 `block` 이름·「조치 필요」 요약과 종료코드 0의 기대 불일치는 남음 → 문구 정합만 검토 권장 |
| 정책 checks 「어디서도 실행 안 됨」 | 높음 | PLAUSIBLE | **가시적 warn 동반 문서화된 위임**. 실효는 위임 대상(스택 policies.json)에 달림 → P1-3으로 흡수 |
| readJson 크래시 「영구 미업데이트」 | 치명 | 중(교정) | 요란한 크래시·JSON 고치면 즉시 해소. 견고성 버그로만 → P1-4로 흡수 |
| manifest 탈락 「무조건 덮어씀」 | 치명/높음 | 높음(교정) | 전역 백업 존재·`--force` 없으면 보존. 「안전망 격하」가 실체 → P1-1 |
| `.env.production` 시크릿 유출 | (가설) | **기각** | VITE_* 공개 설정 + 내부 URL 1건뿐. 낮음(내부 호스트명 노출) |

**정정된 위생 사실**: `.idea/`·`.harness-backup/`·`outputs/`·`.harness/generated/`·`agent-events.ndjson`·`check-cache.json`은 gitignore되어 커밋·tarball 미포함(양호). `consumer-reviews/` 3건만 커밋됨(공개 원격이면 낮음 노출).

---

## 부록 B — 요청 항목 요약표

| # | 우선순위 | 항목 | 검증 | 핵심 파일 |
| --- | --- | --- | --- | --- |
| P0-1 | 채택 | 퀵스타트 첫 경로 실동작 | ⚡ | README.md:66-70,580,597 |
| P0-2 | 안전 | 차단 훅 fail-closed + 정규식 | ⚡ | block-dangerous.sh · protect-paths.sh · settings.json |
| P0-3 | 채택 | uninstall 경로 | ⚡ | (신규) |
| P0-4 | 채택 | 설치 풋프린트 고지 | ⚡ | README.md:236-254 |
| P0-5 | 보안 | npm files 유출 차단 | ⚡ | package.json files |
| P0-6 | 정합 | 템플릿 재편입/안내 정리 | ○ | cloud-front/manifest.json:27-33 |
| P1-1 | 신뢰 | manifest 보존 승계 | ✓ | init.mjs:1407,899,958 |
| P1-2 | 신뢰 | 버전 그물 자동화 + 헬퍼 공용화 | ○/⚡ | init.mjs:1481-1487 · vue3/init.mjs:229-261,824 (재검증 완화) |
| P1-3 | 신뢰 | 「통과」 의미 정직화 | ✓/○ | policy-harness.mjs:309 · vue3/policies.json |
| P1-4 | 신뢰 | 손상 입력 방어 + 한글 캐시 | ✓/⚡ | init.mjs:1571,2141 · guard.mjs:56-76 |
| P1-5 | 보안 | 템플릿 진입/부트스트랩 게이트 | ○ | cloud-front/entryService.js · apis/auth.js |
| P2-1 | 품질 | init.mjs 책임 분해 | ✓ | scripts/init.mjs |
| P2-2 | 품질 | 테스트 3회차·손상·git·CLI | ✓ | test-init.mjs · cli.test.mjs |
| P2-3 | 이식 | Windows spawn + 롤백 + rmSync 검증 | ✓/○ | guard.mjs:288 · apply-stack.mjs:220,1128 · cli.mjs:999 |
| P2-4 | 정합 | docs SSOT 배선 | ○ | ai-standard-docs |

---

_방법: 9-소스 병렬 리뷰 + harness-seed 핵심 7건 적대 재검증(CONFIRMED 5 / PLAUSIBLE 2 / REFUTED 0). 요청서 초안은 P0/P1/P2 항목 7건을 코드에 재대조하는 red-team 패스로 다시 검증했고, 그 결과 P1-2·P2-4의 과장을 완화하고 P0-1·P0-6·P1-5의 표현·라인 참조를 정정, P0-2 제안에 node 비의존 차단 전제를 추가했다(이 문서에 반영 완료). 전 과정 읽기 전용 · 스냅샷 2026-07-09._
