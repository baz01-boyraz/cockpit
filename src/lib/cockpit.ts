import type { CockpitApi } from '@shared/ipc'
import { createMockApi } from './mock'

let cached: CockpitApi | null = null

/**
 * The renderer's single accessor for the backend. Returns the real Electron
 * preload bridge when present, otherwise a fully-featured mock (browser preview
 * / screenshot workflow). The rest of the app never branches on which one it is.
 */
export function cockpit(): CockpitApi {
  if (cached) return cached
  cached = window.cockpit ?? createMockApi()
  return cached
}

export const isMockBackend = (): boolean => !window.cockpit
