# 다음 세션 리마인더

내일 세션을 열면 이 문서를 짧게 훑고 시작합니다.

## 마지막 세션 마감 상태 (2026-04-27)
- 일반화 하네스 ↔ 스택 프리셋 분리가 완료되었습니다 (B안 + A-1 호환 구조).
- `vue3-fsd` 스택 자산은 모두 `.harness/stacks/vue3-fsd/scaffold/`에 있으며 root는 스택-독립적입니다.
- 결정/이유는 `decision-log.md` 2026-04-27 항목 참고.
- 세션 종료 시점의 `npm run guard`는 적용/미적용 두 다 통과.

## 내일 가장 먼저 확인할 것
1. `npm run stack:status`로 현재 적용 상태 확인
2. 개발 재개가 필요하면 `npm run stack:apply` + `npm install`
3. 새 환경이면 `npm run hooks:install`
4. 작업 전 `npm run guard`

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
- 다른 스택으로 전환: `npm run stack:reset` → `profile.json`의 `activeStack` 변경 → `npm run stack:apply` → `npm install`
- 일반 하네스만 쓰고 싶을 때: `activeStack: "none"`으로 설정 (자동 lint/test/build 스킵)
- 새 스택 추가: `.harness/stacks/README.md`의 "신규 스택 추가 가이드" 따르기
- A-1 마이그레이션 결정: 스택 수 ≥ 2 또는 외부 공유 필요 시 고려

## 내일 시작용 한 줄
- **이제 이 저장소는 "프로젝트 시작점"이다. 도메인을 묻고 스택을 적용한 뒤 시작하라.**
