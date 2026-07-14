import { describe, expect, it, vi } from 'vitest'
import type { MemoryCaptureNotice } from '@shared/memory-capture'
import { createMockApi, emitMockMemoryCaptureNotice } from './mock'

const notice: MemoryCaptureNotice = {
  id: 'notice-1',
  projectId: 'p1',
  provider: 'claude',
  sourceSessionId: 'claude-session-1',
  outcome: 'created',
  scope: 'project',
  slug: 'package-manager',
  title: 'Package manager',
  summary: 'This project uses pnpm for installs and scripts.',
  reason: 'Needed whenever dependencies or build scripts change.',
  at: '2026-07-13T18:02:00.000Z',
}

describe('browser mock live Memory notice bridge', () => {
  it('subscribes, isolates a broken observer, and unsubscribes cleanly', () => {
    const api = createMockApi()
    const seen = vi.fn()
    api.memory.onCaptureNotice(() => { throw new Error('preview observer failed') })
    const off = api.memory.onCaptureNotice(seen)

    expect(() => emitMockMemoryCaptureNotice(notice)).not.toThrow()
    expect(seen).toHaveBeenCalledOnce()
    expect(seen).toHaveBeenCalledWith(notice)

    off()
    emitMockMemoryCaptureNotice({ ...notice, id: 'notice-2' })
    expect(seen).toHaveBeenCalledOnce()
  })
})
