import type { MemoryHubSnapshot, MemoryNoteSummary } from '@shared/memory-hub'

export type MemoryLibrary = 'active' | 'archive'

/** A calm default surface even when a project has hundreds of memories. */
export const MEMORY_RECENT_LIMIT = 24

export function notesForLibrary(
  snapshot: MemoryHubSnapshot | null,
  library: MemoryLibrary,
): MemoryNoteSummary[] {
  if (!snapshot) return []
  return library === 'active' ? snapshot.notes : snapshot.archived
}

export function matchingLibraryNotes(
  notes: MemoryNoteSummary[],
  query: string,
): MemoryNoteSummary[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return notes
  return notes.filter(
    (note) => note.title.toLowerCase().includes(normalized) || note.name.includes(normalized),
  )
}

export function shownLibraryNotes(
  notes: MemoryNoteSummary[],
  query: string,
  showAll: boolean,
): MemoryNoteSummary[] {
  const matching = matchingLibraryNotes(notes, query)
  return query.trim() || showAll ? matching : matching.slice(0, MEMORY_RECENT_LIMIT)
}
