import { cockpit } from '../../lib/cockpit'
import type { AppUpdateSlice, SliceCreator } from './types'

export const createAppUpdateSlice: SliceCreator<AppUpdateSlice> = (set) => ({
  appUpdate: null,

  refreshAppUpdate: async () => {
    set({ appUpdate: await cockpit().appUpdate.status() })
  },
})
