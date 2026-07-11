import { describe, expect, it } from 'vitest'
import type { MemoryContextReceipt } from '@shared/memory-context'
import { memoryBadge } from './memoryBadge'

function receipt(over: Partial<MemoryContextReceipt>): MemoryContextReceipt {
  return {
    contextId: 'memctx_1',
    surface: 'claude_chat',
    status: 'ready',
    delivery: 'lookup',
    notes: [],
    characters: 100,
    ...over,
  }
}

describe('memoryBadge', () => {
  it('shows a proven read with the note count', () => {
    expect(memoryBadge(receipt({ evidence: { status: 'read', files: ['a.md', 'b.md'] } }))).toEqual({
      label: 'memory · read 2 notes',
      tone: 'ok',
    })
  })

  it('surfaces an ignored contract as a warning, never as success', () => {
    expect(memoryBadge(receipt({ evidence: { status: 'missing', files: [] } }))?.tone).toBe('warn')
  })

  it('reports an honest no-relevant-notes and empty-hub state as dim', () => {
    expect(memoryBadge(receipt({ evidence: { status: 'none', files: [] } }))?.tone).toBe('dim')
    expect(memoryBadge(receipt({ status: 'empty', delivery: 'none' }))?.tone).toBe('dim')
  })

  it('flags an unavailable hub and hides the badge without a receipt', () => {
    expect(memoryBadge(receipt({ status: 'unavailable' }))?.label).toBe('memory unavailable')
    expect(memoryBadge(undefined)).toBeNull()
  })
})
