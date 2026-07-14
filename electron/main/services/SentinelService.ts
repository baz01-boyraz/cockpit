import {
  SENTINEL_COOLDOWN_MS,
  buildSignal,
  shouldSuppress,
  type SentinelOutcome,
  type SentinelSignal,
  type SentinelTriage,
} from '@shared/sentinel'
import { gateMemoryWrite } from '@shared/memory-gate'
import { isNonActionableLogLine } from '@shared/log-sanitize'
import { redactText } from '@shared/redaction'
import { projectBrain } from '@shared/memory-ledger'
import { canAutoCommit, defaultTrustModeForBrain } from '@shared/memory-policy'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { logFatal } from '../logging'
import { newId, nowIso, safeJson } from '../util/ids'
import type { MemoryHubService } from './MemoryHubService'
import type { MemoryReviewService } from './MemoryReviewService'
import type { MemoryPolicyService } from './MemoryPolicyService'

/**
 * The optional async triage seat. Structural so tests can pass a fake and so the
 * spine never depends on a model provider — absent, it stays fully deterministic.
 */
export interface SentinelTriager {
  triage(signal: SentinelSignal): Promise<SentinelTriage | null>
}

/** The review-queue write path the gotcha route reuses (the Faz C queue). */
export type SentinelReviewSink = Pick<MemoryReviewService, 'create'>

/**
 * The hub write path the H3 recurrence gotcha reuses when the charter gate votes
 * `accept` (a justified, deduped, secret-free note lands directly). `list` feeds
 * the gate's twin check with the hub's existing note names. Structural + optional
 * so tests pass `undefined` and the spine never hard-depends on the hub.
 */
export type SentinelMemorySink = Pick<MemoryHubService, 'write' | 'list'>

/**
 * Best-effort OS notification sink — the SAME shape the swarm's Faz 2.5 notifier
 * uses (`SwarmNotifier`), so Services.ts can hand both services one guarded
 * instance. Every call site wraps it in try/catch: a throwing/unsupported
 * notifier must never break a sensor.
 */
export type SentinelNotifier = (input: { title: string; body: string }) => void

export interface SentinelReportInput {
  projectId: string
  severity: SentinelSignal['severity']
  source: SentinelSignal['source']
  title: string
  summary: string
  context?: string | null
  /** Optional machine identity; never replaces the human-facing title. */
  dedupKey?: string
}

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
  outcome: string | null
  outcome_at: string | null
}

/** How far back the cooldown lookup scans same-fingerprint rows. Bounded so the
 *  dedup query never walks an unbounded history. */
const RECENT_FINGERPRINT_LIMIT = 20

/**
 * Track H3 — how many times a dedup key must fire before a recurrence is worth a
 * memory gotcha. Each persisted occurrence is already >1 cooldown window apart
 * (within-window repeats are suppressed), so three PERSISTED rows means the same
 * fact has genuinely recurred across three separate windows — a real pattern, not
 * a burst. Constant by design (no per-project knob).
 */
export const GOTCHA_RECURRENCE_THRESHOLD = 3

/** Track H4 — the boot re-triage sweep only revisits rows younger than this. An
 *  older untriaged signal is stale news; retriaging it would spend a model call
 *  on something the owner has long moved past. */
const RETRIAGE_SWEEP_WINDOW_MS = 48 * 60 * 60_000

/** Track H4 — hard cap on how many untriaged rows one boot sweep re-enqueues, so
 *  a large backlog can never turn into an unbounded run of paid triage calls. */
const RETRIAGE_SWEEP_LIMIT = 50

