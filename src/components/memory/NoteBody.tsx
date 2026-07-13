import { useMemo, type ReactNode } from 'react'
import { parseNote, type NoteFrontmatter } from '@shared/memory-note-schema'
import { parseMarkdownBlocks, type InlineToken, type MarkdownBlock } from '@shared/markdown-lite'
import { normalizeNoteName } from '@shared/wikilink'
import { relativeTime } from '@shared/time'

interface NoteBodyProps {
  content: string
  /** Normalized names of notes that exist — decides resolved vs unresolved. */
  known: ReadonlySet<string>
  onOpen: (name: string) => void
  /** Unresolved link clicked — offer creation upstream (never auto-write). */
  onOffer: (target: string) => void
  /** Hide the frontmatter chip row (the overlay shows its own header). */
  hideMeta?: boolean
  /** The title already shown in the surrounding chrome — a leading `# heading`
   *  that repeats it is dropped instead of rendered twice. */
  dedupeTitle?: string
}

const inlinePlainText = (tokens: InlineToken[]): string =>
  tokens.map((t) => (t.kind === 'wikilink' ? (t.alias ?? t.target) : t.text)).join('')

const GATE_LABEL: Record<NoteFrontmatter['gate'], string> = {
  save: 'auto-saved',
  asked: 'you approved',
  manual: 'written by hand',
  consolidation: 'tidy-up merge',
}

/** "captured just now" / "captured 3h ago" — relativeTime can return a bare date. */
function agoLabel(iso: string): string {
  const t = relativeTime(iso)
  if (!t) return ''
  return t === 'now' ? 'just now' : `${t} ago`
}

function Inline({
  tokens,
  known,
  onOpen,
  onOffer,
}: {
  tokens: InlineToken[]
  known: ReadonlySet<string>
  onOpen: (name: string) => void
  onOffer: (target: string) => void
}) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === 'bold') return <strong key={i}>{t.text}</strong>
        if (t.kind === 'code') return <code key={i}>{t.text}</code>
        if (t.kind === 'wikilink') {
          const slug = normalizeNoteName(t.target)
          const label = t.alias ?? t.target
          if (!slug) return <span key={i}>{label}</span>
          return known.has(slug) ? (
            <button
              key={i}
              type="button"
              className="wikilink"
              title={`Open ${slug}`}
              onClick={() => onOpen(slug)}
            >
              {label}
            </button>
          ) : (
            <button
              key={i}
              type="button"
              className="wikilink wikilink--unresolved"
              title={`${slug} doesn't exist yet — click to create it`}
              onClick={() => onOffer(slug)}
            >
              {label}
            </button>
          )
        }
        return t.text
      })}
    </>
  )
}

/**
 * The composed note view: frontmatter becomes a quiet metadata chip row (never
 * raw `---` text), the body renders as structured markdown-lite blocks, and
 * wikilinks stay clickable. Everything is React nodes — note content cannot
 * inject markup (same boundary as WikiText).
 */
export function NoteBody({ content, known, onOpen, onOffer, hideMeta, dedupeTitle }: NoteBodyProps) {
  const { frontmatter, blocks } = useMemo(() => {
    const parsed = parseNote(content)
    let parsedBlocks = parseMarkdownBlocks(parsed.body)
    const first = parsedBlocks[0]
    if (
      dedupeTitle &&
      first?.kind === 'heading' &&
      inlinePlainText(first.inline).trim().toLowerCase() === dedupeTitle.trim().toLowerCase()
    ) {
      parsedBlocks = parsedBlocks.slice(1)
    }
    return { frontmatter: parsed.frontmatter, blocks: parsedBlocks }
  }, [content, dedupeTitle])

  const inlineProps = { known, onOpen, onOffer }

  const render = (block: MarkdownBlock, i: number): ReactNode => {
    switch (block.kind) {
      case 'heading': {
        const level = Math.min(block.level, 4)
        return (
          <div key={i} className={`notebody__h notebody__h--${level}`} role="heading" aria-level={level + 2}>
            <Inline tokens={block.inline} {...inlineProps} />
          </div>
        )
      }
      case 'list':
        return block.ordered ? (
          <ol key={i} className="notebody__list">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline tokens={item} {...inlineProps} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="notebody__list">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inline tokens={item} {...inlineProps} />
              </li>
            ))}
          </ul>
        )
      case 'code':
        return (
          <pre key={i} className="notebody__code mono">
            {block.text}
          </pre>
        )
      case 'quote':
        return (
          <blockquote key={i} className="notebody__quote">
            <Inline tokens={block.inline} {...inlineProps} />
          </blockquote>
        )
      case 'rule':
        return <hr key={i} className="notebody__rule" />
      default:
        return (
          <p key={i} className="notebody__p">
            <Inline tokens={block.inline} {...inlineProps} />
          </p>
        )
    }
  }

  return (
    <div className="notebody">
      {!hideMeta && frontmatter && (
        <div className="notebody__meta" aria-label="Note metadata">
          <span className={`notebody__class notebody__class--${frontmatter.class}`}>
            {frontmatter.class}
          </span>
          <span className="notebody__metaItem">{GATE_LABEL[frontmatter.gate]}</span>
          {frontmatter.capturedAt && (
            <span className="notebody__metaItem">captured {agoLabel(frontmatter.capturedAt)}</span>
          )}
          {frontmatter.tags.length > 0 && (
            <span className="notebody__metaItem">{frontmatter.tags.join(' · ')}</span>
          )}
        </div>
      )}
      {blocks.map(render)}
    </div>
  )
}
