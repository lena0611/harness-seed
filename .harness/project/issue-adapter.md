# 이슈 조회 설정 (issue-adapter.md) — 본체: 표준화 관문 조회

**커밋·푸시를 마친 뒤** 열린 하네스 관문(회사 미결정 사항) 요약 한 줄을 완료 보고에
덧붙입니다. 관문 이슈의 정본 맥락은
[standards-adoption-roadmap.md](./standards-adoption-roadmap.md)(참조)와
`ai-standard/docs`의 로드맵 정본입니다.

이 파일은 본체 저장소(seed-mode) 자신의 프로젝트 상태입니다 — init이 소비자에게
배포하지 않습니다(결정 82, `shouldIncludeInstallFile` 제외 + 회귀).

## ① 조회 방법 (필수)

에이전트는 push 완료 후 아래 명령을 그대로 한 번 실행합니다(읽기 전용).

```bash
[ -f .issue-adapter.env ] && DOCS_ISSUE_TOKEN_RO=$(sed -n 's/^DOCS_ISSUE_TOKEN_RO=//p' .issue-adapter.env | tr -d '\r')
curl --silent --header "PRIVATE-TOKEN: $DOCS_ISSUE_TOKEN_RO" "https://git.smartscore.kr/api/v4/projects/ai-standard%2Fdocs/issues?labels=%ED%95%98%EB%84%A4%EC%8A%A4%EA%B4%80%EB%AC%B8&state=opened&per_page=50"
```

- 프로젝트 식별은 숫자 ID 대신 URL 인코딩된 전체 경로(`ai-standard%2Fdocs`)를 씁니다.
- 라벨 쿼리 값은 `하네스관문`의 URL 인코딩입니다.
- 응답의 `iid`, `title`, `labels`(미결정/논의중), `milestone.title`을 사용합니다.

## ② 토큰 환경변수 (필수)

| 항목 | 값 |
| --- | --- |
| 환경변수 이름 | `DOCS_ISSUE_TOKEN_RO` |
| 권한 | 읽기 전용(`read_api`) — 개발자가 자기 계정에서 발급 |
| 파일 | 프로젝트 루트 `.issue-adapter.env` 한 줄: `DOCS_ISSUE_TOKEN_RO=<토큰 값>` (`.gitignore` 등록됨) |

토큰이 없거나 호출이 실패하면 요약 대신 "관문 조회 실패(원인)"라고 적습니다.
이슈 0건과 조회 실패는 다른 말입니다. 커밋·푸시 결과에는 영향이 없습니다.

### 토큰이 없을 때 (에이전트가 보고에 실어줄 안내)

> 저장소 루트에 `.issue-adapter.env` 파일을 만들고 한 줄을 넣으세요:
> `DOCS_ISSUE_TOKEN_RO=<토큰 값>` — GitLab Edit profile → Access tokens에서
> `read_api` 권한으로 직접 발급합니다. 이 파일은 git에 올라가지 않습니다.

## ③ 요약 형식 (필수)

```text
열린 하네스 관문 {전체}건 — 논의중 {논의중수} (#{번호 나열, 최대 5개})
```

- 0건이면: `열린 하네스 관문 없음`
- 본체 작업이 특정 관문과 겹칠 때(예: 이슈보드 기능 작업 중 관문 2 미결정)는
  요약 뒤에 그 관문 번호를 지목해 한 줄 덧붙입니다 — 미결정 영역을 밟는 작업임을
  개발자가 인지하게 하는 것이 이 어댑터의 존재 이유입니다.

## ④ "내 담당" 구분 (선택)

사용하지 않습니다 — 관문은 담당자가 아니라 결정 주체(권위개발자 그룹)의 것입니다.
