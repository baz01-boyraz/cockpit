import { describe, expect, it } from 'vitest'
import { SentinelService } from '../electron/main/services/SentinelService'
import { CockpitEvents } from '../electron/main/events'
import type { Db } from '../electron/main/db/Database'

/**
 * Track G3 (docs/plans/outcome-tracking-plan.md) — the user's RESPONSE to a
 * signal, recorded on the row so triage precision is measurable. These tests
 * lock the write's project-scoping, the read-back through `list`, and the
 * never-throws contract.
 */

interface Row {
  id: string
  project_id: string
  severity: string
  source: string
  title: string
  summary: string
  context: string | null
  fingerprint: string
  status: string
  created_at: string
  triage: string | null
  outcome: string | null
  outcome_at: string | null
}

/**
 * Stateful in-memory stand-in for the sentinel_signals statements — never imports
 * better-sqlite3 (native build targets Electron's ABI), matching the sibling
 * sentinel-service suite. Only the statements this suite exercises are modelled.
 */
function makeDb() {
  const rows: Row[] = []
  const fake = {
    transaction(fn: (...a: unknown[]) => unknown) {
      return (...a: unknown[]) => fn(...a)
    },
    prepare(sql: string) {
      return {
        run: (arg: unknown, ...rest: unknown[]) => {
          if (sql.startsWith('INSERT INTO sentinel_signals')) {
            const p = arg as Record<string, string | null>
            rows.push({
              id: String(p.id),
              project_id: String(p.projectId),
              severity: String(p.severity),
              source: String(p.source),
              title: String(p.title),
              summary: String(p.summary),
              context: p.context == null ? null : String(p.context),
              fingerprint: String(p.fingerprint),
              status: String(p.status),
              created_at: String(p.createdAt),
              triage: null,
              outcome: null,
              outcome_at: null,
            })
            return { changes: 1 }
          }
          if (sql.startsWith('UPDATE sentinel_signals SET outcome')) {
            const p = arg as { outcome: string; outcomeAt: string; projectId: string; id: string }
            const r = rows.find((x) => x.id === p.id && x.project_id === p.projectId)
            if (r) {
              r.outcome = p.outcome
              r.outcome_at = p.outcomeAt
              return { changes: 1 }
            }
            return { changes: 0 }
          }
          void rest
          return { changes: 0 }
        },
        get: () => undefined,
        all: (...args: unknown[]) => {
          if (sql.includes('AND fingerprint = ?')) {
            const [projectId, fingerprint] = args as [string, string]
            return rows
              .filter((r) => r.project_id === projectId && r.fingerprint === fingerprint)
              .map((r) => ({ fingerprint: r.fingerprint, createdAt: r.created_at }))
          }
          const projectId = args[0] as string
          return rows
            .filter((r) => r.project_id === projectId)
            .slice()
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
            .map((r) => ({ ...r }))
        },
      }
    },
  }
  return { db: fake as unknown as Db, rows }
}

const seed = (svc: SentinelService, projectId: string, title: string) =>
  svc.report({ projectId, severity: 'notice', source: 'approval', title, summary: 's' })!

describe('SentinelService.recordOutcome', () => {
  it('stamps outcome + outcome_at and list() reflects it', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    const sig = seed(svc, 'p1', 'dismiss me')

    expect(svc.recordOutcome('p1', sig.id, 'dismissed')).toBe(1)

    const row = store.rows.find((r) => r.id === sig.id)!
    expect(row.outcome).toBe('dismissed')
    expect(row.outcome_at).not.toBeNull()

    const listed = svc.list('p1')[0]
    expect(listed.outcome).toBe('dismissed')
    expect(listed.outcomeAt).toBe(row.outcome_at)
  })

  it('is project-scoped — a foreign project can never flip the row', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    const sig = seed(svc, 'p1', 'mine')

    // p2 asking to write p1's id changes nothing.
    expect(svc.recordOutcome('p2', sig.id, 'card_created')).toBe(0)
    expect(store.rows.find((r) => r.id === sig.id)!.outcome).toBeNull()

    // p1's own id writes.
    expect(svc.recordOutcome('p1', sig.id, 'card_created')).toBe(1)
    expect(store.rows.find((r) => r.id === sig.id)!.outcome).toBe('card_created')
  })

  it('returns 0 for an unknown id without throwing', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    expect(svc.recordOutcome('p1', 'sig_missing', 'acted')).toBe(0)
  })

  it('accepts the full outcome vocabulary and re-writes last-wins', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    const sig = seed(svc, 'p1', 'evolving')

    expect(svc.recordOutcome('p1', sig.id, 'card_created')).toBe(1)
    expect(svc.recordOutcome('p1', sig.id, 'acted')).toBe(1)
    expect(store.rows.find((r) => r.id === sig.id)!.outcome).toBe('acted')
  })

  it('never throws to the caller — a failing UPDATE returns 0', () => {
    const brokenDb = {
      transaction: (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => fn(...a),
      prepare: () => ({
        run: () => {
          throw new Error('disk full')
        },
        get: () => undefined,
        all: () => [],
      }),
    } as unknown as Db
    const svc = new SentinelService(brokenDb, new CockpitEvents())
    let result = -1
    expect(() => {
      result = svc.recordOutcome('p1', 'sig_x', 'dismissed')
    }).not.toThrow()
    expect(result).toBe(0)
  })
})
