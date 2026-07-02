import { describe, expect, it, vi } from 'vitest'
import { riskLevelFor } from '@shared/approval-rules'
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
 * Stateful in-memory stand-in for the approval_requests statements used by
 * request()/decide()/consume()/countPending(). Never imports better-sqlite3
 * (its native build targets Electron's ABI) — see force-push-gate.test.ts.
 */
function makeApprovalDb() {
  const rows = new Map<string, FakeApprovalRow>()
  const decideUpdates: unknown[][] = []
  const fake = {
    prepare(sql: string) {
      return {
        get: (...args: unknown[]) => {
          if (sql.includes('COUNT(*)')) {
            const projectId = args[0] as string
            let n = 0
            for (const r of rows.values()) {
              if (r.project_id === projectId && r.status === 'pending') n += 1
            }
            return { n }
          }
          return rows.get(args[0] as string)
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO approval_requests')) {
            const p = args[0] as Record<string, string>
            rows.set(p.id, {
              id: p.id,
              project_id: p.projectId,
              action_type: p.actionType,
              risk_level: p.riskLevel,
              command_or_payload_json: p.payload,
              summary: p.summary,
              status: p.status,
              created_at: p.createdAt,
              resolved_at: null,
            })
            return { changes: 1 }
          }
          if (sql.includes("SET status = 'consumed'")) {
            const id = args[args.length - 1] as string
            const row = rows.get(id)
            if (row && row.status === 'approved') {
              rows.set(id, { ...row, status: 'consumed' })
              return { changes: 1 }
            }
            return { changes: 0 }
          }
          if (sql.includes('SET status = ?')) {
            const [status, resolvedAt, id] = args as [string, string, string]
            const row = rows.get(id)
            if (!row) return { changes: 0 }
            rows.set(id, { ...row, status, resolved_at: resolvedAt })
            decideUpdates.push(args)
            return { changes: 1 }
          }
          throw new Error(`FakeDb: unexpected write: ${sql}`)
        },
        all: (...args: unknown[]) =>
          [...rows.values()].filter((r) => r.project_id === (args[0] as string)),
      }
    },
  }
  return { db: fake as unknown as Db, rows, decideUpdates }
}

function makeService() {
  const store = makeApprovalDb()
  const record = vi.fn()
  const audit = { record } as unknown as AuditLogService
  const events = new CockpitEvents()
  const changed = vi.fn()
  events.onTyped('approvals:changed', changed)
  const service = new ApprovalService(store.db, audit, events)
  return { service, store, record, changed }
}

const RAW_TOKEN = 'ghp_0123456789abcdefghij0123'

describe('ApprovalService.request', () => {
  it('creates a pending request with the shared risk classification', () => {
    const { service, store, record, changed } = makeService()
    const req = service.request({
      projectId: 'prj_1',
      actionType: 'git_force_push',
      summary: 'Force-push 2 commit(s) to origin/main',
    })

    expect(req.status).toBe('pending')
    expect(req.resolvedAt).toBeNull()
    expect(req.riskLevel).toBe(riskLevelFor('git_force_push'))
    expect(req.riskLevel).toBe('critical')

    const row = store.rows.get(req.id)
    expect(row).toMatchObject({
      project_id: 'prj_1',
      action_type: 'git_force_push',
      risk_level: 'critical',
      status: 'pending',
    })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'ai', actionType: 'approval.request:git_force_push' }),
    )
    expect(changed).toHaveBeenCalledWith({ projectId: 'prj_1' })
  })

  it('redacts secret payload values before persisting or auditing', () => {
    const { service, store, record } = makeService()
    const req = service.request({
      projectId: 'prj_1',
      actionType: 'env_write',
      summary: 'Write GITHUB_TOKEN',
      payload: { token: RAW_TOKEN, branch: 'main' },
    })

    // Returned request, persisted row, and audit payload all hold the mask.
    expect(req.payload).toEqual({ token: '[REDACTED]', branch: 'main' })
    const stored = store.rows.get(req.id)?.command_or_payload_json ?? ''
    expect(stored).toContain('[REDACTED]')
    expect(stored).not.toContain(RAW_TOKEN)
    expect(JSON.stringify(record.mock.calls)).not.toContain(RAW_TOKEN)
  })

  it('redacts secret-shaped values even under innocuous keys', () => {
    const { service } = makeService()
    const req = service.request({
      projectId: 'prj_1',
      actionType: 'shell_command',
      summary: 'Run a command',
      payload: { note: RAW_TOKEN, command: 'echo hi' },
    })
    expect(req.payload).toEqual({ note: '[REDACTED]', command: 'echo hi' })
  })
})

