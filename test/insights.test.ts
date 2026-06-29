import { describe, expect, it } from 'vitest'
import {
  ACTIVE_WINDOW_MS,
  RECENT_WINDOW_MS,
  classifyInsightRecency,
  insightRecency,
} from '@shared/insights'

const NOW = new Date('2026-06-28T12:00:00.000Z').getTime()
const at = (ms: number) => new Date(NOW - ms).toISOString()

describe('classifyInsightRecency', () => {
  it('marks failures seen in the last few minutes as active', () => {
    expect(classifyInsightRecency(at(0), NOW)).toBe('active')
    expect(classifyInsightRecency(at(ACTIVE_WINDOW_MS - 1), NOW)).toBe('active')
    expect(classifyInsightRecency(at(ACTIVE_WINDOW_MS), NOW)).toBe('active')
  })

  it('marks failures within the last hour as recent', () => {
    expect(classifyInsightRecency(at(ACTIVE_WINDOW_MS + 1), NOW)).toBe('recent')
    expect(classifyInsightRecency(at(RECENT_WINDOW_MS), NOW)).toBe('recent')
  })

  it('marks older failures as earlier (history)', () => {
    expect(classifyInsightRecency(at(RECENT_WINDOW_MS + 1), NOW)).toBe('earlier')
    expect(classifyInsightRecency(at(24 * 60 * 60_000), NOW)).toBe('earlier')
  })

  it('treats clock-skewed future timestamps as active, not stale', () => {
    expect(classifyInsightRecency(at(-60_000), NOW)).toBe('active')
  })

  it('falls back to earlier for an invalid timestamp', () => {
    expect(classifyInsightRecency('not-a-date', NOW)).toBe('earlier')
  })

  it('classifies straight from an insight via insightRecency', () => {
    expect(insightRecency({ lastSeenAt: at(0) }, NOW)).toBe('active')
    expect(insightRecency({ lastSeenAt: at(RECENT_WINDOW_MS + 1) }, NOW)).toBe('earlier')
  })
})
