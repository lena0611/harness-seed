# Changelog

하네스 본체의 릴리스 변경사항을 기록합니다.

`CHANGELOG.md`는 하네스 본체 변경 이력입니다. 설치된 소비자 프로젝트의 판단 기록은 `.harness/session/decision-log.md`에 남깁니다.

## 0.2.29 - 2026-05-18

- `--force` 단독 실행 시 프로젝트 소유 파일 덮어쓰기 위험을 안내하고 중단하도록 변경했습니다.
- 실제 덮어쓰기는 `--force --confirm-overwrite-project-files`로 위험 인지를 명시해야 진행됩니다.
- `harness:update`에서도 같은 확인 규칙을 적용했습니다.

## 0.2.28 - 2026-05-18

- 소비자 프로젝트에 본체 세션 기록이 복사되지 않도록 분리했습니다.
- `active-context.md`, `decision-log.md`, `developer-input-queue.md`, `next-session-reminder.md`, `project-memory.md`는 설치 시 소비자 프로젝트용 템플릿으로 생성합니다.
- 과거 버전에서 본체 세션 문서가 그대로 복사되었고 사용자가 수정하지 않은 경우, 업데이트 시 소비자 프로젝트용 템플릿으로 교체합니다.
- 소비자 프로젝트의 `decision-log.md`가 릴리스 노트가 아니라 프로젝트별 기준 충돌과 선택 이유를 기록하는 문서임을 명확히 했습니다.
