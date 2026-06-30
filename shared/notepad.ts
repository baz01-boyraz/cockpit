/**
 * Notepad — pure domain logic for the cockpit's personal idea scratchpad.
 *
 * Deliberately free of DOM / React / runtime deps so it stays unit-testable
 * under Node (see `test/notepad.test.ts`). Persistence (localStorage) and UI
 * live in the renderer-only store + components; this module owns the shape of a
 * note and every *immutable* transform over a note list.
 */

export interface Note {
  id: string
  /** User text. Trimmed at the edges, internal newlines preserved. */
  content: string
  pinned: boolean
  /** ISO-8601 creation timestamp. */
  createdAt: string
  /** ISO-8601 last-edited timestamp; drives recency ordering. */
  updatedAt: string
}

/** localStorage key. Versioned so a future shape change can migrate cleanly. */
export const NOTEPAD_STORAGE_KEY = 'cockpit.notepad.notes.v1'

/** Per-note character cap — guards localStorage and keeps notes "quick". */
export const NOTE_MAX_LENGTH = 4000

let fallbackCounter = 0

/** Stable, collision-resistant id. Prefers `crypto.randomUUID` when present. */
function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  fallbackCounter += 1
  return `note_${Date.now().toString(36)}_${fallbackCounter.toString(36)}`
}

/** Trim surrounding whitespace and clamp to the max length. */
export function normalizeContent(raw: string): string {
  return raw.trim().slice(0, NOTE_MAX_LENGTH)
}

/** Build a fresh note from raw text. Content is normalized for safety. */
export function createNote(content: string, now: number = Date.now()): Note {
  const iso = new Date(now).toISOString()
  return {
    id: newId(),
    content: normalizeContent(content),
    pinned: false,
    createdAt: iso,
    updatedAt: iso,
  }
}

/**
 * Prepend a new note built from `content`. Empty/whitespace-only input is a
 * no-op — returns a shallow copy so callers can compare lengths to detect it.
 */
export function addNote(
  notes: readonly Note[],
  content: string,
  now: number = Date.now(),
): Note[] {
  if (!normalizeContent(content)) return [...notes]
  return [createNote(content, now), ...notes]
}

/**
 * Immutably replace a note's content and bump `updatedAt`. Empty content is a
 * no-op here — the store decides whether an emptied note becomes a delete.
 */
export function updateNoteContent(
  notes: readonly Note[],
  id: string,
  content: string,
  now: number = Date.now(),
): Note[] {
  const normalized = normalizeContent(content)
  if (!normalized) return [...notes]
  const iso = new Date(now).toISOString()
  return notes.map((n) => (n.id === id ? { ...n, content: normalized, updatedAt: iso } : n))
}

/** Drop a note by id. */
export function removeNote(notes: readonly Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id)
}

/** Flip a note's pinned flag (ordering, not content — `updatedAt` untouched). */
export function togglePin(notes: readonly Note[], id: string): Note[] {
  return notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n))
}

/** Re-insert a previously removed note (for undo); no-op if already present. */
export function restoreNote(notes: readonly Note[], note: Note): Note[] {
  if (notes.some((n) => n.id === note.id)) return [...notes]
  return [note, ...notes]
}

/**
 * Display order: pinned notes first, then most-recently-updated. ISO strings
 * compare lexicographically, which matches chronological order.
 */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

/** Case-insensitive substring filter on content. Empty query → everything. */
export function filterNotes(notes: readonly Note[], query: string): Note[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...notes]
  return notes.filter((n) => n.content.toLowerCase().includes(q))
}

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.content === 'string' &&
    typeof r.pinned === 'boolean' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string'
  )
}

/**
 * Parse persisted JSON into a clean note list. Untrusted boundary: malformed
 * JSON yields `[]`, and individual non-conforming entries are dropped rather
 * than throwing.
 */
export function parseNotes(raw: string | null): Note[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data.filter(isNote).map((n) => ({
    id: n.id,
    content: n.content.slice(0, NOTE_MAX_LENGTH),
    pinned: n.pinned,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }))
}

/** Serialize a note list for persistence. */
export function serializeNotes(notes: readonly Note[]): string {
  return JSON.stringify(notes)
}
