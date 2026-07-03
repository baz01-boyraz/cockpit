import { cockpit } from '../../lib/cockpit'
import type { SliceCreator, TerminalSlice } from './types'

export const createTerminalSlice: SliceCreator<TerminalSlice> = (set, get) => ({
  terminals: [],

  refreshTerminals: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    set({ terminals: await cockpit().terminals.list(activeProjectId) })
  },
})
