import { describe, expect, it } from 'vitest'
import type { CouncilResult, CouncilResultV3 } from '../shared/council'
import {
  buildClarificationContinuation,
  buildCouncilDisplay,
  parseCouncilInline,
  parseCouncilMarkdown,
  primaryCouncilArtifact,
  serializeCouncilReport,
  summarizeCouncilSeat,
} from '../shared/council-display'

function result(overrides: Partial<CouncilResult> = {}): CouncilResult {
  return {
    ok: true,
    mode: 'spec',
    seats: [],
    rankings: [],
    aggregate: [],
    labelToSeat: {},
    verdict: null,
    specVerdict: null,
    error: null,
    stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 0, durationMs: 1200 },
    sessionId: 'session-1',
    ...overrides,
  }
}

function analysisResult(): CouncilResultV3 {
  return {
    schemaVersion: 3,
    ok: true,
    mode: 'analysis',
    responseLanguage: 'tr',
    decision: {
      kind: 'analysis_complete',
      summary: 'Memory yazma ve retrieval yolları birbirinden kopuk.',
      why: 'Üç ayrı servis aynı policy kararını tekrar ediyor.',
      questions: [],
      keyFindings: ['Tek normalize sınırı eksik.'],
      dissent: [],
    },
    primaryArtifact: {
      kind: 'analysisReport',
      content: '# Repository Analysis\n\nStructured artifact; no verdict heading required.',
    },
    evidence: {
      seats: [],
      rankings: [],
      aggregate: [],
      labelToSeat: {},
      rawChairman: 'RAW evidence that must not become the primary artifact.',
    },
    execution: {
      stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 12, durationMs: 500 },
    },
    error: null,
    sessionId: 'analysis-1',
  }
}

describe('buildCouncilDisplay', () => {
  it('puts a clarification verdict, its why, and author questions first', () => {
    const display = buildCouncilDisplay(
      result({
        verdict: [
          '### Verdict',
          'NEEDS_CLARIFICATION',
          'The target module is unnamed — a builder would guess. More detail follows.',
          '',
          '### Refined Spec',
          '**Goal** — Cache gateway reads.',
          '**Acceptance criteria** — 1. Cached reads finish below 40ms. 2. Writes invalidate the key.',
        ].join('\n'),
        specVerdict: {
          kind: 'needs_clarification',
          questions: ['Which module is the gateway?', 'What is the latency target?'],
        },
      }),
    )

    expect(display.kind).toBe('clarify')
    expect(display.label).toBe('NEEDS CLARIFICATION')
    expect(display.why).toBe('The target module is unnamed — a builder would guess.')
    expect(display.questions).toEqual([
      'Which module is the gateway?',
      'What is the latency target?',
    ])
    expect(display.clarifications).toEqual([
      {
        id: 'question-1',
        question: 'Which module is the gateway?',
        why: null,
        recommendedAnswer: null,
      },
      {
        id: 'question-2',
        question: 'What is the latency target?',
        why: null,
        recommendedAnswer: null,
      },
    ])
  })

  it('exposes the chairman guidance attached to each clarification', () => {
    const display = buildCouncilDisplay(
      result({
        verdict: '### Verdict\nNEEDS_CLARIFICATION\nTwo product choices remain.',
        specVerdict: {
          kind: 'needs_clarification',
          questions: ['How long may results stay stale?'],
          clarifications: [
            {
              id: 'question-1',
              question: 'How long may results stay stale?',
              why: 'This changes cache invalidation behavior.',
              recommendedAnswer: 'Allow up to 30 seconds.',
            },
          ],
        },
      }),
    )

    expect(display.clarifications).toEqual([
      {
        id: 'question-1',
        question: 'How long may results stay stale?',
        why: 'This changes cache invalidation behavior.',
        recommendedAnswer: 'Allow up to 30 seconds.',
      },
    ])
  })

  it('extracts the approved spec goal and numbered acceptance criteria', () => {
    const display = buildCouncilDisplay(
      result({
        verdict: [
          '### Verdict',
          'APPROVED',
          'The scope is testable and a builder can start.',
          '',
          '### Refined Spec',
          '**Goal** — Cache gateway reads.',
          '**Context** — Shared request layer.',
          '**Acceptance criteria**',
          '1. Cached reads finish below 40ms.',
          '2. Writes invalidate the matching key.',
          '**Constraints** — No dependency.',
        ].join('\n'),
        specVerdict: { kind: 'approved', questions: [] },
      }),
    )

    expect(display.kind).toBe('approved')
    expect(display.goal).toBe('Cache gateway reads.')
    expect(display.acceptanceCriteria).toEqual([
      'Cached reads finish below 40ms.',
      'Writes invalidate the matching key.',
    ])
    expect(display.refinedSpec).toContain('**Context**')
  })

  it('reports a failed synthesis honestly even when some seats returned', () => {
    const display = buildCouncilDisplay(
      result({ ok: false, error: 'Chairman timed out.', mode: 'diff' }),
    )
    expect(display).toMatchObject({
      kind: 'failed',
      label: 'FAILED',
      why: 'Chairman timed out.',
    })
  })

  it('renders a v3 analysis from structured decision/artifact fields without a spec gate', () => {
    const display = buildCouncilDisplay(analysisResult())

    expect(display).toMatchObject({
      kind: 'reviewed',
      label: 'REVIEWED',
      why: 'Memory yazma ve retrieval yolları birbirinden kopuk.',
      refinedSpec: null,
      chairmanAnalysis: '# Repository Analysis\n\nStructured artifact; no verdict heading required.',
    })
    expect(display.questions).toEqual([])
  })
})

