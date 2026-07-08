import { describe, expect, it } from 'vitest'
import type { SanitizedDiff } from '../shared/diff-sanitize'
import {
  COUNCIL_SEATS,
  COUNCIL_SEAT_IDS,
  anonymizeSeats,
  computeAggregateRankings,
  computeScorecard,
  parseRankingFromText,
  parseSpecVerdict,
  type CouncilRanking,
  type CouncilSeatOutput,
} from '../shared/council'
import {
  buildChairmanPrompt,
  buildRankingPrompt,
  buildSeatPrompt,
  buildSpecChairmanPrompt,
} from '../shared/council-prompts'

const sanitized: SanitizedDiff = {
  files: [{ path: 'src/pay.ts', content: '+const total = price * qty', truncated: false, untracked: false }],
  blockedFiles: [],
  summarizedFiles: [],
  injectionSuspects: [],
  totalChars: 26,
  truncatedTotal: false,
}

const seatOutputs = (): CouncilSeatOutput[] =>
  COUNCIL_SEATS.map((s) => ({
    id: s.id,
    label: s.label,
    engine: s.engine,
    usedFallback: false,
    text: `point from ${s.label}`,
    ok: true,
  }))

describe('council roster v2', () => {
  it('ships exactly the five seats with builder replacing executor', () => {
    expect(COUNCIL_SEATS).toHaveLength(5)
    expect(COUNCIL_SEAT_IDS).toEqual([
      'contrarian',
      'first-principles',
      'expansionist',
      'outsider',
      'builder',
    ])
  })

  it('mixes three vendors and gives keyless/second-CLI seats a claude fallback', () => {
    const byId = Object.fromEntries(COUNCIL_SEATS.map((s) => [s.id, s]))
    expect(byId.contrarian.engine).toEqual({ engine: 'claude', model: 'opus' })
    expect(byId['first-principles'].engine).toEqual({ engine: 'openrouter', model: 'deepseek/deepseek-chat' })
    expect(byId['first-principles'].fallback).toEqual({ engine: 'claude', model: 'sonnet' })
    expect(byId.builder.engine).toEqual({ engine: 'codex', model: '' })
    expect(byId.builder.fallback).toEqual({ engine: 'claude', model: 'opus' })
  })
})

describe('buildSeatPrompt', () => {
  it('carries the lens, intent, fenced diff, and diff-mode evidence rule', () => {
    const seat = COUNCIL_SEATS[0]
    const prompt = buildSeatPrompt(seat, {
      mode: 'diff',
      fenceTag: '==FENCE==',
      projectName: 'cockpiT',
      question: 'add tax to the total',
      sanitized,
    })
    expect(prompt).toContain(seat.prompt)
    expect(prompt).toContain('add tax to the total')
    expect(prompt).toContain('cockpiT')
    expect(prompt.match(/==FENCE==/g)).toHaveLength(3)
    expect(prompt).toContain('+const total = price * qty')
    expect(prompt).toContain('UNTRUSTED DATA')
    expect(prompt).toContain('Cite the exact file and line')
  })

  it('fences the spec and switches to the spec-sentence evidence rule in spec mode', () => {
    const seat = COUNCIL_SEATS[1]
    const prompt = buildSeatPrompt(seat, {
      mode: 'spec',
      fenceTag: '==F==',
      projectName: 'x',
      question: null,
      specText: 'Add caching to the gateway. It should be fast.',
    })
    expect(prompt.match(/==F==/g)).toHaveLength(3)
    expect(prompt).toContain('Add caching to the gateway')
    expect(prompt).toContain('UNTRUSTED DATA')
    expect(prompt).toContain('Quote the exact sentence')
    expect(prompt).toContain('buildable AS WRITTEN')
    expect(prompt).not.toContain('The author describes the task as')
  })

  it('appends the builder deliverables only for the builder seat', () => {
    const builder = COUNCIL_SEATS.find((s) => s.id === 'builder')!
    const contrarian = COUNCIL_SEATS[0]
    const builderPrompt = buildSeatPrompt(builder, {
      mode: 'spec',
      fenceTag: '==F==',
      projectName: 'x',
      question: null,
      specText: 'do the thing',
    })
    expect(builderPrompt).toContain('FEASIBILITY:')
    expect(builderPrompt).toContain('EFFORT: S, M, or L')
    expect(builderPrompt).toContain('AMBIGUITIES:')
    const others = buildSeatPrompt(contrarian, {
      mode: 'spec',
      fenceTag: '==F==',
      projectName: 'x',
      question: null,
      specText: 'do the thing',
    })
    expect(others).not.toContain('FEASIBILITY:')
  })

  it('fails fast when the mode is missing its material', () => {
    expect(() =>
      buildSeatPrompt(COUNCIL_SEATS[0], { mode: 'diff', fenceTag: '=', projectName: 'x', question: null }),
    ).toThrow(/diff mode requires/)
    expect(() =>
      buildSeatPrompt(COUNCIL_SEATS[0], { mode: 'spec', fenceTag: '=', projectName: 'x', question: null }),
    ).toThrow(/spec mode requires/)
  })
})

