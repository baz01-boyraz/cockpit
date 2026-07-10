/**
 * The typed IPC contract.
 *
 * `CockpitApi` is the single, narrow surface exposed to the renderer on
 * `window.cockpit`. Both the preload bridge and the in-browser mock adapter
 * implement this exact interface, so the renderer never knows (or cares)
 * whether it is talking to a real Electron main process or a mock.
 *
 * Channel name constants keep the preload `invoke` calls and the main-process
 * `handle` registrations in lockstep.
 */
import type { ClaudeRunOptions } from './claude-run'
import type { DiffStat, ReviewResult } from './review'
import type { CouncilResult, CouncilSessionSummary, ScorecardEntry } from './council'
import type { OutcomeScorecard } from './outcomes'
import type { MemoryHubSnapshot, MemoryNote } from './memory-hub'
import type { MemoryHealth } from './memory-health'
import type { CaptureResult } from './memory-pipeline'
import type { ReviewDecision, ReviewItem } from './memory-review'
import type { LedgerEntry } from './memory-ledger'
import type { ConsolidationResult } from './memory-consolidate'
import type { BoardColumn, CardStatus, StartCardResult } from './kanban'
import type { CompletionReport } from './completion-report'
import type { Assignment } from './agent-taxonomy'
import type { NamedAgentSummary } from './named-agents'
import type { SentinelOutcome, SentinelSignal } from './sentinel'
import type { SecretKind } from './schemas'
import type {
  AgentType,
  AgentUsageReport,
  AppUpdateState,
  ApprovalRequest,
  AuditEntry,
  ClaudeSessionSummary,
  DashboardSnapshot,
  ErrorInsight,
  GitCommitResult,
  GitDiff,
  GitHubRepositoryStatus,
  GitPushResult,
  GitSnapshot,
  LogEvent,
  MaskedEnvVar,
  OpenRouterUsageSnapshot,
  Project,
  ProjectConfig,
  RailwayConnection,
  RailwayService,
  ResumableSessionProvider,
  ResumableSessionSummary,
  RouterResult,
  SwarmCardCompletedEvent,
  TerminalExitEvent,
  TerminalAttachment,
  TerminalOutputChunk,
  TerminalRole,
  TerminalSession,
  UsageSummary,
} from './domain'

