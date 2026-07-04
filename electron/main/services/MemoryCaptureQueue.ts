import { randomUUID } from 'node:crypto'
import { CAPTURE_MAX_ATTEMPTS, type CaptureJob, type CaptureStatus } from '@shared/memory-capture'
import type { Db } from '../db/Database'

interface QueueRow {
  id: string
  project_id: string
  session_id: string
  source_path: string
  status: string
  last_offset: number
  attempts: number
  error: string | null
  enqueued_at: string
  updated_at: string
}

const toJob = (r: QueueRow): CaptureJob => ({
  id: r.id,
  projectId: r.project_id,
  sessionId: r.session_id,
  sourcePath: r.source_path,
  status: r.status as CaptureStatus,
  lastOffset: r.last_offset,
  attempts: r.attempts,
  error: r.error,
  enqueuedAt: r.enqueued_at,
  updatedAt: r.updated_at,
})

export interface EnqueueInput {
  projectId: string
  sessionId: string
  sourcePath: string
}

/**
 * Durable capture queue (docs/memory-imp.md G2 "never miss"). One row per
 * session (session_id is unique). Enqueue is idempotent: a session already
 * queued/processing is left alone; a done/errored session is re-armed to
 * 'queued' when it grows. A crash mid-processing is recovered on boot by
 * `recoverStuck()`. Nothing is processed in-memory only — the row is the truth.
 */
export class MemoryCaptureQueue {
  constructor(private readonly db: Db) {}

  private getBySession(sessionId: string): QueueRow | undefined {
    return this.db
      .prepare('SELECT * FROM memory_capture_queue WHERE session_id = ?')
      .get(sessionId) as QueueRow | undefined
  }

  /** Enqueue (or re-arm) a session. Returns the job in its post-enqueue state. */
  enqueue(input: EnqueueInput): CaptureJob {
    const now = new Date().toISOString()
    const existing = this.getBySession(input.sessionId)
    if (!existing) {
      const row: QueueRow = {
        id: randomUUID(),
        project_id: input.projectId,
        session_id: input.sessionId,
        source_path: input.sourcePath,
        status: 'queued',
        last_offset: 0,
        attempts: 0,
        error: null,
        enqueued_at: now,
        updated_at: now,
      }
      this.db
        .prepare(
          `INSERT INTO memory_capture_queue
             (id, project_id, session_id, source_path, status, last_offset, attempts, error, enqueued_at, updated_at)
           VALUES (@id, @project_id, @session_id, @source_path, @status, @last_offset, @attempts, @error, @enqueued_at, @updated_at)`,
        )
        .run(row)
      return toJob(row)
    }
    // Already pending — leave it alone. Done/errored — re-arm to pick up growth.
    if (existing.status === 'done' || existing.status === 'error') {
      this.db
        .prepare(
          "UPDATE memory_capture_queue SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?",
        )
        .run(now, existing.id)
      return { ...toJob(existing), status: 'queued', error: null, updatedAt: now }
    }
    return toJob(existing)
  }

  /** Claim the oldest queued job (marking it processing), or null when idle. */
  claimNext(): CaptureJob | null {
    const row = this.db
      .prepare("SELECT * FROM memory_capture_queue WHERE status = 'queued' ORDER BY enqueued_at ASC LIMIT 1")
      .get() as QueueRow | undefined
    if (!row) return null
    const now = new Date().toISOString()
    this.db
      .prepare("UPDATE memory_capture_queue SET status = 'processing', updated_at = ? WHERE id = ?")
      .run(now, row.id)
    return { ...toJob(row), status: 'processing', updatedAt: now }
  }

  /** Mark a job done and advance its byte cursor. */
  complete(id: string, nextOffset: number): void {
    this.db
      .prepare("UPDATE memory_capture_queue SET status = 'done', last_offset = ?, updated_at = ? WHERE id = ?")
      .run(nextOffset, new Date().toISOString(), id)
  }

  /** Record a failure; retry (queued) until the attempt ceiling, then 'error'. */
  fail(id: string, message: string): void {
    const row = this.db.prepare('SELECT * FROM memory_capture_queue WHERE id = ?').get(id) as
      | QueueRow
      | undefined
    if (!row) return
    const attempts = row.attempts + 1
    const status: CaptureStatus = attempts >= CAPTURE_MAX_ATTEMPTS ? 'error' : 'queued'
    this.db
      .prepare('UPDATE memory_capture_queue SET status = ?, attempts = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, attempts, message.slice(0, 500), new Date().toISOString(), id)
  }

  /** Boot recovery: any row stuck 'processing' (crash mid-run) becomes 'queued'. */
  recoverStuck(): number {
    const info = this.db
      .prepare("UPDATE memory_capture_queue SET status = 'queued', updated_at = ? WHERE status = 'processing'")
      .run(new Date().toISOString())
    return info.changes
  }

  /** The current job for a session, or null — lets the watcher check growth. */
  peek(sessionId: string): CaptureJob | null {
    const row = this.getBySession(sessionId)
    return row ? toJob(row) : null
  }

  list(projectId: string): CaptureJob[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_capture_queue WHERE project_id = ? ORDER BY enqueued_at DESC')
      .all(projectId) as QueueRow[]
    return rows.map(toJob)
  }
}
