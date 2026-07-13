import { execFileSync } from 'node:child_process'
import { basename, join } from 'node:path'
import { Notification } from 'electron'
import type {
  DashboardSnapshot,
  RouterResult,
} from '@shared/domain'
import { DASHBOARD_RECENT_ERRORS_LIMIT, assembleDashboard } from '@shared/dashboard-assembly'
import { classifyRoute } from '@shared/router'
import { inferLogLevel } from '@shared/log-patterns'
import type { TerminalScanState } from '@shared/log-sanitize'
import { initialTerminalScanState, sanitizeChunkToLines, scanTerminalChunk } from '@shared/log-sanitize'
import { MEMORY_ANALYSIS_ENGINE } from '@shared/memory-model-policy'
import type { Db } from '../db/Database'
import { openDatabase } from '../db/Database'
import type { CockpitEvents } from '../events'
import { AuditLogService } from './AuditLogService'
import { AttachmentService } from './AttachmentService'
import { AgentUsageService } from './AgentUsageService'
import { OpenRouterUsageService } from './OpenRouterUsageService'
import { ApprovalService } from './ApprovalService'
import { AppUpdateService } from './AppUpdateService'
import { ChatService } from './ChatService'
import { MemoryHubService } from './MemoryHubService'
import { MemoryLedgerService } from './MemoryLedgerService'
import { MemoryRecallService } from './MemoryRecallService'
import { MemoryContextService } from './MemoryContextService'
import { MemoryReviewService } from './MemoryReviewService'
import { MemoryPolicyService } from './MemoryPolicyService'
import { MemoryDistiller } from './MemoryDistiller'
import { TranscriptReader } from './TranscriptReader'
import { MemoryPipeline } from './MemoryPipeline'
import { MemoryCaptureQueue } from './MemoryCaptureQueue'
import { MemoryAutoCapture } from './MemoryAutoCapture'
import { MemoryConsolidator } from './MemoryConsolidator'
import { MemoryCurationService } from './MemoryCurationService'
import { MemoryLifecycleSentinel } from './MemoryLifecycleSentinel'
import { OperationalHealthService } from './OperationalHealthService'
import { OperationalHealthStateStore } from './OperationalHealthStateStore'
import { registerMemoryExitCapture } from './memoryExitTrigger'
import { SwarmService } from './SwarmService'
import { SentinelService, type SentinelNotifier } from './SentinelService'
import { SwarmCompletionSteward } from './SwarmCompletionSteward'
import { NamedAgentsService } from './NamedAgentsService'
import { SwarmWorktrees } from './SwarmWorktrees'
import { SwarmDoneSignal } from './SwarmDoneSignal'
import { ReviewService } from './ReviewService'
import { CouncilService } from './CouncilService'
import { CouncilEvidenceService } from './CouncilEvidenceService'
import { OutcomeService } from './OutcomeService'
import { EngineRunner } from './EngineRunner'
import { CouncilSessionStore } from '../db/CouncilSessionStore'
import { ClaudeSessionsService } from './ClaudeSessionsService'
import { AgentSessionsService } from './AgentSessionsService'
import { GitService } from './GitService'
import { GitHubService } from './GitHubService'
import { LogIntelligenceService } from './LogIntelligenceService'
import { ProjectService } from './ProjectService'
import { RailwayService } from './RailwayService'
import { SecretStore } from './SecretStore'
import { TerminalManager } from './TerminalManager'
import { MemoryContractService } from './MemoryContractService'
import { UsageService } from './UsageService'
import { hasCli } from './cliDetect'
import { LifecycleApprovalTokenService } from './LifecycleApprovalTokenService'

/**
 * Composition root for the main process. Constructs every service, wires the
 * cross-cutting flows (terminal output -> log intelligence + usage), and exposes
 * higher-level aggregates (dashboard, router) the IPC layer calls into.
 */
