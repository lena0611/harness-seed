# 다음 세션 리마인더

내일 세션을 열면 이 문서를 짧게 훑고 시작합니다.

## 마지막 세션 마감 상태 (2026-04-27)
- 일반화 하네스 ↔ 외부 스택 기준 런타임 분리가 완료되었습니다.
- 본체에는 특정 스택 기준이나 스택 템플릿이 없으며 root는 스택-독립적입니다.
- 결정/이유는 `decision-log.md` 2026-04-27 항목 참고.
- 세션 종료 시점의 `npm run harness:check`는 적용/미적용 두 다 통과.

## 내일 가장 먼저 확인할 것
1. `npm run stack:status`로 현재 적용 상태 확인
2. 스택 기준이 필요하면 `npm run standards:list` 후 `npm run stack:apply`
3. 새 환경이면 `npm run hooks:install`
4. 작업 전에는 `npm run harness:impact`로 영향 범위를 확인하고, `npm run harness:check`는 사용자가 최종 검증을 승인한 뒤 실행

## 아직 비어 있는 중요한 것
- 프로젝트가 해결하려는 핵심 문제
- 주요 사용자 또는 대상
- 성공 기준
- 비목표
- 프로젝트 개요 문서

## 내일 바로 이어서 하기 좋은 것
- `bootstrap.md` 인터뷰의 1단계(프로젝트 개요 7항목)를 개발자에게 질문
- `project-charter.md`와 `developer-input-queue.md` 동시 갱신
- 실제 첫 feature 후보를 정하고 `core` 기준 첫 use-case 설계 시작

## 알아둘 절차 (스택 관련)
- 스택 하네스 후보 조회: `npm run standards:list`
- 원격 스택 기준 적용: `npm run stack:apply -- --preset-git <repo-url> --ref <tag-or-branch>`
- 로컬 스택 기준 적용: `npm run stack:apply -- --preset-path <preset-dir>`
- scaffold 템플릿 후보 조회: `npm run templates:list`
- 원격 scaffold 템플릿 적용: `npm run template:apply -- --preset-git <repo-url> --ref <tag-or-branch>`
- 다른 스택으로 전환: `npm run stack:reset` → 새 기준 선택 → `npm run stack:apply`
- 공통 하네스만 쓰고 싶을 때: `activeStack: "none"`으로 설정 (자동 lint/test/build 스킵)
- 새 스택 기준 추가: 본체가 아니라 별도 스택 기준 저장소를 만들고 `.harness/stacks/README.md`의 외부 프리셋 계약을 따르기

## 내일 시작용 한 줄
- **이제 이 저장소는 "프로젝트 시작점"이다. 도메인을 묻고 스택을 적용한 뒤 시작하라.**
