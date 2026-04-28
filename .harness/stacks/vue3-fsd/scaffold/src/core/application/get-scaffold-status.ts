import type { ScaffoldStatus } from '@/core/domain/scaffold-status'

export function getScaffoldStatus(): ScaffoldStatus {
  return {
    title: '기본 스캐폴드 준비 완료',
    summary: '도메인 미정 상태에서도 바로 확장할 수 있는 Vue 3 + Pinia + Vite + TypeScript 골격입니다.',
    highlights: [
      'core/application에 프레임워크 독립 로직을 둡니다.',
      'adapters/vue에서 Pinia와 composable로 core를 연결합니다.',
      'pages/widgets/features는 UI 조합과 feature 단위 확장에 사용합니다.',
    ],
  }
}
