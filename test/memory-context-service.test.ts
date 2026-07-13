import { describe, expect, it, vi } from 'vitest'
import { MemoryContextService } from '../electron/main/services/MemoryContextService'

describe('MemoryContextService', () => {
  it('delivers a compact lookup contract to tool-capable agents without recording unread notes', () => {
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
      surface: 'terminal_codex',
      query: 'redesign the landing page',
    })

    expect(memory.listDocs).toHaveBeenCalledWith('prj_1')
    expect(result.receipt.status).toBe('ready')
    expect(result.receipt.delivery).toBe('lookup')
    expect(result.block).toContain('.cockpit-memory/')
    expect(result.block).not.toContain('copper type on an obsidian surface')
    expect(recalls.record).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'prj_1',
        actionType: 'memory.context_lookup',
        payload: expect.objectContaining({ contextId: 'memctx_fixed', delivery: 'lookup' }),
      }),
    )
  })

  it('searches project and global brains and records each recall against its owner', () => {
    const memory = { listDocs: vi.fn(() => []) }
    const globalMemory = {
      listDocs: vi.fn(() => [{
        name: 'global-visual-direction',
        updatedAt: '2026-07-10T12:00:00.000Z',
        content: 'Landing pages use copper type on an obsidian surface.',
      }]),
    }
    const recalls = { record: vi.fn() }
    const service = new MemoryContextService(
      memory,
      recalls,
      undefined,
      () => 'memctx_global',
      globalMemory,
    )

    const result = service.forTask({
      projectId: 'prj_1',
      surface: 'council_spec',
      query: 'landing page visual direction copper obsidian',
    })

    expect(globalMemory.listDocs).toHaveBeenCalledWith('baz-global')
    expect(result.receipt.notes[0]).toMatchObject({
      name: 'global-visual-direction',
      path: 'baz-memory/global-visual-direction.md',
      brain: 'global',
    })
    expect(recalls.record).toHaveBeenCalledWith(
      'baz-global',
      ['global-visual-direction'],
      'council_spec',
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
    expect(result.receipt.delivery).toBe('none')
    expect(result.block).toContain('MEMORY UNAVAILABLE')
    expect(result.block).toContain('do not claim it was loaded')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'memory.context_unavailable' }),
    )
  })
})