export const IPC = {
  projectsList: 'projects:list',
  projectsAdd: 'projects:add',
  projectsSelect: 'projects:select',
  projectsConfig: 'projects:config',
  projectsDashboard: 'projects:dashboard',

  terminalsList: 'terminals:list',
  terminalsCreate: 'terminals:create',
  terminalsWrite: 'terminals:write',
  terminalsResize: 'terminals:resize',
  terminalsKill: 'terminals:kill',
  terminalsRestart: 'terminals:restart',
  terminalsRename: 'terminals:rename',
  terminalsLaunchAgent: 'terminals:launchAgent',
  terminalsClaudeSessions: 'terminals:claudeSessions',
  terminalsResumeClaude: 'terminals:resumeClaude',
  terminalsAgentSessions: 'terminals:agentSessions',
  terminalsResumeAgent: 'terminals:resumeAgent',
  terminalsAttachImage: 'terminals:attachImage',

  gitStatus: 'git:status',
  gitInitRepo: 'git:initRepo',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitCommit: 'git:commit',
  gitPush: 'git:push',

  githubStatus: 'github:status',
  githubCreateRepo: 'github:createRepo',

  railwayStatus: 'railway:status',
  railwayServices: 'railway:services',
  railwayEnv: 'railway:env',

  logsList: 'logs:list',
  logsInsights: 'logs:insights',
  logsIngest: 'logs:ingest',
  logsDismissInsight: 'logs:dismissInsight',
  logsClearInsights: 'logs:clearInsights',

  usageSummary: 'usage:summary',
  agentUsageGet: 'agentUsage:get',
  openRouterUsageStatus: 'openRouterUsage:status',

  approvalsList: 'approvals:list',
  approvalsRequest: 'approvals:request',
  approvalsDecide: 'approvals:decide',

  routerRoute: 'router:route',
  chatAsk: 'chat:ask',
  hermesChatAsk: 'hermesChat:ask',
  hermesChatClear: 'hermesChat:clear',
  reviewRun: 'review:run',
  reviewRunText: 'review:runText',
  reviewDiffStat: 'review:diffStat',
  councilRun: 'council:run',
  councilScorecard: 'council:scorecard',
  councilSessions: 'council:sessions',
  councilSession: 'council:session',

  outcomesScorecard: 'outcomes:scorecard',

  memoryList: 'memory:list',
  memoryRead: 'memory:read',
  memoryWrite: 'memory:write',
  memoryRename: 'memory:rename',
  memoryTrash: 'memory:trash',
  memoryHealth: 'memory:health',
  memoryCaptureSession: 'memory:captureSession',
  memoryReviewQueue: 'memory:reviewQueue',
  memoryResolveReview: 'memory:resolveReview',
  memoryLedger: 'memory:ledger',
  memoryConsolidate: 'memory:consolidate',
  memoryBazList: 'memory:bazList',
  memoryBazRead: 'memory:bazRead',

  swarmBoard: 'swarm:board',
  swarmCreateCard: 'swarm:createCard',
  swarmUpdateCard: 'swarm:updateCard',
  swarmMoveCard: 'swarm:moveCard',
  swarmRemoveCard: 'swarm:removeCard',
  swarmStartCard: 'swarm:startCard',
  swarmParkCard: 'swarm:parkCard',
  swarmAgents: 'swarm:agents',
  swarmCompletionReport: 'swarm:completionReport',

  sentinelList: 'sentinel:list',
  sentinelMarkSeen: 'sentinel:markSeen',
  sentinelUnseenCount: 'sentinel:unseenCount',
  sentinelRecordOutcome: 'sentinel:recordOutcome',
  sentinelCreateCard: 'sentinel:createCard',

  secretSet: 'secret:set',
  secretHas: 'secret:has',
  secretDelete: 'secret:delete',

  auditList: 'audit:list',

  systemInfo: 'system:info',
  dialogChooseDirectory: 'dialog:chooseDirectory',

  appUpdateStatus: 'appUpdate:status',
  appUpdateCheck: 'appUpdate:check',
  appUpdateDownload: 'appUpdate:download',
  appUpdateInstall: 'appUpdate:install',
  appUpdateRefresh: 'appUpdate:refresh',
  appUpdateInstallRelease: 'appUpdate:installRelease',
  appUpdateRefreshEligible: 'appUpdate:refreshEligible',

  // main -> renderer push events
  evtTerminalData: 'evt:terminal:data',
  evtTerminalExit: 'evt:terminal:exit',
  evtApprovalsChanged: 'evt:approvals:changed',
  evtLogsChanged: 'evt:logs:changed',
  evtAppUpdateChanged: 'evt:appUpdate:changed',
  evtSwarmCardCompleted: 'evt:swarm:cardCompleted',
  evtSentinelAlert: 'evt:sentinel:alert',
} as const

export type Unsubscribe = () => void

export interface SystemInfo {
  platform: NodeJS.Platform | string
  appVersion: string
  electron: string | null
  node: string
  isMock: boolean
  cliAvailable: { claude: boolean; codex: boolean; railway: boolean; git: boolean; gh: boolean }
}

export interface ChatReply {
  ok: boolean
  text: string
  model: string
}

/**
 * Reply from the Hermes chat widget backend. Unlike `ChatReply` there is no
 * model label (the model is fixed by the host's Hermes config, not picked per
 * call); a failed turn carries a human-readable `error` instead of throwing
 * across IPC.
 */
export interface HermesChatReply {
  ok: boolean
  text: string
  error?: string
}

/** Result of kicking off a local rebuild + relaunch of the cockpit itself. */
export interface AppRefreshResult {
  ok: boolean
  message: string
}

