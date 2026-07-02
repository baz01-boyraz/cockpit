import { describe, expect, it, vi } from 'vitest'
import { gitPushInputSchema } from '@shared/schemas'
import { ApprovalService } from '../electron/main/services/ApprovalService'
import { CockpitEvents } from '../electron/main/events'
import type { Db } from '../electron/main/db/Database'
import type { AuditLogService } from '../electron/main/services/AuditLogService'

interface FakeApprovalRow {
  id: string
  project_id: string
  action_type: string
  risk_level: string
  command_or_payload_json: string
  summary: string
  status: string
  created_at: string
  resolved_at: string | null
}

/**
 * Minimal in-memory stand-in for the two SQL statements `consume()` uses.
 * Tests never import better-sqlite3 (its native build targets Electron's ABI).
 */
function makeFakeDb(seed: FakeApprovalRow[]): Db {
  const rows = new Map(seed.map((r) => [r.id, { ...r }]))
  const fake = {
    prepare(sql: string) {
      return {
        get: (id: string) => rows.get(id),
        run: (...args: unknown[]) => {
          if (sql.includes("SET status = 'consumed'")) {
            const id = args[args.length - 1] as string
            const row = rows.get(id)
            if (row && row.status === 'approved') {
              rows.set(id, { ...row, status: 'consumed' })
              return { changes: 1 }
            }
            return { changes: 0 }
          }
          throw new Error(`FakeDb: unexpected write: ${sql}`)
        },
        all: () => [...rows.values()],
      }
    },
  }
  return fake as unknown as Db
}

function makeService(seed: FakeApprovalRow[]) {
  const audit = { record: vi.fn() } as unknown as AuditLogService
  const events = new CockpitEvents()
  const service = new ApprovalService(makeFakeDb(seed), audit, events)
  return { service, audit }
}

const approvedRow: FakeApprovalRow = {
  id: 'apr_ok',
  project_id: 'prj_1',
  action_type: 'git_force_push',
  risk_level: 'critical',
  command_or_payload_json: '{}',
  summary: 'Force-push 2 commit(s) to origin/main',
  status: 'approved',
  created_at: '2026-07-01T00:00:00.000Z',
  resolved_at: '2026-07-01T00:01:00.000Z',
}

describe('gitPushInputSchema (force-push requires an approval id)', () => {
  it('accepts a regular push without an approval', () => {
    expect(gitPushInputSchema.parse({ projectId: 'p' })).toMatchObject({ projectId: 'p' })
    expect(gitPushInputSchema.parse({ projectId: 'p', force: false })).toMatchObject({ force: false })
  })

  it('rejects force without an approvalId', () => {
    expect(() => gitPushInputSchema.parse({ projectId: 'p', force: true })).toThrow()
  })

  it('accepts force with an approvalId', () => {
    const out = gitPushInputSchema.parse({ projectId: 'p', force: true, approvalId: 'apr_1' })
    expect(out).toMatchObject({ force: true, approvalId: 'apr_1' })
  })
})

describe('ApprovalService.consume (execution-side gate)', () => {
  const match = { approvalId: 'apr_ok', projectId: 'prj_1', actionType: 'git_force_push' as const }

  it('consumes an approved request exactly once', () => {
    const { service, audit } = makeService([approvedRow])
    expect(() => service.consume(match)).not.toThrow()
    expect(audit.record).toHaveBeenCalledOnce()
    // Second use of the same approval must be refused.
    expect(() => service.consume(match)).toThrow(/consumed|used|new approval/i)
  })

  it('rejects a pending (not yet approved) request', () => {
    const { service } = makeService([{ ...approvedRow, status: 'pending', resolved_at: null }])
    expect(() => service.consume(match)).toThrow(/pending/i)
  })

  it('rejects a rejected request', () => {
    const { service } = makeService([{ ...approvedRow, status: 'rejected' }])
    expect(() => service.consume(match)).toThrow(/rejected|new approval/i)
  })

  it('rejects an approval that belongs to another project', () => {
    const { service } = makeService([{ ...approvedRow, project_id: 'prj_other' }])
    expect(() => service.consume(match)).toThrow(/match/i)
  })

  it('rejects an approval for a different action type', () => {
    const { service } = makeService([{ ...approvedRow, action_type: 'deploy' }])
    expect(() => service.consume(match)).toThrow(/match/i)
  })

  it('rejects an unknown approval id', () => {
    const { service } = makeService([])
    expect(() => service.consume(match)).toThrow(/not found/i)
  })
})
