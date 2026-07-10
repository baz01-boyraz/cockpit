import { describe, expect, it, vi } from 'vitest'
import { MemoryContextService } from '../electron/main/services/MemoryContextService'

describe('MemoryContextService', () => {
  it('reads the hub for every task, records delivered notes, and writes a receipt audit', () => {
    const memory = {
      listDocs: vi.fn(() => [
        {
          name: 'landing-page-direction',
          updatedAt: '2026-07-10T12:00:00.000Z',
          content: 'The landing page uses copper type on an obsidian surface.',
        },
      ]),
    }
    const recalls = { record: vi.fn() }
    const audit = { record: vi.fn() }
    const service = new MemoryContextService(memory, recalls, audit, () => 'memctx_fixed')

    const result = service.forTask({
      projectId: 'prj_1',
      surface: 'hermes_chat',
      query: 'redesign the landing page',
    })

    expect(memory.listDocs).toHaveBeenCalledWith('prj_1')
    expect(result.receipt.status).toBe('ready')
    expect(result.block).toContain('copper type on an obsidian surface')
    expect(recalls.record).toHaveBeenCalledWith(
      'project:prj_1',
      ['landing-page-direction'],
      'hermes_chat',
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'prj_1',
        actionType: 'memory.context_delivered',
        payload: expect.objectContaining({ contextId: 'memctx_fixed' }),
      }),
    )
  })

  it('turns a hub read failure into a loud unavailable receipt', () => {
    const memory = { listDocs: vi.fn(() => { throw new Error('hub unreadable') }) }
    const audit = { record: vi.fn() }
    const service = new MemoryContextService(memory, undefined, audit, () => 'memctx_failed')

    const result = service.forTask({
      projectId: 'prj_1',
      surface: 'council_diff',
      query: 'review landing page changes',
    })

    expect(result.receipt.status).toBe('unavailable')
    expect(result.block).toContain('status: unavailable')
    expect(result.block).toContain('Do not claim that project memory was loaded')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'memory.context_unavailable' }),
    )
  })
})
