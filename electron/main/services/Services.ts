import { join } from 'node:path'
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
import { MemoryReviewService } from './MemoryReviewService'
import { MemoryDistiller } from './MemoryDistiller'
import { MemoryPipeline } from './MemoryPipeline'
import { MemoryCaptureQueue } from './MemoryCaptureQueue'
import { MemoryAutoCapture } from './MemoryAutoCapture'
import { MemoryConsolidator } from './MemoryConsolidator'
import { registerMemoryExitCapture } from './memoryExitTrigger'
import { SwarmService } from './SwarmService'
import { CardOutputTracker } from './hermes/CardOutputTracker'
import { HermesMcpServer } from './hermes/HermesMcpServer'
import { HermesApprovalExecutor } from './hermes/HermesApprovalExecutor'
import { HermesChecksService } from './hermes/HermesChecksService'
import { HermesChatService } from './hermes/HermesChatService'
import { AppScreenshotService } from './hermes/AppScreenshotService'
import { NamedAgentsService } from './NamedAgentsService'
import { SwarmWorktrees } from './SwarmWorktrees'
import { SwarmDoneSignal } from './SwarmDoneSignal'
import { ReviewService } from './ReviewService'
import { CouncilService } from './CouncilService'
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
  readonly review: ReviewService
  readonly council: CouncilService
  readonly memory: MemoryHubService
  /** Cross-project Baz brain (Phase 6) — the same hub machinery, global root. */
  readonly globalMemory: MemoryHubService
  readonly memoryLedger: MemoryLedgerService
  readonly memoryReviews: MemoryReviewService
  readonly memoryDistiller: MemoryDistiller
  readonly memoryPipeline: MemoryPipeline
  readonly memoryCaptureQueue: MemoryCaptureQueue
  readonly memoryAutoCapture: MemoryAutoCapture
  readonly memoryConsolidator: MemoryConsolidator
  readonly swarm: SwarmService
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
    this.logs = new LogIntelligenceService(this.db, opts.events)
    this.projects = new ProjectService(this.db)
    this.attachments = new AttachmentService(this.projects)
    this.approvals = new ApprovalService(this.db, this.audit, opts.events)
    this.git = new GitService(this.db, this.projects)
    this.github = new GitHubService(this.projects)
    this.railway = new RailwayService(this.db, this.projects)
    this.claudeSessions = new ClaudeSessionsService()
    this.chat = new ChatService(this.projects)
    this.hermesChat = new HermesChatService(this.projects)
    this.review = new ReviewService(this.projects, this.audit)
    // One session store, shared: the council writes runs to it, the swarm reads
    // a card's approved session back from it at spawn (Faz 2a).
    const councilSessions = new CouncilSessionStore(this.db)
    this.council = new CouncilService(
      this.projects,
      this.audit,
      new EngineRunner(this.secrets),
      councilSessions,
    )
    this.memory = new MemoryHubService(this.projects)
    this.globalMemory = new MemoryHubService(this.projects, join(opts.userDataDir, 'baz-memory'))
    this.memoryLedger = new MemoryLedgerService(this.db)
    this.memoryReviews = new MemoryReviewService(this.db)
    this.memoryDistiller = new MemoryDistiller(this.projects)
    this.memoryPipeline = new MemoryPipeline(
      this.memory,
      this.memoryLedger,
      this.memoryReviews,
      this.memoryDistiller,
      undefined,
      this.globalMemory,
    )
    this.memoryConsolidator = new MemoryConsolidator(this.memory, this.memoryReviews)
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
      // Faz 2.5: a card reaching In review pops a native notification. Guarded
      // behind Notification.isSupported() so headless/unsupported hosts no-op.
      (input) => {
        if (!Notification.isSupported()) return
        new Notification({ title: input.title, body: input.body }).show()
      },
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
      logs: this.logs,
      approvals: this.approvals,
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
    // Kill terminals first (flags TerminalManager so late pty events are ignored),
    // then close the DB. Order + flags prevent "database connection is not open".
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
