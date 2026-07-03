import { cockpit } from '../../lib/cockpit'
import type { ApprovalsSlice, SliceCreator } from './types'

export const createApprovalsSlice: SliceCreator<ApprovalsSlice> = (set, get) => ({
  approvals: [],

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
})