describe('buildClarificationContinuation', () => {
  it('keeps the original request and turns the guided answers into explicit author decisions', () => {
    const continuation = buildClarificationContinuation('Build a calmer Council flow.', [
      {
        id: 'question-1',
        question: 'Should expert evidence be visible by default?',
        answer: 'No, keep it behind one disclosure.',
      },
      {
        id: 'question-2',
        question: 'Where should the user answer?',
        answer: 'Directly beneath each question.',
      },
    ])

    expect(continuation).toContain('Build a calmer Council flow.')
    expect(continuation).toContain('Should expert evidence be visible by default?')
    expect(continuation).toContain('No, keep it behind one disclosure.')
    expect(continuation).toContain('Where should the user answer?')
    expect(continuation).toContain('Directly beneath each question.')
    expect(continuation).toContain('These answers resolve the ambiguities')
  })
})

describe('council reading helpers', () => {
  it('parses headings, paragraphs, ordered lists, and unordered lists into blocks', () => {
    expect(
      parseCouncilMarkdown('# Heading\nIntro with `code`.\n\n1. First\n2. Second\n\n- One\n- Two'),
    ).toEqual([
      { type: 'heading', text: 'Heading' },
      { type: 'paragraph', text: 'Intro with `code`.' },
      { type: 'ordered-list', items: ['First', 'Second'] },
      { type: 'unordered-list', items: ['One', 'Two'] },
    ])
  })

  it('turns a long seat output into a single scannable sentence', () => {
    expect(
      summarizeCouncilSeat(
        'FEASIBILITY: buildable. The implementation needs three modules and a migration.',
      ),
    ).toBe('FEASIBILITY: buildable.')
  })

  it('parses fenced code, thematic breaks, emphasis, and safe links without HTML', () => {
    expect(
      parseCouncilMarkdown([
        'Before.',
        '',
        '---',
        '',
        '```ts',
        'const answer = 42',
        '```',
      ].join('\n')),
    ).toEqual([
      { type: 'paragraph', text: 'Before.' },
      { type: 'thematic-break' },
      { type: 'code-block', language: 'ts', code: 'const answer = 42' },
    ])
    expect(parseCouncilInline('Use *care* and [docs](https://example.com) with `code`.')).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'emphasis', text: 'care' },
      { type: 'text', text: ' and ' },
      { type: 'link', text: 'docs', href: 'https://example.com' },
      { type: 'text', text: ' with ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: '.' },
    ])
    expect(parseCouncilInline('[unsafe](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[unsafe](javascript:alert(1))' },
    ])
  })
})

