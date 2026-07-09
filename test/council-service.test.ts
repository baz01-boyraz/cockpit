import { describe, expect, it, vi } from 'vitest'
import { CouncilService } from '../electron/main/services/CouncilService'
import type { EngineRunner } from '../electron/main/services/EngineRunner'
import type { AuditLogService } from '../electron/main/services/AuditLogService'
import type { ProjectService } from '../electron/main/services/ProjectService'
import {
  CouncilSessionStore,
  type CouncilSessionInput,
} from '../electron/main/db/CouncilSessionStore'
import type { CouncilResult } from '../shared/council'
import type { Db } from '../electron/main/db/Database'

/** A spec-mode-aware fake engine: OpenRouter and Codex always throw (no key /
 *  second CLI absent) so their seats must fall back; every claude call answers.
 *  The chairman and ranking calls are recognized by their prompt shape. */
function makeEngine(): EngineRunner {
  const call = vi.fn(async (spec: { engine: string }, prompt: string) => {
    if (spec.engine === 'openrouter') throw new Error('no OpenRouter key')
    if (spec.engine === 'codex') throw new Error('codex CLI missing')
    if (prompt.includes('Refined Spec')) {
      return [
        '### 🎯 Verdict',
        'NEEDS_CLARIFICATION',
        'Under-specified.',
        '',
        '### ❓ Questions for the author',
        '1. What is the latency target?',
        '2. Which module is the gateway?',
      ].join('\n')
    }
    if (prompt.includes('FINAL RANKING')) {
      return 'eval\n\nFINAL RANKING:\n1. Response A\n2. Response B\n3. Response C\n4. Response D\n5. Response E'
    }
    return `seat reply via ${spec.engine}`
  })
  return { call } as unknown as EngineRunner
}

function makeProjects(): ProjectService {
  return { get: () => ({ id: 'prj_1', name: 'cockpiT', path: '/tmp/prj' }) } as unknown as ProjectService
}

function makeAudit(): AuditLogService {
  return { record: vi.fn() } as unknown as AuditLogService
}

/** In-memory session store standing in for the SQLite-backed one. */
function makeStore() {
  const inserted: CouncilSessionInput[] = []
  const store = {
    insert: (input: CouncilSessionInput) => {
      inserted.push(input)
      return `sess-${inserted.length}`
    },
    listRecent: (projectId: string) =>
      inserted
        .filter((i) => i.projectId === projectId)
        .map((i, idx) => ({
          id: `sess-${idx + 1}`,
          projectId: i.projectId,
          cardId: i.cardId,
          mode: i.mode,
          question: i.question,
          result: i.result,
          verdictKind: i.result.specVerdict?.kind ?? null,
          createdAt: 'now',
        })),
    get: () => null,
  }
  return { store: store as unknown as CouncilSessionStore, inserted }
}

function makeService(storeParts = makeStore()) {
  const service = new CouncilService(makeProjects(), makeAudit(), makeEngine(), storeParts.store)
  return { service, inserted: storeParts.inserted }
}

