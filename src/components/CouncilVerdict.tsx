import type { ReactNode } from 'react'
import type {
  CouncilClarificationAnswer,
  CouncilResult,
  CouncilTone,
} from '@shared/council'
import type { CouncilAnalysisEvidence } from '@shared/council-evidence'
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
 * Renders a normalized LLM-Council v2/v3 session: the spec gate (spec mode) and the
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

const DECISION_PREVIEW_LIMIT = 5

export function CouncilVerdict({
  result,
  onContinue,
  continuing = false,
  showEvidence = true,
}: CouncilVerdictProps) {
  const display = buildCouncilDisplay(result)
  const keyFindings = result.decision?.keyFindings ?? []
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
            responseLanguage={result.responseLanguage}
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
              <span>Key acceptance checks</span>
              <ol>
                {display.acceptanceCriteria.slice(0, DECISION_PREVIEW_LIMIT).map((criterion, index) => (
                  <li key={index} className="councilAction__criterionPreview">{criterion}</li>
                ))}
              </ol>
              {display.acceptanceCriteria.length > DECISION_PREVIEW_LIMIT && (
                <details className="councilAction__more">
                  <summary>
                    {display.acceptanceCriteria.length - DECISION_PREVIEW_LIMIT} more checks
                  </summary>
                  <ol start={DECISION_PREVIEW_LIMIT + 1}>
                    {display.acceptanceCriteria.slice(DECISION_PREVIEW_LIMIT).map((criterion, index) => (
                      <li key={index}>{criterion}</li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      {display.kind === 'reviewed' && keyFindings.length > 0 && (
        <section className="councilAction councilAction--reviewed">
          <div className="eyebrow">Decision brief</div>
          <ol className="councilAction__findings">
            {keyFindings.slice(0, DECISION_PREVIEW_LIMIT).map((finding, index) => (
              <li key={index} className="councilAction__finding">{finding}</li>
            ))}
          </ol>
          {keyFindings.length > DECISION_PREVIEW_LIMIT && (
            <p className="councilAction__remainder">
              {keyFindings.length - DECISION_PREVIEW_LIMIT} more findings in the full report
            </p>
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
  const analysis = result.evidence?.analysis
  const peerRankings = result.rankings
    .map((ranking, index) => `Ranking ${index + 1} — ${ranking.seatId}\n${ranking.text}`)
    .join('\n\n')

  return (
    <div className="councilEvidenceContents">
      {analysis && <CouncilAnalysisProvenance analysis={analysis} />}
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

function analysisEgressLabel(analysis: CouncilAnalysisEvidence): string {
  if (analysis.egress.policy === 'local-only') return 'Local evidence only'
  if (analysis.egress.policy === 'account-models') return 'Claude + Codex accounts'
  return 'All configured models'
}

/** Compact provenance surface. Source bodies remain deliberately hidden. */
function CouncilAnalysisProvenance({ analysis }: { analysis: CouncilAnalysisEvidence }) {
  const citedIds = new Set(analysis.claims.flatMap((claim) => claim.evidenceRefs))
  const sources =
    analysis.egress.policy === 'local-only'
      ? analysis.pack.sources
      : analysis.pack.sources.filter((source) => citedIds.has(source.id))
  const verifiedClaims = analysis.claims.filter((claim) => claim.verified).length
  const inferenceClaims = analysis.claims.length - verifiedClaims

  return (
    <section className="councilProvenance" aria-label="Analysis evidence provenance">
      <div className="councilProvenance__head">
        <div>
          <div className="eyebrow">grounding</div>
          <h4>Sources used</h4>
        </div>
        <span className="councilProvenance__policy">{analysisEgressLabel(analysis)}</span>
      </div>
      <div className="councilProvenance__stats" aria-label="Evidence quality summary">
        <span>
          <strong>{verifiedClaims}</strong> source-backed {verifiedClaims === 1 ? 'claim' : 'claims'}
        </span>
        <span>
          <strong>{inferenceClaims}</strong> unverified {inferenceClaims === 1 ? 'inference' : 'inferences'}
        </span>
        <span>
          <strong>{sources.length}</strong> {sources.length === 1 ? 'source' : 'sources'} cited
        </span>
      </div>
      {sources.length > 0 ? (
        <ul className="councilProvenance__sources">
          {sources.map((source) => (
            <li key={source.id}>
              <code>{source.id}</code>
              <span>
                <strong>{source.path ?? source.label}</strong>
                <small>
                  {source.kind}
                  {source.startLine !== null && source.endLine !== null
                    ? ` · lines ${source.startLine}–${source.endLine}`
                    : ''}
                  {source.sha256 ? ` · sha256 ${source.sha256.slice(0, 12)}` : ''}
                  {source.truncated ? ' · bounded excerpt' : ''}
                  {source.injectionSuspect ? ' · instruction-like text flagged' : ''}
                </small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="councilProvenance__empty">No source was cited by a source-backed claim.</p>
      )}
      <div className="councilProvenance__freshness">
        <span>
          Manifest <code>{analysis.pack.repository.manifestHash.slice(0, 12)}</code>
        </span>
        <span>
          Head <code>{analysis.pack.repository.headRef ?? 'unknown'}</code>
        </span>
        <span>
          Canonical MEMORY.md{' '}
          <strong>{analysis.pack.repository.canonicalMemoryMdPresent ? 'present' : 'absent'}</strong>
        </span>
      </div>
    </section>
  )
}