export interface CockpitApi {
  projects: {
    list(): Promise<Project[]>
    add(input: { path: string; name?: string }): Promise<Project>
    select(projectId: string): Promise<DashboardSnapshot>
    config(projectId: string): Promise<ProjectConfig>
    dashboard(projectId: string): Promise<DashboardSnapshot>
  }
  terminals: {
    list(projectId: string): Promise<TerminalSession[]>
    create(input: {
      projectId: string
      name?: string
      role?: TerminalRole | null
      cwd?: string
      command?: string | null
    }): Promise<TerminalSession>
    write(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    kill(sessionId: string): Promise<void>
    restart(sessionId: string): Promise<TerminalSession>
    rename(
      sessionId: string,
      name: string,
      role?: TerminalRole | null,
      alias?: string | null,
    ): Promise<TerminalSession>
    launchAgent(projectId: string, agent: 'claude' | 'codex'): Promise<TerminalSession>
    /** Past Claude Code conversations for this project, newest first. */
    claudeSessions(projectId: string): Promise<ClaudeSessionSummary[]>
    /** Open a new terminal that resumes a specific Claude conversation. */
    resumeClaude(projectId: string, sessionId: string): Promise<TerminalSession>
    /** Past Claude and Codex conversations for this project, newest first. */
    agentSessions(projectId: string): Promise<ResumableSessionSummary[]>
    /** Open a terminal that resumes a conversation with its native provider. */
    resumeAgent(
      projectId: string,
      provider: ResumableSessionProvider,
      sessionId: string,
    ): Promise<TerminalSession>
    attachImage(input: {
      projectId: string
      sessionId?: string | null
      fileName: string
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
      dataBase64: string
    }): Promise<TerminalAttachment>
    onData(cb: (chunk: TerminalOutputChunk) => void): Unsubscribe
    onExit(cb: (evt: TerminalExitEvent) => void): Unsubscribe
  }
  git: {
    status(projectId: string): Promise<GitSnapshot>
    /**
     * Bootstrap a brand-new project folder into a git repo (`git init` on a
     * `main` branch). A no-op — returns the current snapshot — if the folder
     * is already a repo.
     */
    initRepo(projectId: string): Promise<GitSnapshot>
    diff(input: { projectId: string; path: string; staged?: boolean }): Promise<GitDiff>
    stage(input: { projectId: string; paths?: string[]; all?: boolean }): Promise<GitSnapshot>
    commit(input: { projectId: string; message: string }): Promise<GitCommitResult>
    /**
     * `force` requires `approvalId` — the id of an approved `git_force_push`
     * request, which the main process verifies and consumes before executing.
     */
    push(input: { projectId: string; force?: boolean; approvalId?: string }): Promise<GitPushResult>
  }
  github: {
    status(projectId: string): Promise<GitHubRepositoryStatus>
    /**
     * Create a new GitHub repo from this project and attach it as `origin`.
     * Initializes the local git repo first if needed. Never pushes — that
     * stays the explicit next step via the regular Push button.
     */
    createRepo(input: {
      projectId: string
      name: string
      visibility: 'private' | 'public'
      description?: string
    }): Promise<GitHubRepositoryStatus>
  }
  railway: {
    status(projectId: string): Promise<RailwayConnection>
    services(projectId: string): Promise<RailwayService[]>
    env(projectId: string): Promise<MaskedEnvVar[]>
  }
  logs: {
    list(projectId: string): Promise<LogEvent[]>
    insights(projectId: string): Promise<ErrorInsight[]>
    ingest(input: {
      projectId: string
      sourceType: 'terminal' | 'git' | 'railway' | 'system' | 'agent'
      sourceId?: string | null
      message: string
    }): Promise<ErrorInsight | null>
    /** Dismiss one detected pattern; it resurfaces only if it happens again. */
    dismissInsight(projectId: string, matchedPattern: string): Promise<void>
    /** Dismiss every currently-visible insight for the project. */
    clearInsights(projectId: string): Promise<void>
    /** Fires when logs/insights change in main (ingest, dismiss, clear). */
    onChange(cb: () => void): Unsubscribe
  }
  usage: {
    summary(projectId: string): Promise<UsageSummary[]>
  }
  agentUsage: {
    /**
     * Account-quota snapshots for the developer's authenticated agents
     * (Claude Code / Codex). Probed in the main process from existing CLI
     * credentials; returns only summarized windows — never tokens.
     */
    get(): Promise<AgentUsageReport>
  }
  openRouterUsage: {
    /**
     * Live remaining-credit snapshot for the OpenRouter key saved in Settings
     * (Hermes's DeepSeek/OpenRouter model calls run on it). Probed in the main
     * process; returns only the derived percent/dollar figures — never the key.
     */
    status(): Promise<OpenRouterUsageSnapshot>
  }
  approvals: {
    list(projectId: string): Promise<ApprovalRequest[]>
    request(input: {
      projectId: string
      actionType: ApprovalRequest['actionType']
      summary: string
      payload?: Record<string, unknown>
    }): Promise<ApprovalRequest>
    decide(approvalId: string, approve: boolean): Promise<ApprovalRequest>
    onChange(cb: () => void): Unsubscribe
  }
  router: {
    route(projectId: string, query: string): Promise<RouterResult>
  }
  review: {
    /**
     * Pre-ship AI diff review: working tree + staged + untracked, pushed
     * through the sanitizer boundary, reviewed read-only by the local
     * `claude` CLI. Never mutates anything.
     */
    run(projectId: string, opts?: { model?: string; dir?: string; lens?: string }): Promise<ReviewResult>
    /**
     * Review one piece of captured text (a command block's command + output)
     * through the SAME sanitizer boundary as a diff review.
     */
    runText(
      projectId: string,
      input: { label: string; content: string },
      opts?: { model?: string },
    ): Promise<ReviewResult>
    /**
     * Cheap, LLM-free `+N −M · K files` summary of a worktree (staged +
     * unstaged + untracked). Read-only; a non-repo or clean tree is a zero.
     */
    diffStat(projectId: string, opts?: { dir?: string }): Promise<DiffStat>
  }
  council: {
    /**
     * Multi-engine LLM-Council (Karpathy's method): five seats across three
     * vendors → anonymized peer rankings → chairman verdict, persisted as a
     * session for the scorecard. `mode` picks what is judged — `diff` (default)
     * reviews a card's change set (read-only, same sanitized diff as the
     * reviewer); `spec` gates a draft task `spec` before it reaches an autonomous
     * builder and returns a NEEDS_CLARIFICATION/APPROVED gate. Prompts are
     * authored in shared/council-prompts; the diff/spec is fenced as untrusted.
     */
    run(
      projectId: string,
      opts?: {
        model?: string
        mode?: 'diff' | 'spec'
        dir?: string
        question?: string
        spec?: string
        cardId?: string
      },
    ): Promise<CouncilResult>
    /**
     * Cross-session seat standings for a project (Faz 2a) — recent persisted
     * council sessions merged into a per-seat scorecard, best (lowest average
     * rank) first. Read-only; the merge math is the pure `computeScorecard`.
     */
    scorecard(projectId: string): Promise<ScorecardEntry[]>
    /**
     * Recent persisted council sessions for a project as content-free headers
     * (ids, mode, verdict kind, run status, the redacted question) — the read
     * side of the `council_sessions` history. Read-only; no seat prose or
     * diff/spec text crosses the bridge.
     */
    sessions(projectId: string): Promise<CouncilSessionSummary[]>
    /**
     * The full persisted `CouncilResult` for one session id — the DETAIL read
     * behind the content-free `sessions` list. Project-scoped in main (a
     * session belonging to another project reads back as null, never leaks),
     * and null for an unknown id. This is what lets a verdict + scorecard
     * survive an unmount/restart: the renderer rehydrates a session on demand
     * instead of holding the heavy result in volatile component state.
     */
    session(projectId: string, sessionId: string): Promise<CouncilResult | null>
  }
  outcomes: {
    /**
     * The read-only judgment scorecard (Track G4): card-fate mix + gate
     * calibration, spec-gate ship-rate leverage, sentinel triage precision,
     * memory earned-keep, and the best council seat — all per-project, all
     * derived from the append-only audit trail + existing read models. These are
     * correlations, never proofs; the surface must not present them as causal.
     */
    scorecard(projectId: string): Promise<OutcomeScorecard>
  }
  memory: {
    /**
     * Per-project markdown knowledge hub (`.cockpit-memory/`). Files are the
     * source of truth; names are slugs; deletion is a soft move to `.trash/`.
     */
    list(projectId: string): Promise<MemoryHubSnapshot>
    read(projectId: string, name: string): Promise<MemoryNote | null>
    write(projectId: string, name: string, content: string): Promise<MemoryNote>
    rename(projectId: string, from: string, to: string): Promise<MemoryHubSnapshot>
    trash(projectId: string, name: string): Promise<MemoryHubSnapshot>
    /** Brain health — note/orphan/unresolved/oversized counts (memory-imp G6). */
    health(projectId: string): Promise<MemoryHealth>
    /**
     * Distill a Claude session into memory (memory-imp Phases 2–3). Confident
     * facts are saved, unsure/conflicting ones are queued for review. `dryRun`
     * previews the proposals without writing anything.
     */
    captureSession(projectId: string, sessionId: string, dryRun?: boolean): Promise<CaptureResult>
    /** Pending review cards awaiting Baz's decision (memory-imp G4). */
    reviewQueue(projectId: string): Promise<ReviewItem[]>
    /** Resolve a review (accept/edit writes it, discard drops it); returns the fresh queue. */
    resolveReview(
      projectId: string,
      reviewId: string,
      decision: ReviewDecision,
      editedContent?: string,
    ): Promise<ReviewItem[]>
    /** Provenance history for the project brain, optionally one note (memory-imp G7). */
    ledger(projectId: string, noteSlug?: string): Promise<LedgerEntry[]>
    /**
     * Run the consolidation "sleep" pass (memory-imp G5): snapshot the hub, find
     * duplicates/oversized/dangling, and queue merge proposals for review.
     */
    consolidate(projectId: string): Promise<ConsolidationResult>
    /** The cross-project Baz brain — facts about you, portable across projects (Phase 6). */
    bazList(): Promise<MemoryHubSnapshot>
    bazRead(name: string): Promise<MemoryNote | null>
  }
  swarm: {
    /**
     * The project's Kanban board (Phase 6): fixed columns, cards ordered by
     * position. Every mutation returns the fresh board to save a round trip.
     */
    board(projectId: string): Promise<BoardColumn[]>
    createCard(input: {
      projectId: string
      title: string
      body?: string
      /** An approved council session that shaped the card (Faz 2a); history, no FK. */
      councilSessionId?: string | null
    }): Promise<BoardColumn[]>
    updateCard(input: {
      projectId: string
      cardId: string
      title?: string
      body?: string
      role?: string | null
      persona?: string | null
      agent?: string | null
      /** Ordered role pipeline; when set it supersedes role/persona/agent. */
      assignments?: Assignment[]
      /** Link/clear the card's approved council session (Faz 2a). */
      councilSessionId?: string | null
    }): Promise<BoardColumn[]>
    /**
     * Human drag/drop. `index` is the insertion index in the destination
     * column. Transitions entering or leaving `in_progress` are refused in
     * main — those mirror real spawns/exits and belong to the SwarmService.
     */
    moveCard(input: {
      projectId: string
      cardId: string
      to: CardStatus
      index: number
    }): Promise<BoardColumn[]>
    removeCard(input: { projectId: string; cardId: string }): Promise<BoardColumn[]>
    /**
     * Card → running agent: main spawns a `claude` worker into a fresh
     * terminal session, links it to the card, and moves the card to Running.
     * 6.2 runs one card at a time; parallel worktrees arrive with 6.3.
     */
    /**
     * Card → running agent. Gated by the council **spec gate**: unless the card
     * carries an approved council session (or `skipGate` is set), this refuses
     * with `{ gated: true }` and the card stays put — a normal, expected outcome
     * the renderer branches on, not an error. A started card returns the fresh
     * board.
     */
    startCard(input: {
      projectId: string
      cardId: string
      /** Explicit developer override of the spec gate (audited as `swarm.gate_skipped`). */
      skipGate?: boolean
    }): Promise<StartCardResult>
    /** Park a running card (worker is stopped; Start later resumes in the same worktree). */
    parkCard(input: { projectId: string; cardId: string }): Promise<BoardColumn[]>
    /** Named Agents roster from .claude/agents (user + project scope; project wins). */
    agents(projectId: string): Promise<NamedAgentSummary[]>
    /**
     * Decision-ready completion report for a card (Faz 2.5) — computed on demand
     * (no new table): branch, worktree diff stat, acceptance criteria from the
     * body, and whether it was council-gated. Read-only.
     */
    completionReport(projectId: string, cardId: string): Promise<CompletionReport>
    /**
     * Fires when a worker finishes and its card moves to In review, so the board
     * surfaces the fresh review without polling. The mock never emits it.
     */
    onCardCompleted(cb: (evt: SwarmCardCompletedEvent) => void): Unsubscribe
  }
  sentinel: {
    /**
     * The project's recent signals from the always-on, LLM-free signal layer
     * (Faz A), newest first. Sensors (log intelligence, worker exits, approvals,
     * council) feed it; the sentinel dedups + persists. Read-only.
     */
    list(projectId: string, opts?: { limit?: number }): Promise<SentinelSignal[]>
    /** Mark signals seen (clears them from the unseen badge). Returns the count updated. */
    markSeen(projectId: string, ids: string[]): Promise<number>
    /** How many of the project's signals are still unseen (the rail badge). */
    unseenCount(projectId: string): Promise<number>
    /**
     * Record the user's response to a signal (Track G3): 'dismissed' (noise),
     * 'acted' (a linked card shipped), or 'card_created'. Project-scoped in main;
     * returns the count of rows updated (0 for an unknown/foreign id). Feeds the
     * triage-precision scorecard — the machine never changes behavior from it.
     */
    recordOutcome(projectId: string, id: string, outcome: SentinelOutcome): Promise<number>
    /**
     * Track H1 — turn a signal into a Swarm card in one call. Main reads the origin
     * signal, composes a card spec framing the signal as data (with hidden
     * provenance so a shipped card can be matched back to it), creates the card,
     * and stamps the signal outcome `card_created`. Returns the updated Swarm board;
     * an unknown/foreign signal id rejects.
     */
    createCard(projectId: string, signalId: string): Promise<BoardColumn[]>
    /**
     * Fires when a fresh signal is recorded, so the feed/badge update without
     * polling. `notice`/`alert` also drive a renderer toast; `alert` additionally
     * pops a macOS notification from main. The mock never emits it.
     */
    onAlert(cb: (signal: SentinelSignal) => void): Unsubscribe
  }
  chat: {
    /**
     * Ask Claude a question via the local `claude` CLI; returns its reply.
     * `opts.model` picks the Claude model (`sonnet`, `opus`, `haiku`).
     */
    ask(projectId: string, prompt: string, opts?: ClaudeRunOptions): Promise<ChatReply>
  }
  hermesChat: {
    /**
     * Send one turn to the Hermes orchestrator (`hermes --oneshot`, or
     * `hermes chat -q --image` when `imagePath` is set) for this project. The
     * backend keeps the conversation history itself — Hermes oneshot is
     * stateless — and re-sends the transcript each turn. `imagePath` must be
     * an absolute path already saved via `terminals.attachImage`.
     */
    ask(projectId: string, message: string, imagePath?: string): Promise<HermesChatReply>
    /** Reset this project's conversation history ("new conversation"). */
    clear(projectId: string): Promise<void>
  }
  secrets: {
    /**
     * Store an encrypted secret (OS keychain via safeStorage). The value never
     * comes back out over IPC — there is no `get`. Used by the upcoming Hermes
     * integration to hold the OpenRouter API key.
     */
    set(kind: SecretKind, value: string): Promise<void>
    /** Whether a secret of this kind is currently stored (no value revealed). */
    has(kind: SecretKind): Promise<boolean>
    /** Remove a stored secret. No-op if none was set. */
    delete(kind: SecretKind): Promise<void>
  }
  audit: {
    list(projectId: string): Promise<AuditEntry[]>
  }
  system: {
    info(): Promise<SystemInfo>
    /** Opens a native folder picker. Returns the chosen absolute path or null. */
    chooseDirectory(): Promise<string | null>
  }
  appUpdate: {
    status(): Promise<AppUpdateState>
    check(): Promise<AppUpdateState>
    download(): Promise<AppUpdateState>
    install(): Promise<void>
    /** Rebuild the cockpit from the given project's source and relaunch it. Dev-only. */
    refresh(projectId: string): Promise<AppRefreshResult>
    /**
     * Replace the installed app with the latest published GitHub release —
     * the way back onto the auto-update train from a local build. Dev-only.
     */
    installRelease(projectId: string): Promise<AppRefreshResult>
    /** True only when the active project is verifiably cockpiT's own source. */
    refreshEligible(projectId: string): Promise<boolean>
    onChange(cb: (state: AppUpdateState) => void): Unsubscribe
  }
}

// ---------------------------------------------------------------------------
// Handler-side typing.
//
// The renderer, preload, and mock are compile-bound to `CockpitApi`. The main
// process is the fourth participant: `IpcResultMap` binds each request channel
// KEY to the result type its handler must return, so `registerIpc`'s `handle()`
// is compile-checked too. Adding a channel without extending this map is a
// type error — the contract cannot drift silently anymore.
// ---------------------------------------------------------------------------

/** Await the return of a CockpitApi method. */
type R<T extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<T>>

/** Request/response channel keys (excludes evt* push events). */
export type RequestChannelKey = Exclude<keyof typeof IPC, `evt${string}`>

export interface IpcResultMap {
  projectsList: R<CockpitApi['projects']['list']>
  projectsAdd: R<CockpitApi['projects']['add']>
  projectsSelect: R<CockpitApi['projects']['select']>
  projectsConfig: R<CockpitApi['projects']['config']>
  projectsDashboard: R<CockpitApi['projects']['dashboard']>