export class Services {
  readonly db: Db
  readonly audit: AuditLogService
  readonly attachments: AttachmentService
  readonly approvals: ApprovalService
  readonly usage: UsageService
  readonly agentUsage: AgentUsageService
  /** Live OpenRouter credit remaining — powers Council's remote seats. */
  readonly openRouterUsage: OpenRouterUsageService
  readonly logs: LogIntelligenceService
  readonly projects: ProjectService
  readonly git: GitService
  readonly github: GitHubService
  readonly railway: RailwayService
  readonly secrets: SecretStore
  readonly terminals: TerminalManager
  /** Official Claude/Codex task composer — always routes through memory. */
  readonly memoryContract: MemoryContractService
  readonly claudeSessions: ClaudeSessionsService
  readonly agentSessions: AgentSessionsService
  readonly chat: ChatService
  readonly review: ReviewService
  readonly council: CouncilService
  /** Bounded read-only repository evidence boundary for Council analysis. */
  readonly councilEvidence: CouncilEvidenceService
  /** Track G4: the read-only judgment scorecard — derives outcomes from the
   *  audit trail + council/recall/signal read models, never a new judgment. */
  readonly outcomes: OutcomeService
  /** Spawns the council's `claude`/`codex` seats; killed on quit (A2). */
  private readonly engineRunner: EngineRunner
  readonly memory: MemoryHubService
  /** Cross-project Baz brain (Phase 6) — the same hub machinery, global root. */
  readonly globalMemory: MemoryHubService
  readonly memoryLedger: MemoryLedgerService
  /** Track G2: recall telemetry — which hub notes reach worker/council prompts. */
  readonly memoryRecalls: MemoryRecallService
  /** Single automatic memory-read gateway shared by every task surface. */
  readonly memoryContexts: MemoryContextService
  readonly memoryReviews: MemoryReviewService
  /** Main-process source of truth for project/global Memory trust policy. */
  readonly memoryPolicy: MemoryPolicyService
  readonly memoryDistiller: MemoryDistiller
  readonly memoryPipeline: MemoryPipeline
  readonly memoryCaptureQueue: MemoryCaptureQueue
  readonly memoryAutoCapture: MemoryAutoCapture
  readonly memoryConsolidator: MemoryConsolidator
  /** Faz D: the weekly curation sweep — proposes archive/merge for stale notes. */
  readonly memoryCuration: MemoryCurationService
  /** Thresholded, content-free Memory queue/audit/review health sensors. */
  readonly memoryLifecycle: MemoryLifecycleSentinel
  /** Scheduled content-free cross-system snapshot and change-only delivery. */
  readonly operationalHealth: OperationalHealthService
  readonly swarm: SwarmService
  /** Always-on deterministic signal layer: sensors → dedup → feed + notify. */
  readonly sentinel: SentinelService
  /** Durable success signal + bounded output + Pro summary coordinator. */
  readonly swarmCompletion: SwarmCompletionSteward
  readonly namedAgents: NamedAgentsService
  readonly appUpdate: AppUpdateService
  /** Mints UI-origin, short-lived, single-use capabilities for app lifecycle actions. */
  readonly lifecycleApprovals: LifecycleApprovalTokenService
  private closing = false
  /** Per-pane full-screen-TUI mode, so repaint frames never reach the matchers. */
  private readonly tuiState = new Map<string, TerminalScanState>()

