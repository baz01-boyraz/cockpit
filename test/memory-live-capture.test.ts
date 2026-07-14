import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSession } from '@shared/domain'
import { CockpitEvents } from '../electron/main/events'
import { MemoryLiveCapture } from '../electron/main/services/MemoryLiveCapture'

const createdAt = '2026-07-13T18:00:00.000Z'

function terminal(id: string, role: 'claude' | 'codex'): TerminalSession {
  return {
    id,
    projectId: 'project-1',
    name: role,
    role,
    alias: null,
    cwd: '/tmp/project-1',
    shell: '/bin/zsh',
    status: 'running',
    pid: 42,
    exitCode: null,
    createdAt,
    lastActiveAt: createdAt,
  }
}

describe('MemoryLiveCapture', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('captures a completed agent turn after terminal output settles', async () => {
    const events = new CockpitEvents()
    const sessions = new Map([['term-claude', terminal('term-claude', 'claude')]])
    const captureRecent = vi.fn(async () => 1)
    const live = new MemoryLiveCapture(
      events,
      { get: (id: string) => sessions.get(id) ?? null },
      { captureRecent },
      { quietMs: 1_000, transcriptSkewMs: 30_000 },
    )
    live.start()

    events.emitTyped('terminal:agentTurn', {
      sessionId: 'term-claude',
      projectId: 'project-1',
      provider: 'claude',
      at: '2026-07-13T18:01:00.000Z',
    })
    await vi.advanceTimersByTimeAsync(500)
    events.emitTyped('terminal:data', {
      sessionId: 'term-claude',
      data: 'working',
      at: '2026-07-13T18:01:00.500Z',
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(captureRecent).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(captureRecent).toHaveBeenCalledTimes(1)
    expect(captureRecent).toHaveBeenCalledWith(
      'project-1',
      'claude',
      '2026-07-13T17:59:30.000Z',
    )
    live.stop()
  })

  it('coalesces noisy output per pane while keeping simultaneous providers independent', async () => {
    const events = new CockpitEvents()
    const sessions = new Map([
      ['term-claude', terminal('term-claude', 'claude')],
      ['term-codex', terminal('term-codex', 'codex')],
    ])
    const captureRecent = vi.fn(async () => 1)
    const live = new MemoryLiveCapture(
      events,
      { get: (id: string) => sessions.get(id) ?? null },
      { captureRecent },
      { quietMs: 1_000 },
    )
    live.start()

    for (const [sessionId, provider] of [
      ['term-claude', 'claude'],
      ['term-codex', 'codex'],
    ] as const) {
      events.emitTyped('terminal:agentTurn', {
        sessionId,
        projectId: 'project-1',
        provider,
        at: '2026-07-13T18:01:00.000Z',
      })
    }
    events.emitTyped('terminal:data', {
      sessionId: 'term-claude',
      data: 'frame 1',
      at: '2026-07-13T18:01:00.100Z',
    })
    events.emitTyped('terminal:data', {
      sessionId: 'term-claude',
      data: 'frame 2',
      at: '2026-07-13T18:01:00.200Z',
    })

    await vi.advanceTimersByTimeAsync(1_000)

    expect(captureRecent).toHaveBeenCalledTimes(2)
    expect(captureRecent).toHaveBeenCalledWith(
      'project-1',
      'claude',
      '2026-07-13T17:59:30.000Z',
    )
    expect(captureRecent).toHaveBeenCalledWith(
      'project-1',
      'codex',
      '2026-07-13T17:59:30.000Z',
    )
    live.stop()
  })

  it('cancels pending live work on terminal exit and service shutdown', async () => {
    const events = new CockpitEvents()
    const sessions = new Map([['term-claude', terminal('term-claude', 'claude')]])
    const captureRecent = vi.fn(async () => 1)
    const live = new MemoryLiveCapture(
      events,
      { get: (id: string) => sessions.get(id) ?? null },
      { captureRecent },
      { quietMs: 1_000 },
    )
    live.start()
    events.emitTyped('terminal:agentTurn', {
      sessionId: 'term-claude',
      projectId: 'project-1',
      provider: 'claude',
      at: '2026-07-13T18:01:00.000Z',
    })
    events.emitTyped('terminal:exit', {
      sessionId: 'term-claude',
      projectId: 'project-1',
      role: 'claude',
      exitCode: 0,
      signal: null,
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(captureRecent).not.toHaveBeenCalled()

    events.emitTyped('terminal:agentTurn', {
      sessionId: 'term-claude',
      projectId: 'project-1',
      provider: 'claude',
      at: '2026-07-13T18:02:00.000Z',
    })
    live.stop()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(captureRecent).not.toHaveBeenCalled()
  })
})
