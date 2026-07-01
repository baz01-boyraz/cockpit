import { describe, expect, it } from 'vitest'
import { formatDuration, relativeTime } from '@shared/time'

const NOW = new Date('2026-06-28T12:00:00.000Z').getTime()
const at = (ms: number) => new Date(NOW - ms).toISOString()

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('shows "now" for very recent timestamps', () => {
    expect(relativeTime(at(5 * SECOND), NOW)).toBe('now')
    expect(relativeTime(at(44 * SECOND), NOW)).toBe('now')
  })

  it('shows minutes under an hour', () => {
    expect(relativeTime(at(2 * MINUTE), NOW)).toBe('2m')
    expect(relativeTime(at(59 * MINUTE), NOW)).toBe('59m')
  })

  it('shows hours under a day', () => {
    expect(relativeTime(at(3 * HOUR), NOW)).toBe('3h')
  })

  it('shows days under a week', () => {
    expect(relativeTime(at(2 * DAY), NOW)).toBe('2d')
  })

  it('shows weeks under five weeks', () => {
    expect(relativeTime(at(14 * DAY), NOW)).toBe('2w')
  })

  it('treats future timestamps as "now"', () => {
    expect(relativeTime(at(-5 * MINUTE), NOW)).toBe('now')
  })

  it('returns an empty string for an invalid date', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('')
  })
})

describe('formatDuration', () => {
  it('keeps sub-second durations in milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(820)).toBe('820ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('shows seconds with decimals under a minute', () => {
    expect(formatDuration(1240)).toBe('1.24s')
    expect(formatDuration(9990)).toBe('9.99s')
    expect(formatDuration(12300)).toBe('12.3s')
    expect(formatDuration(59900)).toBe('59.9s')
  })

  it('switches to minutes and zero-padded seconds past a minute', () => {
    expect(formatDuration(60000)).toBe('1m 00s')
    expect(formatDuration(125000)).toBe('2m 05s')
  })

  it('returns an empty label for non-finite or negative input', () => {
    expect(formatDuration(-1)).toBe('')
    expect(formatDuration(Number.NaN)).toBe('')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('')
  })
})
