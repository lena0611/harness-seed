# Policy DB Readiness

정책을 DB로 옮기기 전에 정책 항목이 문서가 아니라 **기계적으로 식별 가능한 개발 기준**인지 확인합니다.

## 목적

- 정책을 원자 단위로 식별합니다.
- 어떤 계층의 기준인지 명확히 합니다.
- 충돌, 예외, 만료, 검증, 출처 추적을 데이터로 남깁니다.
- DB나 검색 인프라로 옮겨도 원본 문서와 실제 코드가 진실 출처라는 원칙을 유지합니다.

## 정책 항목 최소 필드

`policy-registry.json` v3의 공통 정책 항목은 아래 필드를 가져야 합니다.

| 필드 | 의미 |
| --- | --- |
| `id` | 변경되지 않는 정책 식별자 |
| `title` | 사람이 읽는 정책 이름 |
| `layer` | `common`, `stack`, `template`, `project`, `personal` 중 하나 |
| `category` | sync, runtime, guard, documentation 같은 분류 |
| `status` | `draft`, `active`, `deprecated`, `superseded`, `experimental` |
| `severity` | `info`, `warning`, `error`, `blocker` |
| `enforcement` | `inform`, `trigger`, `hook`, `block` |
| `waiverAllowed` | 예외 기록을 허용하는지 여부 |
| `owner` | 정책 소유 저장소 또는 조직 |
| `source` | 원본 문서/저장소/경로 |
| `documents` | 정책을 설명하는 문서 glob |
| `ownedAreas` | 정책 변경 시 같이 봐야 할 코드/설정/문서 glob |
| `triggerPaths` | 실제 변경 시 정책을 깨우는 좁은 경로 glob. 없으면 `ownedAreas`를 사용 |
| `checks` | 검증 또는 확인 명령 |

## DB화 전 weak point 체크

정책을 DB에 넣기 전에 아래 항목을 먼저 확인합니다.

1. 정책이 너무 큰 묶음이 아니라 하나의 판단 단위인가?
2. 같은 `id`가 다른 의미로 재사용되지 않는가?
3. `source`로 원본 문서와 저장소를 추적할 수 있는가?
4. `documents`, `ownedAreas`, `triggerPaths`가 양방향 검토를 만들되 과도한 경고를 만들지 않는가?
5. 자동 검사 가능 여부가 `checks`에 명시되어 있는가?
6. `enforcement`와 `severity`가 분리되어 있는가?
7. 예외를 허용한다면 `waiverAllowed`가 true이고 `waivers.json`에 기록할 수 있는가?
8. 만료되거나 대체될 정책은 `status`, `supersedes`로 추적되는가?
9. 프로젝트별 적용 상태는 별도 lock 또는 profile에서 추적할 수 있는가?
10. 생성 컨텍스트나 요약이 원본 정책처럼 취급되고 있지 않은가?

## 현재 한계

- `policy-registry.json` v3는 DB 스키마의 전 단계입니다.
- 현재 검증은 필수 필드와 enum 중심입니다.
- 정책 간 의미 충돌, 만료일 초과, 승인자 권한 검증은 아직 수동 검토 대상입니다.
- 스택 하네스의 외부 `policies.json`는 기존 호환을 위해 기본 필드만 검사합니다.

## DB화 순서

1. 파일 기반 v3 레지스트리를 안정화합니다.
2. 정책 항목별 owner, source, checks, waiver 가능 여부를 채웁니다.
3. 프로젝트별 적용 상태를 lock 형태로 기록합니다.
4. 검색/감사/권한 관리가 필요해질 때 DB로 옮깁니다.
5. DB를 쓰더라도 원본 문서와 실제 코드를 진실 출처로 유지합니다.
