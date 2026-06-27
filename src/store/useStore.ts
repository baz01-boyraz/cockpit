import { create } from 'zustand'
import type {
  ApprovalRequest,
  DashboardSnapshot,
  ErrorInsight,
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
  aiDraft: string | null

  dashboard: DashboardSnapshot | null
  git: GitSnapshot | null
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
  setAiDraft: (text: string | null) => void
  refreshInsights: () => Promise<void>
  refreshActive: () => Promise<void>
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
  aiDraft: null,

  dashboard: null,
  git: null,
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
    // Allow deep-linking a view (used by the screenshot review workflow).
    const requested = new URLSearchParams(window.location.search).get('view') as View | null
    const valid: View[] = ['dashboard', 'terminals', 'git', 'railway', 'logs', 'usage', 'settings']
    const view = requested && valid.includes(requested) ? requested : 'dashboard'
    set({ systemInfo, projects, ready: true, view })
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

  refreshActive: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    const api = cockpit()
    const [dashboard, git, terminals, insights, logs, approvals, usage, railwayConnection, railwayServices] =
      await Promise.all([
        api.projects.dashboard(activeProjectId),
        api.git.status(activeProjectId),
        api.terminals.list(activeProjectId),
        api.logs.insights(activeProjectId),
        api.logs.list(activeProjectId),
        api.approvals.list(activeProjectId),
        api.usage.summary(activeProjectId),
        api.railway.status(activeProjectId),
        api.railway.services(activeProjectId),
      ])
    set({ dashboard, git, terminals, insights, logs, approvals, usage, railwayConnection, railwayServices })
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
