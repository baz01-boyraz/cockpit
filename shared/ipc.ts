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
  ApprovalRequest,
  AuditEntry,
  DashboardSnapshot,
  ErrorInsight,
  GitDiff,
  GitSnapshot,
  LogEvent,
  MaskedEnvVar,
  Project,
  ProjectConfig,
  RailwayConnection,
  RailwayService,
  RouterResult,
  TerminalExitEvent,
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

  gitStatus: 'git:status',
  gitDiff: 'git:diff',

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

  // main -> renderer push events
  evtTerminalData: 'evt:terminal:data',
  evtTerminalExit: 'evt:terminal:exit',
  evtApprovalsChanged: 'evt:approvals:changed',
  evtLogsChanged: 'evt:logs:changed',
} as const

export type Unsubscribe = () => void

export interface SystemInfo {
  platform: NodeJS.Platform | string
  appVersion: string
  electron: string | null
  node: string
  isMock: boolean
  cliAvailable: { claude: boolean; codex: boolean; railway: boolean; git: boolean }
}

export type ChatEngine = 'claude' | 'codex'

export interface ChatReply {
  ok: boolean
  text: string
  model: string
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
    onData(cb: (chunk: TerminalOutputChunk) => void): Unsubscribe
    onExit(cb: (evt: TerminalExitEvent) => void): Unsubscribe
  }
  git: {
    status(projectId: string): Promise<GitSnapshot>
    diff(input: { projectId: string; path: string; staged?: boolean }): Promise<GitDiff>
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
}

export type { AgentType }
