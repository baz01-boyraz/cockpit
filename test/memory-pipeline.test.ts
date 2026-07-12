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
import type { MemoryBrainScope, MemoryTrustMode } from '@shared/memory-policy'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'

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
    getPendingFor: (originProjectId: string, scope: MemoryBrainScope, id: string) => {
      const brain = scope === 'global' ? BAZ_GLOBAL_BRAIN : projectBrain(originProjectId)
      const item = items.get(id)
      return item?.brain === brain && item.status === 'pending' ? item : null
    },
    markResolved: (id: string, status: ReviewItem['status']) => {
      const it = items.get(id)
      if (it) items.set(id, { ...it, status, resolvedAt: 't' })
    },
    markResolvedFor: (
      originProjectId: string,
      scope: MemoryBrainScope,
      id: string,
      status: ReviewItem['status'],
    ) => {
      const brain = scope === 'global' ? BAZ_GLOBAL_BRAIN : projectBrain(originProjectId)
      const it = items.get(id)
      if (!it || it.brain !== brain || it.status !== 'pending') return false
      items.set(id, { ...it, status, resolvedAt: 't' })
      return true
    },
    listPending: (brain: string) => [...items.values()].filter((i) => i.brain === brain && i.status === 'pending'),
    listPendingFor: (originProjectId: string, scope: MemoryBrainScope) => {
      const brain = scope === 'global' ? BAZ_GLOBAL_BRAIN : projectBrain(originProjectId)
      return [...items.values()].filter((i) => i.brain === brain && i.status === 'pending')
    },
  }
  return { svc: svc as unknown as MemoryReviewService, items }
}

const fakePolicy = (modes: Partial<Record<string, MemoryTrustMode>>) => ({
  trustModeForBrain: (brain: string): MemoryTrustMode =>
    modes[brain] ?? (brain === BAZ_GLOBAL_BRAIN ? 'assisted' : 'autopilot'),
})

const fakeLedger = () => {
  const records: unknown[] = []
  const svc = { record: (r: unknown) => { records.push(r); return r } }
  return { svc: svc as unknown as MemoryLedgerService, records }
}

