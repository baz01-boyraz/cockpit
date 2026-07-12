import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../electron/main/db/Database'
import { SCHEMA_V20 } from '../electron/main/db/schema'
import { OperationalHealthStateStore } from '../electron/main/services/OperationalHealthStateStore'
import { makeRecordingDb } from './helpers/fakeDb'

const AT = '2026-07-12T12:00:00.000Z'

describe('OperationalHealthStateStore', () => {
  it('ships V20 as a project-scoped, bounded operational-state row', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(20)
    expect(SCHEMA_V20).toContain('CREATE TABLE IF NOT EXISTS operational_health_state')
    expect(SCHEMA_V20).toContain('project_id')
    expect(SCHEMA_V20).toContain('PRIMARY KEY')
    expect(SCHEMA_V20).toContain('last_result_json')
    expect(SCHEMA_V20).toContain('last_fingerprint')
    expect(SCHEMA_V20).toContain('last_digest_at')
  })

  it('claims atomically and refuses a live overlapping run', () => {
    let claimChanges = 1
    const rec = makeRecordingDb({
      run: (sql) => ({ changes: sql.includes('operational_health_state') ? claimChanges : 1 }),
      get: (sql) =>
        sql.includes('operational_health_state')
          ? {
              project_id: 'p1',
              status: 'running',
              last_run_at: null,
              last_result_json: null,
              last_fingerprint: null,
              last_notified_fingerprint: null,
              last_notified_at: null,
              last_digest_at: null,
              updated_at: AT,
            }
          : undefined,
    })
    const store = new OperationalHealthStateStore(rec.db)

    expect(store.claim('p1', AT)).toMatchObject({ projectId: 'p1', status: 'running' })
    const claimSql = rec.callsFor('run', 'INSERT INTO operational_health_state')[0].sql
    expect(claimSql).toContain('ON CONFLICT(project_id)')
    expect(claimSql).toContain("status != 'running'")

    claimChanges = 0
    expect(store.claim('p1', AT)).toBeNull()
  })

  it('persists only the bounded snapshot and all cadence/change metadata', () => {
    const rec = makeRecordingDb({
      get: () => ({
        project_id: 'p1',
        status: 'idle',
        last_run_at: AT,
        last_result_json: JSON.stringify({ fingerprint: 'healthy' }),
        last_fingerprint: 'healthy',
        last_notified_fingerprint: null,
        last_notified_at: null,
        last_digest_at: AT,
        updated_at: AT,
      }),
    })
    const store = new OperationalHealthStateStore(rec.db)
    const snapshot = {
      schema: 1 as const,
      projectId: 'p1',
      checkedAt: AT,
      git: { available: true, ahead: 0, behind: 0, changedFiles: 0, conflicts: 0, detached: false },
      quota: { availableProviders: 1, unavailableProviders: [], lowProviders: [], exhaustedProviders: [] },
      swarm: { inProgress: 0, missingWorkers: 0, stuckWorkers: 0, parked: 0, staleParked: 0, inReview: 0, liveReviewTerminals: 0 },
      processes: { reapedRecent: 0, unverifiedRecent: 0 },
      logs: { recentHigh: 0, recentCritical: 0, recurringHigh: 0 },
      approvals: { pending: 0, stale: 0 },
      memory: { queued: 0, processing: 0, stuckProcessing: 0, errors: 0, pendingReviews: 0, conflicts: 0, oldReviews: 0 },
      unavailableSensors: [],
      anomalies: [],
      fingerprint: 'healthy',
    }
    store.complete({
      projectId: 'p1',
      snapshot,
      at: AT,
      notifiedFingerprint: null,
      notifiedAt: null,
      digestAt: AT,
    })

    const write = rec.callsFor('run', 'UPDATE operational_health_state')[0]
    expect(write.args[0]).toMatchObject({
      projectId: 'p1',
      lastResult: JSON.stringify(snapshot),
      lastFingerprint: 'healthy',
      digestAt: AT,
    })
  })

  it('recovers stale running claims and can abandon a failed run without deleting history', () => {
    const rec = makeRecordingDb()
    const store = new OperationalHealthStateStore(rec.db)
    expect(store.recoverStale(AT)).toBe(1)
    store.abandon('p1', AT)

    expect(rec.callsFor('run', "status = 'idle'")).toHaveLength(2)
    expect(rec.calls.some((call) => /DELETE/i.test(call.sql))).toBe(false)
  })
})
