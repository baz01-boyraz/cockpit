import { useMemo, type ReactNode } from 'react'
import { normalizeNoteName, parseWikilinks } from '@shared/wikilink'

interface WikiTextProps {
  content: string
  /** Normalized names of notes that exist — decides resolved vs unresolved. */
  known: ReadonlySet<string>
  onOpen: (name: string) => void
  /** Unresolved link clicked — offer creation upstream (never auto-write). */
  onOffer: (target: string) => void
}

/**
 * Renders note content as plain text with `[[wikilinks]]` decorated as
 * clickable elements. Segments are built by parsing (shared/wikilink) and
 * rendered as React nodes — never innerHTML — so note content can't inject
 * markup (plan 5.x security boundary).
 */
export function WikiText({ content, known, onOpen, onOffer }: WikiTextProps) {
  const segments = useMemo<ReactNode[]>(() => {
    const links = parseWikilinks(content)
    const out: ReactNode[] = []
    let cursor = 0
    links.forEach((link, i) => {
      if (link.start > cursor) out.push(content.slice(cursor, link.start))
      const slug = normalizeNoteName(link.target)
      const label = link.alias ?? link.target
      if (!slug) {
        // Unrepresentable name — show the raw text, not a dead control.
        out.push(content.slice(link.start, link.end))
      } else if (known.has(slug)) {
        out.push(
          <button
            key={`l${i}`}
            type="button"
            className="wikilink"
            title={`Open ${slug}`}
            onClick={() => onOpen(slug)}
          >
            {label}
          </button>,
        )
      } else {
        out.push(
          <button
            key={`l${i}`}
            type="button"
            className="wikilink wikilink--unresolved"
            title={`${slug} doesn't exist yet — click to create it`}
            onClick={() => onOffer(slug)}
          >
            {label}
          </button>,
        )
      }
      cursor = link.end
    })
    if (cursor < content.length) out.push(content.slice(cursor))
    return out
  }, [content, known, onOpen, onOffer])

  return <div className="wikitext">{segments}</div>
}
