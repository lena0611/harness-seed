# Automation Coverage

개발 기준 중 무엇이 자동 검증 가능하고, 무엇이 아직 수동 검토 대상인지 기록합니다.

## 공통 하네스 자동 검증 (스택 무관)
| Rule | 설명 | 현재 상태 |
| --- | --- | --- |
| `doc-registry-consistency` | `document-registry.json`과 실제 .md 파일 집합 일치 | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `doc-link-integrity` | `.harness/**/*.md`와 에이전트 진입점 문서의 상대 링크 유효성 | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `doc-code-path-integrity` | 문서가 인용한 업무 코드, `.harness/...`, seed-only `scripts/...` 경로 존재 (활성 스택의 scaffold 내부도 관대 검사) | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `policy-registry-schema` | `policy-registry.json` v3 필수 필드, enum, 중복 ID 검사 | 자동 검사 (`policy:check`, `harness:check`) |
| `policy-source-sync-gap` | 기준 매핑의 한쪽만 변경되어 동기화 갭 발생 | 자동 검사 (`harness:impact`, CI에서 `harness:check:strict`로 차단) |
| `stack-isolation` | 한 스택 폴더가 다른 스택 폴더를 참조하지 않음 | 자동 검사 (`harness:check`, 본체 개발 시 `docs:check`) |
| `context-artifact-generation` | 프로젝트 맵, import 맵, Agent Decision Context 생성 | 자동 생성 (`harness:sync`, `harness:context`) |

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
- 스택 미적용 상태(`activeStack: none`)에서도 일반 인프라 검사(doc-link, SYNC GAP)는 항상 동작합니다. lint/test/build는 자동으로 건너뛰어집니다.
- 스택 적용 여부는 머신 로컬 `.harness/.stack-applied.json` 마커만 보지 않고, `profile.json`의 `activeStack`과 커밋된 `.harness/stacks/.applied/<stack>/manifest.json` 스냅샷에서 복원합니다. fresh clone, worktree, CI처럼 ignored 마커가 없는 환경에서도 스택 스냅샷이 있으면 lint/test/build를 실행해야 합니다.
- `activeStack`은 있는데 커밋된 스택 스냅샷을 찾지 못하면 검증을 통과로 보지 않고 실패로 처리합니다. 이 경우 스택 하네스 init 또는 `npm run stack:apply`를 다시 실행해 `.harness/stacks/.applied/<stack>/`을 정착시켜야 합니다.

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
