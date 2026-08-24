# 하네스 표준화 로드맵 참조

이 문서는 `ai-standard/docs`에 있는 표준화 로드맵 정본을 가리키는 참조 문서입니다.

원본:

- GitLab: `https://git.smartscore.kr/ai-standard/docs`
- 경로: `standards/harness-adoption-roadmap.md`
- 관문 이슈 보드: `https://git.smartscore.kr/ai-standard/docs/-/boards` (라벨 `하네스관문`, 컬럼: 미결정/논의중/닫힘=결정됨)
- 마일스톤(시간축): `https://git.smartscore.kr/ai-standard/docs/-/milestones` (M1~M5)

원칙:

- 로드맵 정본은 `ai-standard/docs`에서 관리합니다. `harness-seed`는 설치기이므로 회사 방향 문서를 소유하지 않습니다 (guiding-policy 참조 패턴과 동일).
- **결정은 이슈 닫기가 아니라 정본 문서의 커밋으로 확정됩니다.** 이슈는 논의 스레드, 보드·마일스톤은 파생 뷰입니다.
- 본체 작업 중 "이 기능이 미결정 관문에 걸리는가"가 궁금하면 관문 이슈를 조회합니다 — 이 저장소의 [issue-adapter.md](./issue-adapter.md)가 그 조회를 정의하며, push 완료 보고에도 열린 관문 요약 한 줄이 붙습니다.

요지 (정본의 뼈대만):

- 하네스는 팀 단위 안전장치(M0, 완료)에서 회사 규범이 필요한 국면으로 진입했습니다. 실증 3건(이슈보드 무중력 전환·verify 소유권 후퇴·견본 기각)이 근거입니다.
- M1 관문의 가시화 → M2 결정 주체·기록처 지정 → M3 파일럿(이슈보드 관점 1순위) → M4 실행화·전파 → M5 순환 운영.
- 규범이 생겨도 변하지 않는 것: 감독관 금지(결정 75), 필수 차단/운영 기본값 층 구분, 실증 없는 표준 금지, 산문 대신 검증.

본체 기능 단위 계획은 [body-roadmap.md](./body-roadmap.md)가 따로 소유합니다.
