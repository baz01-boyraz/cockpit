/**
 * Wikilink kernel (pure, no runtime deps — VISION 5.2).
 *
 * The single rule set for `[[wikilinks]]`: parsing (with alias support and
 * code-region awareness), note-name normalization (slug-by-construction — the
 * path-safety property the hub service relies on), the forward/backlink/
 * unresolved index, and rename-with-refresh rewriting.
 */

export interface WikiLink {
  /** Raw target text between the brackets (before the `|`), trimmed. */
  target: string
  alias: string | null
  start: number
  end: number
}

export interface LinkIndex {
  /** normalized note → ordered set of resolved normalized targets */
  forward: Map<string, Set<string>>
  /** normalized note → ordered set of normalized notes linking to it */
  backlinks: Map<string, Set<string>>
  /** normalized missing target → notes that want it */
  unresolved: Map<string, Set<string>>
}

const LINK_RE = /\[\[([^[\]\n]+?)\]\]/g
/** Fenced blocks and single-line inline code — links inside are not links. */
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g

function codeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (const m of text.matchAll(CODE_RE)) {
    spans.push([m.index, m.index + m[0].length])
  }
  return spans
}

const inSpans = (spans: Array<[number, number]>, pos: number): boolean =>
  spans.some(([s, e]) => pos >= s && pos < e)

/** Parse all wikilinks outside code regions. */
export function parseWikilinks(text: string): WikiLink[] {
  const spans = codeSpans(text)
  const out: WikiLink[] = []
  for (const m of text.matchAll(LINK_RE)) {
    if (inSpans(spans, m.index)) continue
    const body = m[1]
    const pipe = body.indexOf('|')
    const target = (pipe === -1 ? body : body.slice(0, pipe)).trim()
    const alias = pipe === -1 ? null : body.slice(pipe + 1).trim() || null
    if (!target || target.includes('/') || target.includes('\\')) continue
    out.push({ target, alias, start: m.index, end: m.index + m[0].length })
  }
  return out
}

/**
 * Normalize a note name into its canonical slug — the matching key AND the
 * filename stem. Slug-by-construction is the path-safety boundary: no
 * separators, no leading dot, bounded length; anything else is null.
 */
export function normalizeNoteName(raw: string): string | null {
  const slug = raw
    .trim()
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/.test(slug)) return null
  if (slug.includes('..')) return null
  return slug
}

/** Build the forward/backlink/unresolved index over a set of notes. */
export function buildLinkIndex(docs: { name: string; content: string }[]): LinkIndex {
  const known = new Map<string, string>()
  for (const doc of docs) {
    const slug = normalizeNoteName(doc.name)
    if (slug) known.set(slug, slug)
  }

  const forward = new Map<string, Set<string>>()
  const backlinks = new Map<string, Set<string>>()
  const unresolved = new Map<string, Set<string>>()

  for (const doc of docs) {
    const source = normalizeNoteName(doc.name)
    if (!source) continue
    for (const link of parseWikilinks(doc.content)) {
      const target = normalizeNoteName(link.target)
      if (!target || target === source) continue
      if (known.has(target)) {
        if (!forward.has(source)) forward.set(source, new Set())
        forward.get(source)!.add(target)
        if (!backlinks.has(target)) backlinks.set(target, new Set())
        backlinks.get(target)!.add(source)
      } else {
        if (!unresolved.has(target)) unresolved.set(target, new Set())
        unresolved.get(target)!.add(source)
      }
    }
  }
  return { forward, backlinks, unresolved }
}

/** Rewrite links to `oldName` so they point at `newName`, aliases preserved. */
export function renameLinkTargets(content: string, oldName: string, newName: string): string {
  const oldSlug = normalizeNoteName(oldName)
  if (!oldSlug) return content
  const links = parseWikilinks(content).filter((l) => normalizeNoteName(l.target) === oldSlug)
  let out = content
  for (const link of links.reverse()) {
    const replacement = link.alias === null ? `[[${newName}]]` : `[[${newName}|${link.alias}]]`
    out = out.slice(0, link.start) + replacement + out.slice(link.end)
  }
  return out
}
