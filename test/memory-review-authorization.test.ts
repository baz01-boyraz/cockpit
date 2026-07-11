import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../electron/main/db/Database'
import { MemoryReviewService } from '../electron/main/services/MemoryReviewService'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '../shared/memory-ledger'

interface ReviewRow {
  id: string
  brain: string
  kind: string
  slug: string
  payload: string
  status: string
  created_at: string
  resolved_at: string | null
}

function makeReviewDb(): Db {
  const rows: ReviewRow[] = []
  return {
    prepare(sql: string) {
      return {
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO memory_review')) {
            const [id, brain, kind, slug, payload, createdAt] = args as string[]
            rows.push({
              id,
              brain,
              kind,
              slug,
              payload,
              status: 'pending',
              created_at: createdAt,
              resolved_at: null,
            })
            return { changes: 1 }
          }
          if (sql.includes('UPDATE memory_review')) {
            const [status, resolvedAt, id, brain] = args as string[]
            const row = rows.find(
              (candidate) =>
                candidate.id === id &&
                (brain === undefined || candidate.brain === brain) &&
                (!sql.includes("status = 'pending'") || candidate.status === 'pending'),
            )
            if (!row) return { changes: 0 }
            row.status = status
            row.resolved_at = resolvedAt
            return { changes: 1 }
          }
          return { changes: 0 }
        },
        all: (brain: string) =>
          rows.filter((row) => row.brain === brain && row.status === 'pending'),
        get: (id: string, brain?: string) =>
          rows.find(
            (row) =>
              row.id === id &&
              (brain === undefined || row.brain === brain) &&
              (!sql.includes("status = 'pending'") || row.status === 'pending'),
          ),
      }
    },
  } as unknown as Db
}

const proposal = (brain: string, slug: string) => ({
  brain,
  kind: 'new' as const,
  slug,
  title: slug,
  proposedContent: `# ${slug}`,
  reason: 'authorization fixture',
})

describe('MemoryReviewService brain authorization', () => {
  let db: Db
  let reviews: MemoryReviewService

  beforeEach(() => {
    db = makeReviewDb()
    reviews = new MemoryReviewService(db)
  })

  it('lists only the origin project brain unless global is explicitly requested', () => {
    reviews.create(proposal(projectBrain('proj-a'), 'a-note'))
    reviews.create(proposal(projectBrain('proj-b'), 'b-note'))
    reviews.create(proposal(BAZ_GLOBAL_BRAIN, 'global-note'))

    expect(reviews.listPendingFor('proj-a', 'project').map((item) => item.slug)).toEqual(['a-note'])
    expect(reviews.listPendingFor('proj-a', 'global').map((item) => item.slug)).toEqual(['global-note'])
  })

  it('cannot fetch or resolve another project review through the caller project', () => {
    const foreign = reviews.create(proposal(projectBrain('proj-b'), 'b-note'))

    expect(reviews.getPendingFor('proj-a', 'project', foreign.id)).toBeNull()
    expect(reviews.markResolvedFor('proj-a', 'project', foreign.id, 'discarded')).toBe(false)
    expect(reviews.get(foreign.id)?.status).toBe('pending')
  })

  it('allows a global review only through an explicit global scope', () => {
    const global = reviews.create(proposal(BAZ_GLOBAL_BRAIN, 'global-note'))

    expect(reviews.getPendingFor('proj-a', 'project', global.id)).toBeNull()
    expect(reviews.getPendingFor('proj-a', 'global', global.id)?.id).toBe(global.id)
    expect(reviews.markResolvedFor('proj-a', 'global', global.id, 'accepted')).toBe(true)
  })
})
