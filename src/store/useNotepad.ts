/**
 * Notepad store — renderer-only state for the personal idea scratchpad.
 *
 * Kept deliberately separate from `useStore` (the main cockpit store) so the
 * feature is self-contained and doesn't fight concurrent edits there. Notes
 * persist to localStorage, mirroring the existing `chatOpen` precedent — this
 * is personal UI state, not project capability, so it stays out of the
 * main-process / SQLite / IPC layer entirely.
 */
import { create } from 'zustand'
import {
  type Note,
  NOTEPAD_STORAGE_KEY,
  addNote,
  normalizeContent,
  parseNotes,
  removeNote,
  restoreNote,
  serializeNotes,
  togglePin as togglePinNotes,
  updateNoteContent,
} from '@shared/notepad'

function loadNotes(): Note[] {
  try {
    return parseNotes(localStorage.getItem(NOTEPAD_STORAGE_KEY))
  } catch {
    // Storage unavailable (e.g. private mode) — start empty, stay in-memory.
    return []
  }
}

function persistNotes(notes: readonly Note[]): void {
  try {
    localStorage.setItem(NOTEPAD_STORAGE_KEY, serializeNotes(notes))
  } catch {
    // Quota / unavailable storage: the in-memory state still works this session.
  }
}

interface NotepadState {
  open: boolean
  notes: Note[]
  query: string
  editingId: string | null
  /** Last deleted note, kept briefly to power the Undo affordance. */
  recentlyDeleted: Note | null

  toggle: (open?: boolean) => void
  setQuery: (query: string) => void
  startEdit: (id: string | null) => void
  add: (content: string) => void
  update: (id: string, content: string) => void
  remove: (id: string) => void
  togglePin: (id: string) => void
  undoDelete: () => void
  dismissUndo: () => void
}

export const useNotepad = create<NotepadState>((set, get) => ({
  open: false,
  notes: loadNotes(),
  query: '',
  editingId: null,
  recentlyDeleted: null,

  toggle: (open) =>
    set((s) => {
      const next = open ?? !s.open
      // Closing the drawer drops any in-flight edit and the undo affordance.
      return next ? { open: true } : { open: false, editingId: null, recentlyDeleted: null }
    }),

  setQuery: (query) => set({ query }),
  startEdit: (id) => set({ editingId: id }),

  add: (content) => {
    const prev = get().notes
    const next = addNote(prev, content)
    if (next.length === prev.length) return // empty input — nothing captured
    persistNotes(next)
    // Reset any active filter so the freshly captured note is visible at top.
    set({ notes: next, query: '' })
  },

  update: (id, content) => {
    if (!normalizeContent(content)) {
      // Clearing an existing note is treated as a delete (recoverable via undo).
      get().remove(id)
      return
    }
    const next = updateNoteContent(get().notes, id, content)
    persistNotes(next)
    set({ notes: next, editingId: null })
  },

  remove: (id) => {
    const prev = get().notes
    const target = prev.find((n) => n.id === id) ?? null
    const next = removeNote(prev, id)
    persistNotes(next)
    set({ notes: next, recentlyDeleted: target, editingId: null })
  },

  togglePin: (id) => {
    const next = togglePinNotes(get().notes, id)
    persistNotes(next)
    set({ notes: next })
  },

  undoDelete: () => {
    const { recentlyDeleted, notes } = get()
    if (!recentlyDeleted) return
    const next = restoreNote(notes, recentlyDeleted)
    persistNotes(next)
    set({ notes: next, recentlyDeleted: null })
  },

  dismissUndo: () => set({ recentlyDeleted: null }),
}))
