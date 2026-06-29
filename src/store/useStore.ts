import { create } from 'zustand'
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
import { cockpit } from '../lib/cockpit'

const CHAT_OPEN_KEY = 'cockpit.chatOpen'

function loadChatOpen(): boolean {
  try {
    // Default to open; only an explicit "false" collapses the panel.
    return localStorage.getItem(CHAT_OPEN_KEY) !== 'false'
  } catch {
    return true
  }
}

function persistChatOpen(open: boolean): void {
  try {
    localStorage.setItem(CHAT_OPEN_KEY, String(open))
  } catch {
    // Storage may be unavailable (private mode); the in-memory state still works.
  }
}

export type View =
  | 'dashboard'
  | 'terminals'
  | 'git'
  | 'railway'
  | 'logs'
  | 'usage'
  | 'settings'

interface CockpitState {
  ready: boolean
  systemInfo: SystemInfo | null
  projects: Project[]
  activeProjectId: string | null
  view: View
  projectSwitcherOpen: boolean
  chatOpen: boolean
  aiDraft: string | null

  dashboard: DashboardSnapshot | null
  git: GitSnapshot | null
  github: GitHubRepositoryStatus | null
  appUpdate: AppUpdateState | null
  terminals: TerminalSession[]
  insights: ErrorInsight[]
  logs: LogEvent[]
  approvals: ApprovalRequest[]
  usage: UsageSummary[]
  railwayConnection: RailwayConnection | null
  railwayServices: RailwayService[]

  init: () => Promise<void>
  selectProject: (projectId: string) => Promise<void>
  setView: (view: View) => void
  toggleSwitcher: (open?: boolean) => void
  toggleChat: (open?: boolean) => void
  setAiDraft: (text: string | null) => void
  refreshInsights: () => Promise<void>
  dismissInsight: (matchedPattern: string) => Promise<void>
  clearInsights: () => Promise<void>
  refreshActive: () => Promise<void>
  refreshGitHub: () => Promise<void>
  refreshAppUpdate: () => Promise<void>
  refreshTerminals: () => Promise<void>
  refreshApprovals: () => Promise<void>
  decideApproval: (id: string, approve: boolean) => Promise<void>
  addProject: (path: string, name?: string) => Promise<void>
}

export const useStore = create<CockpitState>((set, get) => ({
  ready: false,
  systemInfo: null,
  projects: [],
  activeProjectId: null,
  view: 'dashboard',
  projectSwitcherOpen: false,
  chatOpen: loadChatOpen(),
  aiDraft: null,

  dashboard: null,
  git: null,
  github: null,
  appUpdate: null,
  terminals: [],
  insights: [],
  logs: [],
  approvals: [],
  usage: [],
  railwayConnection: null,
  railwayServices: [],

  init: async () => {
    const api = cockpit()
    const [systemInfo, projects] = await Promise.all([api.system.info(), api.projects.list()])
    const appUpdate = await api.appUpdate.status()
    api.appUpdate.onChange((next) => set({ appUpdate: next }))
    // Allow deep-linking a view (used by the screenshot review workflow).
    const requested = new URLSearchParams(window.location.search).get('view') as View | null
    const valid: View[] = ['dashboard', 'terminals', 'git', 'railway', 'logs', 'usage', 'settings']
    const view = requested && valid.includes(requested) ? requested : 'dashboard'
    set({ systemInfo, projects, appUpdate, ready: true, view })
    if (projects.length > 0) {
      await get().selectProject(projects[0].id)
    } else {
      set({ projectSwitcherOpen: true })
    }
  },

  selectProject: async (projectId) => {
    const api = cockpit()
    set({ activeProjectId: projectId, projectSwitcherOpen: false })
    const dashboard = await api.projects.select(projectId)
    set({ dashboard })
    await get().refreshActive()
  },

  setView: (view) => set({ view }),
  toggleSwitcher: (open) =>
    set((s) => ({ projectSwitcherOpen: open ?? !s.projectSwitcherOpen })),
  toggleChat: (open) =>
    set((s) => {
      const next = open ?? !s.chatOpen
      persistChatOpen(next)
      return { chatOpen: next }
    }),
  setAiDraft: (text) => set({ aiDraft: text }),

  refreshInsights: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    const [insights, logs] = await Promise.all([
      cockpit().logs.insights(activeProjectId),
      cockpit().logs.list(activeProjectId),
    ])
    set({ insights, logs })
  },

  dismissInsight: async (matchedPattern) => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    // Optimistic: drop it immediately, then reconcile with the source of truth.
    set((s) => ({ insights: s.insights.filter((i) => i.matchedPattern !== matchedPattern) }))
    await cockpit().logs.dismissInsight(activeProjectId, matchedPattern)
    await get().refreshInsights()
    // Keep the left-rail / top-bar error badges (driven by the dashboard
    // snapshot) in step with the freshly reconciled insight list.
    set((s) =>
      s.dashboard ? { dashboard: { ...s.dashboard, recentErrors: get().insights.slice(0, 5) } } : {},
    )
  },

  clearInsights: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    set({ insights: [] })
    await cockpit().logs.clearInsights(activeProjectId)
    await get().refreshInsights()
    set((s) =>
      s.dashboard ? { dashboard: { ...s.dashboard, recentErrors: get().insights.slice(0, 5) } } : {},
    )
  },

  refreshActive: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    const api = cockpit()
    const [dashboard, git, github, terminals, insights, logs, approvals, usage, railwayConnection, railwayServices] =
      await Promise.all([
        api.projects.dashboard(activeProjectId),
        api.git.status(activeProjectId),
        api.github.status(activeProjectId),
        api.terminals.list(activeProjectId),
        api.logs.insights(activeProjectId),
        api.logs.list(activeProjectId),
        api.approvals.list(activeProjectId),
        api.usage.summary(activeProjectId),
        api.railway.status(activeProjectId),
        api.railway.services(activeProjectId),
      ])
    set({ dashboard, git, github, terminals, insights, logs, approvals, usage, railwayConnection, railwayServices })
  },

  refreshGitHub: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    set({ github: await cockpit().github.status(activeProjectId) })
  },

  refreshAppUpdate: async () => {
    set({ appUpdate: await cockpit().appUpdate.status() })
  },

  refreshTerminals: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    set({ terminals: await cockpit().terminals.list(activeProjectId) })
  },

  refreshApprovals: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    const [approvals, dashboard] = await Promise.all([
      cockpit().approvals.list(activeProjectId),
      cockpit().projects.dashboard(activeProjectId),
    ])
    set({ approvals, dashboard })
  },

  decideApproval: async (id, approve) => {
    await cockpit().approvals.decide(id, approve)
    await get().refreshApprovals()
  },

  addProject: async (path, name) => {
    const project = await cockpit().projects.add({ path, name })
    set((s) => ({ projects: [project, ...s.projects.filter((p) => p.id !== project.id)] }))
    await get().selectProject(project.id)
  },
}))
