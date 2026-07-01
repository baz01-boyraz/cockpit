import { describe, expect, it } from 'vitest'
import type { AgentUsageSnapshot } from '@shared/domain'
import {
  describeAgentUsage,
  summarizeAgentUsage,
  toneFor,
  windowFromUsedPercent,
  windowFromUtilization,
  windowTitle,
} from '@shared/agent-usage'

const snap = (over: Partial<AgentUsageSnapshot>): AgentUsageSnapshot => ({
  provider: 'claude',
  label: 'Claude',
  available: true,
  plan: 'Pro',
  windows: [],
  reason: null,
  fetchedAt: new Date().toISOString(),
  ...over,
})

describe('summarizeAgentUsage', () => {
  it('formats remaining headroom from session + weekly windows', () => {
    const pill = summarizeAgentUsage(
      snap({
        windows: [
          { label: 'Session', usedPercent: 11, resetAt: null },
          { label: 'Weekly', usedPercent: 23, resetAt: null },
        ],
      }),
    )
    expect(pill.available).toBe(true)
    expect(pill.detail).toBe('5h 89% · W 77%')
    expect(pill.minRemainingPercent).toBe(77)
    expect(pill.tone).toBe('healthy')
  })

  it('drives tone from the lowest remaining window', () => {
    const pill = summarizeAgentUsage(
      snap({
        windows: [
          { label: 'Session', usedPercent: 95, resetAt: null },
          { label: 'Weekly', usedPercent: 40, resetAt: null },
        ],
      }),
    )
    expect(pill.detail).toBe('5h 5% · W 60%')
    expect(pill.minRemainingPercent).toBe(5)
    expect(pill.tone).toBe('critical')
  })

  it('matches alternate window labels case-insensitively', () => {
    const pill = summarizeAgentUsage(
      snap({
        windows: [
          { label: 'Current session', usedPercent: 50, resetAt: null },
          { label: 'Current week', usedPercent: 10, resetAt: null },
        ],
      }),
    )
    expect(pill.detail).toBe('5h 50% · W 90%')
  })

  it('passes through the reason for unavailable providers', () => {
    const pill = summarizeAgentUsage(
      snap({ available: false, plan: null, reason: 'Sign in with Claude Code to see usage.' }),
    )
    expect(pill.available).toBe(false)
    expect(pill.detail).toBeNull()
    expect(pill.reason).toBe('Sign in with Claude Code to see usage.')
  })

  it('treats an available snapshot with no usable windows as unavailable', () => {
    const pill = summarizeAgentUsage(snap({ windows: [] }))
    expect(pill.available).toBe(false)
    expect(pill.reason).toContain('No quota')
  })

  it('clamps remaining into 0–100 even with out-of-range usage', () => {
    const pill = summarizeAgentUsage(
      snap({ windows: [{ label: 'Session', usedPercent: 130, resetAt: null }] }),
    )
    expect(pill.detail).toBe('5h 0%')
    expect(pill.minRemainingPercent).toBe(0)
  })
})

describe('windowTitle', () => {
  it('maps provider labels to friendly titles', () => {
    expect(windowTitle('Session')).toBe('5h session')
    expect(windowTitle('Current session')).toBe('5h session')
    expect(windowTitle('Weekly')).toBe('Weekly limit')
    expect(windowTitle('W')).toBe('Weekly limit')
    expect(windowTitle('Custom')).toBe('Custom')
  })
})

describe('describeAgentUsage', () => {
  it('expands each window with remaining headroom, reset, and tone', () => {
    const detail = describeAgentUsage(
      snap({
        windows: [
          { label: 'Session', usedPercent: 11, resetAt: '2026-07-01T12:00:00.000Z' },
          { label: 'Weekly', usedPercent: 92, resetAt: null },
        ],
      }),
    )
    expect(detail.available).toBe(true)
    expect(detail.minRemainingPercent).toBe(8)
    expect(detail.windows).toHaveLength(2)
    expect(detail.windows[0]).toMatchObject({
      title: '5h session',
      remainingPercent: 89,
      usedPercent: 11,
      resetAt: '2026-07-01T12:00:00.000Z',
      tone: 'healthy',
    })
    expect(detail.windows[1]).toMatchObject({
      title: 'Weekly limit',
      remainingPercent: 8,
      tone: 'critical',
    })
  })

  it('exposes no windows and keeps the reason when unavailable', () => {
    const detail = describeAgentUsage(
      snap({ available: false, plan: null, reason: 'Sign in with Codex to see usage.' }),
    )
    expect(detail.available).toBe(false)
    expect(detail.windows).toEqual([])
    expect(detail.reason).toBe('Sign in with Codex to see usage.')
  })
})

describe('windowFromUtilization (Anthropic)', () => {
  it('reads utilization as a whole percent used, not a 0–1 fraction', () => {
    // Regression: a Max account at 4% session / 1% weekly must read as 96% / 99%
    // remaining, never 0%. The old `util <= 1 ? util * 100` guess flipped the 1%
    // weekly window into "100% used".
    expect(windowFromUtilization('Session', { utilization: 4 })?.usedPercent).toBe(4)
    expect(windowFromUtilization('Weekly', { utilization: 1 })?.usedPercent).toBe(1)
    expect(windowFromUtilization('Weekly', { utilization: 0 })?.usedPercent).toBe(0)
    expect(windowFromUtilization('Session', { utilization: 82 })?.usedPercent).toBe(82)
  })

  it('the fixed 1% weekly window summarizes as 96% remaining, not 0%', () => {
    const session = windowFromUtilization('Session', { utilization: 4 })
    const weekly = windowFromUtilization('Weekly', { utilization: 1 })
    const pill = summarizeAgentUsage(snap({ windows: [session!, weekly!] }))
    expect(pill.minRemainingPercent).toBe(96)
    expect(pill.tone).toBe('healthy')
  })

  it('clamps and parses reset, rejects non-numeric utilization', () => {
    expect(windowFromUtilization('Session', { utilization: 130 })?.usedPercent).toBe(100)
    expect(
      windowFromUtilization('Session', {
        utilization: 5,
        resets_at: '2026-07-01T09:00:00.000Z',
      })?.resetAt,
    ).toBe('2026-07-01T09:00:00.000Z')
    expect(windowFromUtilization('Session', { utilization: null })).toBeNull()
    expect(windowFromUtilization('Session', 42)).toBeNull()
  })
})

describe('windowFromUsedPercent (Codex)', () => {
  it('reads used_percent directly and parses unix-seconds reset', () => {
    const win = windowFromUsedPercent('Session', { used_percent: 82, reset_at: 1_780_000_000 })
    expect(win?.usedPercent).toBe(82)
    expect(win?.resetAt).toBe(new Date(1_780_000_000 * 1000).toISOString())
    expect(windowFromUsedPercent('Session', { used_percent: 'nope' })).toBeNull()
  })
})

describe('toneFor', () => {
  it('maps remaining headroom to tones', () => {
    expect(toneFor(80)).toBe('healthy')
    expect(toneFor(25)).toBe('warning')
    expect(toneFor(10)).toBe('critical')
    expect(toneFor(null)).toBe('healthy')
  })
})
