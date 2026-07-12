import { describe, expect, it } from 'vitest'
import {
  extractAcceptanceCriteria,
  formatCompletionSummary,
  type CompletionReport,
} from '../shared/completion-report'

function makeReport(over: Partial<CompletionReport> = {}): CompletionReport {
  return {
    cardId: 'c1',
    title: 'Add the widget',
    branch: 'swarm/add-the-widget-1a2b',
    diffStat: { files: 3, insertions: 42, deletions: 7 },
    worktreeState: 'changed',
    acceptance: ['It renders', 'It validates input', 'It has a test', 'It logs errors'],
    hasCouncilSpec: true,
    finishedAt: '2026-07-07T00:00:00.000Z',
    ...over,
  }
}

describe('extractAcceptanceCriteria', () => {
  it('pulls a numbered list under a bold "Acceptance criteria" label (the refined-spec format)', () => {
    const body = [
      '### 📋 Refined Spec',
      '**Goal** Ship the widget',
      '**Context** The user needs it',
      '**Acceptance criteria** (a testable, numbered list)',
      '1. The endpoint returns 200',
      '2. Errors are logged',
      '3. A test covers the happy path',
      '**Out of scope** Anything else',
    ].join('\n')
    expect(extractAcceptanceCriteria(body)).toEqual([
      'The endpoint returns 200',
      'Errors are logged',
      'A test covers the happy path',
    ])
  })

  it('handles a "###" heading form with dash markers', () => {
    const body = ['### Acceptance criteria', '- first thing', '- second thing', '', '### Next'].join('\n')
    expect(extractAcceptanceCriteria(body)).toEqual(['first thing', 'second thing'])
  })

  it('tolerates mixed markers and a case-insensitive label', () => {
    const body = ['**ACCEPTANCE CRITERIA**', '* star item', '1) paren-numbered', '+ plus item'].join('\n')
    expect(extractAcceptanceCriteria(body)).toEqual(['star item', 'paren-numbered', 'plus item'])
  })

  it('allows a blank line between the label and the first item', () => {
    const body = ['Acceptance criteria', '', '- only item'].join('\n')
    expect(extractAcceptanceCriteria(body)).toEqual(['only item'])
  })

  it('stops at the next bold sub-label', () => {
    const body = ['**Acceptance criteria**', '1. kept', '**Constraints**', '2. dropped'].join('\n')
    expect(extractAcceptanceCriteria(body)).toEqual(['kept'])
  })

  it('returns [] when the section is absent', () => {
    expect(extractAcceptanceCriteria('# Some card\n\nJust prose, no criteria here.')).toEqual([])
  })

  it('returns [] for an inline label with no list items', () => {
    expect(extractAcceptanceCriteria('**Acceptance criteria**: it renders')).toEqual([])
  })

  it('returns [] for an empty body', () => {
    expect(extractAcceptanceCriteria('')).toEqual([])
  })
})

describe('formatCompletionSummary', () => {
  it('renders the full one-liner: diffstat · criteria · council', () => {
    expect(formatCompletionSummary(makeReport())).toBe(
      '"Add the widget" ready for review — +42 −7 across 3 files · 4 acceptance criteria · council-spec’d',
    )
  })

  it('singularizes one file and one criterion', () => {
    const report = makeReport({
      diffStat: { files: 1, insertions: 5, deletions: 0 },
      acceptance: ['just one'],
    })
    expect(formatCompletionSummary(report)).toBe(
      '"Add the widget" ready for review — +5 −0 across 1 file · 1 acceptance criterion · council-spec’d',
    )
  })

  it('omits the diffstat segment when diffStat is null', () => {
    const report = makeReport({ diffStat: null, hasCouncilSpec: false })
    expect(formatCompletionSummary(report)).toBe(
      '"Add the widget" ready for review — 4 acceptance criteria',
    )
  })

  it('omits the acceptance segment when there are no criteria', () => {
    const report = makeReport({ acceptance: [], hasCouncilSpec: false })
    expect(formatCompletionSummary(report)).toBe(
      '"Add the widget" ready for review — +42 −7 across 3 files',
    )
  })

  it('is just the head when nothing else is known', () => {
    const report = makeReport({ diffStat: null, acceptance: [], hasCouncilSpec: false })
    expect(formatCompletionSummary(report)).toBe('"Add the widget" ready for review')
  })
})
