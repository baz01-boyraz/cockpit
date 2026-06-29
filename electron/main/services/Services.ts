import type {
  DashboardSnapshot,
  RouterResult,
} from '@shared/domain'
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
import { ApprovalService } from './ApprovalService'
import { AppUpdateService } from './AppUpdateService'
import { ChatService } from './ChatService'
import { ClaudeSessionsService } from './ClaudeSessionsService'
import { GitService } from './GitService'
import { GitHubService } from './GitHubService'
import { LocalCommandRunner } from './LocalCommandRunner'
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
  readonly logs: LogIntelligenceService
  readonly projects: ProjectService
  readonly git: GitService
  readonly github: GitHubService
  readonly railway: RailwayService
  readonly secrets: SecretStore
  readonly terminals: TerminalManager
  readonly claudeSessions: ClaudeSessionsService
  readonly local: LocalCommandRunner
  readonly chat: ChatService
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
    this.logs = new LogIntelligenceService(this.db, opts.events)
    this.projects = new ProjectService(this.db)
    this.attachments = new AttachmentService(this.projects)
    this.approvals = new ApprovalService(this.db, this.audit, opts.events)
    this.git = new GitService(this.db, this.projects)
    this.github = new GitHubService(this.projects)
    this.railway = new RailwayService(this.db, this.projects)
    this.claudeSessions = new ClaudeSessionsService()
    this.local = new LocalCommandRunner()
    this.chat = new ChatService(this.projects)
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
    )
    // Forget a pane's TUI-mode state once it exits, so session ids never leak.
    opts.events.onTyped('terminal:exit', ({ sessionId }) => this.tuiState.delete(sessionId))
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
      .filter((line) => inferLogLevel(line) === 'error' || inferLogLevel(line) === 'warn')
      .join('\n')
    if (interesting.trim().length === 0) return
    this.logs.ingest({ projectId, sourceType: 'terminal', sourceId: sessionId, message: interesting })
  }

  async dashboard(projectId: string): Promise<DashboardSnapshot> {
    const project = this.projects.get(projectId)
    const git = await this.git.status(projectId).catch(() => null)
    const terminals = this.terminals.list(projectId)
    const railwayConnection = await this.railway.status(projectId)
    const railwayServices = await this.railway.services(projectId)
    const recentErrors = this.logs.listInsights(projectId, 5)
    const usage = this.usage.summarize(projectId)
    const agentRow = this.db
      .prepare(`SELECT COUNT(*) as n FROM agent_sessions WHERE project_id = ? AND status = 'active'`)
      .get(projectId) as { n: number }

    return {
      project,
      branch: git?.branch ?? null,
      changedFiles: git?.changedFilesCount ?? 0,
      terminalCount: terminals.length,
      runningTerminals: terminals.filter((t) => t.status === 'running').length,
      agentCount: agentRow.n,
      railwayConnected: railwayConnection.connected,
      railwayServices: railwayServices.length,
      recentErrors,
      pendingApprovals: this.approvals.countPending(projectId),
      usage,
    }
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
    // Kill terminals first (flags TerminalManager so late pty events are ignored),
    // then close the DB. Order + flags prevent "database connection is not open".
    this.terminals.killAll()
    this.tuiState.clear()
    try {
      this.db.close()
    } catch {
      /* ignore */
    }
  }
}
