import { describe, expect, it, vi } from 'vitest'
import { CouncilService } from '../electron/main/services/CouncilService'
import type { CouncilSessionStore } from '../electron/main/db/CouncilSessionStore'
import type { EngineRunner } from '../electron/main/services/EngineRunner'
import type { ProjectService } from '../electron/main/services/ProjectService'
import type { AuditLogService } from '../electron/main/services/AuditLogService'
import type { CouncilEvidenceCollector } from '../electron/main/services/CouncilEvidenceService'
import type {
  CouncilAnalysisEgressPolicy,
  CouncilEvidencePack,
} from '../shared/council-evidence'
import type { CouncilResultLike } from '../shared/council'

function evidencePack(): CouncilEvidencePack {
  return {
    schemaVersion: 1,
    repository: {
      workspaceHash: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64),
      headRef: 'refs/heads/main',
      filesVisited: 30,
      filesRead: 12,
      canonicalMemoryMdPresent: false,
    },
    sources: [
      {
        id: 'input-001',
        kind: 'input',
        label: 'User analysis request',
        path: null,
        content: 'Analyze memory architecture.',
        startLine: null,
        endLine: null,
        sha256: null,
        updatedAt: null,
        truncated: false,
        injectionSuspect: false,
      },
      {
        id: 'repo-001',
        kind: 'repository',
        label: 'shared/memory-note-schema.ts:1-20',
        path: 'shared/memory-note-schema.ts',
        content: 'export interface MemoryNoteMetadata { type: MemoryNoteType }',
        startLine: 1,
        endLine: 20,
        sha256: 'c'.repeat(64),
        updatedAt: null,
        truncated: false,
        injectionSuspect: false,
      },
      {
        id: 'memory-001',
        kind: 'memory',
        label: '.cockpit-memory/council-memory.md',
        path: '.cockpit-memory/council-memory.md',
        content: null,
        startLine: null,
        endLine: null,
        sha256: null,
        updatedAt: '2026-07-11T00:00:00.000Z',
        truncated: false,
        injectionSuspect: false,
      },
    ],
    unknowns: ['No canonical MEMORY.md exists in the scanned repository manifest.'],
    totalChars: 90,
    truncated: false,
  }
}

function makeParts(policy: CouncilAnalysisEgressPolicy) {
  const inserted: CouncilResultLike[] = []
  const rows: Array<{ id: string; result: CouncilResultLike | null }> = []
  const sessions = {
    sweepStalePending: () => 0,
    insertPending: () => {
      rows.push({ id: 'sess-analysis', result: null })
      return 'sess-analysis'
    },
    finalize: (_id: string, result: CouncilResultLike) => {
      inserted.push(result)
      rows[0].result = result
    },
    insert: ({ result }: { result: CouncilResultLike }) => {
      inserted.push(result)
      return 'sess-analysis'
    },
    listRecent: () => [],
    get: () => null,
  } as unknown as CouncilSessionStore
  const call = vi.fn(async (
    _engine: { engine: string },
    prompt: string,
    _opts: { cwd: string; evidenceOnly?: boolean },
  ) => {
    if (prompt.startsWith('You are the Chairman of a repository-analysis Council')) {
      return [
        'CLAIM 1:',
        'SOURCE: REPOSITORY',
        'EVIDENCE: repo-001',
        'TEXT: MemoryNoteMetadata is the typed note metadata contract.',
        'CLAIM 2:',
        'SOURCE: REPOSITORY',
        'EVIDENCE: repo-404',
        'TEXT: A vector_records table is the canonical source of truth.',
        'CLAIM 3:',
        'SOURCE: MEMORY',
        'EVIDENCE: memory-001',
        'TEXT: Existing project memory records the Council redesign decision.',
      ].join('\n')
    }
    if (prompt.includes('FINAL RANKING')) {
      return 'FINAL RANKING:\n1. Response A\n2. Response B\n3. Response C\n4. Response D\n5. Response E'
    }
    return [
      'FINDING 1: The metadata type is directly visible in repo-001.',
      'IMPACT: The redesign must migrate the typed contract safely.',
      'RECOMMENDATION: Preserve compatibility while adding provenance.',
      'BASIS: EVIDENCE',
      'EVIDENCE: repo-001',
    ].join('\n')
  })
  const collect = vi.fn(async () => evidencePack())
  const evidence = { collect } as unknown as CouncilEvidenceCollector
  const memoryContexts = {
    forTask: vi.fn(() => ({
      block: 'COCKPIT MEMORY — SOURCE .cockpit-memory/council-memory.md: compact hook',
      receipt: {
        contextId: 'memctx-analysis',
        surface: 'council_analysis' as const,
        status: 'ready' as const,
        delivery: 'inline' as const,
        notes: [
          {
            name: 'council-memory',
            path: '.cockpit-memory/council-memory.md',
            updatedAt: '2026-07-11T00:00:00.000Z',
            truncated: false,
          },
        ],
        characters: 80,
      },
    })),
  }
  const service = new CouncilService(
    { get: () => ({ id: 'p1', name: 'cockpiT', path: '/tmp/cockpit' }) } as unknown as ProjectService,
    { record: vi.fn() } as unknown as AuditLogService,
    { call } as unknown as EngineRunner,
    sessions,
    undefined,
    undefined,
    undefined,
    memoryContexts,
    evidence,
  )
  const run = (consent: boolean) =>
    service.run('p1', {
      mode: 'analysis',
      question: 'Audit the memory architecture.',
      specText: 'Inspect the repository and cite every claim.',
      analysisEgress: policy,
      analysisConsent: consent,
      responseLanguage: 'en',
    } as never)
  return { service, run, call, collect, inserted, rows, memoryContexts }
}

