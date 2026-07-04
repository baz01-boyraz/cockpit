import { describe, expect, it } from 'vitest'
import { MemoryCaptureQueue } from '../electron/main/services/MemoryCaptureQueue'
import type { Db } from '../electron/main/db/Database'

interface Row {
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

/** Stateful fake covering exactly the statements MemoryCaptureQueue issues. */
function makeQueueDb() {
  const rows: Row[] = []
  const fake = {
    prepare(sql: string) {
      return {
        get: (...args: unknown[]) => {
          if (sql.includes('WHERE session_id = ?')) return rows.find((r) => r.session_id === args[0])
          if (sql.includes('WHERE id = ?')) return rows.find((r) => r.id === args[0])
          if (sql.includes("status = 'queued' ORDER BY")) {
            return [...rows].filter((r) => r.status === 'queued').sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))[0]
          }
          return undefined
        },
        all: (...args: unknown[]) => rows.filter((r) => r.project_id === args[0]),
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO memory_capture_queue')) {
            rows.push({ ...(args[0] as Row) })
            return { changes: 1 }
          }
          if (sql.includes("SET status = 'queued', error = NULL")) {
            const r = rows.find((x) => x.id === args[1])
            if (r) { r.status = 'queued'; r.error = null; r.updated_at = args[0] as string }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes("SET status = 'processing'")) {
            const r = rows.find((x) => x.id === args[1])
            if (r) { r.status = 'processing'; r.updated_at = args[0] as string }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes("SET status = 'done'")) {
            const r = rows.find((x) => x.id === args[2])
            if (r) { r.status = 'done'; r.last_offset = args[0] as number; r.updated_at = args[1] as string }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes('SET status = ?, attempts = ?')) {
            const r = rows.find((x) => x.id === args[4])
            if (r) { r.status = args[0] as string; r.attempts = args[1] as number; r.error = args[2] as string }
            return { changes: r ? 1 : 0 }
          }
          if (sql.includes("SET status = 'queued', updated_at = ? WHERE status = 'processing'")) {
            let n = 0
            for (const r of rows) if (r.status === 'processing') { r.status = 'queued'; n++ }
            return { changes: n }
          }
          return { changes: 0 }
        },
      }
    },
  }
  return { db: fake as unknown as Db, rows }
}

const input = { projectId: 'p1', sessionId: 's1', sourcePath: '/x/s1.jsonl' }

describe('MemoryCaptureQueue', () => {
  it('enqueues a new session as queued', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    const job = q.enqueue(input)
    expect(job.status).toBe('queued')
    expect(job.sessionId).toBe('s1')
  })

  it('is idempotent — enqueuing a pending session does not duplicate', () => {
    const { db, rows } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    q.enqueue(input)
    expect(rows).toHaveLength(1)
  })

  it('re-arms a done session so growth is captured', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    const job = q.enqueue(input)
    q.complete(job.id, 500)
    const rearmed = q.enqueue(input)
    expect(rearmed.status).toBe('queued')
  })

  it('claims the oldest queued job and marks it processing', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    const claimed = q.claimNext()
    expect(claimed?.status).toBe('processing')
    expect(q.claimNext()).toBeNull() // nothing left queued
  })

  it('retries on failure then gives up at the attempt ceiling', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    const job = q.enqueue(input)
    q.fail(job.id, 'boom') // 1 → queued
    expect(q.list('p1')[0].status).toBe('queued')
    q.fail(job.id, 'boom') // 2 → queued
    q.fail(job.id, 'boom') // 3 → error
    expect(q.list('p1')[0].status).toBe('error')
  })

  it('recovers a job stuck processing after a crash', () => {
    const { db } = makeQueueDb()
    const q = new MemoryCaptureQueue(db)
    q.enqueue(input)
    q.claimNext() // now processing
    const recovered = q.recoverStuck()
    expect(recovered).toBe(1)
    expect(q.claimNext()?.status).toBe('processing') // re-claimable
  })
})
