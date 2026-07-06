import type { ReactNode } from 'react'

/**
 * Dependency-free, best-effort markup for Hermes replies: fenced code blocks,
 * inline code, **bold**, and "- "/"* " bullet lists. Not a real Markdown
 * parser — just enough structure to make Hermes's tool-call-heavy answers
 * (file paths, commands, steps) easier to scan than a flat text blob.
 */

const CODE_BLOCK_RE = /```(\w+)?\n?([\s\S]*?)```/g
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g
const BULLET_RE = /^[-*]\s+(.*)/

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE_RE)
    .filter((part) => part.length > 0)
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={key}>{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code key={key} className="hermes__code">
            {part.slice(1, -1)}
          </code>
        )
      }
      return <span key={key}>{part}</span>
    })
}

/** Splits a code-fence-free chunk of text into paragraph and bullet-list blocks. */
function renderTextBlock(text: string, keyPrefix: string): ReactNode[] {
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let n = 0

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const key = `${keyPrefix}-p-${n++}`
    blocks.push(<p key={key}>{renderInline(paragraph.join(' '), key)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (listItems.length === 0) return
    const key = `${keyPrefix}-ul-${n++}`
    blocks.push(
      <ul key={key} className="hermes__list">
        {listItems.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}
      </ul>,
    )
    listItems = []
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const bullet = BULLET_RE.exec(line)
    if (bullet) {
      flushParagraph()
      listItems.push(bullet[1])
    } else if (line === '') {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}

/** Renders a Hermes message's text into lightly structured, colorable JSX. */
export function renderHermesText(text: string): ReactNode {
  const blocks: ReactNode[] = []
  let lastIndex = 0
  let n = 0
  let match: RegExpExecArray | null
  CODE_BLOCK_RE.lastIndex = 0

  while ((match = CODE_BLOCK_RE.exec(text))) {
    if (match.index > lastIndex) {
      blocks.push(...renderTextBlock(text.slice(lastIndex, match.index), `t-${n++}`))
    }
    const lang = match[1] ?? ''
    const code = (match[2] ?? '').replace(/\n$/, '')
    blocks.push(
      <pre key={`code-${n++}`} className="hermes__codeBlock">
        {lang && <span className="hermes__codeLang">{lang}</span>}
        <code>{code}</code>
      </pre>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    blocks.push(...renderTextBlock(text.slice(lastIndex), `t-${n++}`))
  }
  return blocks.length > 0 ? blocks : text
}
