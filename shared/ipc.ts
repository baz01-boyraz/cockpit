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
import type {
  AgentType,
  AppUpdateState,
  ApprovalRequest,
  AuditEntry,
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

  usageSummary: 'usage:summary',

  approvalsList: 'approvals:list',
  approvalsRequest: 'approvals:request',
  approvalsDecide: 'approvals:decide',

  routerRoute: 'router:route',
  chatAsk: 'chat:ask',

  auditList: 'audit:list',

  systemInfo: 'system:info',
  dialogChooseDirectory: 'dialog:chooseDirectory',

  appUpdateStatus: 'appUpdate:status',
  appUpdateCheck: 'appUpdate:check',
  appUpdateDownload: 'appUpdate:download',
  appUpdateInstall: 'appUpdate:install',
  appUpdateRefresh: 'appUpdate:refresh',

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

export type ChatEngine = 'hermes'

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
    rename(sessionId: string, name: string, role?: TerminalRole | null): Promise<TerminalSession>
    launchAgent(projectId: string, agent: 'claude' | 'codex'): Promise<TerminalSession>
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
    push(input: { projectId: string; force?: boolean }): Promise<GitPushResult>
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
  }
  usage: {
    summary(projectId: string): Promise<UsageSummary[]>
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
  chat: {
    /** Ask the chosen agent (Claude Code or Codex) a question; returns its reply. */
    ask(projectId: string, prompt: string, engine: ChatEngine): Promise<ChatReply>
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
    onChange(cb: (state: AppUpdateState) => void): Unsubscribe
  }
}

export type { AgentType }
