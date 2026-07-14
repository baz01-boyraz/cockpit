import type { AriaRole } from 'react'
import type { SentinelSignal } from '@shared/sentinel'
import { signalImportance, signalRestartImpact } from '@shared/sentinel'
import { relativeTime } from '@shared/time'
import { importanceMeta, OUTCOME_META, sourceLabel } from '../lib/sentinelView'

export type SentinelDecisionAgent = 'claude' | 'codex'

interface SentinelDecisionCardProps {
  signal: SentinelSignal
  onAsk: (agent: SentinelDecisionAgent) => void
  onDismiss: () => void
  onOpen?: () => void
  busyAgent?: SentinelDecisionAgent | null
  error?: string | null
  className?: string
  role?: AriaRole
}

/**
 * One owner decision surface for a persisted Sentinel signal. The percentages
 * and restart labels come from deterministic rules; the card never implies
 * that an agent, fix, restart, or release already happened.
 */
export function SentinelDecisionCard({
  signal,
  onAsk,
  onDismiss,
  onOpen,
  busyAgent = null,
  error = null,
  className = '',
  role,
}: SentinelDecisionCardProps) {
  const importance = signalImportance(signal)
  const importanceInfo = importanceMeta(importance)
  const restart = signalRestartImpact(signal)
  const outcomeMeta = signal.outcome ? OUTCOME_META[signal.outcome] : null
  const dismissed = signal.outcome === 'dismissed'
  const actionBusy = busyAgent !== null

  const issue = (
    <>
      <span className="signalDecision__title">{signal.title}</span>
      <span className="signalDecision__summary">{signal.summary}</span>
    </>
  )

  return (
    <article
      className={`signalDecision signalDecision--${signal.severity} ${className}`.trim()}
      role={role}
      data-signal-id={signal.id}
    >
      <span className="signalDecision__edge" aria-hidden="true" />

      <div className="signalDecision__head">
        <div className="signalDecision__identity">
          <span className="signalDecision__source">{sourceLabel(signal.source)}</span>
          {signal.status === 'new' && <span className="sigbadge sigbadge--new">New</span>}
          {outcomeMeta && (
            <span className={`sigbadge sigbadge--${outcomeMeta.tone}`}>{outcomeMeta.label}</span>
          )}
          <time
            className="signalDecision__time mono"
            dateTime={signal.createdAt}
            title={new Date(signal.createdAt).toLocaleString()}
          >
            {relativeTime(signal.createdAt) || 'now'}
          </time>
        </div>

        <div className="signalDecision__indicators" aria-label="Issue impact">
          <span
            className={`signalDecision__importance signalDecision__importance--${importanceInfo.tone}`}
            title={`${importanceInfo.label} importance`}
          >
            Importance {importance}%
          </span>
          <span
            className={`signalDecision__restart signalDecision__restart--${restart.tone}`}
            title="Estimated full-app restart impact after a fix"
          >
            {restart.label}
          </span>
        </div>
      </div>

      {onOpen ? (
        <button
          type="button"
          className="signalDecision__body signalDecision__body--button"
          onClick={onOpen}
          aria-label={`Open signal: ${signal.title}`}
        >
          {issue}
        </button>
      ) : (
        <div className="signalDecision__body">{issue}</div>
      )}

      {error && (
        <div className="signalDecision__error" role="alert">
          {error}
        </div>
      )}

      <div className="signalDecision__actions">
        <button
          type="button"
          className="signalDecision__ask signalDecision__ask--claude"
          onClick={() => onAsk('claude')}
          disabled={actionBusy || dismissed}
          aria-label="Ask Claude"
        >
          {busyAgent === 'claude' ? 'Opening Claude…' : 'Ask Claude'}
        </button>
        <button
          type="button"
          className="signalDecision__ask signalDecision__ask--codex"
          onClick={() => onAsk('codex')}
          disabled={actionBusy || dismissed}
          aria-label="Ask Codex"
        >
          {busyAgent === 'codex' ? 'Opening Codex…' : 'Ask Codex'}
        </button>
        <button
          type="button"
          className="signalDecision__dismiss"
          onClick={onDismiss}
          disabled={actionBusy || dismissed}
          aria-label="Dismiss"
        >
          {dismissed ? 'Dismissed' : 'Dismiss'}
        </button>
      </div>
    </article>
  )
}
