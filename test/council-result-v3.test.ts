import { describe, expect, it } from 'vitest'
import type { Db } from '../electron/main/db/Database'
import { CouncilSessionStore } from '../electron/main/db/CouncilSessionStore'
import {
  COUNCIL_V3_LIMITS,
  composeCouncilBrief,
  councilSpecVerdictKind,
  isApprovedCouncilSpec,
  normalizeCouncilResult,
  type CouncilResult,
  type CouncilResultV3,
} from '../shared/council'

const stats = {
  seatsRun: 2,
  seatsFailed: 0,
  filesReviewed: 0,
  durationMs: 25,
}

function legacy(over: Partial<CouncilResult> = {}): CouncilResult {
  return {
    ok: true,
    mode: 'spec',
    seats: [
      {
        id: 'builder',
        label: 'Builder',
        engine: { engine: 'codex', model: 'gpt-5.6-sol' },
        usedFallback: false,
        text: 'Implement behind a compatibility adapter.',
        ok: true,
      },
    ],
    rankings: [],
    aggregate: [],
    labelToSeat: {},
    verdict:
      '### Verdict\nAPPROVED\n\n### Refined Spec\n**Goal** Ship the adapter.\n**Acceptance criteria** Old sessions still open.',
    specVerdict: { kind: 'approved', questions: [] },
    error: null,
    stats,
    sessionId: 'legacy-1',
    ...over,
  }
}

function v3(over: Partial<CouncilResultV3> = {}): CouncilResultV3 {
  return {
    schemaVersion: 3,
    ok: true,
    mode: 'analysis',
    responseLanguage: 'tr',
    decision: {
      kind: 'analysis_complete',
      summary: 'Memory sistemi iki ayrı brain kullanıyor.',
      why: 'Repository evidence aynı sonucu destekliyor.',
      questions: [],
      keyFindings: ['Project ve global brain ayrıdır.'],
      dissent: [],
    },
    primaryArtifact: {
      kind: 'analysisReport',
      content: '# Repository analysis\n\nEvidence-backed report.',
    },
    execution: { stats },
    evidence: {
      seats: [],
      rankings: [],
      aggregate: [],
      labelToSeat: {},
      rawChairman: 'raw chairman evidence',
    },
    error: null,
    sessionId: 'v3-1',
    ...over,
  }
}

describe('normalizeCouncilResult', () => {
  it('adapts an unversioned persisted v2 result without rewriting it', () => {
    const raw = legacy()
    const normalized = normalizeCouncilResult(raw)

    expect(normalized).toMatchObject({
      schemaVersion: 2,
      mode: 'spec',
      responseLanguage: 'und',
      decision: { kind: 'approved' },
      primaryArtifact: { kind: 'refinedSpec' },
      sessionId: 'legacy-1',
    })
    expect(normalized?.seats[0].id).toBe('builder')
    expect(raw).not.toHaveProperty('schemaVersion')
  })

  it('adapts v3 without markdown archaeology and keeps raw evidence separate', () => {
    const normalized = normalizeCouncilResult(v3())

    expect(normalized).toMatchObject({
      schemaVersion: 3,
      mode: 'analysis',
      responseLanguage: 'tr',
      decision: { kind: 'analysis_complete' },
      primaryArtifact: { kind: 'analysisReport' },
      specVerdict: null,
      verdict: 'raw chairman evidence',
    })
  })

  it('bounds decision arrays, prose, and the primary artifact defensively', () => {
    const raw = v3({
      decision: {
        kind: 'analysis_complete',
        summary: 's'.repeat(COUNCIL_V3_LIMITS.summaryChars + 500),
        why: 'w'.repeat(COUNCIL_V3_LIMITS.whyChars + 500),
        questions: Array.from({ length: 10 }, (_, i) => ({
          id: `q-${i}`,
          question: `Question ${i}`,
          why: null,
          recommendedAnswer: null,
        })),
        keyFindings: Array.from({ length: 30 }, (_, i) => `Finding ${i}`),
        dissent: Array.from({ length: 30 }, (_, i) => `Dissent ${i}`),
      },
      primaryArtifact: {
        kind: 'analysisReport',
        content: 'x'.repeat(COUNCIL_V3_LIMITS.primaryArtifactChars + 500),
      },
    })
    const normalized = normalizeCouncilResult(raw)!

    expect(normalized.decision.summary.length).toBeLessThanOrEqual(COUNCIL_V3_LIMITS.summaryChars)
    expect(normalized.decision.why!.length).toBeLessThanOrEqual(COUNCIL_V3_LIMITS.whyChars)
    expect(normalized.decision.questions).toHaveLength(COUNCIL_V3_LIMITS.questions)
    expect(normalized.decision.keyFindings).toHaveLength(COUNCIL_V3_LIMITS.keyFindings)
    expect(normalized.decision.dissent).toHaveLength(COUNCIL_V3_LIMITS.dissent)
    expect(normalized.primaryArtifact!.content.length).toBeLessThanOrEqual(
      COUNCIL_V3_LIMITS.primaryArtifactChars,
    )
  })

  it('returns null for malformed or partial blobs instead of crashing consumers', () => {
    expect(normalizeCouncilResult(null)).toBeNull()
    expect(normalizeCouncilResult({ schemaVersion: 3, mode: 'analysis' })).toBeNull()
    expect(normalizeCouncilResult({ ok: true, mode: 'spec', seats: [] })).toBeNull()
    expect(normalizeCouncilResult({ ...legacy(), schemaVersion: 99 })).toBeNull()
    expect(normalizeCouncilResult({ ...v3(), responseLanguage: '' })).toBeNull()
    expect(normalizeCouncilResult({ ...v3(), evidence: {} })).toBeNull()
    expect(
      normalizeCouncilResult({
        ...v3(),
        execution: { ...v3().execution, memoryContext: {} },
      }),
    ).toBeNull()
    expect(
      normalizeCouncilResult({
        ...v3(),
        primaryArtifact: { kind: 'refinedSpec', content: 'Wrong intent.' },
      }),
    ).toBeNull()
  })

  it('strips a stray legacy spec verdict from non-spec modes', () => {
    const normalized = normalizeCouncilResult(
      legacy({ mode: 'diff', specVerdict: { kind: 'approved', questions: [] } }),
    )

    expect(normalized?.specVerdict).toBeNull()
    expect(councilSpecVerdictKind(normalized)).toBeNull()
  })
})