describe('CouncilService — spec mode orchestration', () => {
  it('falls back to the claude engine when a seat’s primary throws, and flags it', async () => {
    const { service } = makeService()
    const result = await service.run('prj_1', { mode: 'spec', specText: 'Add caching to the gateway.' })

    const byId = Object.fromEntries(result.seats.map((s) => [s.id, s]))
    expect(byId['first-principles'].usedFallback).toBe(true)
    expect(byId['first-principles'].engine).toEqual({ engine: 'claude', model: 'sonnet' })
    expect(byId['first-principles'].ok).toBe(true)
    expect(byId.builder.usedFallback).toBe(true)
    expect(byId.builder.engine).toEqual({ engine: 'claude', model: 'opus' })
    // Claude-native seats never touch a fallback.
    expect(byId.contrarian.usedFallback).toBe(false)
    expect(result.stats.seatsRun).toBe(5)
    expect(result.stats.seatsFailed).toBe(0)
  })

  it('produces the spec gate, ranks, and a filesReviewed=0 diff-free run', async () => {
    const { service } = makeService()
    const result = await service.run('prj_1', {
      mode: 'spec',
      specText: 'Add caching to the gateway. It should be fast.',
      cardId: 'card_9',
    })
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('spec')
    expect(result.stats.filesReviewed).toBe(0)
    expect(result.specVerdict).toEqual({
      kind: 'needs_clarification',
      questions: ['What is the latency target?', 'Which module is the gateway?'],
    })
    expect(result.rankings.length).toBeGreaterThanOrEqual(2)
    expect(result.aggregate.length).toBeGreaterThan(0)
    expect(result.sessionId).toBe('sess-1')
  })

  it('redacts secrets in the question before engines see it or it persists (argos M1)', async () => {
    const { service, inserted } = makeService()
    const result = await service.run('prj_1', {
      mode: 'spec',
      specText: 'Add caching to the gateway. It should be fast.',
      question: 'Wire the deploy task.\n\nAPI_KEY=sk-live-9f8e7d6c5b4a3210',
    })
    expect(result.ok).toBe(true)
    expect(inserted[0].question).toContain('[REDACTED]')
    expect(inserted[0].question).not.toContain('sk-live-9f8e7d6c5b4a3210')
  })

  it('returns a clean error (and persists nothing) when spec text is missing', async () => {
    const { service, inserted } = makeService()
    const result = await service.run('prj_1', { mode: 'spec' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/draft spec/i)
    expect(result.sessionId).toBeNull()
    expect(result.seats).toEqual([])
    expect(inserted).toHaveLength(0)
  })

  it('persists every completed run, carrying the spec verdict kind', async () => {
    const { service, inserted } = makeService()
    await service.run('prj_1', { mode: 'spec', specText: 'do the thing', cardId: 'card_1' })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].cardId).toBe('card_1')
    expect(inserted[0].mode).toBe('spec')
    expect(inserted[0].result.specVerdict?.kind).toBe('needs_clarification')
  })

  it('merges recent sessions into a best-first scorecard', async () => {
    const parts = makeStore()
    const { service } = makeService(parts)
    await service.run('prj_1', { mode: 'spec', specText: 'first spec' })
    await service.run('prj_1', { mode: 'spec', specText: 'second spec' })
    const scorecard = service.scorecard('prj_1')
    expect(scorecard.length).toBeGreaterThan(0)
    // Sorted best (lowest average rank) first.
    for (let i = 1; i < scorecard.length; i += 1) {
      expect(scorecard[i].averageRank).toBeGreaterThanOrEqual(scorecard[i - 1].averageRank)
    }
    expect(scorecard.every((e) => e.sessions === 2)).toBe(true)
  })
})

describe('CouncilService — sentinel signal (Faz A)', () => {
  it('raises a council notice when a spec gate returns needs_clarification', async () => {
    const report = vi.fn()
    const service = new CouncilService(makeProjects(), makeAudit(), makeEngine(), makeStore().store, {
      report,
    })
    await service.run('prj_1', {
      mode: 'spec',
      specText: 'Add caching to the gateway.',
      question: 'Cache the gateway reads',
    })
    expect(report).toHaveBeenCalledTimes(1)
    const arg = report.mock.calls[0][0] as { severity: string; source: string; title: string; context: string }
    expect(arg.severity).toBe('notice')
    expect(arg.source).toBe('council')
    expect(arg.title).toContain('clarification')
    expect(arg.title).toContain('Cache the gateway reads')
    // The open questions ride along as the context that seeds a later chat opener.
    expect(arg.context).toContain('latency target')
  })

  it('stays silent when no seat responds (no verdict to gate on)', async () => {
    const report = vi.fn()
    const deadEngine = { call: vi.fn(async () => { throw new Error('all engines down') }) } as never
    const service = new CouncilService(makeProjects(), makeAudit(), deadEngine, makeStore().store, {
      report,
    })
    const result = await service.run('prj_1', { mode: 'spec', specText: 'do the thing' })
    expect(result.ok).toBe(false)
    expect(report).not.toHaveBeenCalled()
  })
})

