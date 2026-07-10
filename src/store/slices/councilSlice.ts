import { cockpit } from '../../lib/cockpit'
import type { CouncilResult } from '@shared/council'
import type { CouncilRunView, CouncilSlice, SliceCreator } from './types'

/**
 * Council run state slice. The bug this closes: both the standalone Council
 * panel and the swarm card editor held the convened verdict (and the in-flight
 * spinner) in volatile component state, so switching rail sections unmounted the
 * surface and dropped everything — even a run still in progress. Lifting the run
 * here means the convene promise resolves in a slice action, not a component, so
 * a run that finishes while the user is elsewhere still lands; a view switch just
 * re-reads the store. Persisted verdicts rehydrate on demand via `council:session`.
 */

/** A thrown council IPC call → a renderable failure result (mirrors the panel helper). */
function councilFailure(error: unknown, mode: CouncilResult['mode'] = 'spec'): CouncilResult {
  const message = error instanceof Error ? error.message : 'The council run failed.'
  return {
    ok: false,
    mode,
    seats: [],
    rankings: [],
    aggregate: [],
    labelToSeat: {},
    verdict: null,
    specVerdict: null,
    error: message,
    stats: { seatsRun: 0, seatsFailed: 0, filesReviewed: 0, durationMs: 0 },
    sessionId: null,
  }
}

/** The spec's first non-empty line, trimmed to a headline length. */
function runTitle(spec: string): string {
  const line = spec.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'Untitled deliberation'
  return line.length > 72 ? `${line.slice(0, 72)}…` : line
}

export const createCouncilSlice: SliceCreator<CouncilSlice> = (set, get) => ({
  councilProjectId: null,
  councilActive: null,
  councilConvening: false,
  councilNotice: null,
  councilConveningCardId: null,
  councilCardResult: null,

  conveneCouncil: async (projectId, spec) => {
    const trimmed = spec.trim()
    if (!trimmed || get().councilConvening) return
    const run: CouncilRunView = {
      id: `local-${Date.now()}`,
      title: runTitle(trimmed),
      spec: trimmed,
      result: null,
      at: Date.now(),
    }
    set({ councilProjectId: projectId, councilConvening: true, councilActive: run, councilNotice: null })
    try {
      const result = await cockpit().council.run(projectId, { mode: 'spec', spec: trimmed })
      // A council can outlive a project switch — never paint a stale verdict.
      if (get().activeProjectId !== projectId) return
      set({
        councilActive: { ...run, id: result.sessionId ?? run.id, result },
        councilConvening: false,
        councilNotice: 'Council finished deliberating.',
      })
    } catch (err: unknown) {
      if (get().activeProjectId !== projectId) return
      set({
        councilActive: { ...run, result: councilFailure(err) },
        councilConvening: false,
        councilNotice: 'Council run failed.',
      })
    }
  },

  setCouncilActive: (run) => set({ councilActive: run }),

  clearCouncilNotice: () => set({ councilNotice: null }),

  conveneCardCouncil: async ({ projectId, cardId, cardTitle, spec }) => {
    const trimmed = spec.trim()
    if (!trimmed || get().councilConveningCardId !== null) return
    set({
      councilProjectId: projectId,
      councilConveningCardId: cardId,
      councilCardResult: { cardId, cardTitle, result: null, source: 'run' },
    })
    try {
      const result = await cockpit().council.run(projectId, { mode: 'spec', spec: trimmed, cardId })
      if (get().activeProjectId !== projectId) return
      set({
        councilConveningCardId: null,
        councilCardResult: { cardId, cardTitle, result, source: 'run' },
      })
    } catch (err: unknown) {
      if (get().activeProjectId !== projectId) return
      set({
        councilConveningCardId: null,
        councilCardResult: { cardId, cardTitle, result: councilFailure(err, 'spec'), source: 'run' },
      })
    }
  },

  loadCardCouncil: async ({ projectId, cardId, sessionId }) => {
    const st = get()
    // Never clobber an in-flight run, or a result we already hold for this session.
    if (st.councilConveningCardId === cardId) return
    if (
      st.councilCardResult?.cardId === cardId &&
      st.councilCardResult.result?.sessionId === sessionId
    ) {
      return
    }
    try {
      const result = await cockpit().council.session(projectId, sessionId)
      if (get().activeProjectId !== projectId || !result) return
      // A rehydrate must not steal the wide surface from a fresh run of another card.
      if (get().councilConveningCardId !== null) return
      // The card title comes from the board; the editor already knows it, so a
      // best-effort placeholder is fine — the editor reads `result`, not this.
      set({ councilCardResult: { cardId, cardTitle: '', result, source: 'rehydrate' } })
    } catch {
      // A rehydrate miss just leaves the card's persisted "approved" tag, no verdict body.
    }
  },

  clearCardCouncil: () => set({ councilConveningCardId: null, councilCardResult: null }),

  resetCouncil: (projectId) => {
    // Same project across a remount → preserve the run so a view switch can't drop it.
    if (get().councilProjectId === projectId) return
    set({
      councilProjectId: projectId,
      councilActive: null,
      councilConvening: false,
      councilNotice: null,
      councilConveningCardId: null,
      councilCardResult: null,
    })
  },
})
