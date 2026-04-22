<script setup lang="ts">
import ScaffoldStatusCard from '@/features/scaffold-status/ui/ScaffoldStatusCard.vue'
import MainLayout from '@/widgets/main-layout/ui/MainLayout.vue'
</script>

<template>
  <MainLayout>
    <section class="page-header">
      <p class="page-header__eyebrow">bareunmal</p>
      <h1>기본 아키텍처 스캐폴드</h1>
      <p class="page-header__description">
        현재는 도메인 중립적인 기본 뼈대만 구성되어 있으며, 이후 실제 기능은 core부터 확장하면 됩니다.
      </p>
    </section>

    <ScaffoldStatusCard />
  </MainLayout>
</template>

<style scoped>
.page-header {
  margin-bottom: 2rem;
}

.page-header__eyebrow {
  margin: 0 0 0.75rem;
  color: #93c5fd;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.75rem);
}

.page-header__description {
  width: min(680px, 100%);
  margin: 1rem 0 0;
  color: #cbd5e1;
  font-size: 1.05rem;
}
</style>
