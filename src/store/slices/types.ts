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
import type { BoardColumn, CardStatus, StartCardResult } from '@shared/kanban'
import type { Assignment } from '@shared/agent-taxonomy'
import type { NamedAgentSummary } from '@shared/named-agents'
import type { SentinelSource } from '@shared/sentinel'
import type { CouncilResult } from '@shared/council'

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

/**
 * One convened council run, held in the store so it survives the panel/editor
 * unmounting on a view switch. `result: null` = in flight; a finished run keeps
 * its persisted `sessionId` as the id so history rows can match it.
 */
export interface CouncilRunView {
  /** Persisted session id when finished, else a local uuid while convening. */
  id: string
  /** Headline for the run row (first spec line, or a browsed session's question). */
  title: string
  /** The spec text judged (kept so a browse/re-convene has the source; '' for a browsed header). */
  spec: string
  /** The finished verdict, or null while the council is convening. */
  result: CouncilResult | null
  /** Epoch ms the run was requested. */
  at: number
}

/**
 * Council run state, lifted out of the CouncilPanel and the swarm card editor so
 * a verdict (or an in-flight spinner) survives leaving and returning to the
 * view. The heavy `CouncilResult` lives here, keyed by the project it belongs to
 * (`councilProjectId`), and the convene promises resolve in the slice actions —
 * never in volatile component state — so a run that finishes while the user is
 * elsewhere still lands. The renderer rehydrates persisted verdicts on demand
 * through the `council:session` detail channel.
 */
export interface CouncilSlice {
  /** Which project every council field below belongs to — the stale-flash + preserve guard. */
  councilProjectId: string | null
  /** Standalone panel: a run in flight or the last completed/browsed one. */
  councilActive: CouncilRunView | null
  /** True while the standalone council is convening. */
  councilConvening: boolean
  /** A subtle "council finished" cue set when a standalone run resolves; the panel clears it. */
  councilNotice: string | null
  /** Swarm spec-gate: card id whose council is in flight, or null. */
  councilConveningCardId: string | null
  /**
   * Swarm spec-gate: the latest result keyed by the card it judged. `source`
   * separates a freshly convened run (`run` — also drives the wide verdict
   * surface) from an on-open rehydration of a card's persisted session
   * (`rehydrate` — feeds only the editor's inline gate).
   */
  councilCardResult: {
    cardId: string
    cardTitle: string
    result: CouncilResult | null
    source: 'run' | 'rehydrate'
  } | null
  /** Convene the standalone spec-mode council on free-form text (resolves in-store). */
  conveneCouncil: (projectId: string, spec: string) => Promise<void>
  /** Point the standalone active run at a chosen view (history browse, or null to dismiss). */
  setCouncilActive: (run: CouncilRunView | null) => void
  /** Clear the standalone "council finished" cue. */
  clearCouncilNotice: () => void
  /** Convene the swarm spec-gate council on a card's draft (resolves in-store). */
  conveneCardCouncil: (input: {
    projectId: string
    cardId: string
    cardTitle: string
    spec: string
  }) => Promise<void>
  /** Rehydrate a card's persisted spec-gate verdict from its linked session id (detail channel). */
  loadCardCouncil: (input: { projectId: string; cardId: string; sessionId: string }) => Promise<void>
  /** Clear the swarm spec-gate result (dismiss the wide surface). */
  clearCardCouncil: () => void
  /**
   * The project-scoped reset. Preserves state when `projectId` matches the held
   * project (so a same-project view switch keeps its run) and wipes everything
   * on a genuine project change.
   */
  resetCouncil: (projectId: string | null) => void
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
  /**
   * 6.2: spawn a worker for a To do / Parked card — the service moves it to
   * Running. Returns the council spec-gate outcome: `{ gated: true }` when the
   * card's spec hasn't passed the council (the board is left untouched) so the
   * panel can prompt to convene; `skipGate` is the explicit developer escape.
   */
  startCard: (input: {
    projectId: string
    cardId: string
    skipGate?: boolean
  }) => Promise<StartCardResult>
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
  SentinelSlice &
  CouncilSlice

export type SliceCreator<T> = StateCreator<CockpitState, [], [], T>
