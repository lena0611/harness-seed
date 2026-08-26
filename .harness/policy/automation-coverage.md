# Automation Coverage

개발 기준 중 무엇이 자동 검증 가능하고, 무엇이 아직 수동 검토 대상인지 기록합니다.

## 공통 하네스 자동 검증 (스택 무관)
| Rule | 설명 | 현재 상태 |
| --- | --- | --- |
| `doc-registry-consistency` | `document-registry.json`과 실제 .md 파일 집합 일치 | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `doc-link-integrity` | `.harness/**/*.md`와 에이전트 진입점 문서의 상대 링크 유효성 | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `doc-code-path-integrity` | 문서가 인용한 업무 코드, `.harness/...`, seed-only `scripts/...` 경로 존재 (활성 스택의 scaffold 내부도 관대 검사) | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `harness-install-integrity` | managed 파일이 `install-manifest.json`의 sha와 일치하는가. 어긋난 파일은 업데이터가 "소비자 수정"으로 보고 **이후 모든 업데이트에서 조용히 건너뛴다** — 그 상태는 스스로 알리지 않는다(2026-08-11 실증: lint 자동수정으로 10건 동결, post-merge hook 지원 누락). 마커 하이브리드(CLAUDE.md 등)는 소비자 영역이 있어 제외. 복구는 `harness:update -- --resync-managed` | 자동 안내 (`harness:check` — 주의로 표기) |
| `policy-registry-schema` | `policy-registry.json` v3 필수 필드, enum, 중복 ID 검사 | 자동 검사 (`policy:check`, `harness:check`) |
| `policy-source-sync-gap` | 기준 매핑의 한쪽만 변경되어 동기화 갭 발생 | 자동 검사 (`harness:impact`, CI에서 `harness:check:strict`로 차단) |
| `stack-isolation` | 한 스택 폴더가 다른 스택 폴더를 참조하지 않음 | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `context-artifact-generation` | 프로젝트 맵, import 맵, Agent Decision Context 생성 | 자동 생성 (`harness:sync`, `harness:context`) |
| `spec-link-integrity` | 기획 연동 선언↔기준(lock v2: 문서별 sha+commit, selector)↔매핑↔코드 정합. repo/ref/selector 드리프트, 유령 소스, 소스 간 경로 충돌, id 중복·안전성(무효 선언은 전체 invalid), 선언 없이 기준만 남은 상태 | 자동 검사 (`harness:check`; `specEnforcement: "gate"` 프로젝트는 차단) |
| `spec-lock-schema` | lock이 JSON으로 읽히는 것과 기준으로 쓸 수 있는 것은 다르다. version·sources/files 형태, source 메타데이터, selector, 문서 경로 안전성, sha256·commit 형식을 검증하고 **항목 하나라도 어긋나면 전체 invalid**(관용하면 그 문서가 기준에서 사라져 drift 검사가 건너뛰어짐) | 자동 검사 (**fail-closed** — status/doc-link/settle/push tip 공유) |
| `spec-screen-link` | 화면은 **문서가 링크로 선언**한다(경로 관례 아님). 링크한 화면이 없거나 아무도 참조하지 않는 화면 파일이 있으면 기준으로 받지 않고(최초 fetch·최신 확인·freshness·상태 모두 fail-closed), 화면만 바뀌어도 문서 단위 전체가 변경으로 판정되며, 정산은 둘을 같은 commit으로 함께 기록(부분 정산 거부). 링크된 화면은 include에 없어도 자동 편입, 매핑은 대표 문서 한 줄로 충분. 독립 명령 `screen-check`로 기획 저장소 CI에서도 동일 판정 | 자동 검사 (연동 전 구간 + push 게이트) |
| `spec-settlement-monotonicity` | 정산은 앞으로만 간다. 목표 commit이 현재 기준의 조상이면 거부, 같은 이력에 없으면 거부, 증명 불가면 거부(허용 아님). 캐시를 전체 이력으로 받아 판정을 보장하고, 옛 얕은 캐시는 최신 확인에서 치유 | 자동 검사 (`harness:spec:settle`) |
| `spec-push-settlement` | push tip snapshot(profile/sources/lock/map을 push 커밋에서 읽음) 기준으로, push 범위 코드에 매핑된 기획 문서의 drift를 차단하고 정산(`spec:settle`)을 요구. 설정 오류는 fail-closed, 기획 저장소 접근 실패만 fail-open | 자동 검사 (pre-push hook `spec-push-gate.mjs`, `"gate"` 옵트인) |
| `spec-provenance` | 기준 기록의 출처 검증: settle은 **기획 저장소의 git 객체**와 대조 후 기록(소스 정체성·스냅샷 commit 실재·본문 sha·삭제 부재 확인, 전부 통과해야 lock 수정), v1 lock은 변경 명령에서 검증 후 v2 승격(읽기 경로는 무수정·무네트워크) | 자동 검사 (`harness:spec:settle`, `harness:spec:fetch -- --move-baseline`) |
| `spec-unmapped-inventory` | 기준에는 있는데 매핑도 판정도 없는 문서 = **"매핑되지 않은 기획"** 목록(구현 여부는 판정하지 않음 — 스텁에 미리 매핑하면 목록에서 빠지지만 구현된 것이 아니다). 커버리지 검사는 매핑이 있어야 도는 구조라 **도입 직후(매핑 0건)가 사각지대**였다 — 그 상태를 "정상적인 시작"으로 알리고 할 일 목록을 준다. 링크된 화면과 `(코드 없음)` 판정분은 제외 | 자동 안내 (`harness:spec:status`, 커밋 검증) |
| `spec-lock-screen-consistency` | 기준에 기록된 문서가 링크한 화면이 기준에 함께 있고 같은 시점인가. 매핑된 문서는 push 게이트가 보지만 매핑되지 않은 문서는 아무도 보지 않았다 | 자동 검사 (`harness:spec:status` — 어긋나면 실패) |
| `spec-mapping-coverage` | **커밋 안내(advisory)**: 매핑된 영역(과 형제 폴더)의 추가·수정 파일만 본다(잡음 방지). **push 게이트(gate)**: 이번 push의 **구현 파일 전부**(하네스·어댑터·문서·루트 설정 제외)가 매핑 또는 `(사양 없음)` 판정을 가져야 한다 — 매핑 0건·영역 밖도 예외 없음(5차 리뷰 P1-1). 매핑 누락은 그 코드가 이후 어떤 spec 검사에도 걸리지 않는 사각지대를 만든다 | 자동 검사 (커밋=안내 · gate=차단) |
| `spec-mapping-shrink` | base에 있던 {문서, 구현경로} 쌍이 tip에서 빠지면: 그 경로의 코드가 살아 있고 다른 매핑·판정이 없으면 차단. 코드 삭제·이전, 정산된 사양의 뒷정리, `(사양 없음)` 전환은 통과. 합집합도 쌍 단위라 경로 갈아끼우기로 drift 범위를 좁힐 수 없다(5차 리뷰 P1-2) | 자동 검사 (push 게이트) |
| `spec-cache-hydration` | **기준 본문**(`spec-cache`, git 미추적)을 lock과 일치시킴. 판정은 소스 HEAD가 아니라 **문서별 sha/commit 대조**(부분 정산 반영). pull 직후 `post-merge` 훅이 담당하고, 컨텍스트 생성이 백스톱. **정본은 lock이며 캐시는 그 사본이다** — 수화가 실패하면 캐시는 lock과 어긋난 채 남고, 그 소스는 컨텍스트 주입에서 제외된다 | 자동 실행 (기준 불변, 실패는 비차단이되 출력+상태 파일 기록) |
| `spec-settlement-provenance` | 정산은 **읽은 스냅샷**(`spec-latest` manifest)의 commit/sha만 기록. 네트워크·ref 재조회 없음. 읽지 않은 문서 거부, 손편집 본문 중단, 검토 후 올라온 변경은 다음 확인에 남음. 스냅샷은 기획 저장소 git 객체와 대조해 위조·가짜 삭제를 거부하고, 한 건이라도 거부되면 lock을 수정하지 않음 | 자동 검사 (`harness:spec:settle`) |
| `spec-latest-exact-set` | 읽어볼 최신 사본(`spec-latest/<source>/`)은 그 기록(`.manifest.json`)과 **정확히 같은 집합**. 기록을 디렉터리 안에 두어 **rename 한 번으로 본문과 기록이 함께 확정**되므로 중간에 죽어도 어긋난 상태가 남지 않는다. 정산 소비도 같은 방식으로 교체 | 자동 실행 (`harness:spec:fetch -- --cache-only`, `harness:spec:settle`) |
| `spec-path-safety` | 기획 저장소가 주는 경로로 캐시 밖에 쓰거나 읽지 못하게 함(절대경로·`..`·NUL 거부, **보호 루트 자신부터** leaf까지 심볼릭 링크 차단, 읽기·쓰기·삭제가 같은 API를 사용, 쓰기는 임시 파일+rename) | 자동 검사 (모든 수화·최신 사본·읽기 경로) |
| `spec-freshness-at-task-start` | 작업 컨텍스트 생성 시 짧은 예산의 비파괴 최신 확인. 기준 문서 / 기준 이후 변경 / 신규·미정산을 구분해 표시하고, 실패 시 "최신 확인 못함"을 명시 | 자동 실행 (TTL 재사용, 기준 이동 없음, 실패해도 진행) |
| `spec-gate-self-disable` | 매핑 표를 비우거나 lock의 문서 항목만 빼는 **정상 형식 self-disable**을 차단. push scope는 base∪tip 매핑으로 잡고(행을 지운 그 push에도 옛 매핑 적용), 매핑된 문서가 기준에 없으면 차단, 매핑은 있는데 기준이 비면 정합 오류 | 자동 검사 (push 게이트 + `harness:check`) |
| `hook-installation` | `core.hooksPath`는 clone으로 공유되지 않으므로 사람마다 설치해야 한다. 미설치를 검사가 감지해 설치 명령을 안내 | 자동 안내 (커밋 검증·`harness:check`) |
| `harness-mode-validity` | `profile.json`의 harnessMode가 허용 값인지, JSON이 읽히는지. 오타는 strict 차단이 조용히 꺼지는 원인이 된다 | 자동 검사 (**fail-closed** — 값 오류·JSON 오류 시 검사 실패) |

