import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryPipeline } from '../electron/main/services/MemoryPipeline'
import { MemoryHubService } from '../electron/main/services/MemoryHubService'
import type { MemoryLedgerService } from '../electron/main/services/MemoryLedgerService'
import type { MemoryReviewService } from '../electron/main/services/MemoryReviewService'
import type { MemoryDistiller } from '../electron/main/services/MemoryDistiller'
import type { ProjectService } from '../electron/main/services/ProjectService'
import type { ReviewItem } from '@shared/memory-review'
import type { MemoryBrainScope, MemoryTrustMode } from '@shared/memory-policy'
import { canAutoCleanup } from '@shared/memory-policy'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'

const stubProjects = (path: string): ProjectService =>
  ({ get: () => ({ path }) }) as unknown as ProjectService

const noopDistiller = (): MemoryDistiller =>
  ({ distill: async () => ({ observations: [], nextOffset: 0 }) }) as unknown as MemoryDistiller

/** In-memory review store that carries the cleanup-operation fields. */
function fakeReviews() {
  const items = new Map<string, ReviewItem>()
  const brainOf = (originProjectId: string, scope: MemoryBrainScope): string =>
    scope === 'global' ? BAZ_GLOBAL_BRAIN : projectBrain(originProjectId)
  const svc = {
    getPendingFor: (originProjectId: string, scope: MemoryBrainScope, id: string) => {
      const item = items.get(id)
      return item?.brain === brainOf(originProjectId, scope) && item.status === 'pending'
        ? item
        : null
    },
    markResolvedFor: (
      originProjectId: string,
      scope: MemoryBrainScope,
      id: string,
      status: ReviewItem['status'],
    ) => {
      const it = items.get(id)
      if (!it || it.brain !== brainOf(originProjectId, scope) || it.status !== 'pending') return false
      items.set(id, { ...it, status, resolvedAt: 't' })
      return true
    },
    listPendingFor: (originProjectId: string, scope: MemoryBrainScope) =>
      [...items.values()].filter(
        (i) => i.brain === brainOf(originProjectId, scope) && i.status === 'pending',
      ),
  }
  return { svc: svc as unknown as MemoryReviewService, items }
}

const fakeLedger = () => {
  const records: Array<{ action: string; noteSlug: string }> = []
  const svc = { record: (r: { action: string; noteSlug: string }) => { records.push(r); return r } }
  return { svc: svc as unknown as MemoryLedgerService, records }
}

const fakeAudit = () => {
  const records: Array<{ actor: string; actionType: string }> = []
  const svc = {
    record: (r: { actor: string; actionType: string }) => {
      records.push(r)
      return r
    },
  }
  return { svc: svc as unknown as ConstructorParameters<typeof MemoryPipeline>[6], records }
}

const fakePolicy = (mode: MemoryTrustMode) => ({ trustModeForBrain: () => mode })

const review = (over: Partial<ReviewItem>): ReviewItem => ({
  id: 'r1',
  brain: projectBrain('p1'),
  kind: 'maintenance',
  slug: 'stale-note',
  title: 'Archive stale note: stale-note',
  proposedContent: '# Stale note\n\nOld fact.',
  reason: 'Curation — archive: superseded',
  existingContent: '# Stale note\n\nOld fact.',
  sourceId: null,
  alsoTrash: null,
  operation: 'archive',
  status: 'pending',
  createdAt: 't',
  resolvedAt: null,
  ...over,
})

describe('canAutoCleanup', () => {
  it('only autopilot may apply reversible cleanup on its own', () => {
    expect(canAutoCleanup('autopilot')).toBe(true)
    expect(canAutoCleanup('assisted')).toBe(false)
    expect(canAutoCleanup('manual')).toBe(false)
  })
})

describe('MemoryPipeline.applyCleanupBacklog', () => {
  let dir: string
  let memory: MemoryHubService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cockpit-cleanup-'))
    memory = new MemoryHubService(stubProjects(dir))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const pipeline = (
    reviews: ReturnType<typeof fakeReviews>,
    mode: MemoryTrustMode,
    ledger = fakeLedger(),
    audit = fakeAudit(),
  ) =>
    new MemoryPipeline(
      memory,
      ledger.svc,
      reviews.svc,
      noopDistiller(),
      undefined,
      undefined,
      audit.svc,
      fakePolicy(mode),
    )

  it('archives pending cleanup automatically under autopilot', () => {
    memory.write('p1', 'stale-note', '# Stale note\n\nOld fact.')
    const reviews = fakeReviews()
    reviews.items.set('r1', review({ existingContent: memory.read('p1', 'stale-note')!.content, proposedContent: memory.read('p1', 'stale-note')!.content }))
    const ledger = fakeLedger()
    const audit = fakeAudit()

    const applied = pipeline(reviews, 'autopilot', ledger, audit).applyCleanupBacklog('p1', 'project')

    expect(applied).toBe(1)
    expect(memory.read('p1', 'stale-note')).toBeNull()
    expect(reviews.items.get('r1')?.status).toBe('accepted')
    expect(ledger.records.some((r) => r.action === 'trash')).toBe(true)
    expect(audit.records.some((r) => r.actor === 'ai')).toBe(true)
  })

  it('leaves everything pending under assisted and manual', () => {
    memory.write('p1', 'stale-note', '# Stale note\n\nOld fact.')
    for (const mode of ['assisted', 'manual'] as const) {
      const reviews = fakeReviews()
      reviews.items.set('r1', review({ existingContent: memory.read('p1', 'stale-note')!.content, proposedContent: memory.read('p1', 'stale-note')!.content }))
      expect(pipeline(reviews, mode).applyCleanupBacklog('p1', 'project')).toBe(0)
      expect(reviews.items.get('r1')?.status).toBe('pending')
    }
    expect(memory.read('p1', 'stale-note')).not.toBeNull()
  })

  it('never touches conflicts or ordinary suggestions', () => {
    const reviews = fakeReviews()
    reviews.items.set('c1', review({ id: 'c1', kind: 'conflict', operation: null, title: 'Two versions' }))
    reviews.items.set('n1', review({ id: 'n1', kind: 'new', operation: null, title: 'Remember this' }))

    expect(pipeline(reviews, 'autopilot').applyCleanupBacklog('p1', 'project')).toBe(0)
    expect(reviews.items.get('c1')?.status).toBe('pending')
    expect(reviews.items.get('n1')?.status).toBe('pending')
  })

  it('skips a stale cleanup item without aborting the rest', () => {
    memory.write('p1', 'stale-note', '# Stale note\n\nEdited since the sweep.')
    memory.write('p1', 'other-note', '# Other note\n\nOld fact.')
    const reviews = fakeReviews()
    reviews.items.set('r1', review({ existingContent: '# Stale note\n\nOld fact.' }))
    reviews.items.set(
      'r2',
      review({
        id: 'r2',
        slug: 'other-note',
        title: 'Archive stale note: other-note',
        existingContent: memory.read('p1', 'other-note')!.content,
        proposedContent: memory.read('p1', 'other-note')!.content,
      }),
    )

    const applied = pipeline(reviews, 'autopilot').applyCleanupBacklog('p1', 'project')

    expect(applied).toBe(1)
    expect(reviews.items.get('r1')?.status).toBe('pending')
    expect(memory.read('p1', 'stale-note')).not.toBeNull()
    expect(memory.read('p1', 'other-note')).toBeNull()
  })
})
