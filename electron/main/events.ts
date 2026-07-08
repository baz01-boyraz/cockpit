import { EventEmitter } from 'node:events'
import type {
  AppUpdateState,
  SwarmCardCompletedEvent,
  TerminalExitEvent,
  TerminalOutputChunk,
} from '@shared/domain'
import { logFatal } from './logging'

/**
 * Internal main-process event bus. Services emit here; the IPC layer subscribes
 * and forwards a curated subset to the renderer via webContents.send. This keeps
 * services decoupled from Electron's window/webContents lifecycle.
 */
export interface CockpitEventMap {
  'terminal:data': TerminalOutputChunk
  'terminal:exit': TerminalExitEvent
  'approvals:changed': { projectId: string }
  'logs:changed': { projectId: string }
  'appUpdate:changed': AppUpdateState
  'swarm:cardCompleted': SwarmCardCompletedEvent
}

export class CockpitEvents extends EventEmitter {
  /**
   * `terminal:data`/`terminal:exit` fire from node-pty's native callback (a
   * libuv thread calling back into V8 via a N-API ThreadSafeFunction) — there
   * is no JS call stack above this for an uncaught exception to unwind into.
   * If a listener throws here, Node aborts the whole process (SIGABRT, not a
   * catchable 'uncaughtException') instead of just breaking that one feature.
   * Isolating each listener in its own try/catch turns "one broken listener
   * kills the app" into "one broken listener stops working."
   */
  emitTyped<K extends keyof CockpitEventMap>(event: K, payload: CockpitEventMap[K]): void {
    for (const listener of this.listeners(event)) {
      try {
        ;(listener as (payload: CockpitEventMap[K]) => void)(payload)
      } catch (err) {
        logFatal(`event:${event}`, err)
      }
    }
  }

  onTyped<K extends keyof CockpitEventMap>(
    event: K,
    listener: (payload: CockpitEventMap[K]) => void,
  ): void {
    this.on(event, listener as (payload: unknown) => void)
  }
}

/** One frame at ~60fps — the flush cadence for coalesced terminal output. */
export const TERMINAL_DATA_FLUSH_MS = 16

/**
 * Coalesces `terminal:data` chunks per session before they cross the IPC
 * boundary. A pty burst (`yes`, a fast build log) arrives as hundreds of tiny
 * chunks; forwarding each one is an IPC flood. Instead chunks are concatenated
 * per session and flushed on a ~16ms timer, so the renderer receives at most
 * one send per session per frame regardless of burst size.
 *
 * Ordering guarantees:
 * - Per session: chunks are concatenated in arrival order — the renderer sees
 *   the exact byte sequence the pty produced, just in bigger pieces.
 * - Data-before-exit: callers flush a session (`flushSession`) before
 *   forwarding its `terminal:exit`, so an exit never overtakes buffered output.
 * - Cross session: a flush emits sessions in first-arrival order within the
 *   frame (Map insertion order).
 *
 * Pure timer-driven unit — no Electron imports, testable under fake timers.
 */
export class TerminalDataCoalescer {
  private pending = new Map<string, TerminalOutputChunk>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly send: (chunk: TerminalOutputChunk) => void,
    private readonly flushMs: number = TERMINAL_DATA_FLUSH_MS,
  ) {}

  push(chunk: TerminalOutputChunk): void {
    const existing = this.pending.get(chunk.sessionId)
    this.pending.set(
      chunk.sessionId,
      existing
        ? { sessionId: chunk.sessionId, data: existing.data + chunk.data, at: chunk.at }
        : chunk,
    )
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.flushMs)
      // Never keep the process alive just for a pending frame; quit paths
      // flush explicitly.
      this.timer.unref?.()
    }
  }

  /** Emit one session's buffered output now (used before its exit event). */
  flushSession(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (!entry) return
    this.pending.delete(sessionId)
    this.send(entry)
    if (this.pending.size === 0) this.clearTimer()
  }

  /** Emit everything buffered — the frame tick, window close, and app quit. */
  flush(): void {
    this.clearTimer()
    if (this.pending.size === 0) return
    const batch = this.pending
    this.pending = new Map()
    for (const chunk of batch.values()) this.send(chunk)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
