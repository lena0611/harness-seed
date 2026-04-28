# CLAUDE

이 파일이 모든 에이전트의 기준 진입점입니다. 사내 표준 에이전트는 Claude입니다.

## 읽기 순서
1. `.harness/session/README.md`
2. `.harness/session/session-start-alert.md`
3. `.harness/session/project-memory.md`
4. `.harness/session/active-context.md`
5. `.harness/project/project-charter.md`
6. `.harness/project/bootstrap.md`
7. `.harness/policy/README.md`
8. `.harness/documentation/README.md`
9. `.harness/stacks/README.md`

## 기준
- 하네스 본체는 `.harness/`에 있습니다.
- `.github/`는 GitHub Copilot, GitHub Actions, GitHub template용 어댑터입니다.
- `AGENTS.md`와 `.github/copilot-instructions.md`는 이 파일을 가리키는 보조 진입점입니다.
- 정책, 세션, 문서, 스택 기준은 `.harness/`를 단일 진실 출처로 봅니다.

## 작업 원칙
- 작업 전 `npm run guard` 또는 최소 `npm run policy:impact`로 영향 범위를 확인합니다.
- 정책 문서, 스택 문서, `src/`를 변경하면 관련 반대편 문서/코드도 함께 검토합니다.
- 새 프로젝트 방향이 비어 있으면 구현보다 `.harness/project/bootstrap.md` 인터뷰를 먼저 진행합니다.
