import { cockpit } from '../../lib/cockpit'
import type { SentinelSlice, SliceCreator } from './types'

/**
 * The always-on sentinel signal layer (Faz A), renderer side. The feed itself is
 * read on demand by the bell popover and the toast host; the store keeps only the
 * unseen count so the bell badge and a markSeen from any surface stay in sync.
 */
export const createSentinelSlice: SliceCreator<SentinelSlice> = (set, get) => ({
  sentinelUnseen: 0,

  refreshSentinelUnseen: async () => {
    const { activeProjectId } = get()
    if (!activeProjectId) {
      set({ sentinelUnseen: 0 })
      return
    }
    try {
      const count = await cockpit().sentinel.unseenCount(activeProjectId)
      set({ sentinelUnseen: count })
    } catch {
      // Best-effort — a failed count read leaves the prior badge value.
    }
  },

  markSignalsSeen: async (ids) => {
    const { activeProjectId } = get()
    if (!activeProjectId || ids.length === 0) return
    // Optimistically drop the badge so the click feels immediate; the refresh
    // below reconciles against the server's authoritative count.
    set((s) => ({ sentinelUnseen: Math.max(0, s.sentinelUnseen - ids.length) }))
    try {
      await cockpit().sentinel.markSeen(activeProjectId, ids)
    } catch {
      // Best-effort; the refresh reconciles whether or not the write landed.
    }
    await get().refreshSentinelUnseen()
  },

  bumpSentinelUnseen: () => set((s) => ({ sentinelUnseen: s.sentinelUnseen + 1 })),
})
