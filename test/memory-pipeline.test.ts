import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryPipeline } from '../electron/main/services/MemoryPipeline'
import { MemoryHubService } from '../electron/main/services/MemoryHubService'
import type { MemoryLedgerService } from '../electron/main/services/MemoryLedgerService'
import type { MemoryReviewService } from '../electron/main/services/MemoryReviewService'
import type { MemoryDistiller } from '../electron/main/services/MemoryDistiller'
import type { ProjectService } from '../electron/main/services/ProjectService'
import type { Observation } from '@shared/memory-observation'
import type { ReviewItem } from '@shared/memory-review'

const stubProjects = (path: string): ProjectService =>
  ({ get: () => ({ path }) }) as unknown as ProjectService

const obs = (over: Partial<Observation> = {}): Observation => ({
  scope: 'project',
  class: 'decision',
  targetSlug: 'router-placement',
  isNew: true,
  title: 'Router in shared',
  body: 'The router lives in shared so both bridges classify identically and stay in lockstep.',
  links: [],
  decision: 'save',
  reason: 'clear architectural decision',
  ...over,
})

/** Distiller stub returning canned observations. */
const stubDistiller = (observations: Observation[]): MemoryDistiller =>
  ({ distill: vi.fn(async () => ({ observations, nextOffset: 128 })) }) as unknown as MemoryDistiller

/** In-memory review store implementing the methods the pipeline calls. */
function fakeReviews() {
  const items = new Map<string, ReviewItem>()
  let seq = 0
  const svc = {
    create: (input: { brain: string; kind: ReviewItem['kind']; slug: string; title: string; proposedContent: string; reason: string; existingContent?: string | null; sourceId?: string | null }) => {
      const id = `r${seq++}`
      const item: ReviewItem = {
        id, brain: input.brain, kind: input.kind, slug: input.slug, title: input.title,
        proposedContent: input.proposedContent, reason: input.reason,
        existingContent: input.existingContent ?? null, sourceId: input.sourceId ?? null,
        alsoTrash: null,
        status: 'pending', createdAt: 't', resolvedAt: null,
      }
      items.set(id, item)
      return item
    },
    get: (id: string) => items.get(id) ?? null,
    markResolved: (id: string, status: ReviewItem['status']) => {
      const it = items.get(id)
      if (it) items.set(id, { ...it, status, resolvedAt: 't' })
    },
    listPending: (brain: string) => [...items.values()].filter((i) => i.brain === brain && i.status === 'pending'),
  }
  return { svc: svc as unknown as MemoryReviewService, items }
}

const fakeLedger = () => {
  const records: unknown[] = []
  const svc = { record: (r: unknown) => { records.push(r); return r } }
  return { svc: svc as unknown as MemoryLedgerService, records }
}

describe('MemoryPipeline.capture', () => {
  let dir: string
  let memory: MemoryHubService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cockpit-pipe-'))
    memory = new MemoryHubService(stubProjects(dir))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('commits a confident new fact and ledgers it', async () => {
    const ledger = fakeLedger()
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(memory, ledger.svc, reviews.svc, stubDistiller([obs()]))
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x', sessionId: 's1' })
    expect(res.committed).toBe(1)
    expect(res.queued).toBe(0)
    expect(memory.read('p1', 'router-placement')?.content).toContain('lives in shared')
    expect(ledger.records).toHaveLength(1)
  })

  it('queues an unsure fact for review instead of writing it', async () => {
    const ledger = fakeLedger()
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(memory, ledger.svc, reviews.svc, stubDistiller([obs({ decision: 'ask' })]))
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.queued).toBe(1)
    expect(res.committed).toBe(0)
    expect(memory.read('p1', 'router-placement')).toBeNull()
    expect(reviews.items.size).toBe(1)
  })

  it('skips a duplicate of an existing note', async () => {
    memory.write('p1', 'router-placement', 'The router lives in shared so both bridges classify identically and stay in lockstep.')
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, fakeReviews().svc, stubDistiller([obs()]))
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.skipped).toBe(1)
    expect(res.committed).toBe(0)
  })

  it('dry run writes nothing but returns proposals', async () => {
    const ledger = fakeLedger()
    const pipe = new MemoryPipeline(memory, ledger.svc, fakeReviews().svc, stubDistiller([obs()]))
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x', dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(res.proposals).toHaveLength(1)
    expect(res.proposals[0].gate).toBe('commit')
    expect(memory.read('p1', 'router-placement')).toBeNull()
    expect(ledger.records).toHaveLength(0)
  })

  it('propagates a distiller error without writing', async () => {
    const failing = { distill: vi.fn(async () => ({ observations: [], nextOffset: 0, error: 'claude failed' })) } as unknown as MemoryDistiller
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, fakeReviews().svc, failing)
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.error).toBe('claude failed')
    expect(res.committed).toBe(0)
  })

  it('routes a user-scope fact to the global Baz brain, not the project hub (Phase 6)', async () => {
    const globalDir = mkdtempSync(join(tmpdir(), 'cockpit-baz-'))
    const globalMemory = new MemoryHubService(stubProjects(globalDir), globalDir)
    const ledger = fakeLedger()
    const userObs = obs({ scope: 'user', targetSlug: 'baz-prefers-fable', body: 'Baz prefers Fable for planning and Opus for building.' })
    const pipe = new MemoryPipeline(memory, ledger.svc, fakeReviews().svc, stubDistiller([userObs]), () => '2026-07-04T12:00:00.000Z', globalMemory)

    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.committed).toBe(1)
    // it landed in the global brain, NOT the project hub
    expect(memory.read('p1', 'baz-prefers-fable')).toBeNull()
    expect(globalMemory.read('baz-global', 'baz-prefers-fable')?.content).toContain('prefers Fable')
    expect(ledger.records[0]).toMatchObject({ brain: 'baz-global' })
    rmSync(globalDir, { recursive: true, force: true })
  })
})

describe('MemoryPipeline.resolveReview', () => {
  let dir: string
  let memory: MemoryHubService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cockpit-pipe-'))
    memory = new MemoryHubService(stubProjects(dir))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('accept writes the proposed note and ledgers it', async () => {
    const ledger = fakeLedger()
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(memory, ledger.svc, reviews.svc, stubDistiller([obs({ decision: 'ask' })]))
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    pipe.resolveReview('p1', item.id, 'accept')
    expect(memory.read('p1', 'router-placement')?.content).toContain('lives in shared')
    expect(reviews.items.get(item.id)?.status).toBe('accepted')
    expect(ledger.records).toHaveLength(1)
  })

  it('discard leaves the hub untouched', async () => {
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([obs({ decision: 'ask' })]))
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    pipe.resolveReview('p1', item.id, 'discard')
    expect(memory.read('p1', 'router-placement')).toBeNull()
    expect(reviews.items.get(item.id)?.status).toBe('discarded')
  })
})
