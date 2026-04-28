# Automation Coverage

정책 중 무엇이 자동 검증 가능하고, 무엇이 아직 수동 검토 대상인지 기록합니다.

## 일반 하네스 자동 검증 (스택 무관)
| Rule | 설명 | 현재 상태 |
| --- | --- | --- |
| `doc-registry-consistency` | `document-registry.json`과 실제 .md 파일 집합 일치 | 자동 검사 (`docs:check`) |
| `doc-link-integrity` | `.harness/**/*.md`와 에이전트 진입점 문서의 상대 링크 유효성 | 자동 검사 (`docs:check`) |
| `doc-code-path-integrity` | 문서가 인용한 `src/...`, `scripts/...`, `.github/...`, `.harness/...` 경로 존재 (활성 스택의 scaffold 내부도 관대 검사) | 자동 검사 (`docs:check`) |
| `policy-source-sync-gap` | 정책 매핑의 한쪽만 변경되어 동기화 갭 발생 | 자동 검사 (`policy:impact`, CI에서 `--strict`로 차단) |
| `stack-isolation` | 한 스택 폴더가 다른 스택 폴더를 참조하지 않음 | 자동 검사 (`docs:check`) |

## 활성 스택 자동 검증 (`activeStack`에 따라 ON/OFF)
아래 규칙들은 활성 스택의 `manifest.json` `checksKey`에 의해 켜집니다. `"none"`이면 전부 비활성화됩니다.

| checksKey | Rule | 설명 |
| --- | --- | --- |
| `vue-fsd` | `core-purity` | core에서 Vue/Pinia/browser API 사용 금지 |
| `vue-fsd` | `adapter-ui-boundary` | adapter에서 UI 계층 의존 금지 |
| `vue-fsd` | `store-placement` | store 위치 제약 |
| `vue-fsd` | `composable-placement` | composable 위치 제약 |
| `vue-fsd` | `feature-structure` | feature 하위 구조 제약 |
| `vue-fsd` | `shared-boundary` | shared의 feature/UI 의존 금지 |
| `vue-fsd` | `no-dumping-folders` | `common`, `utils` dumping folder 금지 |

## 프로파일
- 프레임워크 특화 규칙은 `.harness/policy/profile.json`의 `activeStack` 값으로 선택됩니다.
- 접근 이름: 해당 스택 `manifest.json`의 `checksKey`가 `scripts/policy-harness.mjs`의 분기 식별자로 쓰입니다.
- 현재 값: `activeStack=vue3-fsd` → `checksKey=vue-fsd`. `"none"`으로 두면 프레임워크 자동 검사가 전부 비활성화됩니다.
- 스택 미적용 상태(`.harness/.stack-applied.json` 없음)에서도 일반 인프라 검사(doc-link, SYNC GAP)는 항상 동작합니다. lint/test/build는 자동으로 건너뛰어집니다.

## 아직 수동 검토 필요
| 항목 | 이유 |
| --- | --- |
| store/composable 내부의 "비즈니스 로직인지 아닌지" 판단 | 의미적 해석이 필요 |
| feature 경계를 섞는지에 대한 고수준 설계 판단 | 구조적 맥락이 필요 |
| 정책 변경이 기존 코드의 설계 의도를 바꾸는지 여부 | 문맥 기반 검토가 필요 |
| 프로젝트 목적/범위와 구현이 어긋나는지 여부 | 프로젝트 헌장 입력이 필요 |

## 확장 규칙
- 새로운 자동 검사를 추가하면 이 문서의 자동 검증 가능 표에 반영합니다.
- 자동화가 불가능한 규칙은 수동 검토 표에 남겨 과신을 방지합니다.