describe('spec-gate isolation', () => {
  it('never treats analysis as an approved spec even if its decision token says approved', () => {
    const analysis = v3({
      decision: { ...v3().decision, kind: 'approved' },
    })

    expect(councilSpecVerdictKind(analysis)).toBeNull()
    expect(isApprovedCouncilSpec(analysis)).toBe(false)
    expect(composeCouncilBrief(analysis)).toBeNull()
  })

  it('accepts a real v3 spec decision and composes the worker brief from its artifact', () => {
    const spec = v3({
      mode: 'spec',
      decision: {
        kind: 'approved',
        summary: 'The brief is buildable.',
        why: 'All acceptance criteria are testable.',
        questions: [],
        keyFindings: [],
        dissent: [],
      },
      primaryArtifact: {
        kind: 'refinedSpec',
        content: '**Goal** Ship v3 safely.\n**Acceptance criteria** Legacy sessions still open.',
      },
      evidence: {
        ...v3().evidence,
        seats: [
          {
            id: 'builder',
            label: 'Builder',
            engine: { engine: 'codex', model: 'gpt-5.6-sol' },
            usedFallback: false,
            text: 'Use one shared adapter.',
            ok: true,
          },
        ],
      },
    })

    expect(councilSpecVerdictKind(spec)).toBe('approved')
    expect(isApprovedCouncilSpec(spec)).toBe(true)
    expect(composeCouncilBrief(spec)).toContain('Ship v3 safely')
  })
})

interface SessionRow {
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

function sessionDb(row: SessionRow): Db {
  return {
    prepare() {
      return {
        get: () => row,
        all: () => [row],
        run: () => ({ changes: 1 }),
      }
    },
  } as unknown as Db
}

describe('CouncilSessionStore compatibility adapter', () => {
  it('hydrates a legacy v2 row through the normalized contract', () => {
    const store = new CouncilSessionStore(
      sessionDb({
        id: 'legacy-1',
        project_id: 'p1',
        card_id: 'c1',
        mode: 'spec',
        question: 'q',
        result_json: JSON.stringify(legacy()),
        verdict_kind: 'approved',
        status: 'final',
        created_at: 't1',
      }),
    )

    expect(store.get('legacy-1')?.result).toMatchObject({
      schemaVersion: 2,
      decision: { kind: 'approved' },
    })
  })

  it('hydrates a v3 analysis row without manufacturing a spec verdict', () => {
    const store = new CouncilSessionStore(
      sessionDb({
        id: 'v3-1',
        project_id: 'p1',
        card_id: null,
        mode: 'analysis',
        question: 'q',
        result_json: JSON.stringify(v3()),
        verdict_kind: 'approved',
        status: 'final',
        created_at: 't1',
      }),
    )

    const session = store.get('v3-1')
    const result = session?.result
    expect(result?.mode).toBe('analysis')
    expect(result?.specVerdict).toBeNull()
    expect(councilSpecVerdictKind(result)).toBeNull()
    expect(session?.verdictKind).toBeNull()
  })
})