  constructor(opts: { dbPath: string; userDataDir: string; events: CockpitEvents }) {
    this.db = openDatabase(opts.dbPath)
    this.secrets = new SecretStore(opts.userDataDir)
    this.audit = new AuditLogService(this.db)
    this.usage = new UsageService(this.db)
    this.agentUsage = new AgentUsageService()
    this.openRouterUsage = new OpenRouterUsageService(this.secrets)
    // One guarded macOS notification sink, shared by every notifier consumer
    // (the swarm's Faz 2.5 completion pop and the sentinel's alert pop). Guarded
    // behind Notification.isSupported() so headless/unsupported hosts no-op.
    const notifier: SentinelNotifier = (input) => {
      if (!Notification.isSupported()) return
      new Notification({ title: input.title, body: input.body }).show()
    }
    // The sentinel is constructed before the sensors that feed it. Model triage
    // is deliberately absent: the deterministic signal spine remains useful and
    // never starts a background orchestrator.
    this.memoryReviews = new MemoryReviewService(this.db)
    this.memoryPolicy = new MemoryPolicyService(this.db)
    // ProjectService + the memory hub are built BEFORE the sentinel so the
    // sentinel can take the hub as its Track H3 write path: a recurrence gotcha
    // the charter gate votes `accept` lands straight in the hub, while a `review`
    // verdict still routes to the queue (the hub only serves the direct branch).
    this.projects = new ProjectService(this.db)
    this.memory = new MemoryHubService(this.projects)
    this.globalMemory = new MemoryHubService(this.projects, join(opts.userDataDir, 'baz-memory'))
    this.memoryRecalls = new MemoryRecallService(this.db)
    this.memoryContexts = new MemoryContextService(
      this.memory,
      this.memoryRecalls,
      this.audit,
      undefined,
      this.globalMemory,
    )
    this.sentinel = new SentinelService(
      this.db,
      opts.events,
      notifier,
      undefined,
      this.memoryReviews,
      this.memory,
      this.memoryPolicy,
    )
    this.swarmCompletion = new SwarmCompletionSteward(
      opts.events,
      this.sentinel,
      { summarize: async () => null },
    )
    this.memoryLifecycle = new MemoryLifecycleSentinel(
      this.sentinel,
      this.audit,
      this.memoryReviews,
    )
    this.logs = new LogIntelligenceService(this.db, opts.events, this.sentinel)
    this.attachments = new AttachmentService(this.projects)
    this.approvals = new ApprovalService(this.db, this.audit, opts.events, this.sentinel)
    this.git = new GitService(this.db, this.projects)
    this.github = new GitHubService(this.projects)
    this.railway = new RailwayService(this.db, this.projects)
    this.claudeSessions = new ClaudeSessionsService()
    this.agentSessions = new AgentSessionsService(this.claudeSessions)
    this.chat = new ChatService(this.projects, this.memoryContexts, undefined, this.audit)
    this.review = new ReviewService(this.projects, this.audit, undefined, this.memoryContexts)
    // One session store, shared: the council writes runs to it, the swarm reads
    // a card's approved session back from it at spawn (Faz 2a).
    const councilSessions = new CouncilSessionStore(this.db)
    // The memory hub is constructed above (before the sentinel) so the council
    // can take it as its Faz D collaborator too — in spec mode the seats gain an
    // inline, relevance-ranked memory-pointer block (file-blind OpenRouter seats
    // have no other view of it).
    this.engineRunner = new EngineRunner(this.secrets)
    this.councilEvidence = new CouncilEvidenceService()
    this.council = new CouncilService(
      this.projects,
      this.audit,
      this.engineRunner,
      councilSessions,
      this.sentinel,
      this.memory,
      this.memoryRecalls,
      this.memoryContexts,
      this.councilEvidence,
      opts.events,
      this.agentUsage,
    )
    // Track G4: the judgment scorecard read model. It DERIVES outcomes — card
    // fates from the append-only audit trail, verdicts from the shared session
    // store, recall/triage from their read models — and composes the council's
    // own scorecard; it stores nothing and never changes a judgment.
    this.outcomes = new OutcomeService(this.db, councilSessions, {
      recalls: this.memoryRecalls,
      hub: this.memory,
      signals: this.sentinel,
      councilScore: this.council,
    })
    this.memoryLedger = new MemoryLedgerService(this.db)
    // this.memoryReviews is constructed earlier (Faz B) so the sentinel can take
    // it as its gotcha-route review sink.
    this.memoryDistiller = new MemoryDistiller(
      this.projects,
      new TranscriptReader(),
      (cwd, prompt) =>
        this.engineRunner.call(MEMORY_ANALYSIS_ENGINE, prompt, {
          cwd,
          timeout: 180_000,
          maxBuffer: 8 * 1024 * 1024,
          maxTokens: 4_000,
          evidenceOnly: true,
        }),
    )
    this.memoryPipeline = new MemoryPipeline(
      this.memory,
      this.memoryLedger,
      this.memoryReviews,
      this.memoryDistiller,
      undefined,
      this.globalMemory,
      this.audit,
      this.memoryPolicy,
    )
    this.memoryConsolidator = new MemoryConsolidator(this.memory, this.memoryReviews)
    // Weekly curation uses the same bounded, tool-less Memory analysis policy;
    // proposals route into review and never perform a direct file operation.
    this.memoryCuration = new MemoryCurationService(
      this.memory,
      this.memoryReviews,
      this.audit,
      (cwd, prompt) =>
        this.engineRunner.call(MEMORY_ANALYSIS_ENGINE, prompt, {
          cwd,
          timeout: 60_000,
          maxBuffer: 512 * 1024,
          maxTokens: 2_000,
          evidenceOnly: true,
        }),
    )
    this.memoryCaptureQueue = new MemoryCaptureQueue(this.db, this.memoryLifecycle)
    this.memoryAutoCapture = new MemoryAutoCapture(
      this.memoryCaptureQueue,
      this.memoryPipeline,
      this.projects,
      this.agentSessions,
    )
    // Rehydrate lifecycle pressure from durable state. Models are not involved;
    // only queue status/counts/ages reach Sentinel.
    for (const project of this.projects.list()) {
      this.memoryLifecycle.registerProject(project.id, project.createdAt)
      let curationExpected = false
      try {
        curationExpected = this.memory.listDocs(project.id).length > 0
      } catch {
        // An unreadable hub is handled by the curation failure sensor later.
      }
      let captureJobs: ReturnType<MemoryCaptureQueue['list']> = []
      try {
        captureJobs = this.memoryCaptureQueue.list(project.id)
      } catch {
        // A lifecycle read-model miss must never block app startup.
      }
      this.memoryLifecycle.scanProject(
        project.id,
        captureJobs,
        curationExpected,
      )
    }
    this.appUpdate = new AppUpdateService(opts.events)
    this.lifecycleApprovals = new LifecycleApprovalTokenService(opts.userDataDir)

    this.terminals = new TerminalManager(
      this.db,
      opts.events,
      this.projects,
      (projectId, sessionId, data) => this.handleTerminalOutput(projectId, sessionId, data),
      (projectId, kind) => {
        if (this.closing) return
        this.usage.record({
          projectId,
          provider: 'terminal',
          eventType: kind === 'session' ? 'session_started' : 'command_run',
        })
      },
      join(opts.userDataDir, 'shell-integration'),
    )
    // The standing memory-first contract rides each agent CLI's native channel
    // (Claude hook / Codex AGENTS.md) — user prompts are never modified.
    this.memoryContract = new MemoryContractService(this.projects, this.audit)
    // A4: right after TerminalManager reconciled its own stale rows, audit the
    // pids those rows carried for still-alive orphans (a previous process's pty
    // children that reparented on crash) and reap only OUR recent ones. Fully
    // isolated + guarded — a liveness audit can never block or crash startup.
    this.reconcileZombies()
    // After terminals: the swarm spawns workers through the TerminalManager
    // and listens for their exits on the same bus.
    this.namedAgents = new NamedAgentsService(this.projects)
    this.swarm = new SwarmService(
      this.db,
      this.terminals,
      this.memory,
      this.audit,
      opts.events,
      this.projects,
      new SwarmWorktrees(),
      this.agentUsage,
      this.namedAgents,
      new SwarmDoneSignal(),
      councilSessions,
      // Reuse the review service's diff-stat plumbing for the completion report.
      this.review,
      // Faz 2.5: a card reaching In review pops a native notification — the same
      // guarded sink the sentinel uses.
      notifier,
      // Faz A: a nonzero worker exit also raises a sentinel signal (optional).
      this.sentinel,
      // Track G2: record which hub notes reach a worker's opening brief.
      this.memoryRecalls,
      // Real bounded note content reaches every worker prompt.
      this.memoryContexts,
      // Successful completion persists evidence and publishes one deterministic
      // manager notification without an orchestrator process.
      this.swarmCompletion,
    )
    this.operationalHealth = new OperationalHealthService({
      state: new OperationalHealthStateStore(this.db),
      sentinel: this.sentinel,
      projects: this.projects,
      git: this.git,
      usage: this.agentUsage,
      swarm: this.swarm,
      terminals: this.terminals,
      logs: this.logs,
      approvals: this.approvals,
      captures: this.memoryCaptureQueue,
      reviews: this.memoryReviews,
      audit: this.audit,
    })
    // Forget a pane's TUI-mode state once it exits, so session ids never leak.
    opts.events.onTyped('terminal:exit', ({ sessionId }) => this.tuiState.delete(sessionId))

    // A crash between staging and Pro publication leaves a durable row. Resume
    // those oldest-first, sequentially; failure keeps the feed evidence intact.
    void this.swarmCompletion.resumePending()

    // The living brain: sweep idle Claude and Codex sessions into memory in the
    // background. Conservative defaults; all state is durable
    // in the capture queue, so a crash mid-drain resumes on the next boot.
    this.memoryAutoCapture.start()
    // Capture when a Claude or Codex pane closes. Other terminal roles do not
    // trigger capture; the idle poll remains the crash/sleep fallback.
    registerMemoryExitCapture(opts.events, this.memoryAutoCapture)

    // Faz D: weekly memory curation cadence — no new table. Each project's last
    // sweep is read from the append-only audit trail; anything not swept in >7
    // days (or never) gets a fire-and-forget sweep. Fully isolated so it can
    // never block or crash startup.
    this.scheduleCurationSweeps()
    // Cross-system health starts only after every sensor dependency exists. Its
    // healthy/unchanged ticks remain silent; only a changed anomaly wakes its
    // signal path.
    this.operationalHealth.start()
  }

