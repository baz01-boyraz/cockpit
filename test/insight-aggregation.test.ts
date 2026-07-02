import { describe, expect, it } from 'vitest'
import type { ErrorInsight } from '@shared/domain'
import type { InsightOccurrence } from '@shared/insight-aggregation'
import { aggregateInsights, insightFromMatch } from '@shared/insight-aggregation'

const at = (minutesAgo: number) =>
  new Date(Date.parse('2026-07-01T12:00:00.000Z') - minutesAgo * 60_000).toISOString()

let seq = 0
function occ(pattern: string, createdAt: string, overrides: Partial<InsightOccurrence> = {}): InsightOccurrence {
  seq += 1
  return {
    id: `ins_${seq}`,
    projectId: 'prj_test',
    logEventId: null,
    title: `Title for ${pattern}`,
    likelyCause: 'cause',
    suggestedAction: 'action',
    suggestedAgent: 'codex',
    severity: 'high',
    matchedPattern: pattern,
    createdAt,
    ...overrides,
  }
}

describe('aggregateInsights', () => {
  it('returns an empty list for no events', () => {
    expect(aggregateInsights([], new Map())).toEqual([])
  })

  it('groups occurrences by pattern with count, first-seen, and last-seen', () => {
    const events = [occ('build_failed', at(10)), occ('build_failed', at(60)), occ('build_failed', at(0))]
    const [insight] = aggregateInsights(events, new Map())
    expect(insight.occurrences).toBe(3)
    expect(insight.firstSeenAt).toBe(at(60))
    expect(insight.lastSeenAt).toBe(at(0))
  })

  it('uses the newest occurrence as the representative row', () => {
    const newest = occ('port_in_use', at(1), { id: 'ins_newest', title: 'Newest title', logEventId: 'log_9' })
    const events = [occ('port_in_use', at(30)), newest, occ('port_in_use', at(5))]
    const [insight] = aggregateInsights(events, new Map())
    expect(insight.id).toBe('ins_newest')
    expect(insight.title).toBe('Newest title')
    expect(insight.logEventId).toBe('log_9')
    expect(insight.createdAt).toBe(at(1))
  })

  it('is insensitive to input order', () => {
    const events = [occ('a', at(3)), occ('b', at(1)), occ('a', at(0)), occ('b', at(9))]
    const forward = aggregateInsights(events, new Map())
    const reversed = aggregateInsights([...events].reverse(), new Map())
    expect(forward.map((i) => [i.matchedPattern, i.occurrences, i.firstSeenAt, i.lastSeenAt])).toEqual(
      reversed.map((i) => [i.matchedPattern, i.occurrences, i.firstSeenAt, i.lastSeenAt]),
    )
  })

  it('sorts patterns by last-seen, most recent first', () => {
    const events = [occ('older', at(45)), occ('newest', at(2)), occ('middle', at(20))]
    const list = aggregateInsights(events, new Map())
    expect(list.map((i) => i.matchedPattern)).toEqual(['newest', 'middle', 'older'])
  })

  it('applies the limit after filtering and sorting', () => {
    const events = [occ('a', at(1)), occ('b', at(2)), occ('c', at(3))]
    const list = aggregateInsights(events, new Map(), 2)
    expect(list.map((i) => i.matchedPattern)).toEqual(['a', 'b'])
  })

  it('returns everything when no limit is given', () => {
    const events = [occ('a', at(1)), occ('b', at(2)), occ('c', at(3))]
    expect(aggregateInsights(events, new Map())).toHaveLength(3)
  })

  it('hides a pattern dismissed up to its newest occurrence', () => {
    const events = [occ('build_failed', at(10)), occ('build_failed', at(5))]
    const dismissals = new Map([['build_failed', at(5)]])
    expect(aggregateInsights(events, dismissals)).toEqual([])
  })

  it('resurfaces a dismissed pattern when a newer occurrence arrives', () => {
    const events = [occ('build_failed', at(10)), occ('build_failed', at(5)), occ('build_failed', at(1))]
    const dismissals = new Map([['build_failed', at(5)]])
    const [insight] = aggregateInsights(events, dismissals)
    expect(insight.matchedPattern).toBe('build_failed')
    // History is never rewritten by a dismissal: full count and span survive.
    expect(insight.occurrences).toBe(3)
    expect(insight.firstSeenAt).toBe(at(10))
    expect(insight.lastSeenAt).toBe(at(1))
  })

  it('only hides the dismissed pattern, not its neighbours', () => {
    const events = [occ('dismissed', at(4)), occ('kept', at(8))]
    const dismissals = new Map([['dismissed', at(4)]])
    const list = aggregateInsights(events, dismissals)
    expect(list.map((i) => i.matchedPattern)).toEqual(['kept'])
  })

  it('accepts dismissal watermarks as a plain record too', () => {
    const events = [occ('build_failed', at(5)), occ('port_in_use', at(2))]
    const list = aggregateInsights(events, { build_failed: at(5) })
    expect(list.map((i) => i.matchedPattern)).toEqual(['port_in_use'])
  })

  it('normalizes per-occurrence rows that already carry aggregate fields', () => {
    // The mock feeds full ErrorInsight rows (occurrences: 1 each); aggregation
    // must recompute the history rather than trust the incoming fields.
    const stale: ErrorInsight = {
      ...occ('build_failed', at(30)),
      firstSeenAt: at(500),
      lastSeenAt: at(500),
      occurrences: 99,
    }
    const [insight] = aggregateInsights([stale, occ('build_failed', at(3))], new Map())
    expect(insight.occurrences).toBe(2)
    expect(insight.firstSeenAt).toBe(at(30))
    expect(insight.lastSeenAt).toBe(at(3))
  })
})

describe('insightFromMatch', () => {
  it('builds a single-occurrence insight from a pattern match', () => {
    const insight = insightFromMatch(
      {
        pattern: 'module_not_found',
        title: 'Missing module',
        likelyCause: 'A required package is not installed.',
        suggestedAction: 'Run npm install.',
        suggestedAgent: 'codex',
        severity: 'high',
      },
      { id: 'ins_1', projectId: 'prj_x', logEventId: 'log_1', createdAt: at(0) },
    )
    expect(insight).toEqual({
      id: 'ins_1',
      projectId: 'prj_x',
      logEventId: 'log_1',
      title: 'Missing module',
      likelyCause: 'A required package is not installed.',
      suggestedAction: 'Run npm install.',
      suggestedAgent: 'codex',
      severity: 'high',
      matchedPattern: 'module_not_found',
      createdAt: at(0),
      firstSeenAt: at(0),
      lastSeenAt: at(0),
      occurrences: 1,
    })
  })

  it('defaults logEventId to null when omitted', () => {
    const insight = insightFromMatch(
      {
        pattern: 'p',
        title: 't',
        likelyCause: 'c',
        suggestedAction: 'a',
        suggestedAgent: 'local',
        severity: 'medium',
      },
      { id: 'ins_2', projectId: 'prj_x', createdAt: at(0) },
    )
    expect(insight.logEventId).toBeNull()
  })
})
