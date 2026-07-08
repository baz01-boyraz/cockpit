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
import type { SwarmCardCompletedEvent } from '@shared/domain'
import { cockpit } from '../lib/cockpit'

/** Minimum gap between store writes for one session. */
const STAMP_COARSE_MS = 2_000

/** One recorded "card reached In review" event, keyed by card id in the feed. */
export interface CardCompletion {
  title: string
  summary: string
  at: number
}

interface SwarmActivityState {
  lastOutputAt: Record<string, number>
  /** Latest completion per card id — the feed the board reads for its badge. */
  completions: Record<string, CardCompletion>
  stamp: (sessionId: string, at: number) => void
  recordCompletion: (evt: SwarmCardCompletedEvent, at: number) => void
}

export const useSwarmActivityStore = create<SwarmActivityState>((set, get) => ({
  lastOutputAt: {},
  completions: {},
  stamp: (sessionId, at) => {
    const current = get().lastOutputAt[sessionId] ?? 0
    if (at - current < STAMP_COARSE_MS) return
    set((s) => ({ lastOutputAt: { ...s.lastOutputAt, [sessionId]: at } }))
  },
  recordCompletion: (evt, at) =>
    set((s) => ({
      completions: {
        ...s.completions,
        [evt.cardId]: { title: evt.title, summary: evt.summary, at },
      },
    })),
}))

/** One session's last-output timestamp, or null before any output arrived. */
export function useSessionActivity(sessionId: string | null): number | null {
  return useSwarmActivityStore((s) =>
    sessionId ? (s.lastOutputAt[sessionId] ?? null) : null,
  )
}

/** One card's recorded completion, or null before it finished. */
export function useCardCompletion(cardId: string | null): CardCompletion | null {
  return useSwarmActivityStore((s) =>
    cardId ? (s.completions[cardId] ?? null) : null,
  )
}

/**
 * Start the app-level heartbeat + completion subscriptions (one listener each
 * for output and card-completed, like blockStore's capture). Returns the
 * combined unsubscribe for effect cleanup.
 */
export function initSwarmActivity(): () => void {
  const offData = cockpit().terminals.onData((chunk) => {
    useSwarmActivityStore.getState().stamp(chunk.sessionId, Date.now())
  })
  const offCompleted = cockpit().swarm.onCardCompleted((evt) => {
    useSwarmActivityStore.getState().recordCompletion(evt, Date.now())
  })
  return () => {
    offData()
    offCompleted()
  }
}