  terminalsList: R<CockpitApi['terminals']['list']>
  terminalsCreate: R<CockpitApi['terminals']['create']>
  terminalsWrite: R<CockpitApi['terminals']['write']>
  terminalsResize: R<CockpitApi['terminals']['resize']>
  terminalsKill: R<CockpitApi['terminals']['kill']>
  terminalsRestart: R<CockpitApi['terminals']['restart']>
  terminalsRename: R<CockpitApi['terminals']['rename']>
  terminalsLaunchAgent: R<CockpitApi['terminals']['launchAgent']>
  terminalsClaudeSessions: R<CockpitApi['terminals']['claudeSessions']>
  terminalsResumeClaude: R<CockpitApi['terminals']['resumeClaude']>
  terminalsAgentSessions: R<CockpitApi['terminals']['agentSessions']>
  terminalsResumeAgent: R<CockpitApi['terminals']['resumeAgent']>
  terminalsAttachImage: R<CockpitApi['terminals']['attachImage']>

  gitStatus: R<CockpitApi['git']['status']>
  gitInitRepo: R<CockpitApi['git']['initRepo']>
  gitDiff: R<CockpitApi['git']['diff']>
  gitStage: R<CockpitApi['git']['stage']>
  gitCommit: R<CockpitApi['git']['commit']>
  gitPush: R<CockpitApi['git']['push']>

