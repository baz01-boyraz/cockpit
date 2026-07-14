import { describe, expect, it, vi } from 'vitest'
import { MemoryCaptureQueue } from '../electron/main/services/MemoryCaptureQueue'
import type { Db } from '../electron/main/db/Database'

interface Row {
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

/** Stateful fake covering exactly the statements MemoryCaptureQueue issues. */
function makeQueueDb() {
  const rows: Row[] = []
  const fake = {
    prepare(sql: string) {
      return {
        get: (...args: unknown[]) => {
          if (sql.includes('WHERE provider = ? AND session_id = ?')) {
            return rows.find((r) => r.provider === args[0] && r.session_id === args[1])
          }
          if (sql.includes('WHERE id = ?')) return rows.find((r) => r.id === args[0])
          if (sql.includes("status = 'queued' OR")) {
            const now = String(args[0])
            return [...rows]
              .filter((r) => r.status === 'queued' || (r.status === 'retry_wait' && Boolean(r.next_retry_at && r.next_retry_at <= now)))
              .sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))[0]
          }
          return undefined
        },
        all: (...args: unknown[]) => {
          if (sql.includes("status = 'queued' OR")) {
            const now = String(args[0])
            return [...rows]
              .filter((r) => r.status === 'queued' || (r.status === 'retry_wait' && Boolean(r.next_retry_at && r.next_retry_at <= now)))
              .sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))
          }
          if (sql.includes("WHERE status = 'blocked'")) {
            return rows.filter((r) => r.status === 'blocked')
          }
          return rows.filter((r) => r.project_id === args[0])
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO memory_capture_queue')) {
            rows.push({ ...(args[0] as Row) })
            return { changes: 1 }
          }
          if (sql.includes("SET status = 'queued', attempts = 0")) {
            const r = rows.find((x) => x.id === args[1])
            if (r) {
              r.status = 'queued'; r.attempts = 0; r.error = null; r.next_retry_at = null
              r.guidance = null; r.updated_at = args[0] as string
            }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes("SET status = 'reading'")) {
            const r = rows.find((x) => x.id === args[1])
            if (r) { r.status = 'reading'; r.next_retry_at = null; r.updated_at = args[0] as string }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes("SET status = 'done'")) {
            const r = rows.find((x) => x.id === args[2])
            if (r) { r.status = 'done'; r.last_offset = args[0] as number; r.updated_at = args[1] as string }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes('SET status = ?, attempts = ?')) {
            const r = rows.find((x) => x.id === args[6])
            if (r) {
              r.status = args[0] as string; r.attempts = args[1] as number
              r.error = args[2] as string; r.next_retry_at = args[3] as string | null
              r.guidance = args[4] as string | null; r.updated_at = args[5] as string
            }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes('SET status = ?, updated_at = ?')) {
            const r = rows.find((x) => x.id === args[2])
            if (r) { r.status = args[0] as string; r.updated_at = args[1] as string }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes("WHERE status IN ('reading'")) {
            let n = 0
            for (const r of rows) if (['reading', 'distilling', 'reconciling', 'committing', 'processing'].includes(r.status)) { r.status = 'queued'; n++ }
            return { changes: n }
          }
          return { changes: 0 }
        },
      }
    },
  }
  return { db: fake as unknown as Db, rows }
}

const input = { projectId: 'p1', provider: 'claude' as const, sessionId: 's1', sourcePath: '/x/s1.jsonl' }

describe('MemoryCaptureQueue', () => {
  it('enqueues a new session as queued', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    const job = q.enqueue(input)
    expect(job.status).toBe('queued')
    expect(job.provider).toBe('claude')
    expect(job.sessionId).toBe('s1')
  })

  it('is idempotent — enqueuing a pending session does not duplicate', () => {
    const { db, rows } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    q.enqueue(input)
    expect(rows).toHaveLength(1)
  })

  it('keeps the same native session id distinct across providers', () => {
    const { db, rows } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    q.enqueue({ ...input, provider: 'codex', sourcePath: '/codex/s1.jsonl' })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.provider).sort()).toEqual(['claude', 'codex'])
  })

  it('re-arms a done session so growth is captured', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    const job = q.enqueue(input)
    q.complete(job.id, 500)
    const rearmed = q.enqueue(input)
    expect(rearmed.status).toBe('queued')
  })

  it('claims the oldest queued job and marks it reading', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    const claimed = q.claimNext()
    expect(claimed?.status).toBe('reading')
    expect(q.claimNext()).toBeNull() // nothing left queued
  })

  it('uses retry_wait with backoff, then gives up at the attempt ceiling', () => {
    const { db } = makeQueueDb()
    const observer = { captureFailed: vi.fn() }
    const q = new MemoryCaptureQueue(db, observer)
    const job = q.enqueue(input)
    q.fail(job.id, 'network timeout')
    expect(q.list('p1')[0].status).toBe('retry_wait')
    expect(q.list('p1')[0].nextRetryAt).toBeTruthy()
    q.fail(job.id, 'network timeout')
    q.fail(job.id, 'boom') // 3 → error
    expect(q.list('p1')[0].status).toBe('error')
    expect(observer.captureFailed).toHaveBeenCalledTimes(3)
    expect(observer.captureFailed.mock.calls[2][0]).toMatchObject({
      projectId: 'p1',
      attempts: 3,
      status: 'error',
    })
  })

  it('moves through explicit processing stages', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    const job = q.enqueue(input)
    q.claimNext()
    ;(q as MemoryCaptureQueue & { updateStage(id: string, stage: string): void })
      .updateStage(job.id, 'distilling')
    expect(q.list('p1')[0].status).toBe('distilling')
    ;(q as MemoryCaptureQueue & { updateStage(id: string, stage: string): void })
      .updateStage(job.id, 'reconciling')
    expect(q.list('p1')[0].status).toBe('reconciling')
  })

  it('blocks configuration failures without burning attempts and provides recovery guidance', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    const job = q.enqueue(input)
    const blocked = q.fail(job.id, 'Add an OpenRouter key in Settings to continue.')
    expect(blocked).toMatchObject({ status: 'blocked', attempts: 0 })
    expect(blocked?.guidance).toMatch(/Settings.*Retry/i)
  })

  it('uses one provider configuration block instead of failing every queued session', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    q.enqueue({ ...input, sessionId: 's2', sourcePath: '/x/s2.jsonl' })
    q.enqueue({ ...input, provider: 'codex', sessionId: 'c1', sourcePath: '/x/c1.jsonl' })

    const first = q.claimNext()!
    q.fail(first.id, 'Add an OpenRouter key in Settings to continue.')

    expect(q.claimNext()).toMatchObject({ provider: 'codex', sessionId: 'c1' })
    q.retry(first.id)
    expect(q.claimNext()).toMatchObject({ provider: 'claude' })
  })

  it('recovers a job stuck processing after a crash', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    q.claimNext() // now reading
    const recovered = q.recoverStuck()
    expect(recovered).toBe(1)
    expect(q.claimNext()?.status).toBe('reading') // re-claimable
  })
})
