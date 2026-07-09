import {
  SENTINEL_COOLDOWN_MS,
  buildSignal,
  shouldSuppress,
  type SentinelSignal,
  type SentinelTriage,
} from '@shared/sentinel'
import { gateMemoryWrite } from '@shared/memory-gate'
import { redactText } from '@shared/redaction'
import { projectBrain } from '@shared/memory-ledger'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { logFatal } from '../logging'
import { newId, nowIso, safeJson } from '../util/ids'
import type { MemoryReviewService } from './MemoryReviewService'

/**
 * The async triage seat (Faz B). Structural so a test can pass a fake and so the
 * spine never hard-depends on Hermes — absent, it degrades to the LLM-free spine.
 */
export interface SentinelTriager {
  triage(signal: SentinelSignal): Promise<SentinelTriage | null>
}

/** The review-queue write path the gotcha route reuses (the Faz C queue). */
export type SentinelReviewSink = Pick<MemoryReviewService, 'create'>

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
  triage: string | null
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
  private readonly triageStmt: ReturnType<Db['prepare']>

  constructor(
    private readonly db: Db,
    private readonly events: CockpitEvents,
    private readonly notifier?: SentinelNotifier,
    /**
     * Faz B collaborators — both optional. Absent, {@link report} behaves exactly
     * as the Faz A spine (persist → emit → notify) and never runs enrichment.
     */
    private readonly triager?: SentinelTriager,
    private readonly reviews?: SentinelReviewSink,
  ) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO sentinel_signals
       (id, project_id, severity, source, title, summary, context, fingerprint, status, created_at)
       VALUES (@id, @projectId, @severity, @source, @title, @summary, @context, @fingerprint, @status, @createdAt)`,
    )
    this.triageStmt = this.db.prepare(
      'UPDATE sentinel_signals SET triage = @triage WHERE id = @id',
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
      // Central redaction (argos L1): sensor text persists, reaches the
      // renderer, and — via triage — leaves the machine for OpenRouter. The
      // log-intelligence sensor redacts at ingest, but scrubbing here covers
      // every sensor (card titles, council questions) and every future one.
      const signal = buildSignal({
        id: newId('sig'),
        projectId: input.projectId,
        severity: input.severity,
        source: input.source,
        title: redactText(input.title),
        summary: redactText(input.summary),
        context: input.context ? redactText(input.context) : null,
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

      // Faz B: after the spine has fully surfaced a notice/alert, hand it to the
      // async triage seat fire-and-forget. `info` signals are feed-only and not
      // worth a model call. enrich() owns all its own error handling, so `void`
      // can never leak an unhandled rejection back onto this hot path.
      if (this.triager && (signal.severity === 'notice' || signal.severity === 'alert')) {
        void this.enrich(signal)
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

  /**
   * Enrich a just-persisted signal with an async Hermes triage verdict. Isolated
   * from {@link report}: every step is guarded and this method NEVER throws (it is
   * called via `void`, so a rejection would be an unhandled one). A null verdict
   * (Hermes missing/slow/wrong) is a no-op — the spine's original signal stands.
   *
   * On a non-null verdict it (a) persists the blob on the row, (b) re-emits
   * `sentinel:alert` with the enriched signal (same id — the renderer upserts by
   * id), (c) demotes a not-reportWorthy signal to 'seen' to clear badge pressure,
   * and (d) routes a gotcha candidate into the review queue through the charter
   * gate.
   */
  private async enrich(signal: SentinelSignal): Promise<void> {
    try {
      const triage = await this.triager?.triage(signal)
      if (!triage) return
      const enriched: SentinelSignal = { ...signal, triage }

      // (a) Persist the enrichment blob. A write failure must not stop the
      // re-emit below — the renderer still gets the enriched signal in-memory.
      try {
        this.triageStmt.run({ triage: JSON.stringify(triage), id: signal.id })
      } catch (err) {
        logFatal('sentinel:enrich:persist', err)
      }

      // (b) Re-emit under the same id so the feed/toast upserts in place.
      this.events.emitTyped('sentinel:alert', enriched)

      // (c) Quietly demote noise: the toast may already be up, but the unseen
      // badge should not press for something triage judged not worth reporting.
      if (triage.reportWorthy === false) {
        try {
          this.markSeen(signal.projectId, [signal.id])
        } catch (err) {
          logFatal('sentinel:enrich:demote', err)
        }
      }

      // (d) A reusable lesson → propose a memory note (human-reviewed, never auto).
      if (triage.gotchaCandidate === true) {
        this.routeGotcha(signal, triage)
      }
    } catch (err) {
      // Belt-and-braces: enrich is fire-and-forget, so nothing it does may ever
      // surface as an unhandled rejection or disturb the already-emitted signal.
      logFatal('sentinel:enrich', err)
    }
  }

  /**
   * Turn a gotcha-flagged signal into a memory-review proposal, routed THROUGH the
   * charter write-gate first (so a secret-shaped signal is dropped, never queued)
   * and into the SAME review queue the distiller/Hermes use — a human decides.
   * Never auto-commits; the sentinel proposes, it does not write memory.
   */
  private routeGotcha(signal: SentinelSignal, triage: SentinelTriage): void {
    if (!this.reviews) return
    try {
      const slug = `signal-${kebab(signal.title)}`
      const content = [
        signal.title,
        '',
        signal.summary,
        '',
        `Next: ${triage.action}`,
        '',
        `captured from sentinel signal ${signal.id}`,
      ].join('\n')

      // The gate here is the secret floor + charter shape check. We route to
      // review regardless of accept-vs-review (the sentinel never auto-commits),
      // so only a hard `reject` (secret) changes the outcome. existingNames is []
      // — the sentinel has no hub docs, and the human reviewer is the twin check.
      const gate = gateMemoryWrite({
        name: slug,
        content,
        justification: {
          sevenDayScenario: triage.action,
          dedupChecked: 'no-overlap',
          evidence: `sentinel signal ${signal.id}: ${signal.title}`,
        },
        existingNames: [],
      })
      if (gate.verdict === 'reject') return

      this.reviews.create({
        brain: projectBrain(signal.projectId),
        kind: 'new',
        slug,
        title: signal.title,
        proposedContent: content,
        reason: `sentinel gotcha candidate — ${triage.action}`,
        sourceId: signal.id,
      })
    } catch (err) {
      logFatal('sentinel:enrich:gotcha', err)
    }
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
      // The column holds our own JSON; safeJson guards against a corrupt row
      // rather than trusting it blindly.
      triage: row.triage ? safeJson<SentinelTriage | null>(row.triage, null) : null,
    }
  }
}

/** Kebab-case a title into a slug fragment for a `signal-…` note name. */
function kebab(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'untitled'
}
