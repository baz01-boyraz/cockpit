import type { ReactNode } from 'react'
import type {
  CouncilClarificationAnswer,
  CouncilResult,
  CouncilTone,
} from '@shared/council'
import { engineLabel } from '@shared/engines'
import {
  buildCouncilDisplay,
  parseCouncilInline,
  parseCouncilMarkdown,
  summarizeCouncilSeat,
} from '@shared/council-display'
import { IconCheck, IconWarning, IconX } from './icons'
import { CouncilClarificationForm } from './CouncilClarificationForm'
import { CopyTextButton } from './CopyTextButton'

/** Seat id → its render hue (mirrors the swarm identity palette). Exported so
 *  the scorecard renders each seat in the same voice as its verdict card. */
export const COUNCIL_TONE_CLASS: Record<CouncilTone, string> = {
  contrarian: 'councilAdvisor--contrarian',
  'first-principles': 'councilAdvisor--firstPrinciples',
  expansionist: 'councilAdvisor--expansionist',
  outsider: 'councilAdvisor--outsider',
  builder: 'councilAdvisor--executor',
}

/** Council's safe inline subset; React still escapes every model-provided string. */
function renderInline(text: string): ReactNode[] {
  return parseCouncilInline(text).map((token, index) => {
    if (token.type === 'strong') return <strong key={index}>{token.text}</strong>
    if (token.type === 'emphasis') return <em key={index}>{token.text}</em>
    if (token.type === 'code') return <code key={index}>{token.text}</code>
    if (token.type === 'link') {
      return (
        <a key={index} href={token.href} target="_blank" rel="noreferrer">
          {token.text}
        </a>
      )
    }
    return <span key={index}>{token.text}</span>
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
        if (block.type === 'thematic-break') {
          return <hr key={index} className="council__rule" />
        }
        if (block.type === 'code-block') {
          return (
            <pre key={index} className="council__codeBlock">
              <code data-language={block.language ?? undefined}>{block.code}</code>
            </pre>
          )
        }
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
interface CouncilVerdictProps {
  result: CouncilResult
  /** Present on the standalone flow; omitted on read-only/historical surfaces. */
  onContinue?: (answers: CouncilClarificationAnswer[]) => void
  continuing?: boolean
  /** Standalone Council wraps all internals in one disclosure; Swarm keeps legacy detail. */
  showEvidence?: boolean
}

export function CouncilVerdict({
  result,
  onContinue,
  continuing = false,
  showEvidence = true,
}: CouncilVerdictProps) {
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

      {display.kind === 'clarify' && display.clarifications.length > 0 &&
        (onContinue ? (
          <CouncilClarificationForm
            questions={display.clarifications}
            continuing={continuing}
            onContinue={onContinue}
          />
        ) : (
          <section className="councilAction councilAction--clarify">
            <div className="eyebrow">saved clarification</div>
            <h3 className="councilAction__title">Questions recorded for the author</h3>
            <ol className="councilAction__questions">
              {display.questions.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ol>
          </section>
        ))}

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

      {showEvidence && <CouncilVerdictEvidence result={result} />}
    </div>
  )
}

/** Chairman prose, refined spec, seats, and rankings — evidence, never the primary task. */
export function CouncilVerdictEvidence({ result }: { result: CouncilResult }) {
  const display = buildCouncilDisplay(result)
  const peerRankings = result.rankings
    .map((ranking, index) => `Ranking ${index + 1} — ${ranking.seatId}\n${ranking.text}`)
    .join('\n\n')

  return (
    <div className="councilEvidenceContents">
      <div className="council__disclosures">
        {display.chairmanAnalysis && (
          <details className="councilDisclosure">
            <summary className="councilDisclosure__summary">
              <span>
                <strong>Chairman analysis</strong>
                <small>Full synthesis and reasoning</small>
              </span>
            </summary>
            <div className="council__body councilDisclosure__body">
              <div className="councilArtifactActions">
                <CopyTextButton
                  text={display.chairmanAnalysis}
                  label="Copy chairman analysis"
                  compact
                />
              </div>
              <MarkdownLite text={display.chairmanAnalysis} />
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
              <div className="councilArtifactActions">
                <CopyTextButton text={display.refinedSpec} label="Copy refined spec" compact />
              </div>
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
                  <div className="councilArtifactActions">
                    <CopyTextButton
                      text={seat.text}
                      label={`Copy ${seat.label} perspective`}
                      compact
                    />
                  </div>
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
            <div className="councilArtifactActions">
              <CopyTextButton text={peerRankings} label="Copy peer rankings" compact />
            </div>
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