describe('Council report artifacts', () => {
  const approved = result({
    seats: [
      {
        id: 'contrarian',
        label: 'Contrarian',
        engine: { engine: 'codex', model: 'gpt-5.6-sol' },
        usedFallback: true,
        ok: true,
        text: 'The migration needs a rollback path.',
      },
    ],
    rankings: [{
      seatId: 'contrarian',
      text: 'FINAL RANKING: Response A',
      parsed: ['Response A'],
    }],
    aggregate: [{ seatId: 'contrarian', averageRank: 1, count: 1 }],
    labelToSeat: { 'Response A': 'contrarian' },
    verdict: [
      '### Verdict',
      'APPROVED',
      'The scope is testable.',
      '',
      '### Refined Spec',
      '**Goal** — Ship the canonical brief once.',
      '**Acceptance criteria** — 1. Copy works. 2. Export works.',
      '',
      '### Final note',
      'Preserve the existing visual language.',
    ].join('\n'),
    specVerdict: { kind: 'approved', questions: [] },
  })

  it('returns the correct primary artifact for approved, clarify, and failed runs', () => {
    expect(primaryCouncilArtifact(approved)).toEqual({
      kind: 'brief',
      label: 'Copy primary brief',
      text: [
        '**Goal** — Ship the canonical brief once.',
        '**Acceptance criteria** — 1. Copy works. 2. Export works.',
      ].join('\n'),
    })
    expect(primaryCouncilArtifact(result({
      verdict: '### Verdict\nNEEDS_CLARIFICATION\nTwo choices remain.',
      specVerdict: {
        kind: 'needs_clarification',
        questions: ['Which module?', 'What retention window?'],
      },
    }))).toEqual({
      kind: 'questions',
      label: 'Copy clarification questions',
      text: '1. Which module?\n2. What retention window?',
    })
    expect(primaryCouncilArtifact(result({ ok: false, error: 'Chairman timed out.' }))).toEqual({
      kind: 'decision',
      label: 'Copy decision',
      text: 'Chairman timed out.',
    })
  })

  it('copies and exports the v3 primary artifact instead of raw chairman evidence', () => {
    const analysis = analysisResult()
    const primary = primaryCouncilArtifact(analysis)
    const report = serializeCouncilReport(analysis, { title: 'Memory system' })

    expect(primary).toEqual({
      kind: 'decision',
      label: 'Copy analysis report',
      text: '# Repository Analysis\n\nStructured artifact; no verdict heading required.',
    })
    expect(report).toContain('- Mode: `analysis`')
    expect(report).toContain('Structured artifact; no verdict heading required.')
    expect(report).not.toContain('RAW evidence that must not become the primary artifact.')
  })

  it('serializes one deterministic Markdown report with actual engines and no duplicated refined spec', () => {
    const first = serializeCouncilReport(approved, { title: 'Memory redesign' })
    const second = serializeCouncilReport(approved, { title: 'Memory redesign' })

    expect(second).toBe(first)
    expect(first).toContain('# Council Report — Memory redesign')
    expect(first).toContain('- Session: `session-1`')
    expect(first).toContain('## Decision')
    expect(first).toContain('## Refined Spec')
    expect(first).toContain('## Chairman Analysis')
    expect(first).toContain('### Contrarian')
    expect(first).toContain('- Engine: `codex · gpt-5.6-sol`')
    expect(first).toContain('- Fallback: yes')
    expect(first).toContain('## Peer Rankings')
    expect(first).toContain('## Aggregate Standings')
    expect(first.match(/Ship the canonical brief once\./g)).toHaveLength(1)
  })
})
