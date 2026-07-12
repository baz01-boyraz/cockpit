import type { SliceCreator, UiSlice, View } from './types'

const CHAT_OPEN_KEY = 'cockpit.chatOpen'

function loadChatOpen(): boolean {
  try {
    // Default to open; only an explicit "false" collapses the panel.
    return localStorage.getItem(CHAT_OPEN_KEY) !== 'false'
  } catch {
    return true
  }
}

function persistChatOpen(open: boolean): void {
  try {
    localStorage.setItem(CHAT_OPEN_KEY, String(open))
  } catch {
    // Storage may be unavailable (private mode); the in-memory state still works.
  }
}

/** Deep-linked view (used by the screenshot review workflow), if valid. */
export function initialView(): View {
  const requested = new URLSearchParams(window.location.search).get('view') as View | null
  const valid: View[] = ['dashboard', 'automations', 'terminals', 'git', 'swarm', 'railway', 'logs', 'memory', 'usage', 'settings']
  return requested && valid.includes(requested) ? requested : 'dashboard'
}

export const createUiSlice: SliceCreator<UiSlice> = (set) => ({
  view: 'dashboard',
  projectSwitcherOpen: false,
  chatOpen: loadChatOpen(),
  hermesOpen: false,
  hermesOpener: null,
  aiDraft: null,

  setView: (view) => set({ view }),
  toggleSwitcher: (open) => set((s) => ({ projectSwitcherOpen: open ?? !s.projectSwitcherOpen })),
  toggleChat: (open) =>
    set((s) => {
      const next = open ?? !s.chatOpen
      persistChatOpen(next)
      return { chatOpen: next }
    }),
  toggleHermes: (open) => set((s) => ({ hermesOpen: open ?? !s.hermesOpen })),
  openHermesWith: (opener) => set({ hermesOpen: true, hermesOpener: opener }),
  clearHermesOpener: () => set({ hermesOpener: null }),
  setAiDraft: (text) => set({ aiDraft: text }),
})
