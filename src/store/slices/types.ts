/**
 * Store slice contracts (VISION 3.2).
 *
 * One combined zustand store, feature-sliced by domain. Every slice sees the
 * whole `CockpitState` through `set`/`get` (cross-slice updates like
 * `refreshActive` stay cheap), but each domain's fields and actions are
 * declared and implemented in its own file. New roadmap features (review,
 * memory, swarm) add a slice here instead of growing a monolith.
 */
import type { StateCreator } from 'zustand'
import type {
  ApprovalRequest,
  AppUpdateState,
  DashboardSnapshot,
  ErrorInsight,
  GitHubRepositoryStatus,
  GitSnapshot,
  LogEvent,
  Project,
  RailwayConnection,
  RailwayService,
  TerminalSession,
  UsageSummary,
} from '@shared/domain'
import type { SystemInfo } from '@shared/ipc'
import type { BoardColumn, CardStatus } from '@shared/kanban'

export type View =
  | 'dashboard'
  | 'terminals'
  | 'git'
  | 'swarm'
  | 'railway'
  | 'logs'
  | 'memory'
  | 'usage'
  | 'settings'

export interface UiSlice {
  view: View
  projectSwitcherOpen: boolean
  chatOpen: boolean
  aiDraft: string | null
  setView: (view: View) => void
  toggleSwitcher: (open?: boolean) => void
  toggleChat: (open?: boolean) => void
  setAiDraft: (text: string | null) => void
}

export interface ProjectSlice {
  ready: boolean
  systemInfo: SystemInfo | null
  projects: Project[]
  activeProjectId: string | null
  dashboard: DashboardSnapshot | null
  init: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  addProject: (path: string, name?: string) => Promise<void>
  /** Full refetch of every project-scoped slice — used on project switch. */
  refreshActive: () => Promise<void>
}

export interface GitSlice {
  git: GitSnapshot | null
  github: GitHubRepositoryStatus | null
  refreshGitHub: () => Promise<void>
}

export interface TerminalSlice {
  terminals: TerminalSession[]
  refreshTerminals: () => Promise<void>
}

export interface LogsSlice {
  insights: ErrorInsight[]
  logs: LogEvent[]
  refreshInsights: () => Promise<void>
  dismissInsight: (matchedPattern: string) => Promise<void>
  clearInsights: () => Promise<void>
}

export interface ApprovalsSlice {
  approvals: ApprovalRequest[]
  refreshApprovals: () => Promise<void>
  decideApproval: (id: string, approve: boolean) => Promise<void>
}

export interface InfraSlice {
  usage: UsageSummary[]
  railwayConnection: RailwayConnection | null
  railwayServices: RailwayService[]
}

export interface AppUpdateSlice {
  appUpdate: AppUpdateState | null
  refreshAppUpdate: () => Promise<void>
}

export interface SwarmSlice {
  /** The Kanban board for `boardProjectId`, or null before the first fetch. */
  board: BoardColumn[] | null
  /** Which project `board` belongs to — guards against stale cross-project flashes. */
  boardProjectId: string | null
  boardLoading: boolean
  refreshBoard: (projectId: string) => Promise<void>
  /** Mutations store the fresh board the API returns. Errors propagate to the caller. */
  createCard: (input: { projectId: string; title: string; body?: string }) => Promise<void>
  updateCard: (input: {
    projectId: string
    cardId: string
    title?: string
    body?: string
    role?: string | null
    persona?: string | null
  }) => Promise<void>
  moveCard: (input: { projectId: string; cardId: string; to: CardStatus; index: number }) => Promise<void>
  removeCard: (input: { projectId: string; cardId: string }) => Promise<void>
  /** 6.2: spawn a worker for a To do / Parked card — the service moves it to Running. */
  startCard: (input: { projectId: string; cardId: string }) => Promise<void>
  /** 6.3: stop a Running card's worker, keep its worktree — Start later resumes it. */
  parkCard: (input: { projectId: string; cardId: string }) => Promise<void>
}

export type CockpitState = UiSlice &
  ProjectSlice &
  GitSlice &
  TerminalSlice &
  LogsSlice &
  ApprovalsSlice &
  InfraSlice &
  AppUpdateSlice &
  SwarmSlice

export type SliceCreator<T> = StateCreator<CockpitState, [], [], T>
