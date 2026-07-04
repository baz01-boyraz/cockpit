import type { ReactNode } from 'react'
import type { CouncilResult, CouncilTone } from '@shared/council'
import { IconWarning } from './icons'

/** Advisor id → its render hue (mirrors the swarm identity palette). */
const TONE_CLASS: Record<CouncilTone, string> = {
  contrarian: 'councilAdvisor--contrarian',
  'first-principles': 'councilAdvisor--firstPrinciples',
  expansionist: 'councilAdvisor--expansionist',
  outsider: 'councilAdvisor--outsider',
  executor: 'councilAdvisor--executor',
}

/** Inline `**bold**` → <strong>; everything else passes through verbatim. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    return bold ? <strong key={i}>{bold[1]}</strong> : <span key={i}>{part}</span>
  })
}

/**
 * Markdown-lite: enough to render the chairman's `### heading` + paragraph
 * output cleanly without pulling in a markdown runtime. Heading lines become
 * styled sub-heads (marker stripped, emoji kept); blank lines break paragraphs.
 */
function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length === 0) return
    blocks.push(
      <p key={`p${blocks.length}`} className="council__p">
        {renderInline(para.join(' '))}
      </p>,
    )
    para = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push(
        <h4 key={`h${blocks.length}`} className="council__h">
          {renderInline(heading[1])}
        </h4>,
      )
    } else if (line === '') {
      flush()
    } else {
      para.push(line)
    }
  }
  flush()
  return <>{blocks}</>
}

/**
 * Renders a finished LLM-Council session: the chairman's verdict leads (it is
 * the answer), then the five advisor perspectives, then the anonymous peer
 * review folded away. Model prose is rendered markdown-lite — headings and
 * bold, no runtime dependency.
 */
export function CouncilVerdict({ result }: { result: CouncilResult }) {
  if (!result.ok && result.advisors.length === 0) {
    return (
      <div className="review__notice" role="alert">
        <IconWarning width={14} height={14} /> {result.error ?? 'The council could not convene.'}
      </div>
    )
  }

  return (
    <div className="council">
      {result.verdict && (
        <div className="council__verdict">
          <div className="eyebrow">chairman verdict</div>
          <div className="council__body">
            <MarkdownLite text={result.verdict} />
          </div>
        </div>
      )}

      <div className="council__advisors">
        {result.advisors.map((a) => (
          <article
            key={a.id}
            className={`councilAdvisor ${TONE_CLASS[a.id] ?? ''}${a.ok ? '' : ' councilAdvisor--failed'}`}
          >
            <header className="councilAdvisor__label">{a.label}</header>
            <p className="councilAdvisor__text">{a.text}</p>
          </article>
        ))}
      </div>

      {result.peerReview && (
        <details className="council__peer">
          <summary className="council__peerSummary">Anonymous peer review</summary>
          <div className="council__body">
            <MarkdownLite text={result.peerReview} />
          </div>
        </details>
      )}
    </div>
  )
}
