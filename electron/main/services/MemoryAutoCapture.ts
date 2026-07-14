import type { CapturableSessionSummary, ResumableSessionProvider } from '@shared/domain'
import type { ProjectService } from './ProjectService'
import type { AgentSessionsService } from './AgentSessionsService'
import type { MemoryCaptureQueue } from './MemoryCaptureQueue'
import type { MemoryPipeline } from './MemoryPipeline'
import type { MemoryCaptureNotice } from '@shared/memory-capture'

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
  /** Safe renderer notice sink; no transcript paths or raw model output. */
  onNotice?: (notice: MemoryCaptureNotice) => void
}

const MIN = 60_000
const DAY = 24 * 60 * MIN

/**
 * Automatic capture (docs/memory-imp.md Phase 4, G1+G2). A gentle background
 * watcher: it sweeps each projects Claude and Codex sessions, enqueues the ones that have
 * gone quiet (and grown), and drains the durable queue through the pipeline —
 * confident facts save, ordinary uncertainty is dropped, and only protected
 * high-impact ambiguity lands in review. Bounded per sweep so a backlog never
 * floods the CLI. All state lives in the queue, so a crash mid-drain is
 * recovered on the next boot, never dropped (G2).
 */
export class MemoryAutoCapture {
  private timer: ReturnType<typeof setInterval> | null = null
  private draining = false
  /** Extra live-drain budget requested while an earlier job is awaiting its model. */
  private pendingDrainLimit = 0
  private readonly idleMs: number
  private readonly pollMs: number
  private readonly recentMs: number
  private readonly maxPerDrain: number
  private readonly now: () => number
  private readonly enabled: boolean
  private readonly onNotice?: (notice: MemoryCaptureNotice) => void
  private noticeSequence = 0

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
    this.onNotice = opts.onNotice
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

  /**
   * Near-live trigger: capture every matching provider transcript that has
   * been active since this Cockpit pane started. Scanning the set instead of
   * guessing one newest transcript keeps simultaneous same-provider panes
   * correct; the durable provider+session queue removes overlap idempotently.
   */
  async captureRecent(
    projectId: string,
    provider: ResumableSessionProvider,
    sinceIso: string,
  ): Promise<number> {
    if (!this.enabled) return 0
    let enqueued = 0
    try {
      const project = this.projects.get(projectId)
      const sinceMs = Date.parse(sinceIso)
      for (const session of this.sessions.captureList(project.path)) {
        if (session.provider !== provider) continue
        const activeMs = Date.parse(session.lastActiveAt)
        if (!Number.isNaN(sinceMs) && (Number.isNaN(activeMs) || activeMs < sinceMs)) continue
        if (this.enqueueSession(project.id, session)) enqueued += 1
      }
    } catch {
      // A project removed during the debounce is an ordinary no-op.
    }
    if (enqueued > 0) await this.drain(Math.max(this.maxPerDrain, enqueued))
    return enqueued
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
  private enqueueSession(projectId: string, s: CapturableSessionSummary): boolean {
    const job = this.queue.peek(s.provider, s.id)
    if (!job) {
      this.queue.enqueue({
        projectId,
        provider: s.provider,
        sessionId: s.id,
        sourcePath: s.transcriptPath,
      })
      return true
    } else if ((job.status === 'done' || job.status === 'error') && s.sizeBytes > job.lastOffset) {
      this.queue.enqueue({
        projectId,
        provider: s.provider,
        sessionId: s.id,
        sourcePath: s.transcriptPath,
      })
      return true
    }
    return false
  }

  /** Drain up to `maxPerDrain` queued jobs through the pipeline. */
  private async drain(limit = this.maxPerDrain): Promise<void> {
    const requested = Math.max(0, Math.floor(limit))
    if (this.draining) {
      // Calls from simultaneous panes may enqueue new provider sessions while
      // the first distillation is awaiting its model. Carry that work into the
      // active drain instead of leaving it for the 10-minute recovery sweep.
      this.pendingDrainLimit += requested
      return
    }
    this.draining = true
    let budget = requested
    try {
      while (budget > 0) {
        for (let i = 0; i < budget; i += 1) {
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
            else {
              this.queue.complete(job.id, res.nextOffset)
              this.emitNotices(job.projectId, job.provider, job.sessionId, res.proposals)
            }
          } catch (err) {
            this.queue.fail(job.id, err instanceof Error ? err.message : String(err))
          }
        }
        budget = this.pendingDrainLimit
        this.pendingDrainLimit = 0
      }
    } finally {
      this.draining = false
    }
  }

  private emitNotices(
    projectId: string,
    provider: ResumableSessionProvider,
    sourceSessionId: string,
    proposals: Awaited<ReturnType<MemoryPipeline['capture']>>['proposals'],
  ): void {
    if (!this.onNotice) return
    for (const proposal of proposals) {
      if (proposal.gate !== 'commit' && proposal.gate !== 'review') continue
      const outcome: MemoryCaptureNotice['outcome'] =
        proposal.gate === 'review'
          ? 'review'
          : proposal.reconcile === 'merge'
            ? 'updated'
            : 'created'
      const nowMs = this.now()
      this.noticeSequence += 1
      try {
        this.onNotice({
          id: `memory-${nowMs}-${this.noticeSequence}`,
          projectId,
          provider,
          sourceSessionId,
          outcome,
          scope: proposal.scope === 'user' ? 'global' : 'project',
          slug: proposal.slug,
          title: bound(proposal.title, 160),
          summary: bound(proposal.summary ?? proposal.title, 240),
          reason: bound(proposal.reason, 220),
          at: new Date(nowMs).toISOString(),
        })
      } catch {
        // Renderer availability is not part of Memory durability. The note and
        // cursor are already committed; a toast failure must never retry or
        // relabel that successful capture as an error.
      }
    }
  }
}

function bound(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}
