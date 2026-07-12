import { describe, expect, it, vi } from 'vitest'
import type { Db } from '../electron/main/db/Database'
import { AuditLogService } from '../electron/main/services/AuditLogService'

function fakeDb(): Db {
  return {
    prepare: () => ({
      run: () => ({ changes: 1 }),
      get: () => undefined,
      all: () => [],
    }),
  } as unknown as Db
}

describe('AuditLogService subscriptions', () => {
  it('notifies after durable insert, isolates a bad listener, and supports unsubscribe', () => {
    const audit = new AuditLogService(fakeDb())
    const seen = vi.fn()
    audit.subscribe(() => {
      throw new Error('observer bug')
    })
    const off = audit.subscribe(seen)

    expect(() =>
      audit.record({
        projectId: 'p1',
        actor: 'system',
        actionType: 'memory.compliance_missing',
        summary: 'missing',
      }),
    ).not.toThrow()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0]).toMatchObject({ actionType: 'memory.compliance_missing' })

    off()
    audit.record({ projectId: 'p1', actor: 'system', actionType: 'x', summary: 'x' })
    expect(seen).toHaveBeenCalledTimes(1)
  })
})
