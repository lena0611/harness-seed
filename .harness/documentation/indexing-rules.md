# 문서 인덱싱 규칙

## 1. 문서 역할 구분
- **인덱스 문서**: 문서군의 진입점, 짧은 설명, 목차 링크만 둡니다.
- **세부 문서**: 실제 기준, 절차, 상태, 예외, 예시를 담습니다.

## 2. 인덱스 문서 작성 규칙
- 문서군의 목적을 1~3문장으로 설명합니다.
- 세부 문서 링크를 순서대로 나열합니다.
- 길어지는 본문 설명은 넣지 않습니다.
- 가능한 한 “무엇을 읽어야 하는가”만 전달합니다.

## 3. 세부 문서 작성 규칙
- 한 문서에는 하나의 책임만 둡니다.
- 상태성 문서와 장기 규칙 문서를 섞지 않습니다.
- 절차 문서와 기준 문서를 섞지 않습니다.

## 4. 링크 규칙
- 같은 문서군 내부 링크는 상대 경로를 사용합니다.
- 새 세션에서 먼저 읽어야 하는 문서는 상위 인덱스 문서에 반드시 링크합니다.
- 문서를 분리하면 기존 진입 문서는 새 하위 문서 링크로 갱신합니다.

## 5. 자동 생성 스냅샷 예외
- `.harness/stacks/.applied/`는 `stack:apply`가 외부 스택 기준을 프로젝트에 정착시키기 위해 생성하는 스냅샷 영역입니다.
- 이 영역의 instruction 문서는 원격 스택 기준의 복사본이므로 `document-registry.json`에 등록하지 않습니다.
- doc-link 검사는 `.harness/stacks/.applied/` 아래 Markdown을 orphan 문서로 보지 않습니다.

## 6. 코드 경로 참조 검사 규칙
- doc-link 검사는 백틱으로 감싼 `src|scripts|.github|.harness|.claude|.githooks/` 경로를 코드 경로 참조로 보고 실제 존재를 확인합니다(`.harness/bin/doc-link-check.mjs`의 `codePathPattern`).
- 단 "특정 파일 참조"가 아닌 경로는 검사 대상에서 제외합니다(`isIgnorableCodePath`). 이 구분이 없으면 본체엔 우연히 존재하는 디렉토리가 소비자 환경에는 없어 환경 의존 오탐이 발생합니다.
  - glob/생략 표기: `*`, `...` 포함.
  - 디렉토리 예시: trailing slash로 끝나는 경로(`.github/workflows/`, `.harness/policy/`)는 "이런 위치를 보라"는 안내이지 파일 링크가 아닙니다.
  - 본체 CI 어댑터: `.github/workflows/` 하위는 소비자 프로젝트에 기본 주입되지 않으므로 소비자 환경에 없을 수 있어 검사하지 않습니다(본체에선 실제 존재하므로 검사해도 통과).
- 구체 파일 참조(`.harness/bin/guard.mjs` 등)는 계속 검사 대상입니다. 이 규칙이 바뀌면 `scripts/test-init.mjs`의 `isIgnorableCodePathClassifiesExamplesAndCiPaths`/`consumerDocLinkCheckIgnoresCiExamplePaths` 회귀를 함께 갱신합니다.
