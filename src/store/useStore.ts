/**
 * The combined renderer store (VISION 3.2): one zustand store, feature-sliced.
 * Each domain lives in `slices/*`; this file only composes them. Consumers
 * keep importing `useStore` + `View` — the surface is unchanged.
 */
import { create } from 'zustand'
import type { CockpitState, View } from './slices/types'
import { createUiSlice } from './slices/uiSlice'
import { createProjectSlice } from './slices/projectSlice'
import { createGitSlice } from './slices/gitSlice'
import { createTerminalSlice } from './slices/terminalSlice'
import { createLogsSlice } from './slices/logsSlice'
import { createApprovalsSlice } from './slices/approvalsSlice'
import { createInfraSlice } from './slices/infraSlice'
import { createAppUpdateSlice } from './slices/appUpdateSlice'

export type { CockpitState, View }

export const useStore = create<CockpitState>()((...a) => ({
  ...createUiSlice(...a),
  ...createProjectSlice(...a),
  ...createGitSlice(...a),
  ...createTerminalSlice(...a),
  ...createLogsSlice(...a),
  ...createApprovalsSlice(...a),
  ...createInfraSlice(...a),
  ...createAppUpdateSlice(...a),
}))
