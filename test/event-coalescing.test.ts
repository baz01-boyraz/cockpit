import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalOutputChunk } from '@shared/domain'
import { TERMINAL_DATA_FLUSH_MS, TerminalDataCoalescer } from '../electron/main/events'

/**
 * Task 3.4 — terminal:data coalescing. The coalescer is a pure timer-driven
 * unit (no Electron): chunks buffer per session and flush as one concatenated
 * send per session per ~16ms frame. Exit paths flush explicitly so no output
 * is ever dropped and an exit never overtakes its session's data.
 */

function chunk(sessionId: string, data: string, at = '2026-07-02T10:00:00.000Z'): TerminalOutputChunk {
  return { sessionId, data, at }
}

function makeCoalescer(flushMs?: number) {
  const sent: TerminalOutputChunk[] = []
  const coalescer = new TerminalDataCoalescer((c) => sent.push(c), flushMs)
  return { coalescer, sent }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TerminalDataCoalescer buffering', () => {
  it('holds a chunk until the frame timer fires, then sends it once', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s1', 'hello'))
    expect(sent).toHaveLength(0)

    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)
    expect(sent).toEqual([chunk('s1', 'hello')])
  })

  it('concatenates same-session chunks in arrival order into one send', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s1', 'a', 't1'))
    coalescer.push(chunk('s1', 'b', 't2'))
    coalescer.push(chunk('s1', 'c', 't3'))

    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ sessionId: 's1', data: 'abc', at: 't3' })
  })

  it('bounds a burst: one send per session per frame regardless of chunk count', () => {
    const { coalescer, sent } = makeCoalescer()
    // A `yes`-style spam burst: 1000 chunks inside a single frame.
    for (let i = 0; i < 1000; i += 1) coalescer.push(chunk('s1', 'y\n'))

    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)
    expect(sent).toHaveLength(1)
    expect(sent[0].data).toHaveLength(2000)
  })

  it('emits sessions in first-arrival order within a frame', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s2', 'two'))
    coalescer.push(chunk('s1', 'one'))
    coalescer.push(chunk('s2', ' more'))

    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)
    expect(sent.map((c) => c.sessionId)).toEqual(['s2', 's1'])
    expect(sent[0].data).toBe('two more')
  })

  it('keeps per-session order across frames (no reordering after a flush)', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s1', 'frame1'))
    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)
    coalescer.push(chunk('s1', 'frame2'))
    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)

    expect(sent.map((c) => c.data)).toEqual(['frame1', 'frame2'])
  })

  it('a sustained stream produces bounded send frequency (~1 per frame)', () => {
    const { coalescer, sent } = makeCoalescer()
    // 100ms of continuous output, one chunk per millisecond.
    for (let ms = 0; ms < 100; ms += 1) {
      coalescer.push(chunk('s1', 'x'))
      vi.advanceTimersByTime(1)
    }
    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)

    // 100ms / 16ms frames ≈ 7 sends — never one per chunk.
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(100 / TERMINAL_DATA_FLUSH_MS) + 1)
    expect(sent.map((c) => c.data).join('')).toBe('x'.repeat(100))
  })
})

describe('TerminalDataCoalescer.flushSession', () => {
  it('drains only the exiting session, immediately', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s1', 'final output'))
    coalescer.push(chunk('s2', 'still streaming'))

    coalescer.flushSession('s1')
    expect(sent).toEqual([chunk('s1', 'final output')])

    // The other session still flushes on its frame — nothing lost.
    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(chunk('s2', 'still streaming'))
  })

  it('is a no-op for a session with nothing pending', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.flushSession('s1')
    expect(sent).toHaveLength(0)
  })

  it('does not double-send once the frame timer fires afterwards', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s1', 'data'))
    coalescer.flushSession('s1')

    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS * 4)
    expect(sent).toHaveLength(1)
  })
})

describe('TerminalDataCoalescer.flush (window close / app quit)', () => {
  it('drains every pending session without waiting for the timer', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s1', 'a'))
    coalescer.push(chunk('s2', 'b'))

    coalescer.flush()
    expect(sent.map((c) => c.sessionId).sort()).toEqual(['s1', 's2'])

    // Timer was cancelled — no phantom empty flush later.
    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS * 4)
    expect(sent).toHaveLength(2)
  })

  it('is safe to call with nothing pending', () => {
    const { coalescer, sent } = makeCoalescer()
    expect(() => coalescer.flush()).not.toThrow()
    expect(sent).toHaveLength(0)
  })

  it('a push after a flush schedules a fresh frame', () => {
    const { coalescer, sent } = makeCoalescer()
    coalescer.push(chunk('s1', 'first'))
    coalescer.flush()

    coalescer.push(chunk('s1', 'second'))
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(TERMINAL_DATA_FLUSH_MS)
    expect(sent.map((c) => c.data)).toEqual(['first', 'second'])
  })
})

describe('custom flush interval', () => {
  it('respects a caller-provided interval', () => {
    const { coalescer, sent } = makeCoalescer(50)
    coalescer.push(chunk('s1', 'slow frame'))

    vi.advanceTimersByTime(49)
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(sent).toHaveLength(1)
  })
})
