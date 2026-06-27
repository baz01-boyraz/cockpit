/**
 * Core domain model for Baz Developer Cockpit.
 *
 * These types are shared verbatim across the Electron main process, the preload
 * bridge, and the React renderer. Keep them free of any runtime imports so they
 * can be consumed from any context (including a plain browser running the mock
 * bridge during screenshot review).
 */

export type ISODate = string

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface Project {
  id: string
  name: string
  path: string
  techStack: string[]
  createdAt: ISODate
  updatedAt: ISODate
  lastOpenedAt: ISODate | null
}

export interface ProjectConfig {
  version: number
  project: {
    name: string
    path: string
    techStack: string[]
  }
  terminals: {
    max: number
    layout: TerminalLayoutSlot[]
    profiles: TerminalProfile[]
  }
  railway: {
    projectId: string | null
    environmentId: string | null
    services: string[]
  }
  safety: {
    requireApprovalFor: ApprovalActionType[]
  }
}

export interface TerminalProfile {
  name: string
  cwd: string
  command?: string | null
  role?: TerminalRole | null
}

export interface TerminalLayoutSlot {
  sessionId: string
  column: number
  row: number
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

export type TerminalRole =
  | 'frontend'
  | 'backend'
  | 'claude'
  | 'codex'
  | 'git'
  | 'general'

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'killed'

export interface TerminalSession {
  id: string
  projectId: string
  name: string
  role: TerminalRole | null
  cwd: string
  shell: string
  status: TerminalStatus
  pid: number | null
  exitCode: number | null
  createdAt: ISODate
  lastActiveAt: ISODate
}

export interface TerminalOutputChunk {
  sessionId: string
  data: string
  at: ISODate
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
  signal: number | null
}

// ---------------------------------------------------------------------------
// Agents / router
// ---------------------------------------------------------------------------

export type AgentType = 'claude' | 'codex' | 'local' | 'chat' | 'railway'

export type AgentSessionStatus = 'active' | 'idle' | 'ended'

export interface AgentSession {
  id: string
  projectId: string
  agentType: AgentType
  terminalSessionId: string | null
  status: AgentSessionStatus
  startedAt: ISODate
  endedAt: ISODate | null
}

export type RouteRisk = 'safe' | 'caution' | 'dangerous'

export interface RouteRecommendation {
  agent: AgentType
  title: string
  rationale: string
  confidence: number
  risk: RouteRisk
  suggestedCommand?: string | null
  requiresApproval: boolean
}

export interface RouterResult {
  query: string
  primary: RouteRecommendation
  alternatives: RouteRecommendation[]
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export type GitFileState = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface GitFileEntry {
  path: string
  state: GitFileState
  index: string
  workingDir: string
}

export interface GitSnapshot {
  id: string
  projectId: string
  branch: string
  ahead: number
  behind: number
  changedFilesCount: number
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  files: GitFileEntry[]
  createdAt: ISODate
}

export interface GitDiff {
  path: string
  hunks: string
  binary: boolean
}

// ---------------------------------------------------------------------------
// Railway
// ---------------------------------------------------------------------------

export type RailwayServiceType = 'frontend' | 'backend' | 'database' | 'worker'

export type RailwayServiceStatus =
  | 'unknown'
  | 'active'
  | 'building'
  | 'crashed'
  | 'stopped'

export interface RailwayConnection {
  id: string
  projectId: string
  railwayProjectId: string | null
  railwayEnvironmentId: string | null
  tokenRef: string | null
  connected: boolean
  createdAt: ISODate
  updatedAt: ISODate
}

export interface RailwayService {
  id: string
  connectionId: string
  railwayServiceId: string
  name: string
  serviceType: RailwayServiceType
  status: RailwayServiceStatus
  url: string | null
  startCommand: string | null
  updatedAt: ISODate
}

export interface MaskedEnvVar {
  key: string
  maskedValue: string
  masked: boolean
}

// ---------------------------------------------------------------------------
// Logs & error intelligence
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogSourceType = 'terminal' | 'git' | 'railway' | 'system' | 'agent'

export interface LogEvent {
  id: string
  projectId: string
  sourceType: LogSourceType
  sourceId: string | null
  level: LogLevel
  message: string
  metadata: Record<string, unknown>
  createdAt: ISODate
}

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface ErrorInsight {
  id: string
  projectId: string
  logEventId: string | null
  title: string
  likelyCause: string
  suggestedAction: string
  suggestedAgent: AgentType
  severity: ErrorSeverity
  matchedPattern: string
  createdAt: ISODate
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export type UsageProvider = 'terminal' | 'claude' | 'codex' | 'local' | 'git'

export type UsageEventType =
  | 'session_started'
  | 'session_ended'
  | 'command_run'
  | 'task_run'
  | 'agent_launch'

export interface UsageEvent {
  id: string
  projectId: string
  provider: UsageProvider
  eventType: UsageEventType
  count: number
  durationMs: number | null
  estimatedTokens: number | null
  metadata: Record<string, unknown>
  createdAt: ISODate
}

export interface UsageSummary {
  provider: UsageProvider
  sessions: number
  commands: number
  tasks: number
  totalDurationMs: number
  estimatedTokens: number | null
  warning: string | null
}

// ---------------------------------------------------------------------------
// Approvals & audit
// ---------------------------------------------------------------------------

export type ApprovalActionType =
  | 'git_push'
  | 'git_force_push'
  | 'deploy'
  | 'redeploy'
  | 'restart_service'
  | 'delete_file'
  | 'database_reset'
  | 'env_write'
  | 'shell_command'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface ApprovalRequest {
  id: string
  projectId: string
  actionType: ApprovalActionType
  riskLevel: RiskLevel
  summary: string
  payload: Record<string, unknown>
  status: ApprovalStatus
  createdAt: ISODate
  resolvedAt: ISODate | null
}

export type AuditActor = 'user' | 'ai' | 'system'

export interface AuditEntry {
  id: string
  projectId: string | null
  actor: AuditActor
  actionType: string
  summary: string
  payloadRedacted: Record<string, unknown>
  createdAt: ISODate
}

// ---------------------------------------------------------------------------
// Dashboard aggregate
// ---------------------------------------------------------------------------

export interface DashboardSnapshot {
  project: Project
  branch: string | null
  changedFiles: number
  terminalCount: number
  runningTerminals: number
  agentCount: number
  railwayConnected: boolean
  railwayServices: number
  recentErrors: ErrorInsight[]
  pendingApprovals: number
  usage: UsageSummary[]
}
