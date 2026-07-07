import { describe, expect, it, vi } from 'vitest'
import { CockpitEvents } from '../electron/main/events'

/**
 * `terminal:data`/`terminal:exit` fire from node-pty's native ThreadSafeFunction
 * callback (see electron/main/services/TerminalManager.ts) — an exception
 * escaping there aborts the whole process (SIGABRT), not a catchable
 * 'uncaughtException'. CockpitEvents.emitTyped must isolate each listener so
 * one broken listener degrades a feature instead of killing the app.
 */
describe('CockpitEvents.emitTyped fault isolation', () => {
  it('does not throw when a listener throws', () => {
    const events = new CockpitEvents()
    events.onTyped('terminal:data', () => {
      throw new Error('boom')
    })

    expect(() =>
      events.emitTyped('terminal:data', { sessionId: 's1', data: 'x', at: 't1' }),
    ).not.toThrow()
  })

  it('still runs every other listener after one throws', () => {
    const events = new CockpitEvents()
    const before = vi.fn()
    const after = vi.fn()
    events.onTyped('terminal:data', before)
    events.onTyped('terminal:data', () => {
      throw new Error('boom')
    })
    events.onTyped('terminal:data', after)

    events.emitTyped('terminal:data', { sessionId: 's1', data: 'x', at: 't1' })

    expect(before).toHaveBeenCalled()
    expect(after).toHaveBeenCalled()
  })

  it('a throwing listener on one event never affects listeners on another event', () => {
    const events = new CockpitEvents()
    events.onTyped('terminal:data', () => {
      throw new Error('boom')
    })
    const exitSpy = vi.fn()
    events.onTyped('terminal:exit', exitSpy)

    events.emitTyped('terminal:data', { sessionId: 's1', data: 'x', at: 't1' })
    events.emitTyped('terminal:exit', {
      sessionId: 's1',
      projectId: 'p1',
      role: null,
      exitCode: 0,
      signal: null,
    })

    expect(exitSpy).toHaveBeenCalled()
  })
})
