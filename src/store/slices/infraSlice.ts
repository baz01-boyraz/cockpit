import type { InfraSlice, SliceCreator } from './types'

// Usage + Railway are read-only snapshots refreshed by `refreshActive`;
// they gain their own refreshers when a feature needs targeted updates.
export const createInfraSlice: SliceCreator<InfraSlice> = () => ({
  usage: [],
  railwayConnection: null,
  railwayServices: [],
})
