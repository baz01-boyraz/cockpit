import { randomUUID } from 'node:crypto'
import {
  CAPTURE_MAX_ATTEMPTS,
  CAPTURE_PROCESSING_STAGES,
  classifyCaptureFailure,
  type CaptureJob,
  type CaptureProcessingStage,
  type CaptureStatus,
} from '@shared/memory-capture'
import type { ResumableSessionProvider } from '@shared/domain'
import type { Db } from '../db/Database'

interface QueueRow {
  id: string
  project_id: string
  provider: string
  session_id: string
  source_path: string
  status: string
  last_offset: number
  attempts: number
  error: string | null
  next_retry_at: string | null
  guidance: string | null
  enqueued_at: string
  updated_at: string
}

const toJob = (r: QueueRow): CaptureJob => ({
  id: r.id,
  projectId: r.project_id,
  provider: r.provider as ResumableSessionProvider,
  sessionId: r.session_id,
  sourcePath: r.source_path,
  status: r.status as CaptureStatus,
  lastOffset: r.last_offset,
  attempts: r.attempts,
  error: r.error,
  nextRetryAt: r.next_retry_at,
  guidance: r.guidance,
  enqueuedAt: r.enqueued_at,
  updatedAt: r.updated_at,
})

export interface EnqueueInput {
  projectId: string
  provider: ResumableSessionProvider
  sessionId: string
  sourcePath: string
}

export interface CaptureFailureObserver {
  captureFailed(job: CaptureJob): void
}

interface CaptureQueueOptions {
  now?: () => Date
  retryBaseMs?: number
  retryMaxMs?: number
}

/**
 * Durable capture queue (docs/memory-imp.md G2 "never miss"). One row per
 * provider session. Enqueue is idempotent: a provider/session pair already
 * queued/processing is left alone; a done/errored session is re-armed to
 * 'queued' when it grows. A crash mid-processing is recovered on boot by
 * `recoverStuck()`. Nothing is processed in-memory only — the row is the truth.
 */
