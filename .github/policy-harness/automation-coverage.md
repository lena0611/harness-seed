# Automation Coverage

정책 중 무엇이 자동 검증 가능하고, 무엇이 아직 수동 검토 대상인지 기록합니다.

## 자동 검증 가능
| Rule | 설명 | 현재 상태 |
| --- | --- | --- |
| `core-purity` | core에서 Vue/Pinia/browser API 사용 금지 | 자동 검사 |
| `adapter-ui-boundary` | adapter에서 UI 계층 의존 금지 | 자동 검사 |
| `store-placement` | store 위치 제약 | 자동 검사 |
| `composable-placement` | composable 위치 제약 | 자동 검사 |
| `feature-structure` | feature 하위 구조 제약 | 자동 검사 |
| `shared-boundary` | shared의 feature/UI 의존 금지 | 자동 검사 |
| `no-dumping-folders` | `common`, `utils` dumping folder 금지 | 자동 검사 |

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