const fakeAudit = () => {
  const records: Array<{ actionType: string; payload?: Record<string, unknown> }> = []
  const svc = { record: (r: { actionType: string; payload?: Record<string, unknown> }) => { records.push(r); return r } }
  return { svc: svc as unknown as ConstructorParameters<typeof MemoryPipeline>[6], records }
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

  it('CHARTER GATE: drops a would-be commit whose content is secret-shaped, never persisting it', async () => {
    const ledger = fakeLedger()
    const reviews = fakeReviews()
    const audit = fakeAudit()
    const leaky = obs({
      targetSlug: 'leaky-fact',
      body: 'The deploy token is sk-or-v1-0123456789abcdefghijklmnop and it must be rotated.',
    })
    const pipe = new MemoryPipeline(
      memory, ledger.svc, reviews.svc, stubDistiller([leaky]), undefined, undefined, audit.svc,
    )
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    // not committed, not queued (a secret never lands in the review queue either) — dropped
    expect(res.committed).toBe(0)
    expect(res.skipped).toBe(1)
    expect(memory.read('p1', 'leaky-fact')).toBeNull()
    expect(reviews.items.size).toBe(0)
    expect(audit.records.some((r) => r.payload?.verdict === 'reject')).toBe(true)
  })

  it('CHARTER GATE: downgrades a confident commit with a too-vague reason to review', async () => {
    const reviews = fakeReviews()
    const audit = fakeAudit()
    const vague = obs({ reason: 'idk' }) // shorter than the 20-char scenario floor
    const pipe = new MemoryPipeline(
      memory, fakeLedger().svc, reviews.svc, stubDistiller([vague]), undefined, undefined, audit.svc,
    )
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.committed).toBe(0)
    expect(res.queued).toBe(1)
    expect(memory.read('p1', 'router-placement')).toBeNull()
    expect(audit.records.some((r) => r.payload?.verdict === 'review')).toBe(true)
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

  it('Manual routes even a high-quality new fact to review while the UI is closed', async () => {
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(
      memory,
      fakeLedger().svc,
      reviews.svc,
      stubDistiller([obs()]),
      undefined,
      undefined,
      undefined,
      fakePolicy({ [projectBrain('p1')]: 'manual' }) as never,
    )

    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })

    expect(res.committed).toBe(0)
    expect(res.queued).toBe(1)
    expect(res.proposals[0].gate).toBe('review')
    expect(memory.read('p1', 'router-placement')).toBeNull()
  })

  it('Assisted routes a high-quality merge to review instead of changing the note', async () => {
    memory.write('p1', 'router-placement', 'The router was originally placed in the renderer only.')
    const reviews = fakeReviews()
    const merge = obs({
      isNew: false,
      body: 'The router now belongs in shared so the renderer and main process use one rule.',
    })
    const pipe = new MemoryPipeline(
      memory,
      fakeLedger().svc,
      reviews.svc,
      stubDistiller([merge]),
      undefined,
      undefined,
      undefined,
      fakePolicy({ [projectBrain('p1')]: 'assisted' }) as never,
    )

    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })

    expect(res.committed).toBe(0)
    expect(res.queued).toBe(1)
    expect(res.proposals[0]).toMatchObject({ gate: 'review', reconcile: 'merge' })
    expect(memory.read('p1', 'router-placement')?.content).not.toContain('now belongs')
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

    pipe.resolveReview('p1', 'project', item.id, 'accept')
    expect(memory.read('p1', 'router-placement')?.content).toContain('lives in shared')
    expect(reviews.items.get(item.id)?.status).toBe('accepted')
    expect(ledger.records).toHaveLength(1)
  })

  it('discard leaves the hub untouched', async () => {
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([obs({ decision: 'ask' })]))
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    pipe.resolveReview('p1', 'project', item.id, 'discard')
    expect(memory.read('p1', 'router-placement')).toBeNull()
    expect(reviews.items.get(item.id)?.status).toBe('discarded')
  })

  it('accepting a legacy archive cleanup really soft-deletes the note and ledgers it', () => {
    const content = '# Stale fact\n\nSomething that used to be true.'
    memory.write('p1', 'stale-fact', content)
    const ledger = fakeLedger()
    const reviews = fakeReviews()
    reviews.items.set('archive-1', {
      id: 'archive-1',
      brain: projectBrain('p1'),
      kind: 'maintenance',
      slug: 'stale-fact',
      title: 'Archive stale note: stale-fact',
      proposedContent: content,
      reason: 'Curation — archive: no longer true',
      existingContent: content,
      sourceId: null,
      alsoTrash: null,
      status: 'pending',
      createdAt: 't',
      resolvedAt: null,
    })
    const pipe = new MemoryPipeline(memory, ledger.svc, reviews.svc, stubDistiller([]))

    pipe.resolveReview('p1', 'project', 'archive-1', 'accept')

    expect(memory.read('p1', 'stale-fact')).toBeNull()
    expect(reviews.items.get('archive-1')?.status).toBe('accepted')
    expect(ledger.records).toContainEqual(expect.objectContaining({
      noteSlug: 'stale-fact',
      action: 'trash',
      gate: 'consolidation',
      contentBefore: content,
      contentAfter: null,
    }))
  })

  it('refuses a queued change when the live note changed after the proposal', () => {
    const original = '# Release process\n\nUse the old workflow.'
    const changed = '# Release process\n\nUse the newly signed workflow.'
    memory.write('p1', 'release-process', original)
    const reviews = fakeReviews()
    reviews.items.set('stale-review', {
      id: 'stale-review',
      brain: projectBrain('p1'),
      kind: 'merge',
      slug: 'release-process',
      title: 'Release process changed',
      proposedContent: '# Release process\n\nUse the proposed workflow.',
      reason: 'A newer session suggested a different workflow.',
      existingContent: original,
      sourceId: null,
      alsoTrash: null,
      status: 'pending',
      createdAt: 't',
      resolvedAt: null,
    })
    memory.write('p1', 'release-process', changed)
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([]))

    expect(() => pipe.resolveReview('p1', 'project', 'stale-review', 'accept')).toThrow(/changed since/i)
    expect(memory.read('p1', 'release-process')?.content).toBe(changed)
    expect(reviews.items.get('stale-review')?.status).toBe('pending')
  })

  it('refuses duplicate cleanup when the duplicate changed after the proposal', () => {
    const survivor = '# Canonical\n\nThe canonical fact.'
    const duplicate = '# Duplicate\n\nThe original duplicate.'
    const changedDuplicate = '# Duplicate\n\nA newer detail that must not be lost.'
    memory.write('p1', 'canonical', survivor)
    memory.write('p1', 'duplicate', duplicate)
    const reviews = fakeReviews()
    reviews.items.set('merge-cleanup', {
      id: 'merge-cleanup',
      brain: projectBrain('p1'),
      kind: 'maintenance',
      slug: 'canonical',
      title: 'Merge duplicate: duplicate → canonical',
      proposedContent: '# Canonical\n\nThe combined fact.',
      reason: 'Curation — merge: same idea',
      existingContent: survivor,
      sourceId: null,
      operation: 'merge',
      alsoTrash: 'duplicate',
      alsoTrashContent: duplicate,
      status: 'pending',
      createdAt: 't',
      resolvedAt: null,
    })
    memory.write('p1', 'duplicate', changedDuplicate)
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([]))

    expect(() => pipe.resolveReview('p1', 'project', 'merge-cleanup', 'accept')).toThrow(/duplicate memory changed/i)
    expect(memory.read('p1', 'canonical')?.content).toBe(survivor)
    expect(memory.read('p1', 'duplicate')?.content).toBe(changedDuplicate)
    expect(reviews.items.get('merge-cleanup')?.status).toBe('pending')
  })

  it('refuses to resolve another project review through the caller project', async () => {
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([obs({ decision: 'ask' })]))
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    expect(() => pipe.resolveReview('p2', 'project', item.id, 'accept')).toThrow(/not found|authorized/i)
    expect(reviews.items.get(item.id)?.status).toBe('pending')
    expect(memory.read('p1', 'router-placement')).toBeNull()
  })

  it('requires explicit global scope to resolve a Baz-brain review', async () => {
    const globalDir = mkdtempSync(join(tmpdir(), 'cockpit-baz-review-'))
    const globalMemory = new MemoryHubService(stubProjects(globalDir), globalDir)
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(
      memory,
      fakeLedger().svc,
      reviews.svc,
      stubDistiller([obs({ scope: 'user', decision: 'ask', targetSlug: 'baz-prefers-calm-ui' })]),
      undefined,
      globalMemory,
    )
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    expect(() => pipe.resolveReview('p1', 'project', item.id, 'accept')).toThrow(/not found|authorized/i)
    pipe.resolveReview('p1', 'global', item.id, 'accept')
    expect(globalMemory.read(BAZ_GLOBAL_BRAIN, 'baz-prefers-calm-ui')).not.toBeNull()
    rmSync(globalDir, { recursive: true, force: true })
  })
})
