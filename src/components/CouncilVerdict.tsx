import type { ReactNode } from 'react'
import type { CouncilResult, CouncilTone } from '@shared/council'
import { engineLabel } from '@shared/engines'
import { IconWarning } from './icons'

/** Seat id → its render hue (mirrors the swarm identity palette). Exported so
 *  the scorecard renders each seat in the same voice as its verdict card. */
export const COUNCIL_TONE_CLASS: Record<CouncilTone, string> = {
  contrarian: 'councilAdvisor--contrarian',
  'first-principles': 'councilAdvisor--firstPrinciples',
  expansionist: 'councilAdvisor--expansionist',
  outsider: 'councilAdvisor--outsider',
  builder: 'councilAdvisor--executor',
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

/** The spec-mode gate banner: APPROVED / NEEDS_CLARIFICATION + author questions. */
function SpecGate({ specVerdict }: { specVerdict: NonNullable<CouncilResult['specVerdict']> }) {
  const approved = specVerdict.kind === 'approved'
  return (
    <div className={`council__gate council__gate--${approved ? 'approved' : 'clarify'}`}>
      <div className="eyebrow">spec verdict</div>
      <div className="council__gateKind">{approved ? 'APPROVED' : 'NEEDS CLARIFICATION'}</div>
      {specVerdict.questions.length > 0 && (
        <ol className="council__questions">
          {specVerdict.questions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Renders a finished LLM-Council v2 session: the spec gate (spec mode) and the
 * chairman's verdict lead, then each seat's perspective with its engine chip
 * (and "(fallback)" when the primary engine was down), then the peer rankings
 * folded away. Model prose is rendered markdown-lite — headings and bold, no
 * runtime dependency.
 */
export function CouncilVerdict({ result }: { result: CouncilResult }) {
  if (!result.ok && result.seats.length === 0) {
    return (
      <div className="review__notice" role="alert">
        <IconWarning width={14} height={14} /> {result.error ?? 'The council could not convene.'}
      </div>
    )
  }

  return (
    <div className="council">
      {result.specVerdict && <SpecGate specVerdict={result.specVerdict} />}

      {result.verdict && (
        <div className="council__verdict">
          <div className="eyebrow">chairman verdict</div>
          <div className="council__body">
            <MarkdownLite text={result.verdict} />
          </div>
        </div>
      )}

      <div className="council__advisors">
        {result.seats.map((s) => (
          <article
            key={s.id}
            className={`councilAdvisor ${COUNCIL_TONE_CLASS[s.id] ?? ''}${s.ok ? '' : ' councilAdvisor--failed'}`}
          >
            <header className="councilAdvisor__label">
              {s.label}
              <span className="councilAdvisor__engine">
                {engineLabel(s.engine)}
                {s.usedFallback ? ' (fallback)' : ''}
              </span>
            </header>
            <p className="councilAdvisor__text">{s.text}</p>
          </article>
        ))}
      </div>

      {result.rankings.length > 0 && (
        <details className="council__peer">
          <summary className="council__peerSummary">
            Peer rankings · {result.rankings.length} of {result.stats.seatsRun}
          </summary>
          <div className="council__body">
            {result.rankings.map((r, i) => (
              <div key={r.seatId} className="council__ranking">
                <div className="council__rankingHead">Ranking {i + 1}</div>
                <MarkdownLite text={r.text} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