describe('CouncilService — project memory pointers (Faz D)', () => {
  /** An engine that records every prompt it is handed, so a test can inspect the
   *  seat prompts. Claude answers; OpenRouter/Codex throw (fall back to claude). */
  function makeCapturingEngine() {
    const prompts: string[] = []
    const call = vi.fn(async (spec: { engine: string }, prompt: string) => {
      prompts.push(prompt)
      if (spec.engine === 'openrouter') throw new Error('no key')
      if (spec.engine === 'codex') throw new Error('no cli')
      if (prompt.includes('Refined Spec')) return '### 🎯 Verdict\nAPPROVED\nfine'
      if (prompt.includes('FINAL RANKING')) return 'FINAL RANKING:\n1. Response A\n2. Response B'
      return `seat reply via ${spec.engine}`
    })
    return { engine: { call } as unknown as EngineRunner, prompts }
  }

  const memoryWith = (notes: { name: string; hook: string | null; updatedAt: string }[]) => ({
    listHooks: () => notes,
  })

  it('includes an inline memory-pointer block in the spec seats when the collaborator is present', async () => {
    const { engine, prompts } = makeCapturingEngine()
    const memory = memoryWith([
      { name: 'gateway-caching', hook: 'the gateway caches reads for 60s', updatedAt: 't2' },
      { name: 'unrelated-note', hook: 'about the billing window', updatedAt: 't1' },
    ])
    const service = new CouncilService(makeProjects(), makeAudit(), engine, makeStore().store, undefined, memory)

    await service.run('prj_1', { mode: 'spec', specText: 'Add caching to the gateway.' })

    const seatPrompts = prompts.filter((p) => !p.includes('FINAL RANKING') && !p.includes('Refined Spec'))
    expect(seatPrompts.length).toBeGreaterThan(0)
    expect(seatPrompts.every((p) => p.includes('Project memory pointers'))).toBe(true)
    // The relevant note surfaces in the block.
    expect(seatPrompts[0]).toContain('gateway-caching')
  })

  it('omits the memory block entirely when no memory collaborator is wired', async () => {
    const { engine, prompts } = makeCapturingEngine()
    const service = new CouncilService(makeProjects(), makeAudit(), engine, makeStore().store)

    await service.run('prj_1', { mode: 'spec', specText: 'Add caching to the gateway.' })

    expect(prompts.every((p) => !p.includes('Project memory pointers'))).toBe(true)
  })
})

// ---- CouncilSessionStore against a tiny fake Db (no better-sqlite3 in Node) ----

interface StoredRow {
  id: string
  project_id: string
  card_id: string | null
  mode: string
  question: string | null
  result_json: string
  verdict_kind: string | null
  created_at: string
}

function fakeDb() {
  const rows: StoredRow[] = []
  const db = {
    prepare(sql: string) {
      if (sql.includes('INSERT INTO council_sessions')) {
        return {
          run: (p: {
            id: string
            projectId: string
            cardId: string | null
            mode: string
            question: string | null
            resultJson: string
            verdictKind: string | null
            createdAt: string
          }) => {
            rows.push({
              id: p.id,
              project_id: p.projectId,
              card_id: p.cardId,
              mode: p.mode,
              question: p.question,
              result_json: p.resultJson,
              verdict_kind: p.verdictKind,
              created_at: p.createdAt,
            })
          },
        }
      }
      if (sql.includes('WHERE project_id')) {
        return { all: (projectId: string) => rows.filter((r) => r.project_id === projectId) }
      }
      return { get: (id: string) => rows.find((r) => r.id === id) }
    },
  }
  return { db: db as unknown as Db, rows }
}

function specResult(): CouncilResult {
  return {
    ok: true,
    mode: 'spec',
    seats: [],
    rankings: [],
    aggregate: [{ seatId: 'contrarian', averageRank: 1, count: 1 }],
    labelToSeat: {},
    verdict: '### 🎯 Verdict\nNEEDS_CLARIFICATION',
    specVerdict: { kind: 'needs_clarification', questions: ['Why?'] },
    error: null,
    stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 0, durationMs: 10 },
    sessionId: null,
  }
}

describe('CouncilSessionStore', () => {
  it('derives verdict_kind, stamps the session id into the stored result, and round-trips', () => {
    const { db, rows } = fakeDb()
    const store = new CouncilSessionStore(db)
    const id = store.insert({
      projectId: 'prj_1',
      cardId: 'card_1',
      mode: 'spec',
      question: 'q',
      result: specResult(),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].verdict_kind).toBe('needs_clarification')
    // The persisted blob carries its own id.
    expect(JSON.parse(rows[0].result_json).sessionId).toBe(id)

    const fetched = store.get(id)
    expect(fetched?.mode).toBe('spec')
    expect(fetched?.result.aggregate).toEqual([{ seatId: 'contrarian', averageRank: 1, count: 1 }])

    const recent = store.listRecent('prj_1')
    expect(recent).toHaveLength(1)
    expect(recent[0].result.specVerdict?.kind).toBe('needs_clarification')
  })
})