  /** Age threshold before a project's memory hub is re-swept (7 days). */
  private static readonly CURATION_CADENCE_MS = 7 * 24 * 60 * 60 * 1000

  /** A4: how recent a reconciled terminal row must be before its pid is even a
   *  candidate to signal. Shrunk from 7d to 6h (argos HIGH): pid+recency is NOT
   *  identity. On a busy single-user dev box (kern.maxproc≈4000, heavy process
   *  churn) the kernel can recycle a freed pid onto the same user's unrelated
   *  process within hours — a 7-day window is wide enough to SIGTERM a live,
   *  reused pid. Recency only narrows the field; the ps-based identity check
   *  below is what actually authorizes a kill. */
  private static readonly ZOMBIE_RECENCY_MS = 6 * 60 * 60 * 1000

  /**
   * A4: liveness-audit the pids of terminal rows this process just reconciled
   * from running/starting → exited. Row-only reconciliation never checked whether
   * the pty children actually died; on crash they reparent to launchd/init and
   * keep burning CPU/API spend. We SIGTERM only OUR orphans, and only when the
   * row is recent AND the pid is still alive — never a pid that was never ours.
   *
   * Conservative by construction: only rows from `terminal_sessions` are ever
   * touched; a stale (>6h) row is skipped outright, a foreign/already-dead pid is
   * left alone, and — the decisive gate — the live pid's command line must relate
   * to the stored session (its shell binary or its startup command) before any
   * signal is sent. Every decision is audit-logged. Fully guarded — same contract
   * as the worktree prune: a miss costs a leaked process, a throw here would cost
   * the whole boot, so it can do neither.
   */
  private reconcileZombies(): void {
    try {
      const candidates = this.terminals.reconciledStaleSessions
      if (candidates.length === 0) return
      const nowMs = Date.now()
      let reaped = 0
      let alreadyDead = 0
      let skippedStale = 0
      let skippedUnverified = 0
      for (const row of candidates) {
        if (row.pid === null || row.pid <= 0) continue
        // Recency guard first: an old row's pid is almost certainly reused now.
        const lastMs = Date.parse(row.lastActiveAt)
        if (Number.isNaN(lastMs) || nowMs - lastMs > Services.ZOMBIE_RECENCY_MS) {
          skippedStale += 1
          continue
        }
        if (!this.isProcessAlive(row.pid)) {
          alreadyDead += 1
          continue
        }
        // Identity gate (argos HIGH): recency+liveness does not prove the live pid
        // is OUR orphan — the kernel may have recycled it onto an unrelated
        // process. Verify the pid's actual command line still matches the stored
        // session before signalling. Fail-closed: any mismatch, missing identity,
        // or ps failure declines the kill.
        if (!this.pidMatchesSession(row.pid, row.id)) {
          skippedUnverified += 1
          this.audit.record({
            projectId: row.projectId,
            actor: 'system',
            actionType: 'system.zombie_unverified',
            summary: 'Possible orphaned terminal process was left untouched because identity was unverified',
            payload: { pid: row.pid, sessionId: row.id, lastActiveAt: row.lastActiveAt },
          })
          continue
        }
        // Our recent, identity-verified orphan is still alive — SIGTERM the pty
        // pid. Guarded: it may die between probe and signal, that race is fine.
        try {
          process.kill(row.pid, 'SIGTERM')
          reaped += 1
          this.audit.record({
            projectId: row.projectId,
            actor: 'system',
            actionType: 'system.zombie_reaped',
            summary: `Reaped orphaned terminal pid ${row.pid} left running by a previous session`,
            payload: { pid: row.pid, sessionId: row.id, lastActiveAt: row.lastActiveAt },
          })
        } catch {
          // Vanished between probe and signal, or not ours to signal — either way
          // it is no longer our concern.
        }
      }
      // One summary line whenever the sweep did (or deliberately declined) work.
      if (reaped > 0 || skippedStale > 0 || alreadyDead > 0 || skippedUnverified > 0) {
        this.audit.record({
          projectId: null,
          actor: 'system',
          actionType: 'system.zombie_sweep',
          summary: `Zombie sweep: ${reaped} reaped, ${alreadyDead} already dead, ${skippedStale} skipped (stale pid), ${skippedUnverified} skipped (identity unverified)`,
          payload: {
            candidates: candidates.length,
            reaped,
            alreadyDead,
            skippedStale,
            skippedUnverified,
          },
        })
      }
    } catch {
      // A liveness-audit failure must never block boot — leaked pids are a
      // resource nuisance, not a correctness hazard (mirrors the worktree prune).
    }
  }

