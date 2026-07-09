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
import type { Assignment } from '@shared/agent-taxonomy'
import type { NamedAgentSummary } from '@shared/named-agents'
import type { SentinelSource } from '@shared/sentinel'

export type View =
  | 'dashboard'
  | 'terminals'
  | 'git'
  | 'swarm'
  | 'council'
  | 'railway'
  | 'logs'
  | 'audit'
  | 'sentinel'
  | 'memory'
  | 'usage'
  | 'settings'

/**
 * A "continue from the notification" handoff (Faz A UI): a sentinel signal the
 * user chose to take to Hermes. It opens the Hermes panel, seeds a muted signal
 * context card at the top of the thread, and prefills an editable draft question
 * — it does NOT auto-send (a later phase lets Hermes speak first).
 */
export interface HermesOpener {
  signalId: string
  source: SentinelSource
  title: string
  summary: string
  context: string | null
}

export interface UiSlice {
  view: View
  projectSwitcherOpen: boolean
  chatOpen: boolean
  /** Hermes chat panel — triggered from the rail's Engines row, not a floating launcher. */
  hermesOpen: boolean
  /** A pending sentinel→Hermes handoff, consumed by the widget once rendered. */
  hermesOpener: HermesOpener | null
  aiDraft: string | null
  setView: (view: View) => void
  toggleSwitcher: (open?: boolean) => void
  toggleChat: (open?: boolean) => void
  toggleHermes: (open?: boolean) => void
  /** Open Hermes carrying a signal's context (sets hermesOpen + stores the opener). */
  openHermesWith: (opener: HermesOpener) => void
  /** Clear the pending opener once the widget has absorbed it (single-use). */
  clearHermesOpener: () => void
  setAiDraft: (text: string | null) => void
}

/**
 * The renderer's view of the always-on sentinel signal layer (Faz A). The feed
 * itself is fetched on demand (bell popover, toasts); the store only holds the
 * unseen count so the bell badge and the toast host stay in sync across a
 * markSeen from either surface.
 */
export interface SentinelSlice {
  /** Unseen (status: 'new') signal count for the active project — the bell badge. */
  sentinelUnseen: number
  /** Re-read the unseen count for the active project (hydrate + after markSeen). */
  refreshSentinelUnseen: () => Promise<void>
  /** Mark signals seen server-side, then reconcile the unseen count. */
  markSignalsSeen: (ids: string[]) => Promise<void>
  /** Optimistically bump the badge when a live signal arrives (onAlert). */
  bumpSentinelUnseen: () => void
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
  /** Named Agents roster for `agentsProjectId` — the identities cards can carry. */
  agents: NamedAgentSummary[]
  /** Which project `agents` belongs to — the roster is fetched once per project. */
  agentsProjectId: string | null
  refreshBoard: (projectId: string) => Promise<void>
  refreshAgents: (projectId: string) => Promise<void>
  /** Mutations store the fresh board the API returns. Errors propagate to the caller. */
  createCard: (input: { projectId: string; title: string; body?: string }) => Promise<void>
  updateCard: (input: {
    projectId: string
    cardId: string
    title?: string
    body?: string
    role?: string | null
    persona?: string | null
    agent?: string | null
    assignments?: Assignment[]
    /** Link/clear the approved council session that shaped this card (Faz 2b). */
    councilSessionId?: string | null
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
  SwarmSlice &
  SentinelSlice

export type SliceCreator<T> = StateCreator<CockpitState, [], [], T>
