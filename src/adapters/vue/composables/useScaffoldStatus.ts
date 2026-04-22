import { storeToRefs } from 'pinia'

import { useScaffoldStatusStore } from '@/adapters/vue/stores/scaffoldStatus.store'

export function useScaffoldStatus() {
  const store = useScaffoldStatusStore()
  const { highlights, summary, title } = storeToRefs(store)

  return {
    highlights,
    summary,
    title,
    hydrate: store.hydrate,
  }
}