export class MemoryCaptureQueue {
  constructor(
    private readonly db: Db,
    private readonly observer?: CaptureFailureObserver,
    private readonly options: CaptureQueueOptions = {},
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private getBySession(
    provider: ResumableSessionProvider,
    sessionId: string,
  ): QueueRow | undefined {
    return this.db
      .prepare('SELECT * FROM memory_capture_queue WHERE provider = ? AND session_id = ?')
      .get(provider, sessionId) as QueueRow | undefined
  }

  /** Enqueue (or re-arm) a session. Returns the job in its post-enqueue state. */
  enqueue(input: EnqueueInput): CaptureJob {
    const now = new Date().toISOString()
    const existing = this.getBySession(input.provider, input.sessionId)
    if (!existing) {
      const row: QueueRow = {
        id: randomUUID(),
        project_id: input.projectId,
        provider: input.provider,
        session_id: input.sessionId,
        source_path: input.sourcePath,
        status: 'queued',
        last_offset: 0,
        attempts: 0,
        error: null,
        next_retry_at: null,
        guidance: null,
        enqueued_at: now,
        updated_at: now,
      }
      this.db
        .prepare(
          `INSERT INTO memory_capture_queue
             (id, project_id, provider, session_id, source_path, status, last_offset, attempts, error, next_retry_at, guidance, enqueued_at, updated_at)
           VALUES (@id, @project_id, @provider, @session_id, @source_path, @status, @last_offset, @attempts, @error, @next_retry_at, @guidance, @enqueued_at, @updated_at)`,
        )
        .run(row)
      return toJob(row)
    }
    // Already pending — leave it alone. Done/errored — re-arm to pick up growth.
    if (existing.status === 'done' || existing.status === 'error') {
      this.db
        .prepare(
          "UPDATE memory_capture_queue SET status = 'queued', attempts = 0, error = NULL, next_retry_at = NULL, guidance = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, existing.id)
      return {
        ...toJob(existing),
        status: 'queued',
        attempts: 0,
        error: null,
        nextRetryAt: null,
        guidance: null,
        updatedAt: now,
      }
    }
    return toJob(existing)
  }

  /** Claim the oldest ready job (marking it reading), or null when idle/backing off. */
  claimNext(): CaptureJob | null {
    const now = this.now().toISOString()
    const ready = this.db
      .prepare(
        "SELECT * FROM memory_capture_queue WHERE status = 'queued' OR (status = 'retry_wait' AND next_retry_at <= ?) ORDER BY enqueued_at ASC",
      )
      .all(now) as QueueRow[]
    const providerBlocks = new Set(
      (this.db
        .prepare("SELECT * FROM memory_capture_queue WHERE status = 'blocked'")
        .all() as QueueRow[])
        .filter((candidate) => classifyCaptureFailure(candidate.error ?? '').scope === 'provider')
        .map((candidate) => `${candidate.project_id}\u0000${candidate.provider}`),
    )
    const row = ready.find(
      (candidate) => !providerBlocks.has(`${candidate.project_id}\u0000${candidate.provider}`),
    )
    if (!row) return null
    this.db
      .prepare("UPDATE memory_capture_queue SET status = 'reading', next_retry_at = NULL, updated_at = ? WHERE id = ?")
      .run(now, row.id)
    return { ...toJob(row), status: 'reading', nextRetryAt: null, updatedAt: now }
  }

  updateStage(id: string, stage: CaptureProcessingStage): void {
    if (!(CAPTURE_PROCESSING_STAGES as readonly string[]).includes(stage)) {
      throw new Error(`Invalid capture stage: ${stage}`)
    }
    const row = this.db.prepare('SELECT * FROM memory_capture_queue WHERE id = ?').get(id) as
      | QueueRow
      | undefined
    if (!row || !(CAPTURE_PROCESSING_STAGES as readonly string[]).includes(row.status)) return
    this.db
      .prepare('UPDATE memory_capture_queue SET status = ?, updated_at = ? WHERE id = ?')
      .run(stage, this.now().toISOString(), id)
  }

  /** Mark a job done and advance its byte cursor. */
  complete(id: string, nextOffset: number): void {
    this.db
      .prepare("UPDATE memory_capture_queue SET status = 'done', last_offset = ?, attempts = 0, error = NULL, next_retry_at = NULL, guidance = NULL, updated_at = ? WHERE id = ?")
      .run(nextOffset, this.now().toISOString(), id)
  }

  /** Record a failure as blocked, scheduled retry, or exhausted terminal error. */
  fail(id: string, message: string): CaptureJob | null {
    const row = this.db.prepare('SELECT * FROM memory_capture_queue WHERE id = ?').get(id) as
      | QueueRow
      | undefined
    if (!row) return null
    const policy = classifyCaptureFailure(message)
    const attempts = policy.disposition === 'blocked' ? row.attempts : row.attempts + 1
    const status: CaptureStatus =
      policy.disposition === 'blocked'
        ? 'blocked'
        : attempts >= CAPTURE_MAX_ATTEMPTS
          ? 'error'
          : 'retry_wait'
    const now = this.now()
    const updatedAt = now.toISOString()
    const error = message.slice(0, 500)
    const retryBase = Math.max(1, this.options.retryBaseMs ?? 30_000)
    const retryMax = Math.max(retryBase, this.options.retryMaxMs ?? 15 * 60_000)
    const nextRetryAt =
      status === 'retry_wait'
        ? new Date(now.getTime() + Math.min(retryMax, retryBase * 2 ** Math.max(0, attempts - 1))).toISOString()
        : null
    const guidance = status === 'error'
      ? 'Automatic retries are exhausted. Check provider connectivity, then press Retry.'
      : policy.guidance
    this.db
      .prepare('UPDATE memory_capture_queue SET status = ?, attempts = ?, error = ?, next_retry_at = ?, guidance = ?, updated_at = ? WHERE id = ?')
      .run(status, attempts, error, nextRetryAt, guidance, updatedAt, id)
    const job: CaptureJob = {
      ...toJob(row),
      status,
      attempts,
      error,
      nextRetryAt,
      guidance,
      updatedAt,
    }
    try {
      this.observer?.captureFailed(job)
    } catch {
      // Queue durability never depends on the optional lifecycle observer.
    }
    return job
  }

  /** Explicit owner recovery after fixing a blocked/exhausted dependency. */
  retry(id: string): CaptureJob | null {
    const row = this.db.prepare('SELECT * FROM memory_capture_queue WHERE id = ?').get(id) as
      | QueueRow
      | undefined
    if (!row || !['blocked', 'error', 'retry_wait'].includes(row.status)) return row ? toJob(row) : null
    const updatedAt = this.now().toISOString()
    this.db
      .prepare("UPDATE memory_capture_queue SET status = 'queued', attempts = 0, error = NULL, next_retry_at = NULL, guidance = NULL, updated_at = ? WHERE id = ?")
      .run(updatedAt, id)
    return {
      ...toJob(row),
      status: 'queued',
      attempts: 0,
      error: null,
      nextRetryAt: null,
      guidance: null,
      updatedAt,
    }
  }

  /** Boot recovery: any row stuck in a live stage becomes queued. */
  recoverStuck(): number {
    const info = this.db
      .prepare("UPDATE memory_capture_queue SET status = 'queued', updated_at = ? WHERE status IN ('reading', 'distilling', 'reconciling', 'committing', 'processing')")
      .run(this.now().toISOString())
    return info.changes
  }

  /** The current job for a session, or null — lets the watcher check growth. */
  peek(provider: ResumableSessionProvider, sessionId: string): CaptureJob | null {
    const row = this.getBySession(provider, sessionId)
    return row ? toJob(row) : null
  }

  list(projectId: string): CaptureJob[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_capture_queue WHERE project_id = ? ORDER BY enqueued_at DESC')
      .all(projectId) as QueueRow[]
    return rows.map(toJob)
  }
}
