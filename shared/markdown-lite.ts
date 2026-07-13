/**
 * Markdown-lite tokenizer (pure, no runtime deps) — just enough structure for
 * the memory reader: headings, paragraphs, lists, fenced code, quotes, rules,
 * and the inline trio the notes actually use (**bold**, `code`, [[wikilinks]]).
 *
 * It deliberately is NOT a markdown engine: unknown syntax degrades to plain
 * text, nothing ever throws, and the output is data — the renderer maps tokens
 * to React nodes, so note content can never inject markup (same boundary as
 * WikiText).
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'wikilink'; target: string; alias: string | null }

export type MarkdownBlock =
  | { kind: 'heading'; level: number; inline: InlineToken[] }
  | { kind: 'paragraph'; inline: InlineToken[] }
  | { kind: 'list'; ordered: boolean; items: InlineToken[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; inline: InlineToken[] }
  | { kind: 'rule' }

/** Inline code first (protects brackets), then bold, then wikilinks. */
const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[\[[^[\]\n]+?\]\])/g

/** Tokenize one line/run of prose into inline tokens. Unmatched markers stay text. */
export function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  let cursor = 0
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > cursor) out.push({ kind: 'text', text: text.slice(cursor, m.index) })
    if (m[1]) {
      out.push({ kind: 'code', text: m[1].slice(1, -1) })
    } else if (m[2]) {
      out.push({ kind: 'bold', text: m[2].slice(2, -2) })
    } else {
      const body = m[3].slice(2, -2)
      const pipe = body.indexOf('|')
      const target = (pipe === -1 ? body : body.slice(0, pipe)).trim()
      const alias = pipe === -1 ? null : body.slice(pipe + 1).trim() || null
      if (target) out.push({ kind: 'wikilink', target, alias })
      else out.push({ kind: 'text', text: m[3] })
    }
    cursor = m.index + m[0].length
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) })
  return out
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/
const ORDERED_RE = /^\d+[.)]\s+(.*)$/
const RULE_RE = /^(-{3,}|\*{3,}|_{3,})$/

/** Split note body markdown into structural blocks. Never throws. */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: InlineToken[][] } | null = null

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = (): void => {
    if (!list) return
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      flushParagraph()
      flushList()
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }

    if (trimmed.length === 0) {
      flushParagraph()
      flushList()
      continue
    }

    if (RULE_RE.test(trimmed)) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'rule' })
      continue
    }

    const heading = HEADING_RE.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', level: heading[1].length, inline: parseInline(heading[2]) })
      continue
    }

    const bullet = BULLET_RE.exec(trimmed)
    const ordered = bullet ? null : ORDERED_RE.exec(trimmed)
    if (bullet || ordered) {
      flushParagraph()
      const isOrdered = !!ordered
      const item = parseInline((bullet ?? ordered)![1])
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(item)
      continue
    }

    if (trimmed.startsWith('>')) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'quote', inline: parseInline(trimmed.replace(/^>+\s?/, '')) })
      continue
    }

    // A list interrupted by prose ends; the prose starts a paragraph.
    flushList()
    paragraph.push(trimmed)
  }
  flushParagraph()
  flushList()
  return blocks
}
