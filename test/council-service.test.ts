import { describe, expect, it, vi } from 'vitest'
import { CouncilService } from '../electron/main/services/CouncilService'
import type { EngineRunner } from '../electron/main/services/EngineRunner'
import type { AuditLogService } from '../electron/main/services/AuditLogService'
import type { ProjectService } from '../electron/main/services/ProjectService'
import {
  CouncilSessionStore,
  type CouncilSessionInput,
  type CouncilSessionPending,
  type CouncilSessionStatus,
} from '../electron/main/db/CouncilSessionStore'
import {
  councilSpecVerdictKind,
  normalizeCouncilResult,
  type CouncilResult,
  type CouncilResultLike,
  type NormalizedCouncilResult,
} from '../shared/council'
import type { Db } from '../electron/main/db/Database'
import { COUNCIL_STAGE_BUDGETS } from '../shared/council-stages'

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

/**
 * In-memory session store standing in for the SQLite-backed one, modelling the
 * A6 pending→final lifecycle. `inserted` collects the COMPLETED runs (via
 * finalize or the fallback insert) so the existing assertions on persisted runs
 * still hold; `rows` exposes lifecycle state for the durable-marker tests.
 */
interface FakeRow {
  id: string
  projectId: string
  cardId: string | null
  mode: CouncilSessionInput['mode']
  question: string | null
  result: NormalizedCouncilResult | null
  status: CouncilSessionStatus
}

function makeStore() {
  const rows: FakeRow[] = []
  const inserted: CouncilSessionInput[] = []
  let seq = 0
  const storedResult = (result: CouncilResultLike, sessionId: string): NormalizedCouncilResult => {
    const normalized = normalizeCouncilResult({ ...result, sessionId })
    if (!normalized) throw new Error('Fake CouncilSessionStore received an invalid result')
    return normalized
  }
  const store = {
    insertPending: (input: CouncilSessionPending) => {
      seq += 1
      const id = `sess-${seq}`
      rows.push({ ...input, id, result: null, status: 'pending' })
      return id
    },
    finalize: (id: string, result: CouncilResultLike) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return
      // The real store stamps the row's own id into the stored blob's sessionId.
      row.result = storedResult(result, id)
      row.status = 'final'
      inserted.push({
        projectId: row.projectId,
        cardId: row.cardId,
        mode: row.mode,
        question: row.question,
        result,
      })
    },
    insert: (input: CouncilSessionInput) => {
      seq += 1
      const id = `sess-${seq}`
      rows.push({ ...input, id, result: storedResult(input.result, id), status: 'final' })
      inserted.push(input)
      return id
    },
    sweepStalePending: () => {
      let n = 0
      for (const row of rows) {
        if (row.status === 'pending') {
          row.status = 'failed'
          n += 1
        }
      }
      return n
    },
    listRecent: (projectId: string) =>
      rows
        .filter(
          (r): r is FakeRow & { result: NormalizedCouncilResult } =>
            r.projectId === projectId && !!r.result,
        )
        .map((r) => ({
          id: r.id,
          projectId: r.projectId,
          cardId: r.cardId,
          mode: r.mode,
          question: r.question,
          result: r.result,
          verdictKind: councilSpecVerdictKind(r.result),
          status: r.status,
          createdAt: 'now',
        })),
    get: (id: string) => {
      const row = rows.find((r) => r.id === id)
      if (!row || !row.result) return null
      return {
        id: row.id,
        projectId: row.projectId,
        cardId: row.cardId,
        mode: row.mode,
        question: row.question,
        result: row.result,
        verdictKind: councilSpecVerdictKind(row.result),
        status: row.status,
        createdAt: 'now',
      }
    },
  }
  return { store: store as unknown as CouncilSessionStore, inserted, rows }
}