  /**
   * Existence probe via the null signal: `process.kill(pid, 0)` delivers nothing
   * but throws ESRCH when no such process exists and EPERM when it exists but is
   * owned by another user. EPERM is treated as NOT reapable — a process we can't
   * signal is not one we spawned, i.e. a reused pid — so only a clean success
   * (our own live process) returns true.
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /**
   * Identity check that authorizes a zombie reap. Reads the stored session's
   * `shell` (always present) and `command` (nullable) from `terminal_sessions`,
   * asks the OS for the live pid's real command line (`ps -o command= -p <pid>`),
   * and returns true only when that command line contains the session's startup
   * command's first token OR its shell binary basename.
   *
   * Why this is sound-enough: a cockpit pane's pty pid is the shell it spawned
   * (node-pty spawns `shell`), so a genuine orphan's command line carries that
   * shell (e.g. `zsh`) and, when a startup command was launched, that token too
   * (e.g. `claude`, `codex`, `npm`). A recycled pid running some unrelated
   * program will contain neither. It is deliberately NOT perfect — a bare reused
   * shell of the same kind could still match — but it fails closed on every
   * ambiguity the caller can act on: missing row, empty ps output, or a ps error
   * all return false, so uncertainty never kills.
   */
  private pidMatchesSession(pid: number, sessionId: string): boolean {
    const row = this.sessionIdentity(sessionId)
    if (!row) return false
    const cmdline = this.processCommandLine(pid)
    if (!cmdline) return false
    const haystack = cmdline.toLowerCase()
    const tokens: string[] = []
    const shellName = row.shell ? basename(row.shell.trim()).toLowerCase() : ''
    if (shellName) tokens.push(shellName)
    if (row.command) {
      const first = row.command.trim().split(/\s+/)[0] ?? ''
      const commandToken = first ? basename(first).toLowerCase() : ''
      if (commandToken) tokens.push(commandToken)
    }
    if (tokens.length === 0) return false
    return tokens.some((t) => haystack.includes(t))
  }

