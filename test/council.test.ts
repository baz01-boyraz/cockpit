import { describe, expect, it } from 'vitest'
import type { ReviewFinding, ReviewResult } from '../shared/review'
import {
  mergeCouncil,
  tagFindings,
  type CouncilLensOutcome,
  type LensTaggedFinding,
} from '../src/lib/council'

const finding = (title: string, severity: ReviewFinding['severity'] = 'high'): ReviewFinding => ({
  severity,
  file: 'src/a.ts',
  line: 12,
  title,
  detail: 'why + fix',
})

const success = (
  findings: ReviewFinding[],
  overrides: Partial<ReviewResult> = {},
): ReviewResult => ({
  ok: true,
  findings,
  raw: null,
  model: 'Claude · Sonnet',
  error: null,
  stats: {
    filesReviewed: 3,
    filesBlocked: 0,
    filesSummarized: 1,
    injectionSuspects: 0,
    truncated: false,
    durationMs: 900,
  },
  ...overrides,
})

describe('reviewer council merge (6.5)', () => {
  it('tags each finding with its persona label without mutating the source', () => {
    const source = [finding('leak')]
    const tagged = tagFindings(source, 'Security veteran')
    expect(tagged[0].lens).toBe('Security veteran')
    expect(tagged[0].title).toBe('leak')
    expect((source[0] as LensTaggedFinding).lens).toBeUndefined()
  })

  it('concatenates findings in lens order and takes the LAST success stats/model', () => {
    const outcomes: CouncilLensOutcome[] = [
      { label: 'Security veteran', result: success([finding('injection')]), error: null },
      {
        label: 'Pragmatic senior',
        result: success([finding('scope creep', 'medium')], {
          model: 'Claude · Opus',
          stats: {
            filesReviewed: 4,
            filesBlocked: 1,
            filesSummarized: 0,
            injectionSuspects: 0,
            truncated: false,
            durationMs: 1200,
          },
        }),
        error: null,
      },
    ]
    const { result, lensErrors } = mergeCouncil(outcomes)
    expect(lensErrors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.error).toBeNull()
    expect(result.findings.map((f) => (f as LensTaggedFinding).lens)).toEqual([
      'Security veteran',
      'Pragmatic senior',
    ])
    expect(result.model).toBe('Claude · Opus')
    expect(result.stats.filesReviewed).toBe(4)
  })

  it('keeps surviving findings when one lens fails, with one error line per failure', () => {
    const outcomes: CouncilLensOutcome[] = [
      { label: 'Security veteran', result: null, error: 'CLI timed out' },
      { label: 'Pragmatic senior', result: success([finding('race')]), error: null },
      {
        label: 'Type-safety zealot',
        result: success([], { ok: false, error: 'model refused' }),
        error: null,
      },
    ]
    const { result, lensErrors } = mergeCouncil(outcomes)
    expect(lensErrors).toEqual([
      'Security veteran lens failed — CLI timed out',
      'Type-safety zealot lens failed — model refused',
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toBeNull()
    expect(result.findings).toHaveLength(1)
    expect((result.findings[0] as LensTaggedFinding).lens).toBe('Pragmatic senior')
  })

  it('degrades to an error result when every lens fails', () => {
    const outcomes: CouncilLensOutcome[] = [
      { label: 'Security veteran', result: null, error: 'boom' },
      { label: 'Pragmatic senior', result: null, error: 'boom' },
      { label: 'Type-safety zealot', result: null, error: 'boom' },
    ]
    const { result, lensErrors } = mergeCouncil(outcomes)
    expect(lensErrors).toHaveLength(3)
    expect(result.error).toBe('All 3 council lenses failed.')
    expect(result.findings).toEqual([])
  })

  it('keeps unparsed raw output visible, prefixed per lens', () => {
    const outcomes: CouncilLensOutcome[] = [
      { label: 'Security veteran', result: success([], { raw: 'prose answer' }), error: null },
      { label: 'Pragmatic senior', result: success([finding('bug')]), error: null },
    ]
    const { result } = mergeCouncil(outcomes)
    expect(result.raw).toBe('[Security veteran]\nprose answer')
    expect(result.findings).toHaveLength(1)
  })
})