function makeService(storeParts = makeStore()) {
  const service = new CouncilService(makeProjects(), makeAudit(), makeEngine(), storeParts.store)
  return { service, inserted: storeParts.inserted, rows: storeParts.rows }
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
    // GPT-first seats reach Claude only after the Codex CLI is unavailable.
    expect(byId.contrarian.usedFallback).toBe(true)
    expect(byId.contrarian.engine).toEqual({ engine: 'claude', model: 'opus' })
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
    expect(councilSpecVerdictKind(inserted[0].result)).toBe('needs_clarification')
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

  it('enforces structured stage budgets and Turkish human prose instructions end to end', async () => {
    const calls: Array<{ prompt: string; maxTokens: number | undefined }> = []
    const engine = {
      call: vi.fn(
        async (
          _spec: { engine: string },
          prompt: string,
          opts: { maxTokens?: number },
        ) => {
          calls.push({ prompt, maxTokens: opts.maxTokens })
          if (prompt.startsWith('You are the Chairman')) {
            return [
              '### ⚖️ Consensus & Disagreement',
              'Ortak görüş. ' + 'uzun '.repeat(3_000),
              '### 🎯 Verdict',
              'APPROVED',
              'Görev uygulanabilir.',
              '### 📋 Refined Spec',
              '**Goal** Memory sistemini sadeleştir.\n' + 'detay '.repeat(6_000),
            ].join('\n')
          }
          if (prompt.startsWith('You are a member of an LLM Council. Below')) {
            return [
              `Long ranking essay that must disappear. ${'essay '.repeat(1_000)}`,
              'STRONGEST CONTRIBUTION: Response A — En önemli migration riskini buldu.',
              'COLLECTIVE GAP: Hiçbir yanıt crash recovery testini tanımlamadı.',
              'FACTUALITY FLAGS:',
              '- Response B kaynak göstermedi.',
              'FINAL RANKING:',
              '1. Response A',
              '2. Response B',
              '3. Response C',
              '4. Response D',
              '5. Response E',
            ].join('\n')
          }
          return Array.from({ length: 8 }, (_, index) => [
            `FINDING ${index + 1}: ${'bulgu '.repeat(120)}`,
            `IMPACT: ${'etki '.repeat(100)}`,
            `RECOMMENDATION: ${'öneri '.repeat(100)}`,
            'BASIS: EVIDENCE',
            `EVIDENCE: src/memory-${index}.ts:42`,
          ].join('\n')).join('\n\n')
        },
      ),
    } as unknown as EngineRunner
    const parts = makeStore()
    const service = new CouncilService(makeProjects(), makeAudit(), engine, parts.store)

    const result = await service.run('prj_1', {
      mode: 'spec',
      specText:
        'Memory sistemini daha sade ve guvenilir yapmak icin migration ve rollback kurallarini tanimla.',
    })

    expect(result.responseLanguage).toBe('tr')
    expect(result.seats.every((seat) => seat.text.length <= COUNCIL_STAGE_BUDGETS.seat.outputChars))
      .toBe(true)
    expect(
      result.rankings.every(
        (ranking) => ranking.text.length <= COUNCIL_STAGE_BUDGETS.ranking.outputChars,
      ),
    ).toBe(true)
    expect(result.rankings[0]).toMatchObject({
      collectiveGap: 'Hiçbir yanıt crash recovery testini tanımlamadı.',
      factualityFlags: ['Response B kaynak göstermedi.'],
    })
    expect(result.verdict!.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.chairman.outputChars,
    )
    expect(calls).toHaveLength(11)
    expect(calls.every((call) => call.prompt.includes('Human prose language: Turkish (tr)')))
      .toBe(true)
    expect(calls.slice(0, 5).every((call) => call.maxTokens === COUNCIL_STAGE_BUDGETS.seat.maxTokens))
      .toBe(true)
    expect(calls.slice(5, 10).every((call) => call.maxTokens === COUNCIL_STAGE_BUDGETS.ranking.maxTokens))
      .toBe(true)
    expect(calls[10].maxTokens).toBe(COUNCIL_STAGE_BUDGETS.chairman.maxTokens)
    expect(calls[10].prompt.length).toBeLessThanOrEqual(
      COUNCIL_STAGE_BUDGETS.chairman.inputChars,
    )
    expect(calls[10].prompt).not.toContain('Long ranking essay that must disappear.')
  })
})

