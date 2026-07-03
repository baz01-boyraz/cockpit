import { cockpit } from '../../lib/cockpit'
import type { LogsSlice, SliceCreator } from './types'

export const createLogsSlice: SliceCreator<LogsSlice> = (set, get) => ({
  insights: [],
  logs: [],

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
})
