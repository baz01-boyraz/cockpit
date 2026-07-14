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
import { serializeNote } from '@shared/memory-note-schema'

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
  const records: Array<{
    actor: string
    actionType: string
    summary: string
    payload?: Record<string, unknown>
  }> = []
  const svc = {
    record: (r: {
      actor: string
      actionType: string
      summary: string
      payload?: Record<string, unknown>
    }) => {
      records.push(r)
      return r
    },
  }
  return { svc: svc as unknown as ConstructorParameters<typeof MemoryPipeline>[6], records }
}

const USER_RESOLUTION = { actor: 'user' as const }

function seedConflictReview(reviews: ReturnType<typeof fakeReviews>, id: string) {
  const existing = '# Release process\n\nUse the current signed workflow.'
  const proposed = '# Release process\n\nUse the replacement workflow.'
  reviews.items.set(id, {
    id,
    brain: projectBrain('p1'),
    kind: 'conflict',
    slug: 'release-process',
    title: 'Release process conflict',
    proposedContent: proposed,
    reason: 'The saved fact and a new observation disagree.',
    existingContent: existing,
    sourceId: 'session-2',
    alsoTrash: null,
    status: 'pending',
    createdAt: 't',
    resolvedAt: null,
  })
  return { existing, proposed }
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

  it('suppresses an ordinary unsure fact instead of filling the review inbox', async () => {
    const ledger = fakeLedger()
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(memory, ledger.svc, reviews.svc, stubDistiller([obs({ decision: 'ask' })]))
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.queued).toBe(0)
    expect(res.skipped).toBe(1)
    expect(res.committed).toBe(0)
    expect(memory.read('p1', 'router-placement')).toBeNull()
    expect(reviews.items.size).toBe(0)
  })

  it('skips a duplicate of an existing note', async () => {
    memory.write('p1', 'router-placement', 'The router lives in shared so both bridges classify identically and stay in lockstep.')
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, fakeReviews().svc, stubDistiller([obs()]))
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.skipped).toBe(1)
    expect(res.committed).toBe(0)
  })

  it('treats archived notes as reconciliation history and never reactivates them', async () => {
    const archived = serializeNote({
      schema: 2,
      name: 'router-placement',
      title: 'Router in shared',
      class: 'decision',
      gate: 'manual',
      updatedAt: '2026-07-12T00:00:00.000Z',
      tags: [],
      status: 'archived',
      authority: 'human-directive',
      scope: 'project',
      confidence: 'high',
      firstSeenAt: '2026-07-12T00:00:00.000Z',
      reviewAfter: '2027-01-01T00:00:00.000Z',
      supersedes: [],
    }, obs().body)
    memory.write('p1', 'router-placement', archived)
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, fakeReviews().svc, stubDistiller([obs()]))

    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })

    expect(res).toMatchObject({ committed: 0, queued: 0, skipped: 1 })
    expect(memory.read('p1', 'router-placement')?.content).toBe(archived)
    expect(memory.list('p1').archived.map((note) => note.name)).toEqual(['router-placement'])
  })

  it('skips repeated captures of one bullet already buried in a long note', async () => {
    const repeatedFact =
      'The router lives in shared so both bridges classify identically and stay in lockstep.'
    const longBody = [
      'A long-lived architecture note with independent historical facts.',
      ...Array.from(
        { length: 12 },
        (_, index) =>
          `- (2026-06-01) unrelatedtopic${index} component${index} behavior${index} remains documented separately`,
      ),
      'Related: [[ipc-contract]]',
      `- (2026-07-01) ${repeatedFact}`,
    ].join('\n')
    memory.write('p1', 'router-placement', longBody)
    const ledger = fakeLedger()
    const repeated = obs({ isNew: false, body: repeatedFact })
    const pipe = new MemoryPipeline(
      memory,
      ledger.svc,
      fakeReviews().svc,
      stubDistiller([repeated, repeated]),
    )

    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })

    expect(res.skipped).toBe(2)
    expect(res.committed).toBe(0)
    expect(ledger.records).toHaveLength(0)
    expect(memory.read('p1', 'router-placement')?.content).toBe(longBody)
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

  it('CHARTER GATE: suppresses a vague candidate instead of asking the owner to curate it', async () => {
    const reviews = fakeReviews()
    const audit = fakeAudit()
    const vague = obs({ reason: 'idk' }) // shorter than the 20-char scenario floor
    const pipe = new MemoryPipeline(
      memory, fakeLedger().svc, reviews.svc, stubDistiller([vague]), undefined, undefined, audit.svc,
    )
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.committed).toBe(0)
    expect(res.queued).toBe(0)
    expect(res.skipped).toBe(1)
    expect(memory.read('p1', 'router-placement')).toBeNull()
    expect(audit.records.some((r) => r.payload?.verdict === 'review')).toBe(true)
  })

  it('propagates a distiller error without writing', async () => {
    const failing = { distill: vi.fn(async () => ({ observations: [], nextOffset: 0, error: 'invalid JSON with AKIAIOSFODNN7EXAMPLE' })) } as unknown as MemoryDistiller
    const audit = fakeAudit()
    const pipe = new MemoryPipeline(
      memory,
      fakeLedger().svc,
      fakeReviews().svc,
      failing,
      undefined,
      undefined,
      audit.svc,
    )
    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    expect(res.error).toContain('invalid JSON')
    expect(res.committed).toBe(0)
    expect(audit.records).toContainEqual(
      expect.objectContaining({
        actionType: 'memory.distiller_failed',
        payload: { failureKind: 'parse' },
      }),
    )
    expect(JSON.stringify(audit.records)).not.toContain('AKIAIOSFODNN7EXAMPLE')
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

  it('Assisted applies a high-quality, evidence-safe merge without creating review work', async () => {
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

    expect(res.committed).toBe(1)
    expect(res.queued).toBe(0)
    expect(res.proposals[0]).toMatchObject({ gate: 'commit', reconcile: 'merge' })
    expect(memory.read('p1', 'router-placement')?.content).toContain('now belongs')
  })

  it('asks only when a high-impact protected fact has a genuinely ambiguous replacement', async () => {
    memory.write('p1', 'refresh-consent', [
      '---',
      'schema: 2',
      'name: refresh-consent',
      'title: Refresh consent',
      'class: decision',
      'gate: manual',
      'updatedAt: 2026-07-13T00:00:00.000Z',
      'status: active',
      'authority: human-directive',
      'scope: project',
      'confidence: high',
      'firstSeenAt: 2026-07-13T00:00:00.000Z',
      'reviewAfter: 2027-01-13T00:00:00.000Z',
      '---',
      '',
      'Refresh requires explicit current-message approval.',
    ].join('\n'))
    const reviews = fakeReviews()
    const replacement = obs({
      targetSlug: 'refresh-consent',
      title: 'Refresh consent changed',
      body: 'Agents may refresh automatically after tests complete.',
      class: 'decision',
      isNew: true,
      decision: 'ask',
      reason: 'The new transcript directly contradicts a protected owner safety rule.',
    })
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([replacement]))

    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })

    expect(res.queued).toBe(1)
    expect(res.skipped).toBe(0)
    expect(reviews.items.size).toBe(1)
    expect(res.proposals[0]).toMatchObject({ gate: 'review', reconcile: 'conflict' })
  })

  it('keeps an ordinary ambiguous collision out of both active Memory and the inbox', async () => {
    memory.write('p1', 'minor-layout-note', '# Minor layout note\n\nThe card gap is eight pixels.')
    const reviews = fakeReviews()
    const collision = obs({
      targetSlug: 'minor-layout-note',
      title: 'Minor layout note changed',
      body: 'The card gap might be ten pixels.',
      class: 'reference',
      isNew: true,
      decision: 'ask',
      reason: 'The transcript is uncertain about a minor presentation detail.',
    })
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([collision]))

    const res = await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })

    expect(res.queued).toBe(0)
    expect(res.skipped).toBe(1)
    expect(reviews.items.size).toBe(0)
    expect(memory.read('p1', 'minor-layout-note')?.content).not.toContain('ten pixels')
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

  it('blocks a delegated AI conflict decision without structured evidence', () => {
    const reviews = fakeReviews()
    const { existing } = seedConflictReview(reviews, 'conflict-unproven')
    memory.write('p1', 'release-process', existing)
    const ledger = fakeLedger()
    const pipe = new MemoryPipeline(memory, ledger.svc, reviews.svc, stubDistiller([]))

    expect(() =>
      pipe.resolveReview(
        'p1',
        'project',
        'conflict-unproven',
        'accept',
        undefined,
        { actor: 'ai' },
      ),
    ).toThrow(/delegated|evidence|basis/i)
    expect(memory.read('p1', 'release-process')?.content).toBe(existing)
    expect(reviews.items.get('conflict-unproven')?.status).toBe('pending')
    expect(ledger.records).toHaveLength(0)
  })

  it('audits an evidence-backed delegated conflict decision and marks its ledger gate', () => {
    const reviews = fakeReviews()
    const { existing, proposed } = seedConflictReview(reviews, 'conflict-proven')
    memory.write('p1', 'release-process', existing)
    const ledger = fakeLedger()
    const audit = fakeAudit()
    const pipe = new MemoryPipeline(
      memory,
      ledger.svc,
      reviews.svc,
      stubDistiller([]),
      undefined,
      undefined,
      audit.svc,
    )

    pipe.resolveReview(
      'p1',
      'project',
      'conflict-proven',
      'accept',
      undefined,
      {
        actor: 'ai',
        delegated: {
          basis: 'code-verified',
          rationale: 'The implementation and release checks both use the replacement workflow.',
          evidence: 'electron/main release service and the signed-release integration test',
        },
      },
    )

    expect(memory.read('p1', 'release-process')?.content).toBe(proposed)
    expect(ledger.records).toContainEqual(
      expect.objectContaining({ action: 'replace', gate: 'delegated' }),
    )
    expect(audit.records).toContainEqual(
      expect.objectContaining({
        actor: 'ai',
        actionType: 'memory.review_resolved',
        payload: expect.objectContaining({ basis: 'code-verified' }),
      }),
    )
  })

  it('refuses delegated conflict mutation when the audit sink is unavailable', () => {
    const reviews = fakeReviews()
    const { existing } = seedConflictReview(reviews, 'conflict-no-audit')
    memory.write('p1', 'release-process', existing)
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([]))

    expect(() =>
      pipe.resolveReview(
        'p1',
        'project',
        'conflict-no-audit',
        'discard',
        undefined,
        {
          actor: 'ai',
          delegated: {
            basis: 'source-authority',
            rationale: 'The owner-authored charter supersedes the captured session summary.',
            evidence: 'docs/MEMORY-CHARTER.md controlled conflict policy',
          },
        },
      ),
    ).toThrow(/audit sink/i)
    expect(reviews.items.get('conflict-no-audit')?.status).toBe('pending')
  })

  it('refuses an edit decision that has no edited content', () => {
    const reviews = fakeReviews()
    const { existing } = seedConflictReview(reviews, 'conflict-empty-edit')
    memory.write('p1', 'release-process', existing)
    const pipe = new MemoryPipeline(memory, fakeLedger().svc, reviews.svc, stubDistiller([]))

    expect(() =>
      pipe.resolveReview(
        'p1',
        'project',
        'conflict-empty-edit',
        'edit',
        undefined,
        { actor: 'user' },
      ),
    ).toThrow(/edited content/i)
  })

  it('accept writes the proposed note and ledgers it', async () => {
    const ledger = fakeLedger()
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(
      memory,
      ledger.svc,
      reviews.svc,
      stubDistiller([obs({ decision: 'ask' })]),
      undefined,
      undefined,
      undefined,
      fakePolicy({ [projectBrain('p1')]: 'manual' }) as never,
    )
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    pipe.resolveReview('p1', 'project', item.id, 'accept', undefined, USER_RESOLUTION)
    expect(memory.read('p1', 'router-placement')?.content).toContain('lives in shared')
    expect(reviews.items.get(item.id)?.status).toBe('accepted')
    expect(ledger.records).toHaveLength(1)
  })

  it('discard leaves the hub untouched', async () => {
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(
      memory,
      fakeLedger().svc,
      reviews.svc,
      stubDistiller([obs({ decision: 'ask' })]),
      undefined,
      undefined,
      undefined,
      fakePolicy({ [projectBrain('p1')]: 'manual' }) as never,
    )
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    pipe.resolveReview('p1', 'project', item.id, 'discard', undefined, USER_RESOLUTION)
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

    pipe.resolveReview('p1', 'project', 'archive-1', 'accept', undefined, USER_RESOLUTION)

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

    expect(() =>
      pipe.resolveReview(
        'p1',
        'project',
        'stale-review',
        'accept',
        undefined,
        USER_RESOLUTION,
      ),
    ).toThrow(/changed since/i)
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

    expect(() =>
      pipe.resolveReview(
        'p1',
        'project',
        'merge-cleanup',
        'accept',
        undefined,
        USER_RESOLUTION,
      ),
    ).toThrow(/duplicate memory changed/i)
    expect(memory.read('p1', 'canonical')?.content).toBe(survivor)
    expect(memory.read('p1', 'duplicate')?.content).toBe(changedDuplicate)
    expect(reviews.items.get('merge-cleanup')?.status).toBe('pending')
  })

  it('refuses to resolve another project review through the caller project', async () => {
    const reviews = fakeReviews()
    const pipe = new MemoryPipeline(
      memory,
      fakeLedger().svc,
      reviews.svc,
      stubDistiller([obs({ decision: 'ask' })]),
      undefined,
      undefined,
      undefined,
      fakePolicy({ [projectBrain('p1')]: 'manual' }) as never,
    )
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    expect(() =>
      pipe.resolveReview('p2', 'project', item.id, 'accept', undefined, USER_RESOLUTION),
    ).toThrow(/not found|authorized/i)
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
      undefined,
      fakePolicy({ [BAZ_GLOBAL_BRAIN]: 'manual' }) as never,
    )
    await pipe.capture({ projectId: 'p1', transcriptPath: 'x' })
    const [item] = reviews.items.values()

    expect(() =>
      pipe.resolveReview('p1', 'project', item.id, 'accept', undefined, USER_RESOLUTION),
    ).toThrow(/not found|authorized/i)
    pipe.resolveReview('p1', 'global', item.id, 'accept', undefined, USER_RESOLUTION)
    expect(globalMemory.read(BAZ_GLOBAL_BRAIN, 'baz-prefers-calm-ui')).not.toBeNull()
    rmSync(globalDir, { recursive: true, force: true })
  })
})
