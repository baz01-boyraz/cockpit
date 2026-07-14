import type { ResumableSessionProvider, TerminalSession } from '@shared/domain'
import type { CockpitEvents } from '../events'

interface TerminalLookup {
  get(sessionId: string): TerminalSession | null
}

interface RecentCapture {
  captureRecent(
    projectId: string,
    provider: ResumableSessionProvider,
    sinceIso: string,
  ): Promise<number>
}

export interface MemoryLiveCaptureOptions {
  /** Output must stay quiet this long before one incremental capture (default 12s). */
  quietMs?: number
  /** Include transcripts born just before the pane row was recorded (default 30s). */
  transcriptSkewMs?: number
}

interface PendingTurn {
  projectId: string
  provider: ResumableSessionProvider
  timer: ReturnType<typeof setTimeout>
}

/**
 * Turns Cockpit-owned agent panes into near-live Memory sources without ever
 * parsing PTY output. A submitted turn arms one timer; noisy TUI output merely
 * pushes that timer back. Once settled, provider-native transcripts remain the
 * canonical input to the existing redaction/distill/reconcile pipeline.
 */
export class MemoryLiveCapture {
  private readonly pending = new Map<string, PendingTurn>()
  private readonly quietMs: number
  private readonly transcriptSkewMs: number
  private started = false

  constructor(
    private readonly events: CockpitEvents,
    private readonly terminals: TerminalLookup,
    private readonly capture: RecentCapture,
    opts: MemoryLiveCaptureOptions = {},
  ) {
    this.quietMs = opts.quietMs ?? 12_000
    this.transcriptSkewMs = opts.transcriptSkewMs ?? 30_000
  }

  private readonly onTurn = (event: {
    sessionId: string
    projectId: string
    provider: ResumableSessionProvider
  }): void => {
    const terminal = this.terminals.get(event.sessionId)
    if (!terminal || terminal.status !== 'running' || terminal.role !== event.provider) return
    this.arm(event.sessionId, event.projectId, event.provider)
  }

  private readonly onData = (event: { sessionId: string }): void => {
    const current = this.pending.get(event.sessionId)
    if (!current) return
    this.arm(event.sessionId, current.projectId, current.provider)
  }

  private readonly onExit = (event: { sessionId: string }): void => {
    this.clear(event.sessionId)
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.events.onTyped('terminal:agentTurn', this.onTurn)
    this.events.onTyped('terminal:data', this.onData)
    this.events.onTyped('terminal:exit', this.onExit)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.events.off('terminal:agentTurn', this.onTurn)
    this.events.off('terminal:data', this.onData)
    this.events.off('terminal:exit', this.onExit)
    for (const sessionId of this.pending.keys()) this.clear(sessionId)
  }

  private arm(
    sessionId: string,
    projectId: string,
    provider: ResumableSessionProvider,
  ): void {
    this.clear(sessionId)
    const timer = setTimeout(() => void this.flush(sessionId, projectId, provider), this.quietMs)
    timer.unref?.()
    this.pending.set(sessionId, { projectId, provider, timer })
  }

  private clear(sessionId: string): void {
    const current = this.pending.get(sessionId)
    if (current) clearTimeout(current.timer)
    this.pending.delete(sessionId)
  }

  private async flush(
    sessionId: string,
    projectId: string,
    provider: ResumableSessionProvider,
  ): Promise<void> {
    this.pending.delete(sessionId)
    const terminal = this.terminals.get(sessionId)
    if (!terminal || terminal.status !== 'running' || terminal.role !== provider) return
    const createdMs = Date.parse(terminal.createdAt)
    const sinceIso = new Date(
      (Number.isNaN(createdMs) ? Date.now() : createdMs) - this.transcriptSkewMs,
    ).toISOString()
    try {
      await this.capture.captureRecent(projectId, provider, sinceIso)
    } catch {
      // Session-end and idle capture remain durable fallbacks. A live miss must
      // never escape into the native terminal event boundary.
    }
  }
}