describe('ApprovalService.decide', () => {
  it('approve transitions pending → approved and records the decision', () => {
    const { service, store, record, changed } = makeService()
    const req = service.request({ projectId: 'prj_1', actionType: 'git_push', summary: 'Push' })

    const decided = service.decide(req.id, true)
    expect(decided.status).toBe('approved')
    expect(decided.resolvedAt).not.toBeNull()
    expect(store.rows.get(req.id)?.status).toBe('approved')
    expect(record).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: 'user', actionType: 'approval.approved:git_push' }),
    )
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('reject transitions pending → rejected', () => {
    const { service, store, record } = makeService()
    const req = service.request({ projectId: 'prj_1', actionType: 'deploy', summary: 'Deploy' })

    const decided = service.decide(req.id, false)
    expect(decided.status).toBe('rejected')
    expect(store.rows.get(req.id)?.status).toBe('rejected')
    expect(record).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: 'user', actionType: 'approval.rejected:deploy' }),
    )
  })

  it('is idempotent on an already-resolved request', () => {
    const { service, store, record } = makeService()
    const req = service.request({ projectId: 'prj_1', actionType: 'git_push', summary: 'Push' })
    service.decide(req.id, true)
    const auditCalls = record.mock.calls.length

    // A second, contradictory decision must not flip the stored outcome.
    const again = service.decide(req.id, false)
    expect(again.status).toBe('approved')
    expect(store.rows.get(req.id)?.status).toBe('approved')
    expect(store.decideUpdates).toHaveLength(1)
    expect(record.mock.calls.length).toBe(auditCalls)
  })

  it('throws for an unknown approval id', () => {
    const { service } = makeService()
    expect(() => service.decide('apr_missing', true)).toThrow(/not found/i)
  })
})

describe('ApprovalService lifecycle (request → decide → consume)', () => {
  it('an approval can only be consumed once, and only after approval', () => {
    const { service } = makeService()
    const req = service.request({
      projectId: 'prj_1',
      actionType: 'git_force_push',
      summary: 'Force-push',
    })
    const match = {
      approvalId: req.id,
      projectId: 'prj_1',
      actionType: 'git_force_push' as const,
    }

    expect(() => service.consume(match)).toThrow(/pending/i)
    service.decide(req.id, true)
    expect(() => service.consume(match)).not.toThrow()
    expect(() => service.consume(match)).toThrow(/consumed|new approval/i)
  })

  it('a rejected approval never authorizes execution', () => {
    const { service } = makeService()
    const req = service.request({
      projectId: 'prj_1',
      actionType: 'database_reset',
      summary: 'Reset DB',
    })
    service.decide(req.id, false)
    expect(() =>
      service.consume({
        approvalId: req.id,
        projectId: 'prj_1',
        actionType: 'database_reset',
      }),
    ).toThrow(/rejected|new approval/i)
  })

  it('countPending tracks only unresolved requests for the project', () => {
    const { service } = makeService()
    const a = service.request({ projectId: 'prj_1', actionType: 'git_push', summary: 'Push A' })
    service.request({ projectId: 'prj_1', actionType: 'deploy', summary: 'Deploy B' })
    service.request({ projectId: 'prj_other', actionType: 'deploy', summary: 'Elsewhere' })

    expect(service.countPending('prj_1')).toBe(2)
    service.decide(a.id, true)
    expect(service.countPending('prj_1')).toBe(1)
  })
})
