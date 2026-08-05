# 하네스 본체 개선요청 — 본체 자신의 decision-log 아카이브가 소비자에게 배포됨

- **발행**: clubadm (서비스개발4팀), 2026-08-04
- **환경**: base `harness-seed` 0.2.86 → **0.2.94** (`--base-only`), stack `vue3-vite-pinia-router` 0.1.47, `harnessMode: active`
- **등급 제안**: P1 (데이터 유실 가능 경로 포함)

---

## 1. 현상

`npm run harness:update -- --base-only` (0.2.94) 실행 후, 소비자 프로젝트에 아래 파일이 **새로 설치**됨:

```
.harness/session/decision-log-2026H1.md   (458줄)
```

내용이 소비자 프로젝트의 결정이 아니라 **harness-seed 본체 자신의 제품 개발 이력**이다. 실제 항목 예:

```
## 2026-06-25 - 본체 전용 Spec Authority 로드맵 seed-only 기록
## 2026-06-22 - 본체(seed-mode) 전용 문서 소비자 배포 제외 (0.2.69)
## 2026-06-22 - doc-link-check 소비자 환경 의존 오탐 수정 (0.2.68)
## 2026-06-15 - harness:update가 소비자 수정된 managed 파일을 무경고로 덮어쓰던 사고 차단
```

0.2.92 changelog의 서술과 일치한다:

> 본체 자신도 임계를 넘겨(500줄) 상반기 이력 454줄을 `decision-log-2026H1.md`로 분리했습니다.

즉 본체가 자기 이력을 분리하면서, 그 파일이 소비자 설치 목록에 함께 포함됐다.

## 2. 근거

`install-manifest.json` 등재 형태 (0.2.94 설치 직후 실측):

| 경로 | 섹션 |
| --- | --- |
| `.harness/session/decision-log-2026H1.md` | **`managedFiles`** (sha256 추적) |
| `.harness/session/decision-log.md` | `projectOwnedFiles` |

소비자의 현행 `decision-log.md`(157줄, 프로젝트 결정)는 **정상 보존**됐다. 데이터 손실은 이번엔 없었다.

## 3. 왜 문제인가

### (a) 소비자 저장소 오염

무관한 이력 458줄이 소비자 저장소에 커밋된다. 0.2.92가 "세션 재개는 현행 파일만 읽는다"고 규정했지만, **파일이 존재하는 것 자체**가 grep·코드 검색·리뷰·핸드오프 문서 수집에서 계속 걸린다. 소비자 관점에서는 노이즈이고, 본체 관점에서는 내부 의사결정 이력의 불필요한 노출이다.

### (b) 관례 파일명이 managed로 선점됨 — 소비자 이력 유실 경로 (핵심)

0.2.92는 소비자에게 **아카이브 파일명 관례**를 안내한다:

> 폐기/번복/종결/승격 완료 항목은 `decision-log-YYYYH1.md` 같은 날짜 아카이브로 항목 단위로 옮깁니다.

그런데 바로 그 경로(`decision-log-2026H1.md`)가 **`managedFiles`로 선점**돼 있다. 따라서 소비자가 **관례를 그대로 따라** 자기 결정 로그를 그 이름으로 분리하면:

1. 소비자 아카이브 = 본체 managed 파일과 경로 충돌
2. 다음 `harness:update`가 managed 파일을 기준본으로 복원
3. **소비자 결정 이력이 본체 이력으로 덮어써진다**

이는 아래 두 원칙과 정면 충돌한다.

- 0.2.69 — 본체(seed-mode) 전용 문서 소비자 배포 제외
- 0.2.72~0.2.74 — project-owned 파일 보존 (`harnessMode`·`sources[]`·lock changelog 보존 확립)

특히 0.2.92가 이 관례를 **권장**하면서 같은 릴리스에서 그 경로를 managed로 점유했기 때문에, **관례를 성실히 따르는 소비자가 손해를 보는** 구조다.

## 4. 요청 사항

1. **본체 자신의 decision-log 아카이브를 소비자 배포 목록에서 제외** (seed-only 처리). 0.2.69에서 확립한 seed-only 문서 목록(`SEED_ONLY_DOC_PATHS`, `doc-link-check.mjs`의 `seedOnlyDocs`)에 `decision-log-*.md` 아카이브 패턴을 추가.
2. **소비자 아카이브 경로를 `projectOwnedFiles`로 보장.** `decision-log.md`가 project-owned인 것과 동일하게, 그 아카이브(`decision-log-*.md`, `thread-handoff-*.md`)도 project-owned로 분류해 managed 복원 대상에서 영구 제외. 관례가 안내하는 파일명이 managed와 충돌할 수 없도록 계약으로 못 박아야 한다.
3. **회귀 테스트 2종 추가**
   - 소비자 설치본에 본체 decision-log 아카이브가 **존재하지 않음**
   - 소비자가 생성한 `decision-log-YYYYH1.md`가 `harness:update` 후 **내용 그대로 보존됨**

## 5. 소비자측 임시 조치

해당 파일을 로컬에서 삭제한다. 단 `managedFiles`에 등재돼 있어 **다음 base 업데이트에서 다시 설치될 것으로 예상**되며, 본체 수정 없이는 항구 해소되지 않는다.

또한 본 저장소는 결정 로그 분리 시 **관례 파일명(`decision-log-2026H1.md`)을 사용하지 않는다** — 위 (b) 유실 경로를 피하기 위한 회피책이며, 요청 2가 반영되면 해제한다.

## 6. 참고 — 이번 업데이트에서 정상 확인된 항목

문제는 위 1건뿐이고, 나머지는 모두 정상이었다.

| 항목 | 결과 |
| --- | --- |
| base 버전 | 0.2.86 → 0.2.94 (하향 없음) |
| stack 버전 | 0.1.47 유지 (`--base-only` 준수) |
| `requiredBase` 충족 | v0.2.85 ≤ 0.2.94 |
| project-owned 보존 | `harnessMode: active`, `sources[]` 2건 보존 |
| 소비자 `decision-log.md` | 무변경 |
| `package.json` 변경 | `template:gap` 스크립트 추가만 (rollup overrides 핀 보존) |
| `.gitignore` 변경 | `template-gap-report.md` 무시 추가만 |
| `harness:check --no-cache` | 통과 (build 통과) |
