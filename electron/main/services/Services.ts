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
import { MemoryReviewService } from './MemoryReviewService'
import { MemoryDistiller } from './MemoryDistiller'
import { MemoryPipeline } from './MemoryPipeline'
import { MemoryCaptureQueue } from './MemoryCaptureQueue'
import { MemoryAutoCapture } from './MemoryAutoCapture'
import { MemoryConsolidator } from './MemoryConsolidator'
import { MemoryCurationService } from './MemoryCurationService'
import { registerMemoryExitCapture } from './memoryExitTrigger'
import { SwarmService } from './SwarmService'
import { SentinelService, type SentinelNotifier } from './SentinelService'
import { CardOutputTracker } from './hermes/CardOutputTracker'
import { HermesMcpServer } from './hermes/HermesMcpServer'
import { HermesApprovalExecutor } from './hermes/HermesApprovalExecutor'
import { HermesChecksService } from './hermes/HermesChecksService'
import { HermesChatService } from './hermes/HermesChatService'
import { HermesTriageService } from './hermes/HermesTriageService'
import { AppScreenshotService } from './hermes/AppScreenshotService'
import { NamedAgentsService } from './NamedAgentsService'
import { SwarmWorktrees } from './SwarmWorktrees'
import { SwarmDoneSignal } from './SwarmDoneSignal'
import { ReviewService } from './ReviewService'
import { CouncilService } from './CouncilService'
import { OutcomeService } from './OutcomeService'
import { EngineRunner } from './EngineRunner'
import { CouncilSessionStore } from '../db/CouncilSessionStore'
import { ClaudeSessionsService } from './ClaudeSessionsService'
import { GitService } from './GitService'
import { GitHubService } from './GitHubService'
import { LogIntelligenceService } from './LogIntelligenceService'
import { ProjectService } from './ProjectService'
import { RailwayService } from './RailwayService'
import { SecretStore } from './SecretStore'
import { TerminalManager } from './TerminalManager'
import { UsageService } from './UsageService'
import { hasCli } from './cliDetect'

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
  /** Live OpenRouter credit remaining — powers the Hermes engine core's ring. */
  readonly openRouterUsage: OpenRouterUsageService
  readonly logs: LogIntelligenceService
  readonly projects: ProjectService
  readonly git: GitService
  readonly github: GitHubService
  readonly railway: RailwayService
  readonly secrets: SecretStore
  readonly terminals: TerminalManager
  readonly claudeSessions: ClaudeSessionsService
  readonly chat: ChatService
  /** Backend for the Hermes chat widget (docs/plans/hermes.md Faz 7). */
  readonly hermesChat: HermesChatService
  /** Faz B: the cheap DeepSeek seat that triages sentinel signals asynchronously. */
  readonly hermesTriage: HermesTriageService
  readonly review: ReviewService
  readonly council: CouncilService
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
  readonly memoryReviews: MemoryReviewService
  readonly memoryDistiller: MemoryDistiller
  readonly memoryPipeline: MemoryPipeline
  readonly memoryCaptureQueue: MemoryCaptureQueue
  readonly memoryAutoCapture: MemoryAutoCapture
  readonly memoryConsolidator: MemoryConsolidator
  /** Faz D: the weekly curation sweep — proposes archive/merge for stale notes. */
  readonly memoryCuration: MemoryCurationService
  readonly swarm: SwarmService
  /** Always-on, LLM-free signal layer (Faz A): sensors → dedup → feed + notify. */
  readonly sentinel: SentinelService
  readonly namedAgents: NamedAgentsService
  /** Session-scoped terminal-output tap for the Hermes `subscribe_card_output` tool. */
  readonly cardOutput: CardOutputTracker
  /** Allowlist-only check runner (test/typecheck/lint) for the Hermes `run_checks` tool. */
  readonly hermesChecks: HermesChecksService
  /** Build + serve + screenshot pipeline for the Hermes `take_app_screenshot` tool. */
  readonly appScreenshot: AppScreenshotService
  /** Local MCP server exposing the narrow Swarm tool set to the Hermes agent. */
  readonly hermesMcp: HermesMcpServer
  /** Opens+starts a Swarm card once the human approves a Hermes proposal (Faz 6). */
  readonly hermesApprovalExecutor: HermesApprovalExecutor
  readonly appUpdate: AppUpdateService
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
    // Faz A: the sentinel is constructed BEFORE the sensors that feed it (log
    // intelligence, approvals, council, swarm) so it can be injected as their
    // optional collaborator. It is a fire-and-forget sink — report() never throws.
    // Faz B: its two enrichment collaborators (the DeepSeek triage seat + the
    // review-queue sink) are built here first so the sentinel gets them at
    // construction; both are optional — absent, the spine behaves identically.
    this.hermesTriage = new HermesTriageService()
    this.memoryReviews = new MemoryReviewService(this.db)
    // ProjectService + the memory hub are built BEFORE the sentinel so the
    // sentinel can take the hub as its Track H3 write path: a recurrence gotcha
    // the charter gate votes `accept` lands straight in the hub, while a `review`
    // verdict still routes to the queue (the hub only serves the direct branch).
    this.projects = new ProjectService(this.db)
    this.memory = new MemoryHubService(this.projects)
    this.sentinel = new SentinelService(
      this.db,
      opts.events,
      notifier,
      this.hermesTriage,
      this.memoryReviews,
      this.memory,
    )
    this.logs = new LogIntelligenceService(this.db, opts.events, this.sentinel)
    this.attachments = new AttachmentService(this.projects)
    this.approvals = new ApprovalService(this.db, this.audit, opts.events, this.sentinel)
    this.git = new GitService(this.db, this.projects)
    this.github = new GitHubService(this.projects)
    this.railway = new RailwayService(this.db, this.projects)
    this.claudeSessions = new ClaudeSessionsService()
    this.chat = new ChatService(this.projects)
    // The MCP bearer token is minted by `hermesMcp` (constructed further down),
    // so the token is read lazily at ask() time via a thunk — by then the server
    // exists. This keeps the chat service decoupled from construction order.
    this.hermesChat = new HermesChatService(
      this.projects,
      this.db,
      undefined,
      () => this.hermesMcp?.authToken,
    )
    this.review = new ReviewService(this.projects, this.audit)
    // One session store, shared: the council writes runs to it, the swarm reads
    // a card's approved session back from it at spawn (Faz 2a).
    const councilSessions = new CouncilSessionStore(this.db)
    // The memory hub is constructed above (before the sentinel) so the council
    // can take it as its Faz D collaborator too — in spec mode the seats gain an
    // inline, relevance-ranked memory-pointer block (file-blind OpenRouter seats
    // have no other view of it).
    this.globalMemory = new MemoryHubService(this.projects, join(opts.userDataDir, 'baz-memory'))
    this.engineRunner = new EngineRunner(this.secrets)
    // Track G2: recall telemetry is built here so both the council (spec-mode
    // memory-pointer block) and the swarm (worker brief) take it as a best-effort
    // collaborator — recording a recall never endangers a spawn or a council run.
    this.memoryRecalls = new MemoryRecallService(this.db)
    this.council = new CouncilService(
      this.projects,
      this.audit,
      this.engineRunner,
      councilSessions,
      this.sentinel,
      this.memory,
      this.memoryRecalls,
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
    this.memoryDistiller = new MemoryDistiller(this.projects)
    this.memoryPipeline = new MemoryPipeline(
      this.memory,
      this.memoryLedger,
      this.memoryReviews,
      this.memoryDistiller,
      undefined,
      this.globalMemory,
      this.audit,
    )
    this.memoryConsolidator = new MemoryConsolidator(this.memory, this.memoryReviews)
    // Faz D: the weekly curation sweep. Reuses the triage runner pattern (a cheap
    // Hermes oneshot); proposals route into the review queue, never a file op.
    this.memoryCuration = new MemoryCurationService(this.memory, this.memoryReviews, this.audit)
    this.memoryCaptureQueue = new MemoryCaptureQueue(this.db)
    this.memoryAutoCapture = new MemoryAutoCapture(
      this.memoryCaptureQueue,
      this.memoryPipeline,
      this.projects,
      this.claudeSessions,
    )
    this.appUpdate = new AppUpdateService(opts.events)

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
    )
    // Forget a pane's TUI-mode state once it exits, so session ids never leak.
    opts.events.onTyped('terminal:exit', ({ sessionId }) => this.tuiState.delete(sessionId))

    // Hermes control surface: a session-scoped output tap plus the local MCP
    // server that fronts the swarm/usage tools. The server binds to loopback and
    // starts in the background — a bind failure logs and is swallowed so Hermes
    // being unavailable can never keep the app from booting.
    this.cardOutput = new CardOutputTracker(opts.events)
    this.hermesChecks = new HermesChecksService(this.projects)
    this.appScreenshot = new AppScreenshotService(this.projects)
    this.hermesMcp = new HermesMcpServer({
      swarm: this.swarm,
      council: this.council,
      agentUsage: this.agentUsage,
      cardOutput: this.cardOutput,
      git: this.git,
      review: this.review,
      checks: this.hermesChecks,
      screenshot: this.appScreenshot,
      memory: this.memory,
      memoryReviews: this.memoryReviews,
      memoryPipeline: this.memoryPipeline,
      memoryCuration: this.memoryCuration,
      logs: this.logs,
      approvals: this.approvals,
      // Faz C: gate outcomes (accept/review/reject counts, no content) land here.
      audit: this.audit,
    })
    void this.hermesMcp.start().catch((err) => {
      // Last-resort surface; matches the main process's crash-log fallback.
      console.error('[Services] HermesMcpServer failed to start:', err)
    })

    // Faz 6: when the human approves a Hermes `propose_open_swarm_card` request
    // on the Dashboard, open+start the proposed card. Registered here alongside
    // the other event listeners; consumes the approval single-use (idempotent).
    this.hermesApprovalExecutor = new HermesApprovalExecutor({
      events: opts.events,
      approvals: this.approvals,
      swarm: this.swarm,
    })
    this.hermesApprovalExecutor.start()

    // The living brain: sweep idle Claude sessions into memory in the background
    // (docs/memory-imp.md Phase 4). Conservative defaults; all state is durable
    // in the capture queue, so a crash mid-drain resumes on the next boot.
    this.memoryAutoCapture.start()
    // Faz 5: capture the instant a Claude pane closes, instead of waiting for the
    // idle-poll. Non-claude terminals never trigger a capture. The idle-poll
    // above remains the fallback for panes that never emit a clean exit.
    registerMemoryExitCapture(opts.events, this.memoryAutoCapture)

    // Faz D: weekly memory curation cadence — no new table. Each project's last
    // sweep is read from the append-only audit trail; anything not swept in >7
    // days (or never) gets a fire-and-forget sweep. Fully isolated so it can
    // never block or crash startup.
    this.scheduleCurationSweeps()
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
          continue
        }
        // Our recent, identity-verified orphan is still alive — SIGTERM the pty
        // pid. Guarded: it may die between probe and signal, that race is fine.
        try {
          process.kill(row.pid, 'SIGTERM')
          reaped += 1
          this.audit.record({
            projectId: null,
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
      // project is due at once, and a parallel fan-out would mean one hermes
      // spawn + one paid DeepSeek call PER PROJECT simultaneously. Awaiting
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
    this.cardOutput.clear()
    // Fire-and-forget: the process is quitting; closing the socket is best-effort.
    void this.hermesMcp.stop()
    // Kill orphaned CLI children BEFORE closing the DB (roadmap A2). Council seats
    // (claude/codex) and the two Hermes execFile paths (chat up to 5min, triage
    // 45s) otherwise reparent on quit and keep burning CPU/API spend until their
    // own timeouts. All three killAll()s are best-effort and never throw.
    this.engineRunner.killAll()
    this.hermesChat.killAll()
    this.hermesTriage.killAll()
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
