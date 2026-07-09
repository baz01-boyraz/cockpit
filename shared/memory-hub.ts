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

/** Hard cap on the one-line hook extracted for list previews / relevance recall. */
export const HOOK_CAP = 120

/**
 * The charter's "one-line hook": the first real prose line at the body head. Skips
 * a leading `--- … ---` frontmatter block, then any heading (`#…`) and blank
 * lines, and strips a leading blockquote marker (`>`), returning the first content
 * line capped at {@link HOOK_CAP} chars — or null when the note is all
 * frontmatter/headings/blank. Pure and cheap; used to preview a note without
 * inlining its whole body.
 */
export function extractHook(content: string): string | null {
  const lines = content.split('\n')
  let i = 0
  // Skip a leading frontmatter block (opens with a line that is exactly `---`).
  if (lines[0]?.trim() === '---') {
    i = 1
    while (i < lines.length && lines[i].trim() !== '---') i += 1
    i += 1 // step past the closing `---`
  }
  for (; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const stripped = line.startsWith('>') ? line.replace(/^>+\s?/, '').trim() : line
    if (stripped.length === 0) continue
    return stripped.slice(0, HOOK_CAP)
  }
  return null
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
