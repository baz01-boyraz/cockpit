import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryConsolidator } from '../electron/main/services/MemoryConsolidator'
import { MemoryHubService } from '../electron/main/services/MemoryHubService'
import type { MemoryReviewService } from '../electron/main/services/MemoryReviewService'
import type { ProjectService } from '../electron/main/services/ProjectService'
import type { CreateReviewInput } from '../electron/main/services/MemoryReviewService'
import type { ReviewItem } from '@shared/memory-review'

const stubProjects = (path: string): ProjectService =>
  ({ get: () => ({ path }) }) as unknown as ProjectService

function fakeReviews() {
  const items: ReviewItem[] = []
  const svc = {
    create: (i: CreateReviewInput) => {
      const item = {
        id: `r${items.length}`, brain: i.brain, kind: i.kind, slug: i.slug, title: i.title,
        proposedContent: i.proposedContent, reason: i.reason, existingContent: i.existingContent ?? null,
        sourceId: i.sourceId ?? null, alsoTrash: i.alsoTrash ?? null, status: 'pending' as const,
        createdAt: 't', resolvedAt: null,
      }
      items.push(item)
      return item
    },
    listPending: () => items.filter((i) => i.status === 'pending'),
  }
  return { svc: svc as unknown as MemoryReviewService, items }
}

const DUP = 'the router lives in shared so both bridges classify identically and stay in lockstep'

describe('MemoryConsolidator', () => {
  let dir: string
  let memory: MemoryHubService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cockpit-consol-'))
    memory = new MemoryHubService(stubProjects(dir))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('snapshots, finds duplicates, and queues a merge with alsoTrash', () => {
    memory.write('p1', 'router-a', `# Router A\n\n${DUP}`)
    memory.write('p1', 'router-b', `# Router B\n\n${DUP}`)
    const reviews = fakeReviews()
    const c = new MemoryConsolidator(memory, reviews.svc)
    const res = c.consolidate('p1')

    expect(res.snapshotId).toBeTruthy()
    expect(res.report.duplicates).toHaveLength(1)
    expect(res.queued).toBe(1)
    const item = reviews.items[0]
    expect(item.kind).toBe('maintenance')
    expect(item.alsoTrash).toBeTruthy()
    expect(item.proposedContent).toContain('merged from')
  })

  it('does not re-queue a merge already pending (idempotent)', () => {
    memory.write('p1', 'router-a', `# Router A\n\n${DUP}`)
    memory.write('p1', 'router-b', `# Router B\n\n${DUP}`)
    const reviews = fakeReviews()
    const c = new MemoryConsolidator(memory, reviews.svc)
    c.consolidate('p1')
    const second = c.consolidate('p1')
    expect(second.queued).toBe(0)
    expect(reviews.items).toHaveLength(1)
  })

  it('reports a clean hub with nothing to do', () => {
    memory.write('p1', 'alpha', '# Alpha\n\nunique content about the router subsystem')
    memory.write('p1', 'beta', '# Beta\n\nunrelated content about railway deploy tokens')
    const reviews = fakeReviews()
    const res = new MemoryConsolidator(memory, reviews.svc).consolidate('p1')
    expect(res.queued).toBe(0)
    expect(res.report.duplicates).toEqual([])
  })
})
