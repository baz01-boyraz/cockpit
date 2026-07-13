import type { CapturableSessionSummary, ResumableSessionProvider } from '@shared/domain'
import type { ProjectService } from './ProjectService'
import type { AgentSessionsService } from './AgentSessionsService'
import type { MemoryCaptureQueue } from './MemoryCaptureQueue'
import type { MemoryPipeline } from './MemoryPipeline'

export interface AutoCaptureOptions {
  /** A session must be quiet this long before it is captured (default 10 min). */
  idleMs?: number
  /** How often the watcher sweeps projects (default 90 s). */
  pollMs?: number
  /** Ignore sessions older than this — don't re-mine ancient history (default 3 days). */
  recentMs?: number
  /** Cap distillations per sweep so a backlog can't flood the CLI (default 2). */
  maxPerDrain?: number
  /** Injected clock for tests. */
  now?: () => number
  /** Master switch — the watcher does nothing when false. */
  enabled?: boolean
}

const MIN = 60_000
const DAY = 24 * 60 * MIN

/**
 * Automatic capture (docs/memory-imp.md Phase 4, G1+G2). A gentle background
 * watcher: it sweeps each projects Claude and Codex sessions, enqueues the ones that have
 * gone quiet (and grown), and drains the durable queue through the pipeline —
 * confident facts save, unsure ones land in the review queue. Bounded per sweep
 * so a backlog never floods the CLI. All state lives in the queue, so a crash
 * mid-drain is recovered on the next boot, never dropped (G2).
 */
export class MemoryAutoCapture {
  private timer: ReturnType<typeof setInterval> | null = null
  private draining = false
  private readonly idleMs: number
  private readonly pollMs: number
  private readonly recentMs: number
  private readonly maxPerDrain: number
  private readonly now: () => number
  private readonly enabled: boolean

  constructor(
    private readonly queue: MemoryCaptureQueue,
    private readonly pipeline: MemoryPipeline,
    private readonly projects: ProjectService,
    private readonly sessions: AgentSessionsService,
    opts: AutoCaptureOptions = {},
  ) {
    this.idleMs = opts.idleMs ?? 10 * MIN
    this.pollMs = opts.pollMs ?? 90_000
    this.recentMs = opts.recentMs ?? 3 * DAY
    this.maxPerDrain = opts.maxPerDrain ?? 2
    this.now = opts.now ?? (() => Date.now())
    this.enabled = opts.enabled ?? true
  }

  /** Recover any crash-stuck jobs, then begin sweeping. Safe to call once. */
  start(): void {
    if (!this.enabled || this.timer) return
    this.queue.recoverStuck()
    this.timer = setInterval(() => {
      void this.sweep()
    }, this.pollMs)
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One sweep: enqueue quiet/grown sessions across projects, then drain. */
  async sweep(): Promise<void> {
    if (!this.enabled) return
    try {
      this.enqueueReady()
    } catch {
      /* a bad project path must not kill the watcher */
    }
    await this.drain()
  }

  /**
   * Terminal-close trigger: the instant a Claude or Codex pane exits, capture
   * that providers most-recent project session immediately instead of
   * waiting up to a full idle-poll interval. This is ADDITIVE — the idle-poll
   * (`sweep`) stays as the fallback for sessions that never emit a clean exit
   * (crashed panes, Mac sleep). The idle age filter is intentionally skipped
   * here: the pane just closed, so the session is done by definition. The
   * per-session growth guard in {@link enqueueSession} still prevents
   * re-mining an already-captured, unchanged transcript.
   */
  async captureNow(projectId: string, provider: ResumableSessionProvider): Promise<void> {
    if (!this.enabled) return
    try {
      const project = this.projects.get(projectId)
      // `captureList` is sorted most-recent-first. Provider filtering prevents
      // a nearby Claude write from being mistaken for a closing Codex pane, or
      // vice versa.
      const latest = this.sessions
        .captureList(project.path)
        .find((session) => session.provider === provider)
      if (latest) this.enqueueSession(project.id, latest)
    } catch {
      /* a bad/removed project must never throw into the event emitter */
    }
    await this.drain()
  }

  /** Owner-triggered recovery after fixing a blocked/exhausted dependency. */
  async retry(projectId: string, jobId: string): Promise<void> {
    const job = this.queue.list(projectId).find((candidate) => candidate.id === jobId)
    if (!job) throw new Error('Capture job not found in this project.')
    this.queue.retry(jobId)
    await this.drain()
  }

  /** Enqueue sessions that are idle, recent, and have new content since last time. */
  private enqueueReady(): void {
    const nowMs = this.now()
    for (const project of this.projects.list()) {
      let sessions
      try {
        sessions = this.sessions.captureList(project.path)
      } catch {
        continue
      }
      for (const s of sessions) {
        const age = nowMs - Date.parse(s.lastActiveAt)
        if (Number.isNaN(age) || age < this.idleMs || age > this.recentMs) continue
        this.enqueueSession(project.id, s)
      }
    }
  }

  /**
   * Enqueue one session for capture, idempotently. Shared by the idle-poll and
   * the terminal-close trigger so both use the exact same "first time, or grew
   * since the last done/errored capture" rule — never two divergent copies.
   */
  private enqueueSession(projectId: string, s: CapturableSessionSummary): void {
    const job = this.queue.peek(s.provider, s.id)
    if (!job) {
      this.queue.enqueue({
        projectId,
        provider: s.provider,
        sessionId: s.id,
        sourcePath: s.transcriptPath,
      })
    } else if ((job.status === 'done' || job.status === 'error') && s.sizeBytes > job.lastOffset) {
      this.queue.enqueue({
        projectId,
        provider: s.provider,
        sessionId: s.id,
        sourcePath: s.transcriptPath,
      })
    }
  }

  /** Drain up to `maxPerDrain` queued jobs through the pipeline. */
  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (let i = 0; i < this.maxPerDrain; i += 1) {
        const job = this.queue.claimNext()
        if (!job) break
        try {
          const res = await this.pipeline.capture({
            projectId: job.projectId,
            provider: job.provider,
            transcriptPath: job.sourcePath,
            fromOffset: job.lastOffset,
            sessionId: job.sessionId,
            onStage: (stage) => this.queue.updateStage(job.id, stage),
          })
          if (res.error) this.queue.fail(job.id, res.error)
          else this.queue.complete(job.id, res.nextOffset)
        } catch (err) {
          this.queue.fail(job.id, err instanceof Error ? err.message : String(err))
        }
      }
    } finally {
      this.draining = false
    }
  }
}