describe('buildRankingPrompt', () => {
  it('poses the collective-gap question and the strict ranking block', () => {
    const prompt = buildRankingPrompt(
      [
        { label: 'Response A', text: 'alpha take' },
        { label: 'Response B', text: 'beta take' },
      ],
      'diff',
    )
    expect(prompt).toContain('COLLECTIVE GAP')
    expect(prompt).toContain('FINAL RANKING:')
    expect(prompt).toContain('### Response A')
    expect(prompt).toContain('alpha take')
    expect(prompt).toContain('code change')
  })

  it('names the subject as a task spec in spec mode', () => {
    const prompt = buildRankingPrompt([{ label: 'Response A', text: 'x' }], 'spec')
    expect(prompt).toContain('task spec')
  })
})

describe('parseRankingFromText', () => {
  it('parses the strict numbered block after FINAL RANKING', () => {
    const text = 'blah\nFINAL RANKING:\n1. Response B\n2. Response A\n3. Response C'
    expect(parseRankingFromText(text)).toEqual(['Response B', 'Response A', 'Response C'])
  })

  it('tolerates messy spacing and lowercase marker', () => {
    const text = 'notes\nfinal ranking:\n1.Response C\n2.  Response A'
    expect(parseRankingFromText(text)).toEqual(['Response C', 'Response A'])
  })

  it('reads a numbered list even with no FINAL RANKING header', () => {
    expect(parseRankingFromText('1. Response A\n2. Response B')).toEqual(['Response A', 'Response B'])
  })

  it('falls back to any Response mention in order when nothing is numbered', () => {
    expect(parseRankingFromText('I prefer Response C over Response A.')).toEqual([
      'Response C',
      'Response A',
    ])
  })

  it('dedupes a repeated response', () => {
    expect(parseRankingFromText('FINAL RANKING:\n1. Response A\n2. Response A')).toEqual(['Response A'])
  })

  it('returns nothing when no response is named', () => {
    expect(parseRankingFromText('the winner is unclear')).toEqual([])
  })
})

describe('parseSpecVerdict', () => {
  it('reads APPROVED with no questions', () => {
    const text = '### 🎯 Verdict\nAPPROVED\nThe spec is buildable.'
    expect(parseSpecVerdict(text)).toEqual({ kind: 'approved', questions: [] })
  })

  it('reads NEEDS_CLARIFICATION and the numbered author questions', () => {
    const text = [
      '### 🎯 Verdict',
      'NEEDS_CLARIFICATION',
      'Two criteria are untestable.',
      '',
      '### ❓ Questions for the author',
      '1. What is the latency target?',
      '2. Which module is the gateway?',
    ].join('\n')
    expect(parseSpecVerdict(text)).toEqual({
      kind: 'needs_clarification',
      questions: ['What is the latency target?', 'Which module is the gateway?'],
    })
  })

  it('tolerates a spaced "needs clarification" spelling', () => {
    expect(parseSpecVerdict('### 🎯 Verdict\nNeeds Clarification').kind).toBe('needs_clarification')
  })

  it('returns a null kind for garbage', () => {
    expect(parseSpecVerdict('nothing structured here')).toEqual({ kind: null, questions: [] })
  })
})