커밋 검증(`policy-harness`)은 본문 자동 수화를 실행하지 않습니다. 캐시 부재를 안내만 하며(비차단), 본문 준비의 보장은 pull 훅과 작업 컨텍스트 단계에 있습니다 — 커밋 시점 수화는 작업이 끝난 뒤라 늦습니다.

## Claude Code 어댑터 자동 방어
Claude Code 환경에서는 `.claude/settings.json` hook으로 다음 방어를 추가합니다. 이 어댑터는 `.harness/` 기준을 대체하지 않고 실행 표면에서 피해를 줄입니다.

| Hook | 설명 | 누적 관리 |
| --- | --- | --- |
| `scan-secrets.sh` | 사용자 프롬프트의 API key, token, private key, password-like 값 패턴 감지 | 값을 저장하지 않고 컨텍스트 경고만 출력 |
| `block-dangerous.sh` | `rm -rf /`, `git reset --hard`, `git clean -fd`, `--no-verify`, `curl \| sh`, secret 파일 읽기 우회 차단 | 누적 없음 |
| `protect-paths.sh` | `.env`, `.git`, dependency/generated 디렉터리, lockfile 직접 쓰기 차단 | 누적 없음 |
| `record-tool-failure.sh` | `PostToolUseFailure`와 `PermissionDenied`를 redaction 후 기록해 같은 시도 반복을 줄임 | `.harness/generated/agent-events.ndjson`에 capped 기록. 컨텍스트 주입은 TTL 안의 마지막 1건만. 프로젝트 기준 승격은 별도 판단 |

