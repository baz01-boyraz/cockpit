import { describe, expect, it } from 'vitest'
import type { AgentUsageSnapshot } from '@shared/domain'
import { describeAgentUsage, summarizeAgentUsage, toneFor, windowTitle } from '@shared/agent-usage'

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

describe('toneFor', () => {
  it('maps remaining headroom to tones', () => {
    expect(toneFor(80)).toBe('healthy')
    expect(toneFor(25)).toBe('warning')
    expect(toneFor(10)).toBe('critical')
    expect(toneFor(null)).toBe('healthy')
  })
})
