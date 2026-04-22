# bareunmal

Vue 3 + Pinia + Vite + TypeScript 기반의 기본 스캐폴드입니다.

## 자동 배포
- `main` 브랜치에 푸시하면 GitHub Actions가 자동으로 빌드 후 GitHub Pages에 배포합니다.
- 배포 주소: `https://lena0611.github.io/bareunmal/`

## 세션 컨텍스트 하네스
- 새 세션에서 빠르게 컨텍스트를 복구하려면 `.github/session-harness/README.md`부터 읽습니다.
- 개발자 정보가 부족해 미완료된 항목은 `.github/session-harness/developer-input-queue.md`에서 새 세션마다 다시 확인합니다.

## 프로젝트 하네스
- 실제 도메인 정의 전에는 `.github/project-harness/README.md`와 `project-charter.md`를 먼저 확인합니다.

## 정책 동기화 하네스
- 정책 문서와 소스 변경의 상호 영향을 추적하려면 `.github/policy-harness/README.md`를 기준으로 작업합니다.
- 기본 명령:
```bash
npm run lint
npm run policy:impact
npm run policy:check
npm run policy:guard
npm run guard
```

## 문서 인덱싱 하네스
- 긴 문서는 한 파일에 누적하지 말고 `.github/documentation-harness/README.md` 기준으로 인덱스/세부 문서로 분리합니다.

## 스타일 하네스
- 코딩 스타일 규칙과 자동 검증 기준은 `.github/style-harness/README.md`를 따릅니다.

## 로컬 훅
```bash
npm run hooks:install
```

## 테스트
```bash
npm run test
```

## 시작하기
```bash
npm install
npm run dev
```

## 빌드
```bash
npm run build
```

## 구조
```text
src/
  app/
  pages/
  widgets/
  features/
  entities/
  shared/
  core/
    domain/
    application/
  adapters/
    vue/
      stores/
      composables/
```
