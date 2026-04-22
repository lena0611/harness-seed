<script setup lang="ts">
import { onMounted } from 'vue'

import { useScaffoldStatus } from '@/adapters/vue/composables/useScaffoldStatus'

const { highlights, hydrate, summary, title } = useScaffoldStatus()

onMounted(() => {
  hydrate()
})
</script>

<template>
  <section class="status-card">
    <p class="eyebrow">Scaffold</p>
    <h2>{{ title }}</h2>
    <p class="summary">{{ summary }}</p>

    <ul>
      <li v-for="highlight in highlights" :key="highlight">
        {{ highlight }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.status-card {
  padding: 2rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 24px;
  background: rgba(15, 23, 42, 0.72);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.32);
}

.eyebrow {
  margin: 0 0 0.75rem;
  color: #60a5fa;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

h2 {
  margin: 0;
  font-size: clamp(1.75rem, 2vw, 2.25rem);
}

.summary {
  margin: 1rem 0 0;
  color: #cbd5e1;
}

ul {
  margin: 1.5rem 0 0;
  padding-left: 1.25rem;
  color: #dbeafe;
}

li + li {
  margin-top: 0.75rem;
}
</style>
