import type { OperationalHealthSnapshot } from '@shared/operational-health'
import { OPERATIONAL_HEALTH_POLICY } from '@shared/operational-health'
import type { Db } from '../db/Database'

export interface OperationalHealthState {
  projectId: string
  status: 'idle' | 'running'
  lastRunAt: string | null
  lastResult: OperationalHealthSnapshot | null
  lastFingerprint: string | null
  lastNotifiedFingerprint: string | null
  lastNotifiedAt: string | null
  lastDigestAt: string | null
  updatedAt: string
}

export interface OperationalHealthCompleteInput {
  projectId: string
  snapshot: OperationalHealthSnapshot
  at: string
  notifiedFingerprint?: string | null
  notifiedAt?: string | null
  digestAt?: string | null
}

/** Structural seam used by the scheduler and unit tests. */
export interface OperationalHealthStateRepository {
  claim(projectId: string, at: string): OperationalHealthState | null
  complete(input: OperationalHealthCompleteInput): OperationalHealthState
  abandon(projectId: string, at: string): void
  recoverStale(at: string): number
}

interface StateRow {
  project_id: string
  status: string
  last_run_at: string | null
  last_result_json: string | null
  last_fingerprint: string | null
  last_notified_fingerprint: string | null
  last_notified_at: string | null
  last_digest_at: string | null
  updated_at: string
}

const staleBefore = (at: string): string => {
  const parsed = Date.parse(at)
  const base = Number.isNaN(parsed) ? Date.now() : parsed
  return new Date(base - OPERATIONAL_HEALTH_POLICY.staleRunMs).toISOString()
}

/**
 * Persistent last-run/result/cadence metadata plus the cross-tick overlap lock.
 * Exactly one row exists per project, so scheduled sweeps never grow an audit-
 * style history table twice an hour.
 */
export class OperationalHealthStateStore implements OperationalHealthStateRepository {
  constructor(private readonly db: Db) {}

  claim(projectId: string, at: string): OperationalHealthState | null {
    const result = this.db
      .prepare(
        `INSERT INTO operational_health_state
           (project_id, status, last_run_at, last_result_json, last_fingerprint,
            last_notified_fingerprint, last_notified_at, last_digest_at, updated_at)
         VALUES (@projectId, 'running', NULL, NULL, NULL, NULL, NULL, NULL, @at)
         ON CONFLICT(project_id) DO UPDATE SET
           status = 'running', updated_at = excluded.updated_at
         WHERE operational_health_state.status != 'running'
            OR operational_health_state.updated_at <= @staleBefore`,
      )
      .run({ projectId, at, staleBefore: staleBefore(at) })
    if (result.changes !== 1) return null
    return this.get(projectId)
  }

  complete(input: OperationalHealthCompleteInput): OperationalHealthState {
    this.db
      .prepare(
        `UPDATE operational_health_state SET
           status = 'idle',
           last_run_at = @at,
           last_result_json = @lastResult,
           last_fingerprint = @lastFingerprint,
           last_notified_fingerprint = COALESCE(@notifiedFingerprint, last_notified_fingerprint),
           last_notified_at = COALESCE(@notifiedAt, last_notified_at),
           last_digest_at = COALESCE(@digestAt, last_digest_at),
           updated_at = @at
         WHERE project_id = @projectId`,
      )
      .run({
        projectId: input.projectId,
        at: input.at,
        lastResult: JSON.stringify(input.snapshot),
        lastFingerprint: input.snapshot.fingerprint,
        notifiedFingerprint: input.notifiedFingerprint ?? null,
        notifiedAt: input.notifiedAt ?? null,
        digestAt: input.digestAt ?? null,
      })
    const state = this.get(input.projectId)
    if (!state) throw new Error('Operational health state disappeared after completion.')
    return state
  }

  abandon(projectId: string, at: string): void {
    this.db
      .prepare(
        `UPDATE operational_health_state SET status = 'idle', updated_at = ?
         WHERE project_id = ? AND status = 'running'`,
      )
      .run(at, projectId)
  }

  recoverStale(at: string): number {
    return this.db
      .prepare(
        `UPDATE operational_health_state SET status = 'idle', updated_at = @at
         WHERE status = 'running' AND updated_at <= @staleBefore`,
      )
      .run({ at, staleBefore: staleBefore(at) }).changes
  }

  private get(projectId: string): OperationalHealthState | null {
    const row = this.db
      .prepare('SELECT * FROM operational_health_state WHERE project_id = ?')
      .get(projectId) as StateRow | undefined
    return row ? this.toState(row) : null
  }

  private toState(row: StateRow): OperationalHealthState {
    let lastResult: OperationalHealthSnapshot | null = null
    if (row.last_result_json) {
      try {
        lastResult = JSON.parse(row.last_result_json) as OperationalHealthSnapshot
      } catch {
        lastResult = null
      }
    }
    return {
      projectId: row.project_id,
      status: row.status === 'running' ? 'running' : 'idle',
      lastRunAt: row.last_run_at,
      lastResult,
      lastFingerprint: row.last_fingerprint,
      lastNotifiedFingerprint: row.last_notified_fingerprint,
      lastNotifiedAt: row.last_notified_at,
      lastDigestAt: row.last_digest_at,
      updatedAt: row.updated_at,
    }
  }
}
