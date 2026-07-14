import { describe, expect, it, vi } from 'vitest'
import type { SentinelSignal } from '../shared/sentinel'
import { SentinelAgentHandoff } from '../electron/main/services/SentinelAgentHandoff'

const signal: SentinelSignal = {
  id: 'sig_1',
  projectId: 'p1',
  severity: 'alert',
  source: 'log-intelligence',
  title: 'Build failed',
  summary: 'A required module is missing.',
  context: "Error: Cannot find module '@shared/schemas'",
  fingerprint: 'p1::log-intelligence::build failed',
  status: 'new',
  createdAt: '2026-07-14T05:00:00.000Z',
  triage: null,
  outcome: null,
  outcomeAt: null,
}

function harness(found: SentinelSignal | null = signal) {
  const order: string[] = []
  const signals = {
    get: vi.fn(() => found),
    markSeen: vi.fn(() => {
      order.push('seen')
      return 1
    }),
  }
  const contracts = {
    ensureForAgent: vi.fn(() => order.push('contract')),
  }
  const terminals = {
    launchAgent: vi.fn((_projectId: string, _agent: 'claude' | 'codex', _prompt: string) => {
      order.push('launch')
      return {
        id: 'term_1',
        projectId: 'p1',
        name: 'Claude Code',
        role: _agent,
        alias: 'Signal review',
        cwd: '/repo',
        shell: '/bin/zsh',
        status: 'running' as const,
        pid: 123,
        exitCode: null,
        createdAt: '2026-07-14T05:01:00.000Z',
        lastActiveAt: '2026-07-14T05:01:00.000Z',
      }
    }),
  }
  const audit = {
    record: vi.fn(() => {
      order.push('audit')
      return {
        id: 'aud_1',
        projectId: 'p1',
        actor: 'user' as const,
        actionType: 'sentinel.ask_agent',
        summary: 'Opened Claude to inspect a signal',
        payloadRedacted: {},
        createdAt: '2026-07-14T05:01:00.000Z',
      }
    }),
  }
  const service = new SentinelAgentHandoff({ signals, contracts, terminals, audit })
  return { service, signals, contracts, terminals, audit, order }
}

describe('SentinelAgentHandoff', () => {
  it('opens the requested direct agent with bounded evidence, then marks and audits the handoff', () => {
    const h = harness()
    const session = h.service.ask({ projectId: 'p1', signalId: 'sig_1', agent: 'claude' })

    expect(session).toMatchObject({ id: 'term_1' })
    expect(h.order).toEqual(['contract', 'launch', 'seen', 'audit'])
    expect(h.terminals.launchAgent).toHaveBeenCalledWith(
      'p1',
      'claude',
      expect.stringContaining('Restart impact:'),
    )
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        actor: 'user',
        actionType: 'sentinel.ask_agent',
        payload: {
          signalId: 'sig_1',
          agent: 'claude',
          importance: 98,
          restartImpact: 'unknown',
        },
      }),
    )
  })

  it('refuses an unknown or foreign-project signal before starting an agent', () => {
    const h = harness(null)

    expect(() =>
      h.service.ask({ projectId: 'p2', signalId: 'sig_1', agent: 'codex' }),
    ).toThrow('Signal was not found in this project.')
    expect(h.contracts.ensureForAgent).not.toHaveBeenCalled()
    expect(h.terminals.launchAgent).not.toHaveBeenCalled()
    expect(h.audit.record).not.toHaveBeenCalled()
  })
})