describe('CouncilService grounded analysis', () => {
  it('runs every model stage over one bounded evidence pack and persists cited v3 analysis', async () => {
    const parts = makeParts('account-models')

    const result = await parts.run(true)

    expect(result).toMatchObject({
      schemaVersion: 3,
      ok: true,
      mode: 'analysis',
      decision: { kind: 'analysis_complete' },
      primaryArtifact: { kind: 'analysisReport' },
      evidence: {
        analysis: {
          egress: { policy: 'account-models', allowedEngines: ['claude', 'codex'] },
        },
      },
    })
    expect(result.primaryArtifact?.content).toContain('## Sources used')
    expect(result.primaryArtifact?.content).toContain('shared/memory-note-schema.ts:1-20')
    expect(result.evidence.analysis?.claims).toMatchObject([
      { source: 'repository', verified: true, evidenceRefs: ['repo-001'] },
      { source: 'inference', verified: false, evidenceRefs: [] },
      { source: 'memory', verified: true, evidenceRefs: ['memory-001'] },
    ])
    expect(result.evidence.analysis?.pack.sources.map((source) => source.id)).toEqual([
      'repo-001',
      'memory-001',
    ])
    expect(result.evidence.analysis?.pack.sources.every((source) => source.content === null))
      .toBe(true)
    expect(JSON.stringify(result)).not.toContain(
      'export interface MemoryNoteMetadata { type: MemoryNoteType }',
    )
    expect(parts.collect).toHaveBeenCalledTimes(1)
    // Account-only egress cannot run the fixed DeepSeek seat and does not
    // silently substitute another model: four seats + four rankings + chairman.
    expect(parts.call).toHaveBeenCalledTimes(9)
    expect(result.seats.find((seat) => seat.id === 'first-principles')).toMatchObject({
      ok: false,
      engine: { engine: 'openrouter' },
    })
    expect(parts.call.mock.calls.every(([engine]) => engine.engine !== 'openrouter')).toBe(true)
    expect(parts.call.mock.calls.every(([, prompt]) => prompt.includes('repo-001'))).toBe(true)
    expect(parts.call.mock.calls.every(([, , opts]) => opts.evidenceOnly === true)).toBe(true)
    expect(parts.call.mock.calls.every(([, , opts]) => opts.cwd !== '/tmp/cockpit')).toBe(true)
    expect(parts.inserted[0]).toMatchObject({ schemaVersion: 3, mode: 'analysis' })
  })

  it('local-only collects and persists a source inventory with zero model calls', async () => {
    const parts = makeParts('local-only')

    const result = await parts.run(false)

    expect(result).toMatchObject({
      ok: true,
      mode: 'analysis',
      decision: { kind: 'analysis_complete' },
      evidence: { analysis: { egress: { policy: 'local-only', consent: false } } },
    })
    expect(result.primaryArtifact?.content).toMatch(/no model synthesis/i)
    expect(parts.collect).toHaveBeenCalledTimes(1)
    expect(parts.call).not.toHaveBeenCalled()
    expect(parts.inserted).toHaveLength(1)
  })

  it('requires explicit consent before any repository content reaches an engine', async () => {
    const parts = makeParts('all-configured')

    const result = await parts.run(false)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/explicit consent/i)
    expect(parts.collect).not.toHaveBeenCalled()
    expect(parts.call).not.toHaveBeenCalled()
    expect(parts.rows).toHaveLength(0)
  })

  it('allows OpenRouter only under the all-configured policy with consent', async () => {
    const parts = makeParts('all-configured')

    await parts.run(true)

    expect(parts.call.mock.calls.some(([engine]) => engine.engine === 'openrouter')).toBe(true)
  })

  it('keeps raw CLI failures private and never calls engines disallowed by policy', async () => {
    const parts = makeParts('account-models')
    parts.call.mockRejectedValue({
      stderr: 'provider failed at /Users/example/private with sk-secret-secret-secret',
    })

    const result = await parts.run(true)

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('/Users/example/private')
    expect(JSON.stringify(result)).not.toContain('sk-secret-secret-secret')
    expect(parts.call.mock.calls.every(([engine]) => engine.engine !== 'openrouter')).toBe(true)
    expect(result.seats.find((seat) => seat.id === 'first-principles')).toMatchObject({
      ok: false,
      engine: { engine: 'openrouter' },
    })
  })
})
