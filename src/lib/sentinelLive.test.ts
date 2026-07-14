import { describe, expect, it } from 'vitest'
import type { SentinelSignal } from '@shared/sentinel'
import { isSignalForProject, upsertLiveSignal } from './sentinelLive'

const signal = (over: Partial<SentinelSignal> = {}): SentinelSignal => ({
  id: 'sig-1',
  projectId: 'p1',
  severity: 'notice',
  source: 'log-intelligence',
  title: 'Build failed',
  summary: 'The build failed.',
  context: null,
  fingerprint: 'p1::log-intelligence::build failed',
  status: 'new',
  createdAt: '2026-07-14T00:00:00.000Z',
  triage: null,
  outcome: null,
  outcomeAt: null,
  ...over,
})

describe('live Sentinel delivery', () => {
  it('accepts only the active project', () => {
    expect(isSignalForProject('p1', signal())).toBe(true)
    expect(isSignalForProject('p2', signal())).toBe(false)
    expect(isSignalForProject(null, signal())).toBe(false)
  })

  it('replaces a triage re-emit in place instead of duplicating it', () => {
    const original = signal()
    const enriched = signal({
      triage: {
        reportWorthy: true,
        headline: 'Action needed',
        action: 'Inspect the first compiler error.',
        gotchaCandidate: false,
        at: '2026-07-14T00:00:01.000Z',
      },
    })

    const merged = upsertLiveSignal([original], enriched, 20)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(enriched)
  })

  it('prepends a new signal and preserves the feed bound', () => {
    const older = signal({ id: 'sig-old', createdAt: '2026-07-13T00:00:00.000Z' })
    const newest = signal({ id: 'sig-new', createdAt: '2026-07-14T00:00:00.000Z' })

    expect(upsertLiveSignal([older], newest, 1)).toEqual([newest])
  })
})
