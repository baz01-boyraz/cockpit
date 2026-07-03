import { cockpit } from '../../lib/cockpit'
import { initialView } from './uiSlice'
import type { ProjectSlice, SliceCreator } from './types'

export const createProjectSlice: SliceCreator<ProjectSlice> = (set, get) => ({
  ready: false,
  systemInfo: null,
  projects: [],
  activeProjectId: null,
  dashboard: null,

  init: async () => {
    const api = cockpit()
    const [systemInfo, projects] = await Promise.all([api.system.info(), api.projects.list()])
    const appUpdate = await api.appUpdate.status()
    api.appUpdate.onChange((next) => set({ appUpdate: next }))
    set({ systemInfo, projects, appUpdate, ready: true, view: initialView() })
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

  addProject: async (path, name) => {
    const project = await cockpit().projects.add({ path, name })
    set((s) => ({ projects: [project, ...s.projects.filter((p) => p.id !== project.id)] }))
    await get().selectProject(project.id)
  },

  // Full refetch across every project-scoped slice. Deliberately kept for the
  // project-switch moment; steady-state updates flow through the targeted
  // slice refreshers + push events instead.
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
})