describe('computeAggregateRankings', () => {
  it('averages positions with uneven participation, best first', () => {
    const labelToSeat = { 'Response A': 'contrarian', 'Response B': 'outsider', 'Response C': 'builder' } as const
    const rankings: CouncilRanking[] = [
      { seatId: 'contrarian', text: '', parsed: ['Response A', 'Response B', 'Response C'] },
      { seatId: 'outsider', text: '', parsed: ['Response B', 'Response A'] },
    ]
    const agg = computeAggregateRankings(rankings, labelToSeat)
    // A: (1+2)/2=1.5, B: (2+1)/2=1.5, C: 3/1=3
    expect(agg.map((a) => a.seatId).slice(0, 2).sort()).toEqual(['contrarian', 'outsider'])
    expect(agg.find((a) => a.seatId === 'builder')).toEqual({ seatId: 'builder', averageRank: 3, count: 1 })
    expect(agg[agg.length - 1].seatId).toBe('builder')
  })

  it('ignores an unparseable ranking and unknown labels', () => {
    const labelToSeat = { 'Response A': 'contrarian' } as const
    const rankings: CouncilRanking[] = [
      { seatId: 'contrarian', text: '', parsed: [] },
      { seatId: 'outsider', text: '', parsed: ['Response A', 'Response Z'] },
    ]
    const agg = computeAggregateRankings(rankings, labelToSeat)
    expect(agg).toEqual([{ seatId: 'contrarian', averageRank: 1, count: 1 }])
  })
})

describe('computeScorecard', () => {
  it('merges per-session aggregates into per-seat averages, best first', () => {
    const scorecard = computeScorecard([
      {
        aggregate: [
          { seatId: 'contrarian', averageRank: 1, count: 2 },
          { seatId: 'outsider', averageRank: 2, count: 2 },
        ],
      },
      { aggregate: [{ seatId: 'contrarian', averageRank: 3, count: 1 }] },
    ])
    // contrarian mean = (1+3)/2 = 2 over 2 sessions; outsider = 2 over 1 session.
    expect(scorecard.find((s) => s.seatId === 'contrarian')).toEqual({
      seatId: 'contrarian',
      averageRank: 2,
      sessions: 2,
    })
    expect(scorecard.find((s) => s.seatId === 'outsider')).toEqual({
      seatId: 'outsider',
      averageRank: 2,
      sessions: 1,
    })
  })
})

describe('anonymizeSeats', () => {
  it('applies the permutation, labels Response A… and maps each back to its seat', () => {
    const seats = seatOutputs()
    const { anonymized, labelToSeat } = anonymizeSeats(seats, [4, 0, 2, 1, 3])
    expect(anonymized.map((r) => r.label)).toEqual([
      'Response A',
      'Response B',
      'Response C',
      'Response D',
      'Response E',
    ])
    expect(anonymized[0].text).toBe(seats[4].text)
    expect(labelToSeat['Response A']).toBe(seats[4].id)
    expect(labelToSeat['Response B']).toBe(seats[0].id)
  })

  it('only anonymizes seats that responded', () => {
    const seats = seatOutputs()
    seats[1] = { ...seats[1], ok: false }
    const { anonymized } = anonymizeSeats(seats, [0, 1, 2, 3])
    expect(anonymized).toHaveLength(4)
    expect(anonymized.every((r) => r.text !== seats[1].text)).toBe(true)
  })
})

describe('chairman prompts', () => {
  it('diff chairman includes ok seats, rankings, and the verdict sections', () => {
    const seats = seatOutputs()
    seats[2] = { ...seats[2], ok: false, text: 'unreachable' }
    const prompt = buildChairmanPrompt({
      question: 'q',
      seats,
      rankings: [{ seatId: 'contrarian', text: 'the ranking said things', parsed: [] }],
    })
    expect(prompt).toContain('### Contrarian')
    expect(prompt).not.toContain('unreachable')
    expect(prompt).toContain('the ranking said things')
    expect(prompt).toContain('### 🎯 Verdict')
    expect(prompt).toContain('### ➡️ Next step')
  })

  it('spec chairman demands the gate token, refined spec, and fences the spec', () => {
    const prompt = buildSpecChairmanPrompt({
      question: null,
      seats: seatOutputs(),
      rankings: [],
      fenceTag: '==SPEC==',
      specText: 'draft spec body',
    })
    expect(prompt).toContain('APPROVED or NEEDS_CLARIFICATION')
    expect(prompt).toContain('### 📋 Refined Spec')
    expect(prompt).toContain('### ❓ Questions for the author')
    expect(prompt).toContain('draft spec body')
    expect(prompt.match(/==SPEC==/g)).toHaveLength(3)
  })
})
