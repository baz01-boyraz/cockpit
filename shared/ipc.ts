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
import type { ReviewResult } from './review'
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
  Project,
  ProjectConfig,
  RailwayConnection,
  RailwayService,
  RouterResult,
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
  terminalsAttachImage: 'terminals:attachImage',

  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitCommit: 'git:commit',
  gitPush: 'git:push',

  githubStatus: 'github:status',

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

  approvalsList: 'approvals:list',
  approvalsRequest: 'approvals:request',
  approvalsDecide: 'approvals:decide',

  routerRoute: 'router:route',
  chatAsk: 'chat:ask',
  reviewRun: 'review:run',
  reviewRunText: 'review:runText',

  auditList: 'audit:list',

  systemInfo: 'system:info',
  dialogChooseDirectory: 'dialog:chooseDirectory',

  appUpdateStatus: 'appUpdate:status',
  appUpdateCheck: 'appUpdate:check',
  appUpdateDownload: 'appUpdate:download',
  appUpdateInstall: 'appUpdate:install',
  appUpdateRefresh: 'appUpdate:refresh',
  appUpdateRefreshEligible: 'appUpdate:refreshEligible',

  // main -> renderer push events
  evtTerminalData: 'evt:terminal:data',
  evtTerminalExit: 'evt:terminal:exit',
  evtApprovalsChanged: 'evt:approvals:changed',
  evtLogsChanged: 'evt:logs:changed',
  evtAppUpdateChanged: 'evt:appUpdate:changed',
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
    run(projectId: string, opts?: { model?: string }): Promise<ReviewResult>
    /**
     * Review one piece of captured text (a command block's command + output)
     * through the SAME sanitizer boundary as a diff review.
     */
    runText(
      projectId: string,
      input: { label: string; content: string },
      opts?: { model?: string },
    ): Promise<ReviewResult>
  }
  chat: {
    /**
     * Ask Claude a question via the local `claude` CLI; returns its reply.
     * `opts.model` picks the Claude model (`sonnet`, `opus`, `haiku`).
     */
    ask(projectId: string, prompt: string, opts?: ClaudeRunOptions): Promise<ChatReply>
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
  terminalsAttachImage: R<CockpitApi['terminals']['attachImage']>

  gitStatus: R<CockpitApi['git']['status']>
  gitDiff: R<CockpitApi['git']['diff']>
  gitStage: R<CockpitApi['git']['stage']>
  gitCommit: R<CockpitApi['git']['commit']>
  gitPush: R<CockpitApi['git']['push']>

  githubStatus: R<CockpitApi['github']['status']>

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

  approvalsList: R<CockpitApi['approvals']['list']>
  approvalsRequest: R<CockpitApi['approvals']['request']>
  approvalsDecide: R<CockpitApi['approvals']['decide']>

  routerRoute: R<CockpitApi['router']['route']>
  chatAsk: R<CockpitApi['chat']['ask']>
  reviewRun: R<CockpitApi['review']['run']>
  reviewRunText: R<CockpitApi['review']['runText']>
  auditList: R<CockpitApi['audit']['list']>

  systemInfo: R<CockpitApi['system']['info']>
  dialogChooseDirectory: R<CockpitApi['system']['chooseDirectory']>

  appUpdateStatus: R<CockpitApi['appUpdate']['status']>
  appUpdateCheck: R<CockpitApi['appUpdate']['check']>
  appUpdateDownload: R<CockpitApi['appUpdate']['download']>
  appUpdateInstall: R<CockpitApi['appUpdate']['install']>
  appUpdateRefresh: R<CockpitApi['appUpdate']['refresh']>
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
