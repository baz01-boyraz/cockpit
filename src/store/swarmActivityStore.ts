/**
 * Per-session output heartbeat for the Swarm board (the "is it alive?"
 * signal). Running cards show when their worker last produced output, so the
 * human can tell a working agent from a stalled one WITHOUT opening the
 * terminal — the board's whole point.
 *
 * Content is never stored (a Claude TUI stream is repaint noise anyway);
 * only a timestamp per session, coarsened so a chatty pty updates the store
 * at most once per STAMP_COARSE_MS instead of per chunk.
 */
import { create } from 'zustand'
import { cockpit } from '../lib/cockpit'

/** Minimum gap between store writes for one session. */
const STAMP_COARSE_MS = 2_000

interface SwarmActivityState {
  lastOutputAt: Record<string, number>
  stamp: (sessionId: string, at: number) => void
}

export const useSwarmActivityStore = create<SwarmActivityState>((set, get) => ({
  lastOutputAt: {},
  stamp: (sessionId, at) => {
    const current = get().lastOutputAt[sessionId] ?? 0
    if (at - current < STAMP_COARSE_MS) return
    set((s) => ({ lastOutputAt: { ...s.lastOutputAt, [sessionId]: at } }))
  },
}))

/** One session's last-output timestamp, or null before any output arrived. */
export function useSessionActivity(sessionId: string | null): number | null {
  return useSwarmActivityStore((s) =>
    sessionId ? (s.lastOutputAt[sessionId] ?? null) : null,
  )
}

/**
 * Start the app-level heartbeat subscription (one listener for every
 * session, like blockStore's capture). Returns the unsubscribe for effect
 * cleanup.
 */
export function initSwarmActivity(): () => void {
  return cockpit().terminals.onData((chunk) => {
    useSwarmActivityStore.getState().stamp(chunk.sessionId, Date.now())
  })
}
