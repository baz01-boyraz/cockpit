import { describe, expect, it } from 'vitest'
import type { UsageEvent } from '@shared/domain'
import { summarizeUsage } from '@shared/usage'

const ev = (over: Partial<UsageEvent>): UsageEvent => ({
  id: 'u',
  projectId: 'p',
  provider: 'terminal',
  eventType: 'session_started',
  count: 1,
  durationMs: null,
  estimatedTokens: null,
  metadata: {},
  createdAt: new Date().toISOString(),
  ...over,
})

describe('summarizeUsage', () => {
  it('aggregates sessions, commands and tasks per provider', () => {
    const summary = summarizeUsage([
      ev({ provider: 'terminal', eventType: 'session_started' }),
      ev({ provider: 'terminal', eventType: 'command_run', count: 3 }),
      ev({ provider: 'claude', eventType: 'agent_launch' }),
      ev({ provider: 'claude', eventType: 'task_run', count: 2, estimatedTokens: 1000 }),
    ])
    const terminal = summary.find((s) => s.provider === 'terminal')!
    const claude = summary.find((s) => s.provider === 'claude')!
    expect(terminal.sessions).toBe(1)
    expect(terminal.commands).toBe(3)
    expect(claude.tasks).toBe(2)
    expect(claude.estimatedTokens).toBe(1000)
  })

  it('raises a warning when sessions are unusually high', () => {
    const events = Array.from({ length: 14 }, () => ev({ provider: 'terminal', eventType: 'session_started' }))
    const [terminal] = summarizeUsage(events)
    expect(terminal.warning).toBeTruthy()
  })

  it('returns no warning for modest usage', () => {
    const [terminal] = summarizeUsage([ev({ eventType: 'session_started' })])
    expect(terminal.warning).toBeNull()
  })
})