  githubStatus: R<CockpitApi['github']['status']>
  githubCreateRepo: R<CockpitApi['github']['createRepo']>

  railwayStatus: R<CockpitApi['railway']['status']>
  railwayServices: R<CockpitApi['railway']['services']>
  railwayEnv: R<CockpitApi['railway']['env']>

  logsList: R<CockpitApi['logs']['list']>
  logsInsights: R<CockpitApi['logs']['insights']>
  logsIngest: R<CockpitApi['logs']['ingest']>
  // The bridge maps these to void; main returns an ack object.
  logsDismissInsight: { ok: boolean }
  logsClearInsights: { ok: boolean }

  usageSummary: R<CockpitApi['usage']['summary']>
  agentUsageGet: R<CockpitApi['agentUsage']['get']>
  openRouterUsageStatus: R<CockpitApi['openRouterUsage']['status']>

  approvalsList: R<CockpitApi['approvals']['list']>
  approvalsRequest: R<CockpitApi['approvals']['request']>
  approvalsDecide: R<CockpitApi['approvals']['decide']>

  routerRoute: R<CockpitApi['router']['route']>
  chatAsk: R<CockpitApi['chat']['ask']>
  hermesChatAsk: R<CockpitApi['hermesChat']['ask']>
  hermesChatClear: R<CockpitApi['hermesChat']['clear']>
  reviewRun: R<CockpitApi['review']['run']>
  reviewRunText: R<CockpitApi['review']['runText']>
  reviewDiffStat: R<CockpitApi['review']['diffStat']>
  councilRun: R<CockpitApi['council']['run']>
  councilScorecard: R<CockpitApi['council']['scorecard']>
  councilSessions: R<CockpitApi['council']['sessions']>
  councilSession: R<CockpitApi['council']['session']>
  outcomesScorecard: R<CockpitApi['outcomes']['scorecard']>
  memoryList: R<CockpitApi['memory']['list']>
  memoryRead: R<CockpitApi['memory']['read']>
  memoryWrite: R<CockpitApi['memory']['write']>
  memoryRename: R<CockpitApi['memory']['rename']>
  memoryTrash: R<CockpitApi['memory']['trash']>
  memoryHealth: R<CockpitApi['memory']['health']>
  memoryCaptureSession: R<CockpitApi['memory']['captureSession']>
  memoryReviewQueue: R<CockpitApi['memory']['reviewQueue']>
  memoryResolveReview: R<CockpitApi['memory']['resolveReview']>
  memoryLedger: R<CockpitApi['memory']['ledger']>
  memoryConsolidate: R<CockpitApi['memory']['consolidate']>
  memoryBazList: R<CockpitApi['memory']['bazList']>
  memoryBazRead: R<CockpitApi['memory']['bazRead']>
  swarmBoard: R<CockpitApi['swarm']['board']>
  swarmCreateCard: R<CockpitApi['swarm']['createCard']>
  swarmUpdateCard: R<CockpitApi['swarm']['updateCard']>
  swarmMoveCard: R<CockpitApi['swarm']['moveCard']>
  swarmRemoveCard: R<CockpitApi['swarm']['removeCard']>
  swarmStartCard: R<CockpitApi['swarm']['startCard']>
  swarmParkCard: R<CockpitApi['swarm']['parkCard']>
  swarmAgents: R<CockpitApi['swarm']['agents']>
  swarmCompletionReport: R<CockpitApi['swarm']['completionReport']>
  sentinelList: R<CockpitApi['sentinel']['list']>
  sentinelMarkSeen: R<CockpitApi['sentinel']['markSeen']>
  sentinelUnseenCount: R<CockpitApi['sentinel']['unseenCount']>
  sentinelRecordOutcome: R<CockpitApi['sentinel']['recordOutcome']>
  sentinelCreateCard: R<CockpitApi['sentinel']['createCard']>
  secretSet: R<CockpitApi['secrets']['set']>
  secretHas: R<CockpitApi['secrets']['has']>
  secretDelete: R<CockpitApi['secrets']['delete']>
  auditList: R<CockpitApi['audit']['list']>

  systemInfo: R<CockpitApi['system']['info']>
  dialogChooseDirectory: R<CockpitApi['system']['chooseDirectory']>

  appUpdateStatus: R<CockpitApi['appUpdate']['status']>
  appUpdateCheck: R<CockpitApi['appUpdate']['check']>
  appUpdateDownload: R<CockpitApi['appUpdate']['download']>
  appUpdateInstall: R<CockpitApi['appUpdate']['install']>
  appUpdateRefresh: R<CockpitApi['appUpdate']['refresh']>
  appUpdateInstallRelease: R<CockpitApi['appUpdate']['installRelease']>
  appUpdateRefreshEligible: R<CockpitApi['appUpdate']['refreshEligible']>
}

/**
 * Compile-time completeness guard: every request channel key must appear in
 * IpcResultMap and vice versa. If either side drifts, the type collapses to
 * `never` and this assignment becomes a compile error.
 */
export const IPC_RESULT_MAP_COMPLETE: [
  Exclude<RequestChannelKey, keyof IpcResultMap>,
  Exclude<keyof IpcResultMap, RequestChannelKey>,
] extends [never, never]
  ? true
  : never = true

export type { AgentType }
