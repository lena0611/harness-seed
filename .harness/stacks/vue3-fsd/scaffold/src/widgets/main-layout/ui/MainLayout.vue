<template>
  <main class="layout">
    <div class="layout__inner">
      <slot />
    </div>
  </main>
</template>

<style scoped>
.layout {
  min-height: 100vh;
  padding: 3rem 1.5rem;
}

.layout__inner {
  width: min(960px, 100%);
  margin: 0 auto;
}
</style>
