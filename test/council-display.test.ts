import { describe, expect, it } from 'vitest'
import type { CouncilResult } from '../shared/council'
import {
  buildCouncilDisplay,
  parseCouncilMarkdown,
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
})
