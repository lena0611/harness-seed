import { defineStore } from 'pinia'

import { getScaffoldStatus } from '@/core/application/get-scaffold-status'

interface ScaffoldStatusState {
  title: string
  summary: string
  highlights: string[]
}

export const useScaffoldStatusStore = defineStore('scaffoldStatus', {
  state: (): ScaffoldStatusState => ({
    title: '',
    summary: '',
    highlights: [],
  }),
  actions: {
    hydrate() {
      const status = getScaffoldStatus()

      this.title = status.title
      this.summary = status.summary
      this.highlights = [...status.highlights]
    },
  },
})