  /** Stored shell + startup command for a terminal session, or null if the row
   *  is gone. Fail-closed: any query error returns null (no identity → no kill). */
  private sessionIdentity(sessionId: string): { shell: string; command: string | null } | null {
    try {
      const row = this.db
        .prepare('SELECT shell, command FROM terminal_sessions WHERE id = ?')
        .get(sessionId) as { shell: string; command: string | null } | undefined
      return row ?? null
    } catch {
      return null
    }
  }

  /** The live pid's command line via `ps -o command= -p <pid>`, or null when ps
   *  fails or reports nothing — both treated as "cannot verify", i.e. no kill. */
  private processCommandLine(pid: number): string | null {
    try {
      const out = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 2000,
      }).trim()
      return out.length > 0 ? out : null
    } catch {
      return null
    }
  }

  /**
   * Fire-and-forget a curation sweep for every project not swept in the last
   * {@link CURATION_CADENCE_MS} (or never). Best-effort: each project is isolated,
   * the whole pass is try/caught, and the sweep itself never throws — a curation
   * miss costs nothing, but a boot failure would cost everything.
   */
  private scheduleCurationSweeps(): void {
    try {
      const nowMs = Date.now()
      // Collect the due projects, then sweep SEQUENTIALLY inside one
      // fire-and-forget chain (argos H1): on this feature's first boot every
      // project is due at once, and a parallel fan-out would mean one paid
      // model call PER PROJECT simultaneously. Awaiting
      // each sweep bounds the fleet to a single spawn regardless of count.
      const due: string[] = []
      for (const project of this.projects.list()) {
        try {
          const last = this.audit.lastAt(project.id, 'memory.curation_sweep')
          const lastMs = last ? Date.parse(last) : Number.NaN
          if (Number.isNaN(lastMs) || nowMs - lastMs > Services.CURATION_CADENCE_MS) {
            due.push(project.id)
          }
        } catch {
          // One project's failure never stops the others.
        }
      }
      void (async () => {
        for (const projectId of due) {
          try {
            await this.memoryCuration.sweep(projectId)
            // Autopilot settles its own reversible cleanup right away — the
            // inbox only keeps what genuinely needs the owner (conflicts,
            // uncertain suggestions, non-autopilot brains).
            this.memoryPipeline.applyCleanupBacklog(projectId, 'project')
          } catch {
            /* a missed sweep is invisible by design */
          }
        }
      })()
    } catch {
      // Enumeration failed — cadence is best-effort, never a boot blocker.
    }
  }

  /**
   * Filter terminal noise before persisting. A pane running a full-screen agent
   * CLI (Claude/Codex), pager, or editor repaints the screen with the project's
   * own source — text that legitimately contains "build failed", "Cannot find
   * module", etc. We track that repaint mode across chunks and drop the whole
   * chunk while a frame is being painted, so the error matchers never see a pane
   * echoing the codebase back at itself. Remaining output is ANSI-stripped, and
   * only clean warning/error lines become log events (and feed pattern matching).
   */
  private handleTerminalOutput(projectId: string, sessionId: string, data: string): void {
    if (this.closing) return
    const prev = this.tuiState.get(sessionId) ?? initialTerminalScanState()
    const scan = scanTerminalChunk(data, prev)
    this.tuiState.set(sessionId, scan.state)
    if (scan.suppress) return
    const interesting = sanitizeChunkToLines(data)
      .filter((line) => {
        const level = inferLogLevel(line)
        return level === 'error' || level === 'warn'
      })
      .join('\n')
    if (interesting.trim().length === 0) return
    this.logs.ingest({ projectId, sourceType: 'terminal', sourceId: sessionId, message: interesting })
  }

  async dashboard(projectId: string): Promise<DashboardSnapshot> {
    const project = this.projects.get(projectId)
    // Git and Railway lookups are independent — fetch them concurrently.
    const [git, railwayConnection, railwayServices] = await Promise.all([
      this.git.status(projectId).catch(() => null),
      this.railway.status(projectId),
      this.railway.services(projectId),
    ])
    // Shape-building is shared with the browser mock (shared/dashboard-assembly)
    // so the two bridges assemble the exact same snapshot from their inputs.
    return assembleDashboard({
      project,
      git,
      terminals: this.terminals.list(projectId),
      agentCount: this.terminals.countActiveAgents(projectId),
      railwayConnected: railwayConnection.connected,
      railwayServiceCount: railwayServices.length,
      recentErrors: this.logs.listInsights(projectId, DASHBOARD_RECENT_ERRORS_LIMIT),
      pendingApprovals: this.approvals.countPending(projectId),
      usage: this.usage.summarize(projectId),
    })
  }

  route(projectId: string, query: string): RouterResult {
    const result = classifyRoute(query)
    this.audit.record({
      projectId,
      actor: 'ai',
      actionType: 'router.classify',
      summary: `Routed task to ${result.primary.agent}: "${query.slice(0, 80)}"`,
      payload: { primary: result.primary.agent, risk: result.primary.risk },
    })
    return result
  }

  systemInfo() {
    return {
      cliAvailable: {
        claude: hasCli('claude'),
        codex: hasCli('codex'),
        railway: hasCli('railway'),
        git: hasCli('git'),
        gh: hasCli('gh'),
      },
    }
  }

  shutdown(): void {
    if (this.closing) return
    this.closing = true
    this.memoryAutoCapture.stop()
    this.memoryLifecycle.dispose()
    this.operationalHealth.stop()
    this.swarmCompletion.clear()
    // Kill Council/Memory model children before closing the DB so they cannot
    // reparent on quit and continue using CPU or provider capacity.
    this.engineRunner.killAll()
    // Kill terminals (flags TerminalManager so late pty events are ignored), then
    // close the DB. Order + flags prevent "database connection is not open".
    this.terminals.killAll()
    this.tuiState.clear()
    this.appUpdate.stopAutoCheck()
    try {
      this.db.close()
    } catch {
      /* ignore */
    }
  }
}
