# Stacks

이 저장소는 **일반 하네스(generic harness)** 와 **스택 프리셋(stack preset)** 을 함께 제공합니다.

## 정의
- **일반 하네스**: 세션 복구, 정책↔코드 동기화, 문서 인덱싱, 스타일 검증, doc-link/SYNC GAP 검사 등 어떤 프레임워크에서도 동일하게 쓰는 인프라.
- **스택 프리셋**: 특정 프레임워크 + 디자인 패턴 조합에 종속된 instruction 문서, 정책 매핑, 자동 검사 규칙 키를 한 꾸러미로 묶은 것.

## 사용 가능한 프리셋
| id | UI | 상태관리 | 디자인 패턴 | status |
| --- | --- | --- | --- | --- |
| `vue3-fsd` | Vue 3 | Pinia | FSD + Clean Architecture + Headless Core + Adapter | stable |
| `none` | (선택 안 함) | (선택 안 함) | (선택 안 함) | always available |

> 새 프리셋을 추가하려면 [신규 스택 추가 가이드](#%EC%8B%A0%EA%B7%9C-%EC%8A%A4%ED%83%9D-%EC%B6%94%EA%B0%80-%EA%B0%80%EC%9D%B4%EB%93%9C)를 따릅니다.

## 활성 프리셋
- `.harness/policy/profile.json`의 `activeStack` 값이 결재의 단일 진실 출처입니다.
- 활성 프리셋의 `policies.json`은 일반 정책에 자동 병합됩니다.
- 활성 프리셋의 `instructions/`는 일반 instruction 인덱스에 함께 노출됩니다.

## 격리 원칙 (반드시 지킬 것)
1. 일반 하네스 문서·스크립트는 어떤 스택 폴더도 import 하지 않습니다. 로더만 활성 스택을 읽습니다.
2. 한 스택 폴더는 다른 스택 폴더를 참조하지 않습니다.
3. 스택 폴더는 자체-완결되어야 합니다. 폴더 단위로 잘라 다른 저장소로 옮길 수 있어야 합니다.
4. 스택의 정책은 반드시 `policies.json`을 통해서만 일반 인프라에 노출됩니다.

## 신규 스택 추가 가이드
1. `.harness/stacks/<new-id>/manifest.json` 작성 (id, framework, designPattern, instructions 목록, policiesFile, checksKey, source).
2. `.harness/stacks/<new-id>/instructions/*.md` 추가.
3. `.harness/stacks/<new-id>/policies.json` 작성 (id, title, documents, ownedAreas, checks).
4. `.harness/stacks/<new-id>/scaffold/` 안에 실제 스캐폴드 파일들(src/, package.merge.json, 빌드 설정 등) 을 넣습니다.
5. 새 `checksKey`가 자동 검사에 필요한 신규 규칙을 요구하면 `scripts/policy-harness.mjs`의 `collectViolations()`에 분기 추가.
6. `.harness/stacks/README.md`의 표에 등록.
7. `document-registry.json`에 새 스택 그룹 등록 (scaffold 내부는 등록 불필요, doc-link-check가 자동 제외함).
8. `npm run docs:check` 와 `npm run policy:guard` 통과 확인.
9. `npm run stack:apply`로 실제 적용이 동작하는지 검증.

## 향후 분리 경로 (지금은 적용하지 않음)
- 프리셋 수가 늘거나 외부 저장소에서 공유해야 하면 `.harness/stacks/<id>/scaffold/`를 별도 저장소로 뗼어내고 manifest의 `source.type`을 `tiged`로 전환합니다.
- 현재 격리 원칙을 지키면 폴더 이동 + manifest 한 줄 변경으로 마이그레이션 가능합니다.
- 마이그레이션 시 구현해야 할 것: `scripts/apply-stack.mjs`의 `adapterTiged()` 구현(`npx tiged <ref> <tmp>` + scaffold 복사 흐름 + 캠시 처리).
