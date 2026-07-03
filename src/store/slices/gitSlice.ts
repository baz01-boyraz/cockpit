import { cockpit } from '../../lib/cockpit'
import type { GitSlice, SliceCreator } from './types'

export const createGitSlice: SliceCreator<GitSlice> = (set, get) => ({
  git: null,
  github: null,

  refreshGitHub: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) return
    set({ github: await cockpit().github.status(activeProjectId) })
  },
})
