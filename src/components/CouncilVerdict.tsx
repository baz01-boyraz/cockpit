import type { ReactNode } from 'react'
import type { CouncilResult, CouncilTone } from '@shared/council'
import { engineLabel } from '@shared/engines'
import {
  buildCouncilDisplay,
  parseCouncilMarkdown,
  summarizeCouncilSeat,
} from '@shared/council-display'
import { IconCheck, IconWarning, IconX } from './icons'

/** Seat id → its render hue (mirrors the swarm identity palette). Exported so
 *  the scorecard renders each seat in the same voice as its verdict card. */
export const COUNCIL_TONE_CLASS: Record<CouncilTone, string> = {
  contrarian: 'councilAdvisor--contrarian',
  'first-principles': 'councilAdvisor--firstPrinciples',
  expansionist: 'councilAdvisor--expansionist',
  outsider: 'councilAdvisor--outsider',
  builder: 'councilAdvisor--executor',
}

/** Council's tiny inline subset: bold and code, with all text still escaped by React. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    const code = /^`([^`]+)`$/.exec(part)
    if (bold) return <strong key={i}>{bold[1]}</strong>
    if (code) return <code key={i}>{code[1]}</code>
    return <span key={i}>{part}</span>
  })
}

/**
 * Markdown-lite: enough to render the chairman's `### heading` + paragraph
 * output cleanly without pulling in a markdown runtime. Heading lines become
 * styled sub-heads (marker stripped, emoji kept); blank lines break paragraphs.
 */
function MarkdownLite({ text }: { text: string }) {
  return (
    <>
      {parseCouncilMarkdown(text).map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h4 key={index} className="council__h">
              {renderInline(block.text)}
            </h4>
          )
        }
        if (block.type === 'paragraph') {
          return (
            <p key={index} className="council__p">
              {renderInline(block.text)}
            </p>
          )
        }
        const List = block.type === 'ordered-list' ? 'ol' : 'ul'
        return (
          <List key={index} className="council__list">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </List>
        )
      })}
    </>
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
  const display = buildCouncilDisplay(result)
  const DecisionIcon =
    display.kind === 'failed' ? IconX : display.kind === 'clarify' ? IconWarning : IconCheck

  return (
    <div className="council">
      <section
        className={`councilDecision councilDecision--${display.kind}`}
        role={display.kind === 'failed' ? 'alert' : 'status'}
      >
        <div className="councilDecision__verdict">
          <span className="councilDecision__icon" aria-hidden>
            <DecisionIcon width={15} height={15} />
          </span>
          <span className="councilDecision__chip">{display.label}</span>
        </div>
        <p className="councilDecision__why">{display.why}</p>
      </section>

      {display.kind === 'clarify' && display.questions.length > 0 && (
        <section className="councilAction councilAction--clarify">
          <div className="eyebrow">council needs your input</div>
          <h3 className="councilAction__title">Answer these before the build starts</h3>
          <ol className="councilAction__questions">
            {display.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ol>
        </section>
      )}

      {display.kind === 'approved' && (display.goal || display.acceptanceCriteria.length > 0) && (
        <section className="councilAction councilAction--approved">
          <div className="eyebrow">approved build brief</div>
          {display.goal && (
            <div className="councilAction__goal">
              <span>Goal</span>
              <p>{display.goal}</p>
            </div>
          )}
          {display.acceptanceCriteria.length > 0 && (
            <div className="councilAction__criteria">
              <span>Acceptance criteria</span>
              <ol>
                {display.acceptanceCriteria.map((criterion, index) => (
                  <li key={index}>{criterion}</li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      <div className="council__disclosures">
        {result.verdict && (
          <details className="councilDisclosure">
            <summary className="councilDisclosure__summary">
              <span>
                <strong>Chairman analysis</strong>
                <small>Full synthesis and reasoning</small>
              </span>
            </summary>
            <div className="council__body councilDisclosure__body">
              <MarkdownLite text={result.verdict} />
            </div>
          </details>
        )}

        {display.refinedSpec && (
          <details className="councilDisclosure">
            <summary className="councilDisclosure__summary">
              <span>
                <strong>Refined spec</strong>
                <small>Goal, scope, constraints, and full acceptance criteria</small>
              </span>
            </summary>
            <div className="council__body councilDisclosure__body">
              <MarkdownLite text={display.refinedSpec} />
            </div>
          </details>
        )}
      </div>

      {result.seats.length > 0 && (
        <section className="councilSeats">
          <div className="eyebrow">seat perspectives · {result.seats.length}</div>
          <div className="council__advisors">
            {result.seats.map((seat) => (
              <details
                key={seat.id}
                className={`councilAdvisor ${COUNCIL_TONE_CLASS[seat.id] ?? ''}${seat.ok ? '' : ' councilAdvisor--failed'}`}
              >
                <summary className="councilAdvisor__summary">
                  <span className="councilAdvisor__label">
                    {seat.label}
                    <span className="councilAdvisor__engine">
                      {engineLabel(seat.engine)}
                      {seat.usedFallback ? ' · fallback' : ''}
                    </span>
                  </span>
                  <span className="councilAdvisor__preview">{summarizeCouncilSeat(seat.text)}</span>
                </summary>
                <div className="council__body councilAdvisor__text">
                  <MarkdownLite text={seat.text} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {result.rankings.length > 0 && (
        <details className="councilDisclosure council__peer">
          <summary className="councilDisclosure__summary">
            <span>
              <strong>Peer rankings</strong>
              <small>
                {result.rankings.length} of {result.stats.seatsRun} seats ranked the room
              </small>
            </span>
          </summary>
          <div className="council__body councilDisclosure__body">
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