/**
 * The sentinel: an always-on deterministic signal layer (Faz A). Sensors call
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
  /**
   * Track H3 — fingerprints that have already produced a recurrence gotcha this
   * PROCESS. In-memory by design: it dedupes the common case (many repeats in one
   * session route exactly one proposal). It is NOT persisted, so after a restart a
   * still-recurring key can route one further proposal — acceptable, because the
   * charter gate's twin check + the human review queue are the durable backstop
   * against a duplicate note ever landing.
   */
  private readonly gotchaFired = new Set<string>()

  constructor(
    private readonly db: Db,
    private readonly events: CockpitEvents,
    private readonly notifier?: SentinelNotifier,
    /**
     * Faz B collaborators — all optional. Absent, {@link report} behaves exactly
     * as the Faz A spine (persist → emit → notify) and never runs enrichment.
     */
    private readonly triager?: SentinelTriager,
    private readonly reviews?: SentinelReviewSink,
    /**
     * Track H3 — the hub write path for a `accept`-verdict recurrence gotcha.
     * Optional: absent, a would-be-accepted gotcha degrades to the review queue
     * (or is dropped if there is no queue either), never a bypass of the gate.
     */
    private readonly memory?: SentinelMemorySink,
    /** Brain policy keeps background writes honest even when Memory UI is closed. */
    private readonly memoryPolicy?: Pick<MemoryPolicyService, 'trustModeForBrain'>,
  ) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO sentinel_signals
       (id, project_id, severity, source, title, summary, context, fingerprint, status, created_at)
       VALUES (@id, @projectId, @severity, @source, @title, @summary, @context, @fingerprint, @status, @createdAt)`,
    )
    this.triageStmt = this.db.prepare(
      `UPDATE sentinel_signals SET triage = @triage
       WHERE id = @id AND project_id = @projectId AND triage IS NULL`,
    )
    // Track H4: in-flight triage is volatile (a fire-and-forget child on a hot
    // path), so a signal recorded just before a crash/quit can be left with a
    // null verdict forever. Re-enqueue recent untriaged notice/alert rows now.
    // Fire-and-forget and fully self-contained — a sweep failure can never break
    // boot, and it is serialized (never N parallel paid calls) inside.
    void this.retriageSweep()
  }

  /**
   * Record a signal, or suppress it. Build → fingerprint → cooldown check
   * against recent same-fingerprint rows; a hit returns null (a suppressed toast
   * is invisible by design). Otherwise the signal is persisted, `sentinel:alert`
   * is emitted, and — for `alert` severity — a macOS notification fires
   * (isolated: a throwing notifier can never unwind the persisted signal). Any
   * unexpected internal failure logs and returns null; this method never throws.
   */
  report(input: SentinelReportInput): SentinelSignal | null {
    const persisted = this.persist(input, 'sentinel:report')
    if (!persisted) return null
    const { signal, recent } = persisted

    this.events.emitTyped('sentinel:alert', signal)

    // Track H3: this persisted row is the Nth occurrence of its dedup key.
    const occurrences = recent.length + 1
    if (occurrences >= GOTCHA_RECURRENCE_THRESHOLD && !this.gotchaFired.has(signal.fingerprint)) {
      this.gotchaFired.add(signal.fingerprint)
      this.routeRecurrenceGotcha(signal, occurrences)
    }

    if (signal.severity === 'alert') this.notify(signal.title, signal.summary)

    // Standard notice/alert signals use the cheap Flash triager. A deliberately
    // staged completion bypasses this method and is interpreted by Pro instead.
    if (this.triager && (signal.severity === 'notice' || signal.severity === 'alert')) {
      void this.enrich(signal)
    }
    return signal
  }

  /**
   * Persist without emitting, notifying, or invoking the generic Flash triager.
   * Used when deterministic evidence must survive before an async specialist
   * interprets it. A duplicate replay returns null before any paid model work.
   */
  stage(input: SentinelReportInput): SentinelSignal | null {
    return this.persist(input, 'sentinel:stage')?.signal ?? null
  }

  /**
   * Publish one staged row after its specialist enrichment exists. Project scope
   * and `triage IS NULL` make this single-use; a replay cannot create a second
   * toast or native notification. Notice severity is intentionally notified here
   * because successful Swarm completion is an explicit Mac/app delivery event.
   */
  publishStaged(
    projectId: string,
    id: string,
    triage: SentinelTriage,
  ): SentinelSignal | null {
    try {
      const signal = this.get(projectId, id)
      if (!signal) return null
      if (signal.triage) return signal
      const changes = this.triageStmt.run({
        triage: JSON.stringify(triage),
        id,
        projectId,
      }).changes
      if (changes === 0) return this.get(projectId, id)
      const enriched = { ...signal, triage }
      this.events.emitTyped('sentinel:alert', enriched)
      this.notify(triage.headline, triage.action)
      return enriched
    } catch (err) {
      logFatal('sentinel:publishStaged', err)
      return null
    }
  }

  /** Oldest-first crash-recovery queue for specialist-owned staged signals. */
  pendingStaged(source: SentinelSignal['source'], limit = 20): SentinelSignal[] {
    try {
      const bounded = Math.max(1, Math.min(100, Math.floor(limit)))
      const rows = this.db
        .prepare(
          `SELECT * FROM sentinel_signals
           WHERE source = ? AND triage IS NULL AND status = 'new'
           ORDER BY created_at ASC LIMIT ?`,
        )
        .all(source, bounded) as SignalRow[]
      return rows.map((row) => this.toSignal(row))
    } catch (err) {
      logFatal('sentinel:pendingStaged', err)
      return []
    }
  }

  private persist(
    input: SentinelReportInput,
    logScope: string,
  ): { signal: SentinelSignal; recent: { fingerprint: string; createdAt: string }[] } | null {
    try {
      const now = nowIso()
      // Central redaction is the egress floor for every sensor and specialist.
      const signal = buildSignal({
        id: newId('sig'),
        projectId: input.projectId,
        severity: input.severity,
        source: input.source,
        title: redactText(input.title),
        summary: redactText(input.summary),
        context: input.context ? redactText(input.context) : null,
        dedupKey: input.dedupKey ? redactText(input.dedupKey) : undefined,
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
      return { signal, recent }
    } catch (err) {
      logFatal(logScope, err)
      return null
    }
  }

  private notify(title: string, body: string): void {
    try {
      this.notifier?.({ title, body })
    } catch {
      // A host that refuses notifications must never affect persisted state.
    }
  }

  /** The project's recent signals, newest first (the feed). */
  list(projectId: string, limit = 50): SentinelSignal[] {
    const bounded = Number.isFinite(limit)
      ? Math.max(1, Math.min(200, Math.floor(limit)))
      : 50
    // Over-fetch a small bounded window so legacy noise rows do not displace a
    // real signal at the requested edge. The evidence remains in SQLite; only
    // the owner-facing feed excludes signatures now known to be non-actionable.
    const scanLimit = Math.min(600, bounded * 3)
    const rows = this.db
      .prepare(
        `SELECT * FROM sentinel_signals WHERE project_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, scanLimit) as SignalRow[]
    return rows
      .filter((row) => this.isFeedVisibleRow(row))
      .slice(0, bounded)
      .map((row) => this.toSignal(row))
  }

  /**
   * One signal by id, scoped to its project (Track H1 — the signal→card path
   * reads the origin signal to compose the card spec). Project-scoped in the
   * WHERE clause so a caller can never read another project's row. Returns null
   * for an unknown/foreign id.
   */
  get(projectId: string, id: string): SentinelSignal | null {
    const row = this.db
      .prepare(`SELECT * FROM sentinel_signals WHERE id = ? AND project_id = ?`)
      .get(id, projectId) as SignalRow | undefined
    return row ? this.toSignal(row) : null
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

  /**
   * Record the user's response to a signal (Track G3) so triage precision is
   * measurable: 'dismissed' (noise), 'acted' (a linked card shipped), or
   * 'card_created' (a signal became a card). Scoped by project in the WHERE
   * clause so a caller can never touch another project's rows; a single UPDATE
   * stamps `outcome` + `outcome_at`. Returns the number of rows changed (0 when
   * the id is unknown or belongs to another project).
   *
   * NEVER throws: this rides UI paths (a bell "dismiss", a card-create hook) that
   * must not be endangered by a write failure — a failure is logged and 0 returned.
   */
  recordOutcome(projectId: string, id: string, outcome: SentinelOutcome): number {
    try {
      return this.db
        .prepare(
          `UPDATE sentinel_signals SET outcome = @outcome, outcome_at = @outcomeAt
           WHERE project_id = @projectId AND id = @id`,
        )
        .run({ outcome, outcomeAt: nowIso(), projectId, id }).changes
    } catch (err) {
      logFatal('sentinel:recordOutcome', err)
      return 0
    }
  }

  /**
   * Track H2 — fix verification. A signal-linked Swarm card just shipped. If the
   * origin signal's dedup key has NOT re-fired since the card was created (the fix
   * held), stamp outcome 'acted' and mark the signal seen — "resolved-quiet": the
   * bug is closed and the badge stops pressing. A same-fingerprint signal recorded
   * AFTER `cardCreatedAt` means the bug came back, so the card did not fix it;
   * leave the signal untouched. Returns true only when it resolved a signal.
   *
   * NEVER throws: this rides the swarm's card-shipped path (a user drag to Done)
   * that must not be endangered by a resolve failure — a failure logs and false.
   */
  resolveShippedSignal(input: { projectId: string; signalId: string; cardCreatedAt: string }): boolean {
    try {
      const origin = this.get(input.projectId, input.signalId)
      if (!origin) return false
      // Any newer same-fingerprint occurrence after the card was opened is a
      // re-fire — the fix did not hold, so this is not a resolution.
      const sameKey = this.db
        .prepare(
          `SELECT created_at AS createdAt FROM sentinel_signals
           WHERE project_id = ? AND fingerprint = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(input.projectId, origin.fingerprint, RECENT_FINGERPRINT_LIMIT) as {
        createdAt: string
      }[]
      const refired = sameKey.some((r) => r.createdAt > input.cardCreatedAt)
      if (refired) return false
      const tx = this.db.transaction(() => {
        this.recordOutcome(input.projectId, input.signalId, 'acted')
        // Quiet the badge: a resolved signal should not keep pressing. markSeen is
        // a no-op when the row is already seen, so this is safe either way.
        this.markSeen(input.projectId, [input.signalId])
      })
      tx()
      return true
    } catch (err) {
      logFatal('sentinel:resolveShippedSignal', err)
      return false
    }
  }

  /** How many of the project's signals are still unseen (the rail badge). */
  unseenCount(projectId: string): number {
    const rows = this.db
      .prepare(
        `SELECT source, context, status FROM sentinel_signals
         WHERE project_id = ? AND status = 'new'`,
      )
      .all(projectId) as Pick<SignalRow, 'source' | 'context' | 'status'>[]
    return rows.filter((row) => row.status === 'new' && this.isFeedVisibleRow(row)).length
  }

  /**
   * Enrich a just-persisted signal with an optional async triage verdict. Isolated
   * from {@link report}: every step is guarded and this method NEVER throws (it is
   * called via `void`, so a rejection would be an unhandled one). A null verdict
   * (provider unavailable/slow/invalid) is a no-op — the original signal stands.
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
      // (a) Persist the enrichment blob. A write failure must not stop the
      // re-emit below — the renderer still gets the enriched signal in-memory.
      try {
        const persisted = this.triageStmt.run({
          triage: JSON.stringify(triage),
          id: signal.id,
          projectId: signal.projectId,
        }).changes
        // A live enrich and the boot recovery sweep can race for the same row.
        // The scoped single-use UPDATE elects one publisher; the loser exits so
        // a signal cannot produce duplicate toasts/gotcha routes.
        if (persisted === 0) return
      } catch (err) {
        logFatal('sentinel:enrich:persist', err)
      }

      // (b) Quietly demote noise BEFORE the re-emit. The event must carry the
      // durable `seen` state; emitting `new` and demoting afterwards made the
      // renderer re-add badge pressure for the same signal id.
      if (triage.reportWorthy === false) {
        try {
          this.markSeen(signal.projectId, [signal.id])
        } catch (err) {
          logFatal('sentinel:enrich:demote', err)
        }
      }

      // (c) Re-emit under the same id so the feed/toast upserts in place. Read
      // the current row first: the owner may have marked it seen while triage
      // was in flight, and that state must not be resurrected as `new`.
      const current = this.get(signal.projectId, signal.id)
      const enriched: SentinelSignal = { ...(current ?? signal), triage }
      this.events.emitTyped('sentinel:alert', enriched)

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
   * and into the same review queue as session capture — a human decides.
   * Never auto-commits; the sentinel proposes, it does not write memory.
   */
  private routeGotcha(signal: SentinelSignal, triage: SentinelTriage): void {
    if (!this.reviews) return
    try {
      const slug = `signal-${kebab(signal.title)}`
      const existingNames = this.hubNoteNames(signal.projectId)
      // A recurrence note is a durable dedup key. Active twins need no second
      // proposal; archived twins are an explicit owner decision and must never
      // be resurrected or pushed back into the inbox by a later signal.
      if (existingNames.includes(slug)) return
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
      // so only a hard `reject` (secret) changes the outcome. The durable hub
      // twin check above keeps both active and archived notes out of this path.
      const gate = gateMemoryWrite({
        name: slug,
        content,
        justification: {
          sevenDayScenario: triage.action,
          dedupChecked: 'no-overlap',
          evidence: `sentinel signal ${signal.id}: ${signal.title}`,
        },
        existingNames,
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

  /**
   * Track H3 — a dedup key has recurred {@link GOTCHA_RECURRENCE_THRESHOLD} times;
   * turn it into a charter-compliant gotcha through the canonical write-gate.
   * The gate establishes quality; brain policy decides queue vs direct:
   *   - `reject` (secret-shaped) → dropped, never written;
   *   - `accept` (justified, deduped, secret-free) → written only when policy allows;
   *   - `review` (weak/twin/oversize, or no hub write path) → the review queue.
   * The note carries the VERBATIM symptom text (title + summary), per the charter
   * — a gotcha you cannot find by its error message is a dead memory. The signal
   * fields are already centrally redacted; the gate is defense in depth behind it.
   * Never throws — a routing failure must not disturb the persisted signal.
   */
  private routeRecurrenceGotcha(signal: SentinelSignal, occurrences: number): void {
    try {
      const slug = `signal-${kebab(signal.title)}`
      const existingNames = this.hubNoteNames(signal.projectId)
      // The slug is the durable recurrence identity. An active note already
      // captured the lesson; an archived one records the owner's decision to
      // retire it. Neither may be duplicated, overwritten, or re-queued.
      if (existingNames.includes(slug)) return
      const content = [
        `# ${signal.title}`,
        '',
        'Symptom (verbatim):',
        signal.title,
        signal.summary,
        '',
        `Recurred ${occurrences}× as a \`${signal.source}\` sentinel signal — a repeat-offender pattern worth remembering.`,
        '',
        `captured from recurring sentinel signal ${signal.id}`,
      ].join('\n')

      const gate = gateMemoryWrite({
        name: slug,
        content,
        justification: {
          sevenDayScenario: `This signal has recurred ${occurrences} times — the next time this exact symptom appears, this note names the known repeat pattern.`,
          dedupChecked: 'no-overlap',
          evidence: `sentinel signal ${signal.id} (${signal.source}) recurred ${occurrences} times`,
        },
        existingNames,
      })

      // Secret-shaped content never lands anywhere (the redaction floor already
      // masked the fields; this is the last-line refusal).
      if (gate.verdict === 'reject') return

      // Accept → a justified, deduped, secret-free note goes straight to disk,
      // but only when a hub write path exists; otherwise fall through to review.
      const brain = projectBrain(signal.projectId)
      const trustMode =
        this.memoryPolicy?.trustModeForBrain(brain) ?? defaultTrustModeForBrain(brain)
      if (gate.verdict === 'accept' && this.memory && canAutoCommit(trustMode, 'new')) {
        this.memory.write(signal.projectId, slug, content)
        return
      }

      // Review (or accept with no hub write path) → the human review queue, the
      // same queue session capture feeds. Nothing to do without a sink.
      if (!this.reviews) return
      this.reviews.create({
        brain,
        kind: 'new',
        slug,
        title: signal.title,
        proposedContent: content,
        reason: `recurring sentinel signal (${occurrences}×) — ${
          gate.reasons.join('; ') || `${trustMode} policy requires review`
        }`,
        sourceId: signal.id,
      })
    } catch (err) {
      logFatal('sentinel:recurrenceGotcha', err)
    }
  }

  /** The hub's existing note names for the gate's twin check — empty on any
   *  failure (or no hub), so a lookup problem degrades to no dedup, never a throw. */
  private hubNoteNames(projectId: string): string[] {
    try {
      const snapshot = this.memory?.list(projectId)
      return snapshot
        ? [...snapshot.notes, ...snapshot.archived].map((note) => note.name)
        : []
    } catch {
      return []
    }
  }

  /**
   * Track H4 — boot re-triage sweep. In-flight triage is fire-and-forget on a hot
   * path, so a notice/alert recorded just before the app died can be stranded with
   * a null verdict. This re-enqueues recent (< 48h) untriaged notice/alert rows,
   * newest first and hard-capped, running them ONE AT A TIME (never N parallel
   * paid calls — the argos lesson) so combined with any live triage the process
   * stays within the triage provider's own in-flight ceiling. Fully guarded
   * and fire-and-forget: it can never block or break boot, and a missing triager
   * makes it an immediate no-op.
   */
  private async retriageSweep(): Promise<void> {
    try {
      if (!this.triager) return
      const cutoff = new Date(Date.now() - RETRIAGE_SWEEP_WINDOW_MS).toISOString()
      const rows = this.db
        .prepare(
          `SELECT * FROM sentinel_signals
           WHERE triage IS NULL AND (severity = 'notice' OR severity = 'alert')
             AND source != 'swarm-completion'
             AND created_at >= ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(cutoff, RETRIAGE_SWEEP_LIMIT) as SignalRow[]
      for (const row of rows) {
        if (!this.isFeedVisibleRow(row)) continue
        // Serialized on purpose: await each enrich before the next so the sweep
        // adds at most one in-flight triage at a time (no parallel fan-out of
        // paid model calls). enrich() owns all its own error handling.
        await this.enrich(this.toSignal(row))
      }
    } catch (err) {
      logFatal('sentinel:retriageSweep', err)
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
      // Track G3: the user's response, or null when unanswered. A legacy/garbage
      // value degrades to null rather than leaking a non-vocabulary string.
      outcome: isSentinelOutcome(row.outcome) ? row.outcome : null,
      outcomeAt: row.outcome_at,
    }
  }

  /** A historical misclassification stays queryable in the append-only table,
   * but no longer pressures the feed, badge, triage provider, or scorecard. */
  private isFeedVisibleRow(row: Pick<SignalRow, 'source' | 'context'>): boolean {
    return !(
      row.source === 'log-intelligence' &&
      row.context !== null &&
      isNonActionableLogLine(row.context)
    )
  }
}

/** Narrow a stored column to the closed outcome vocabulary (Track G3). */
function isSentinelOutcome(value: string | null): value is SentinelOutcome {
  return value === 'dismissed' || value === 'acted' || value === 'card_created'
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