## 활성 스택 자동 검증 (`activeStack`에 따라 ON/OFF)
본체는 특정 프레임워크 전용 자동 검사를 내장하지 않습니다. `"none"`이면 전부 비활성화됩니다.

| checksKey | Rule | 설명 |
| --- | --- | --- |
| 외부 프리셋 값 | 프리셋 저장소 guard | 프리셋 전용 자동 검사는 해당 스택 기준 또는 템플릿 저장소에서 관리 |

## 프로파일
- 프레임워크 특화 규칙은 `.harness/policy/profile.json`의 `activeStack` 값으로 선택됩니다.
- 외부 프리셋은 `stackManifest` 경로의 `manifest.json`으로 연결할 수 있습니다.
- 접근 이름: 해당 스택 `manifest.json`의 `checksKey`를 기록할 수 있지만, 본체는 이를 실행하지 않고 안내만 합니다.
- 기본값: `activeStack=none`.
- 스택 미적용 상태(`activeStack: none`)에서도 일반 인프라 검사(doc-link, 기준 동기화 후보 분석)는 항상 동작합니다.
- 코드 품질 검사(lint/test/build)는 스택 적용 여부와 무관하게 **하네스의 자동 검증 범위가 아닙니다**(0.2.131). 소유는 각 프로젝트이며 husky·CI 등 프로젝트 도구가 담당합니다. 하네스는 옵트인 선언도 받지 않습니다.
- 스택 적용 여부는 머신 로컬 `.harness/.stack-applied.json` 마커만 보지 않고, `profile.json`의 `activeStack`과 커밋된 `.harness/stacks/.applied/<stack>/manifest.json` 스냅샷에서 복원합니다. fresh clone, worktree, CI처럼 ignored 마커가 없는 환경에서도 스택 스냅샷이 있으면 스택 적용 상태를 복원해야 합니다.
- `activeStack`은 있는데 커밋된 스택 스냅샷을 찾지 못하면 검증을 통과로 보지 않고 실패로 처리합니다. 이 경우 스택 하네스 init 또는 `.harness/bin/harness stack:apply`를 다시 실행해 `.harness/stacks/.applied/<stack>/`을 정착시켜야 합니다.

## 아직 수동 검토 필요
| 항목 | 이유 |
| --- | --- |
| 특정 모듈 내부의 "업무 판단인지 단순 변환인지" 판단 | 의미적 해석이 필요 |
| 책임 경계를 섞는지에 대한 고수준 설계 판단 | 구조적 맥락이 필요 |
| 기준 변경이 기존 코드의 설계 의도를 바꾸는지 여부 | 문맥 기반 검토가 필요 |
| 프로젝트 목적/범위와 구현이 어긋나는지 여부 | 프로젝트 헌장 입력이 필요 |
| 생성 컨텍스트의 해석이 실제 설계 의도와 맞는지 여부 | 생성 산출물은 보조 자료이므로 사람/에이전트의 원본 확인 필요 |

## 확장 규칙
- 새로운 자동 검사를 추가하면 이 문서의 자동 검증 가능 표에 반영합니다.
- 자동화가 불가능한 규칙은 수동 검토 표에 남겨 과신을 방지합니다.
