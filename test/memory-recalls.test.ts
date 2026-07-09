import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRecallService } from '../electron/main/services/MemoryRecallService'
import { HUB_POINTER_CAP } from '../shared/swarm-worker'
import type { Db } from '../electron/main/db/Database'

interface RecallRow {
  id: string
  brain: string
  note_slug: string
  surface: string
  created_at: string
}

/**
 * Stateful in-memory stand-in for the `memory_recalls` statements. Tests never
 * import better-sqlite3 (its native build targets Electron's ABI); this fake
 * stores rows and reimplements the two SQL statements the service prepares —
 * the batch INSERT and the since-window GROUP BY (`created_at >= ?`, inclusive).
 */
function makeRecallDb() {
  const rows: RecallRow[] = []
  const fake = {
    transaction(fn: (...args: unknown[]) => unknown) {
      return (...args: unknown[]) => fn(...args)
    },
    prepare(sql: string) {
      return {
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO memory_recalls')) {
            const [id, brain, note_slug, surface, created_at] = args as string[]
            rows.push({ id, brain, note_slug, surface, created_at })
          }
          return { changes: 1 }
        },
        all: (...args: unknown[]) => {
          if (sql.includes('FROM memory_recalls')) {
            const [brain, since] = args as string[]
            const counts = new Map<string, number>()
            for (const r of rows) {
              // ISO-8601 strings compare lexicographically == chronologically.
              if (r.brain === brain && r.created_at >= since) {
                counts.set(r.note_slug, (counts.get(r.note_slug) ?? 0) + 1)
              }
            }
            return [...counts].map(([slug, count]) => ({ slug, count }))
          }
          return []
        },
        get: () => undefined,
      }
    },
  }
  return { db: fake as unknown as Db, rows }
}

/** A DB whose prepare() always throws — proves the never-throws contract. */
function makeExplodingDb(): Db {
  return {
    transaction() {
      throw new Error('db is closed')
    },
    prepare() {
      throw new Error('db is closed')
    },
  } as unknown as Db
}

const BRAIN = 'project:p1'

describe('MemoryRecallService.record', () => {
  it('writes one bounded batch — one row per unique slug, shared timestamp/surface', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'))
    const { db, rows } = makeRecallDb()
    const svc = new MemoryRecallService(db)

    svc.record(BRAIN, ['note-a', 'note-b', 'note-c'], 'swarm_worker')

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.note_slug)).toEqual(['note-a', 'note-b', 'note-c'])
    expect(rows.every((r) => r.brain === BRAIN)).toBe(true)
    expect(rows.every((r) => r.surface === 'swarm_worker')).toBe(true)
    expect(rows.every((r) => r.created_at === '2026-07-08T12:00:00.000Z')).toBe(true)
    // Each row gets a distinct id.
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
    vi.useRealTimers()
  })

  it('de-dups repeated slugs within one event', () => {
    const { db, rows } = makeRecallDb()
    const svc = new MemoryRecallService(db)
    svc.record(BRAIN, ['dup', 'dup', 'other', 'dup'], 'council_spec')
    expect(rows.map((r) => r.note_slug)).toEqual(['dup', 'other'])
  })

  it('caps a batch at HUB_POINTER_CAP rows', () => {
    const { db, rows } = makeRecallDb()
    const svc = new MemoryRecallService(db)
    const slugs = Array.from({ length: HUB_POINTER_CAP + 5 }, (_, i) => `n${i}`)
    svc.record(BRAIN, slugs, 'swarm_worker')
    expect(rows).toHaveLength(HUB_POINTER_CAP)
  })

  it('records nothing (and never throws) for empty/invalid input', () => {
    const { db, rows } = makeRecallDb()
    const svc = new MemoryRecallService(db)
    expect(() => svc.record('', ['a'], 'swarm_worker')).not.toThrow()
    expect(() => svc.record(BRAIN, [], 'swarm_worker')).not.toThrow()
    // Non-string entries are filtered out defensively.
    expect(() =>
      svc.record(BRAIN, [null as unknown as string, '', 42 as unknown as string], 'swarm_worker'),
    ).not.toThrow()
    // A slugs value that is not an array at all is tolerated.
    expect(() =>
      svc.record(BRAIN, undefined as unknown as string[], 'swarm_worker'),
    ).not.toThrow()
    expect(rows).toHaveLength(0)
  })

  it('never throws even when the DB itself explodes — recording can never endanger a spawn', () => {
    const svc = new MemoryRecallService(makeExplodingDb())
    expect(() => svc.record(BRAIN, ['a', 'b'], 'swarm_worker')).not.toThrow()
  })
})

describe('MemoryRecallService.recalledSince', () => {
  let db: Db
  let rows: RecallRow[]
  let svc: MemoryRecallService

  beforeEach(() => {
    const made = makeRecallDb()
    db = made.db
    rows = made.rows
    svc = new MemoryRecallService(db)
  })

  const seed = (slug: string, createdAt: string, brain = BRAIN) => {
    rows.push({ id: `${slug}-${createdAt}`, brain, note_slug: slug, surface: 'swarm_worker', created_at: createdAt })
  }

  it('counts recalls per slug within the window, summing repeats', () => {
    seed('hot', '2026-07-08T10:00:00.000Z')
    seed('hot', '2026-07-08T11:00:00.000Z')
    seed('warm', '2026-07-08T11:30:00.000Z')
    const counts = svc.recalledSince(BRAIN, '2026-07-08T00:00:00.000Z')
    expect(counts.get('hot')).toBe(2)
    expect(counts.get('warm')).toBe(1)
  })

  it('includes a recall stamped exactly at the cutoff (inclusive lower bound)', () => {
    const cutoff = '2026-07-01T00:00:00.000Z'
    seed('at-cutoff', cutoff)
    seed('before-cutoff', '2026-06-30T23:59:59.999Z')
    seed('after-cutoff', '2026-07-02T00:00:00.000Z')
    const counts = svc.recalledSince(BRAIN, cutoff)
    expect(counts.get('at-cutoff')).toBe(1)
    expect(counts.has('before-cutoff')).toBe(false)
    expect(counts.get('after-cutoff')).toBe(1)
  })

  it('scopes to the requested brain only', () => {
    seed('mine', '2026-07-08T10:00:00.000Z', BRAIN)
    seed('theirs', '2026-07-08T10:00:00.000Z', 'project:other')
    const counts = svc.recalledSince(BRAIN, '2026-07-01T00:00:00.000Z')
    expect(counts.get('mine')).toBe(1)
    expect(counts.has('theirs')).toBe(false)
  })

  it('returns an empty map (never throws) for an empty brain or a broken DB', () => {
    expect(svc.recalledSince('', '2026-07-01T00:00:00.000Z').size).toBe(0)
    const broken = new MemoryRecallService(makeExplodingDb())
    let result: Map<string, number> | undefined
    expect(() => {
      result = broken.recalledSince(BRAIN, '2026-07-01T00:00:00.000Z')
    }).not.toThrow()
    expect(result?.size).toBe(0)
  })
})
