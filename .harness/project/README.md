# Project Harness

특정 도메인 기능을 시작하기 전에 프로젝트의 목적, 범위, 성공 기준을 정리하기 위한 공통 하네스입니다.

## 목적
- 프로젝트가 무엇을 해결하려는지 명시합니다.
- 앞으로 추가될 기능이 어떤 기준 아래에서 설계되어야 하는지 고정합니다.
- 새 세션에서 도메인 의사결정을 다시 추론하지 않도록 합니다.

## 수정 가이드

자주 직접 수정하는 문서:
- `project-charter.md`
- `scope-contract.md`
- `domain-rules.md`
- `architecture-rules.md`
- `workflow-rules.md`
- `commit-push-rules.md`
- `critical-paths.md`
- `../session/decision-log.md`
- `../session/active-context.md`
- `../session/manual-actions.md`

자동 생성 또는 하네스 관리 파일:
- `../install-manifest.json`
- `../harness-lock.json`
- `../.stack-applied.json`
- `../.template-applied.json`
- `../stacks/.applied/**`
- `../templates/.applied/**`
- `../session/project-scan-report.md`
- `../session/handoff.md`

자동 관리 파일은 직접 고치기보다 `harness:scan`, `harness:handoff`, `stack:apply`, `template:apply`, `harness:update` 같은 명령을 다시 실행합니다.

## 읽기 순서
1. [프로젝트 하네스 작성 가이드](./project-harness-guide.md)
2. [프로젝트 시작 인터뷰 (Bootstrap)](./bootstrap.md)
3. [프로젝트 헌장](./project-charter.md)
4. [범위 계약](./scope-contract.md)
5. [로컬 개발방법론](./local-methodology.md)
6. [개발 기준 계층](./standards-layers.md)
7. [개인 개발 기준 예시](./personal-methodology.example.md)
8. [스택 프리셋 로컬 규칙](./stack-preset-rules.md)
9. [템플릿 사용 계약](./template-contract.md)
10. [도메인 규칙](./domain-rules.md)
11. [아키텍처 규칙](./architecture-rules.md)
12. [작업 흐름 규칙](./workflow-rules.md)
13. [커밋/푸시 안전장치 규칙](./commit-push-rules.md)
14. [중요 경로 선언](./critical-paths.md)
15. [설정 계약](./config-contract.md)
16. [이식 가이드](./portability-guide.md)
17. [스택 프리셋 목록](../stacks/README.md)

## 운영 원칙
- 아직 비어 있는 항목은 빈 채로 두지 말고 `TBD`와 필요한 입력을 함께 적습니다.
- 프로젝트 방향이 정해지면 가장 먼저 이 하네스를 갱신합니다.
- policy 하네스와 세션 하네스보다 앞서 읽어야 하는 도메인 기준 문서입니다.
- 회사 공통, 스택, 템플릿, 프로젝트, 개인 기준의 계층과 충돌 해석 순서는 `standards-layers.md`에 따릅니다.
- 프로젝트 고유의 개발방법론은 `local-methodology.md`와 하위 규칙 문서에 보존합니다.
- 장애, 데이터 손상, 배포 실패, 사용자 주요 흐름에 영향을 주는 경로는 `critical-paths.md`에 등록합니다.
- 에이전트가 직접 처리할 수 없는 콘솔/계정/secret/capability 작업은 `../session/manual-actions.md`에 남깁니다.
- 프로젝트 하네스를 새로 만들거나 보강할 때는 `project-harness-guide.md`의 계층, 승격, 충돌 처리 기준을 따릅니다.
- 스택 프리셋을 적용하면 해당 프리셋의 지침은 `stack-preset-rules.md`에 로컬 규칙으로 정착됩니다.
- scaffold 템플릿을 적용하면 템플릿 코드의 사용 계약은 `template-contract.md`의 브리지로 연결하고, 전체 가이드는 템플릿 저장소의 문서가 소유합니다.
- 로컬 규칙이 비어 있으면 실제 버그 수정과 기능 개발 중 관찰한 반복 패턴을 후보로 기록하고, 사용자 확인이나 반복 근거가 쌓이면 `domain-rules.md`, `architecture-rules.md`, `workflow-rules.md`로 승격합니다.
- 하네스는 도메인 규칙을 임의로 발명하지 않습니다. 기존 코드, 반복 패턴, 사용자 확인을 근거로 프로젝트의 기억을 쌓습니다.
- 내용이 길어지면 이 문서는 인덱스 역할만 유지하고 상세 내용은 하위 문서로 분리합니다.