describe('CouncilService — session detail (rehydrate channel)', () => {
  it('returns the full persisted result for a matching project + id', async () => {
    const parts = makeStore()
    const { service } = makeService(parts)
    const run = await service.run('prj_1', { mode: 'spec', specText: 'Add caching to the gateway.' })
    expect(run.sessionId).toBe('sess-1')

    const detail = service.session('prj_1', 'sess-1')
    expect(detail).not.toBeNull()
    expect(detail?.sessionId).toBe('sess-1')
    expect(detail?.mode).toBe('spec')
    expect(detail?.specVerdict?.kind).toBe('needs_clarification')
    expect(detail?.seats.length).toBe(5)
  })

  it('never leaks a session that belongs to another project (scoping)', async () => {
    const parts = makeStore()
    const { service } = makeService(parts)
    await service.run('prj_1', { mode: 'spec', specText: 'do the thing' })
    // Same store id, wrong project → the detail read must refuse it.
    expect(service.session('prj_OTHER', 'sess-1')).toBeNull()
  })

  it('returns null for an unknown session id', () => {
    const { service } = makeService()
    expect(service.session('prj_1', 'no-such-session')).toBeNull()
  })
})

describe('CouncilService — durable in-progress marker (A6)', () => {
  it('reserves a pending row at run start and finalizes it to final on completion', async () => {
    const parts = makeStore()
    const { service } = makeService(parts)
    await service.run('prj_1', { mode: 'spec', specText: 'Add caching to the gateway.' })
    expect(parts.rows).toHaveLength(1)
    expect(parts.rows[0].status).toBe('final')
    expect(parts.rows[0].result).not.toBeNull()
  })

  it('a completed run leaves no pending rows behind', async () => {
    const parts = makeStore()
    const { service } = makeService(parts)
    await service.run('prj_1', { mode: 'spec', specText: 'do the thing', cardId: 'c1' })
    expect(parts.rows.every((r) => r.status !== 'pending')).toBe(true)
  })

  it('never reserves a pending row for an early-exit (missing spec)', async () => {
    const parts = makeStore()
    const { service } = makeService(parts)
    const result = await service.run('prj_1', { mode: 'spec' })
    expect(result.ok).toBe(false)
    expect(parts.rows).toHaveLength(0)
  })

  it('sweeps a pending row left by a previous crashed run to failed at construction, auditing it', () => {
    const parts = makeStore()
    // Simulate a previous process that reserved a row but crashed before finalize.
    const orphanId = (
      parts.store as unknown as { insertPending: (i: CouncilSessionPending) => string }
    ).insertPending({ projectId: 'prj_1', cardId: null, mode: 'spec', question: null })
    expect(parts.rows.find((r) => r.id === orphanId)?.status).toBe('pending')

    const audit = { record: vi.fn() } as unknown as AuditLogService
    // Constructing the service runs the sweep.
    new CouncilService(makeProjects(), audit, makeEngine(), parts.store)

    expect(parts.rows.find((r) => r.id === orphanId)?.status).toBe('failed')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'council.pending_swept', actor: 'system' }),
    )
  })

  it('does not audit a sweep when there are no pending rows at construction', () => {
    const parts = makeStore()
    const audit = { record: vi.fn() } as unknown as AuditLogService
    new CouncilService(makeProjects(), audit, makeEngine(), parts.store)
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'council.pending_swept' }),
    )
  })

  it('never throws at construction when the store lacks the sweep method (fake store)', () => {
    const bareStore = {
      insertPending: () => 'x',
      finalize: () => undefined,
      insert: () => 'x',
      listRecent: () => [],
      get: () => null,
    } as unknown as CouncilSessionStore
    expect(() => new CouncilService(makeProjects(), makeAudit(), makeEngine(), bareStore)).not.toThrow()
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
    expect(seatPrompts[0]).not.toContain('unrelated-note')
  })

  it('uses the central memory gateway so matched hooks reach every council phase', async () => {
    const { engine, prompts } = makeCapturingEngine()
    const memoryContexts = {
      forTask: vi.fn(() => ({
        block: [
          'COCKPIT PROJECT MEMORY',
          'context_id: memctx_council',
          'status: ready',
          'Landing pages use molten obsidian and copper accents.',
        ].join('\n'),
        receipt: {
          contextId: 'memctx_council',
          surface: 'council_spec' as const,
          status: 'ready' as const,
          delivery: 'inline' as const,
          notes: [],
          characters: 140,
        },
      })),
    }
    const service = new CouncilService(
      makeProjects(),
      makeAudit(),
      engine,
      makeStore().store,
      undefined,
      undefined,
      undefined,
      memoryContexts,
    )

    const result = await service.run('prj_1', {
      mode: 'spec',
      specText: 'Redesign the landing page.',
    })

    expect(memoryContexts.forTask).toHaveBeenCalledWith({
      projectId: 'prj_1',
      surface: 'council_spec',
      query: expect.stringContaining('Redesign the landing page.'),
    })
    expect(prompts.length).toBeGreaterThan(5)
    expect(prompts.every((prompt) => prompt.includes('molten obsidian and copper accents'))).toBe(true)
    expect(result.memoryContext?.contextId).toBe('memctx_council')
  })

  it('records the selected notes as a council_spec recall in spec mode (G2)', async () => {
    const { engine } = makeCapturingEngine()
    const memory = memoryWith([
      { name: 'gateway-caching', hook: 'the gateway caches reads for 60s', updatedAt: 't2' },
      { name: 'unrelated-note', hook: 'about the billing window', updatedAt: 't1' },
    ])
    const record = vi.fn()
    const service = new CouncilService(
      makeProjects(),
      makeAudit(),
      engine,
      makeStore().store,
      undefined,
      memory,
      { record },
    )

    await service.run('prj_1', { mode: 'spec', specText: 'Add caching to the gateway.' })

    expect(record).toHaveBeenCalledWith(
      'project:prj_1',
      expect.arrayContaining(['gateway-caching']),
      'council_spec',
    )
  })

  it('does not record a recall when no memory note positively matches the spec', async () => {
    const { engine } = makeCapturingEngine()
    const memory = memoryWith([
      { name: 'billing-window', hook: 'invoices reset at midnight', updatedAt: 't1' },
    ])
    const record = vi.fn()
    const service = new CouncilService(
      makeProjects(),
      makeAudit(),
      engine,
      makeStore().store,
      undefined,
      memory,
      { record },
    )

    await service.run('prj_1', { mode: 'spec', specText: 'Redesign the landing page.' })

    expect(record).not.toHaveBeenCalled()
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
  status: string
  created_at: string
}

/**
 * A lifecycle-aware in-memory stand-in for the SQLite table (no better-sqlite3 in
 * Node). It routes the store's four write statements — pending insert, final
 * insert, finalize-by-id, pending→failed sweep — by SQL shape, and the two reads
 * by their WHERE clause.
 */
function fakeDb() {
  const rows: StoredRow[] = []
  const db = {
    prepare(sql: string) {
      if (sql.includes('INSERT INTO council_sessions')) {
        // insertPending stamps a `'pending'` literal + NULL verdict_kind; the
        // completed insert stamps `'final'` and a real @verdictKind param.
        const status = sql.includes("'pending'") ? 'pending' : 'final'
        return {
          run: (p: {
            id: string
            projectId: string
            cardId: string | null
            mode: string
            question: string | null
            resultJson: string
            verdictKind?: string | null
            createdAt: string
          }) => {
            rows.push({
              id: p.id,
              project_id: p.projectId,
              card_id: p.cardId,
              mode: p.mode,
              question: p.question,
              result_json: p.resultJson,
              verdict_kind: p.verdictKind ?? null,
              status,
              created_at: p.createdAt,
            })
            return { changes: 1 }
          },
        }
      }
      if (sql.includes('UPDATE council_sessions') && sql.includes("status = 'failed'")) {
        return {
          run: () => {
            let changes = 0
            for (const r of rows) {
              if (r.status === 'pending') {
                r.status = 'failed'
                changes += 1
              }
            }
            return { changes }
          },
        }
      }
      if (sql.includes('UPDATE council_sessions')) {
        // finalize by id
        return {
          run: (p: { id: string; resultJson: string; verdictKind: string | null }) => {
            const row = rows.find((r) => r.id === p.id)
            if (!row) return { changes: 0 }
            row.result_json = p.resultJson
            row.verdict_kind = p.verdictKind
            row.status = 'final'
            return { changes: 1 }
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
    // A row written by the completed-insert path reads back as final.
    expect(recent[0].status).toBe('final')
  })
})

describe('CouncilSessionStore — pending lifecycle (A6)', () => {
  it('insertPending reserves a queryable pending row with a well-formed placeholder result', () => {
    const { db, rows } = fakeDb()
    const store = new CouncilSessionStore(db)
    const id = store.insertPending({ projectId: 'prj_1', cardId: 'c1', mode: 'spec', question: 'q' })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
    // The placeholder is a valid CouncilResult so read paths never throw on it.
    const fetched = store.get(id)
    expect(fetched?.status).toBe('pending')
    expect(fetched?.result.ok).toBe(false)
    expect(fetched?.result.aggregate).toEqual([])
    expect(fetched?.result.sessionId).toBe(id)
  })

  it('uses a valid v3 placeholder for an analysis run so crash markers remain readable', () => {
    const { db } = fakeDb()
    const store = new CouncilSessionStore(db)

    const id = store.insertPending({
      projectId: 'prj_1',
      cardId: null,
      mode: 'analysis',
      question: 'Inspect memory architecture',
    })

    expect(store.get(id)).toMatchObject({
      mode: 'analysis',
      status: 'pending',
      verdictKind: null,
      result: { schemaVersion: 3, mode: 'analysis', specVerdict: null },
    })
  })

  it('refuses malformed completed results before they reach storage', () => {
    const { db, rows } = fakeDb()
    const store = new CouncilSessionStore(db)

    expect(() =>
      store.insert({
        projectId: 'prj_1',
        cardId: null,
        mode: 'spec',
        question: null,
        result: {} as CouncilResult,
      }),
    ).toThrow(/persistence contract/i)
    expect(rows).toHaveLength(0)
  })

  it('finalize replaces the placeholder and flips the row to final', () => {
    const { db } = fakeDb()
    const store = new CouncilSessionStore(db)
    const id = store.insertPending({ projectId: 'prj_1', cardId: null, mode: 'spec', question: null })
    store.finalize(id, specResult())
    const fetched = store.get(id)
    expect(fetched?.status).toBe('final')
    expect(fetched?.verdictKind).toBe('needs_clarification')
    expect(fetched?.result.aggregate).toEqual([{ seatId: 'contrarian', averageRank: 1, count: 1 }])
    expect(fetched?.result.sessionId).toBe(id)
  })

  it('sweepStalePending flips only pending rows to failed and returns the count; a repeat is a no-op', () => {
    const { db, rows } = fakeDb()
    const store = new CouncilSessionStore(db)
    const p1 = store.insertPending({ projectId: 'prj_1', cardId: null, mode: 'spec', question: null })
    store.insertPending({ projectId: 'prj_1', cardId: null, mode: 'diff', question: null })
    store.finalize(p1, specResult()) // p1 completes; one pending remains
    expect(store.sweepStalePending()).toBe(1)
    expect(rows.find((r) => r.id === p1)?.status).toBe('final')
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(1)
    expect(store.sweepStalePending()).toBe(0)
  })

  it('listRecent surfaces a swept (failed) row without breaking on its placeholder', () => {
    const { db } = fakeDb()
    const store = new CouncilSessionStore(db)
    store.insertPending({ projectId: 'prj_1', cardId: null, mode: 'spec', question: null })
    store.sweepStalePending()
    const recent = store.listRecent('prj_1')
    expect(recent).toHaveLength(1)
    expect(recent[0].status).toBe('failed')
    // The defensive parse yields the empty placeholder, never a throw.
    expect(recent[0].result.aggregate).toEqual([])
  })
})
