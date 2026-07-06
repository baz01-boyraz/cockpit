import { describe, expect, it } from 'vitest'
import { CockpitEvents } from '../electron/main/events'
import { CardOutputTracker } from '../electron/main/services/hermes/CardOutputTracker'

function emitData(events: CockpitEvents, sessionId: string, data: string): void {
  events.emitTyped('terminal:data', { sessionId, data, at: 't' })
}

describe('CardOutputTracker', () => {
  it('buffers a tracked session and drains the delta since the last call', () => {
    const events = new CockpitEvents()
    const tracker = new CardOutputTracker(events)
    tracker.track('s1')

    emitData(events, 's1', 'hello ')
    emitData(events, 's1', 'world')

    const first = tracker.drain('s1')
    expect(first).toEqual({ output: 'hello world', exited: false, exitCode: null, tracked: true })

    // A second drain with no new data returns an empty delta.
    expect(tracker.drain('s1').output).toBe('')

    emitData(events, 's1', 'more')
    expect(tracker.drain('s1').output).toBe('more')
  })

  it('is session-scoped: never buffers or leaks output from an untracked session', () => {
    const events = new CockpitEvents()
    const tracker = new CardOutputTracker(events)
    tracker.track('s1')

    emitData(events, 's2', 'not mine')
    emitData(events, 's1', 'mine')

    expect(tracker.drain('s1').output).toBe('mine')
    // s2 was never tracked, so it has no buffer at all.
    expect(tracker.drain('s2')).toEqual({ output: '', exited: false, exitCode: null, tracked: false })
  })

  it('records the exit event so drain reports done', () => {
    const events = new CockpitEvents()
    const tracker = new CardOutputTracker(events)
    tracker.track('s1')

    emitData(events, 's1', 'tail')
    events.emitTyped('terminal:exit', {
      sessionId: 's1',
      projectId: 'p1',
      role: 'claude',
      exitCode: 0,
      signal: null,
    })

    const drained = tracker.drain('s1')
    expect(drained.output).toBe('tail')
    expect(drained.exited).toBe(true)
    expect(drained.exitCode).toBe(0)
  })

  it('bounds the buffer to a trailing window so a chatty worker cannot grow it unbounded', () => {
    const events = new CockpitEvents()
    const tracker = new CardOutputTracker(events, 8)
    tracker.track('s1')

    emitData(events, 's1', '0123456789ABCDEF')
    expect(tracker.drain('s1').output).toBe('89ABCDEF')
  })

  it('track is idempotent and never resets an existing buffer', () => {
    const events = new CockpitEvents()
    const tracker = new CardOutputTracker(events)
    tracker.track('s1')
    emitData(events, 's1', 'kept')
    tracker.track('s1')
    expect(tracker.drain('s1').output).toBe('kept')
  })

  it('untrack drops the session and stops buffering it', () => {
    const events = new CockpitEvents()
    const tracker = new CardOutputTracker(events)
    tracker.track('s1')
    tracker.untrack('s1')
    expect(tracker.isTracking('s1')).toBe(false)

    emitData(events, 's1', 'ignored')
    expect(tracker.drain('s1')).toEqual({ output: '', exited: false, exitCode: null, tracked: false })
  })
})
