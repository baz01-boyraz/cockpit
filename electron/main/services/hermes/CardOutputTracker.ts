import type { CockpitEvents } from '../../events'

/**
 * Per-session tail buffer for the `subscribe_card_output` MCP tool.
 *
 * This taps the SAME in-process event bus the renderer already consumes
 * (`terminal:data` / `terminal:exit`, published by TerminalManager) — it never
 * re-reads a pty. Crucially it is **session-scoped**: it only retains bytes for
 * sessions explicitly added via {@link track}. Output for any untracked session
 * is dropped on arrival, so this is a narrow tap for the one card Hermes is
 * currently watching, never a global terminal firehose.
 *
 * The buffer is bounded to a tail of {@link maxBuffer} bytes so a chatty worker
 * (a fast build log, a `yes` loop) can never grow it without limit — a lost
 * head is acceptable for a live tail; unbounded memory is not.
 */
export interface CardOutputDrain {
  /** Output accumulated for this session since the previous drain. */
  output: string
  /** True once the session's pty has exited. */
  exited: boolean
  /** Exit code, once known. */
  exitCode: number | null
  /** False when the session was never tracked (nothing to report). */
  tracked: boolean
}

/** Keep at most this many trailing bytes per session between drains. */
export const DEFAULT_MAX_BUFFER = 256 * 1024

interface TrackedSession {
  buffer: string
  exited: boolean
  exitCode: number | null
}

export class CardOutputTracker {
  private readonly tracked = new Map<string, TrackedSession>()

  constructor(
    events: CockpitEvents,
    private readonly maxBuffer: number = DEFAULT_MAX_BUFFER,
  ) {
    // One listener each, filtered by the tracked-session allowlist inside.
    events.onTyped('terminal:data', (evt) => this.onData(evt.sessionId, evt.data))
    events.onTyped('terminal:exit', (evt) => this.onExit(evt.sessionId, evt.exitCode))
  }

  /**
   * Begin retaining output for a session. Idempotent: calling it again for an
   * already-tracked session never resets its buffer or exit state. Buffering
   * starts from this call — output produced before the first `track` is not
   * replayed (this is a live tail, not a full transcript).
   */
  track(sessionId: string): void {
    if (!this.tracked.has(sessionId)) {
      this.tracked.set(sessionId, { buffer: '', exited: false, exitCode: null })
    }
  }

  isTracking(sessionId: string): boolean {
    return this.tracked.has(sessionId)
  }

  /**
   * Return and clear the output buffered for a session since the last drain,
   * plus its exit state. An untracked session drains to an empty, `tracked:
   * false` result rather than throwing — the caller decides what that means.
   */
  drain(sessionId: string): CardOutputDrain {
    const entry = this.tracked.get(sessionId)
    if (!entry) return { output: '', exited: false, exitCode: null, tracked: false }
    const output = entry.buffer
    entry.buffer = ''
    return { output, exited: entry.exited, exitCode: entry.exitCode, tracked: true }
  }

  /** Stop retaining a session's output and free its buffer. */
  untrack(sessionId: string): void {
    this.tracked.delete(sessionId)
  }

  /** Drop every tracked session — called when the MCP server stops. */
  clear(): void {
    this.tracked.clear()
  }

  private onData(sessionId: string, data: string): void {
    const entry = this.tracked.get(sessionId)
    if (!entry) return // untracked session: not our card — drop it.
    const next = entry.buffer + data
    entry.buffer =
      next.length > this.maxBuffer ? next.slice(next.length - this.maxBuffer) : next
  }

  private onExit(sessionId: string, exitCode: number): void {
    const entry = this.tracked.get(sessionId)
    if (!entry) return
    entry.exited = true
    entry.exitCode = exitCode
  }
}
