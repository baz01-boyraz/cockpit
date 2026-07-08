import {
  SENTINEL_COOLDOWN_MS,
  buildSignal,
  shouldSuppress,
  type SentinelSignal,
} from '@shared/sentinel'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { logFatal } from '../logging'
import { newId, nowIso } from '../util/ids'

/**
 * Best-effort OS notification sink — the SAME shape the swarm's Faz 2.5 notifier
 * uses (`SwarmNotifier`), so Services.ts can hand both services one guarded
 * instance. Every call site wraps it in try/catch: a throwing/unsupported
 * notifier must never break a sensor.
 */
export type SentinelNotifier = (input: { title: string; body: string }) => void

interface SignalRow {
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
}

/** How far back the cooldown lookup scans same-fingerprint rows. Bounded so the
 *  dedup query never walks an unbounded history. */
const RECENT_FINGERPRINT_LIMIT = 20

/**
 * The sentinel: an always-on, LLM-FREE signal layer (Faz A). Sensors call
 * {@link report} fire-and-forget; the service dedups against a per-fingerprint
 * cooldown, persists the survivor, emits `sentinel:alert` to the renderer, and
 * (for `alert` severity only) fires a macOS notification.
 *
 * Contract: {@link report} NEVER throws to its caller. Sensors run on hot paths
 * (a log insert, a worker exit, an approval) and must not be endangered by a
 * failing signal write — any internal failure is logged and swallowed, returning
 * null. A later phase layers LLM triage on top; the seams are here, no LLM runs.
 */
export class SentinelService {
  private readonly insertStmt: ReturnType<Db['prepare']>

  constructor(
    private readonly db: Db,
    private readonly events: CockpitEvents,
    private readonly notifier?: SentinelNotifier,
  ) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO sentinel_signals
       (id, project_id, severity, source, title, summary, context, fingerprint, status, created_at)
       VALUES (@id, @projectId, @severity, @source, @title, @summary, @context, @fingerprint, @status, @createdAt)`,
    )
  }

  /**
   * Record a signal, or suppress it. Build → fingerprint → cooldown check
   * against recent same-fingerprint rows; a hit returns null (a suppressed toast
   * is invisible by design). Otherwise the signal is persisted, `sentinel:alert`
   * is emitted, and — for `alert` severity — a macOS notification fires
   * (isolated: a throwing notifier can never unwind the persisted signal). Any
   * unexpected internal failure logs and returns null; this method never throws.
   */
  report(input: {
    projectId: string
    severity: SentinelSignal['severity']
    source: SentinelSignal['source']
    title: string
    summary: string
    context?: string | null
  }): SentinelSignal | null {
    try {
      const now = nowIso()
      const signal = buildSignal({
        id: newId('sig'),
        projectId: input.projectId,
        severity: input.severity,
        source: input.source,
        title: input.title,
        summary: input.summary,
        context: input.context ?? null,
        createdAt: now,
      })

      const recent = this.db
        .prepare(
          `SELECT fingerprint, created_at AS createdAt FROM sentinel_signals
           WHERE project_id = ? AND fingerprint = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(input.projectId, signal.fingerprint, RECENT_FINGERPRINT_LIMIT) as {
        fingerprint: string
        createdAt: string
      }[]
      if (shouldSuppress(recent, signal, now, SENTINEL_COOLDOWN_MS)) return null

      this.insertStmt.run({
        id: signal.id,
        projectId: signal.projectId,
        severity: signal.severity,
        source: signal.source,
        title: signal.title,
        summary: signal.summary,
        context: signal.context,
        fingerprint: signal.fingerprint,
        status: signal.status,
        createdAt: signal.createdAt,
      })

      this.events.emitTyped('sentinel:alert', signal)

      if (signal.severity === 'alert') {
        try {
          this.notifier?.({ title: signal.title, body: signal.summary })
        } catch {
          // A host that refuses a notification must not break the persisted
          // signal or the event fan-out above (mirrors announceCompletion).
        }
      }
      return signal
    } catch (err) {
      // Sensors are fire-and-forget: a failed signal write is logged and
      // swallowed so the hot path (a log insert, a worker exit) is never at risk.
      logFatal('sentinel:report', err)
      return null
    }
  }

  /** The project's recent signals, newest first (the feed). */
  list(projectId: string, limit = 50): SentinelSignal[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sentinel_signals WHERE project_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit) as SignalRow[]
    return rows.map((r) => this.toSignal(r))
  }

  /**
   * Mark signals seen. Scoped by project in the WHERE clause so a caller can
   * never flip another project's rows; returns the number actually updated.
   */
  markSeen(projectId: string, ids: string[]): number {
    if (ids.length === 0) return 0
    const stmt = this.db.prepare(
      `UPDATE sentinel_signals SET status = 'seen'
       WHERE project_id = ? AND id = ? AND status = 'new'`,
    )
    let changed = 0
    const tx = this.db.transaction(() => {
      for (const id of ids) changed += stmt.run(projectId, id).changes
    })
    tx()
    return changed
  }

  /** How many of the project's signals are still unseen (the rail badge). */
  unseenCount(projectId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM sentinel_signals WHERE project_id = ? AND status = 'new'`,
      )
      .get(projectId) as { n: number }
    return row.n
  }

  private toSignal(row: SignalRow): SentinelSignal {
    return {
      id: row.id,
      projectId: row.project_id,
      severity: row.severity as SentinelSignal['severity'],
      source: row.source as SentinelSignal['source'],
      title: row.title,
      summary: row.summary,
      context: row.context,
      fingerprint: row.fingerprint,
      status: row.status as SentinelSignal['status'],
      createdAt: row.created_at,
    }
  }
}
