import { describe, expect, it } from 'vitest'

import { getScaffoldStatus } from '@/core/application/get-scaffold-status'

describe('getScaffoldStatus', () => {
  it('returns scaffold metadata for the starter screen', () => {
    const status = getScaffoldStatus()

    expect(status.title).toBe('기본 스캐폴드 준비 완료')
    expect(status.summary).toContain('Vue 3 + Pinia + Vite + TypeScript')
    expect(status.highlights.length).toBeGreaterThan(0)
  })
})
