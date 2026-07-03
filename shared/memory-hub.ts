/**
 * Memory-hub domain types + pure assembly (VISION 5.3).
 *
 * The hub is markdown files; this module owns the shapes the bridge returns
 * and the single assembly rule (summaries, backlinks, unresolved) shared by
 * the real MemoryHubService and the browser mock — the two can never drift.
 */
import { buildLinkIndex, normalizeNoteName, parseWikilinks } from './wikilink'

export interface MemoryDoc {
  name: string
  content: string
  updatedAt: string
}

export interface MemoryNoteSummary {
  name: string
  title: string
  updatedAt: string
  linksOut: number
  backlinks: number
}

export interface MemoryHubSnapshot {
  notes: MemoryNoteSummary[]
  unresolved: { target: string; wantedBy: string[] }[]
}

export interface MemoryNote {
  name: string
  title: string
  content: string
  updatedAt: string
  backlinks: string[]
  outgoing: string[]
  /** Targets this note links to that don't exist yet. */
  unresolved: string[]
}

/** First markdown heading, else the note name. */
export function titleOf(content: string, name: string): string {
  const m = /^#{1,6}\s+(.+)$/m.exec(content)
  return m ? m[1].trim() : name
}

export function assembleHubSnapshot(docs: MemoryDoc[]): MemoryHubSnapshot {
  const idx = buildLinkIndex(docs)
  const notes = docs
    .map((d) => {
      const slug = normalizeNoteName(d.name)
      if (!slug) return null
      return {
        name: slug,
        title: titleOf(d.content, slug),
        updatedAt: d.updatedAt,
        linksOut: idx.forward.get(slug)?.size ?? 0,
        backlinks: idx.backlinks.get(slug)?.size ?? 0,
      }
    })
    .filter((n): n is MemoryNoteSummary => n !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  const unresolved = [...idx.unresolved.entries()]
    .map(([target, wantedBy]) => ({ target, wantedBy: [...wantedBy] }))
    .sort((a, b) => b.wantedBy.length - a.wantedBy.length)
  return { notes, unresolved }
}

export function assembleNote(docs: MemoryDoc[], name: string): MemoryNote | null {
  const slug = normalizeNoteName(name)
  if (!slug) return null
  const doc = docs.find((d) => normalizeNoteName(d.name) === slug)
  if (!doc) return null
  const idx = buildLinkIndex(docs)
  const known = new Set(docs.map((d) => normalizeNoteName(d.name)).filter(Boolean))
  const unresolved = [
    ...new Set(
      parseWikilinks(doc.content)
        .map((l) => normalizeNoteName(l.target))
        .filter((t): t is string => t !== null && t !== slug && !known.has(t)),
    ),
  ]
  return {
    name: slug,
    title: titleOf(doc.content, slug),
    content: doc.content,
    updatedAt: doc.updatedAt,
    backlinks: [...(idx.backlinks.get(slug) ?? [])],
    outgoing: [...(idx.forward.get(slug) ?? [])],
    unresolved,
  }
}
