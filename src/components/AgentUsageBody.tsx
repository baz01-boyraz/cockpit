import type { CSSProperties } from 'react'
import type { AgentUsageSnapshot } from '@shared/domain'
import { describeAgentUsage, type AgentUsageWindowView } from '@shared/agent-usage'

/** Full reset timestamp, e.g. 'Resets 6/28/2026, 4:51 PM'. Null when unknown. */
function resetLabel(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `Resets ${date.toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function WindowRow({ window }: { window: AgentUsageWindowView }) {
  const remaining = window.remainingPercent
  const reset = resetLabel(window.resetAt)
  return (
    <div className={`quotaWindow quotaWindow--${window.tone}`}>
      <div className="quotaWindow__head">
        <span className="quotaWindow__title">{window.title}</span>
        <span className="quotaWindow__value mono">
          {remaining === null ? '—' : `${remaining}%`}
          <span className="quotaWindow__valueHint"> left</span>
        </span>
      </div>
      <div className="quotaWindow__track" aria-hidden>
        <span
          className="quotaWindow__fill"
          style={{ '--fill': `${remaining ?? 0}%` } as CSSProperties}
        />
      </div>
      {reset ? <div className="quotaWindow__reset">{reset}</div> : null}
    </div>
  )
}

interface AgentUsageBodyProps {
  snapshot: AgentUsageSnapshot
  /** Show the 'Live' freshness badge in the header (popover only). */
  live?: boolean
}

/**
 * The Hermes-style account-quota breakdown for one provider: a header with the
 * provider name + plan, then one row per quota window (5h session, weekly limit)
 * showing remaining headroom, a tone-driven bar, and the reset time. Shared by
 * the TopBar popover and the Usage panel so they never drift.
 */
export function AgentUsageBody({ snapshot, live = false }: AgentUsageBodyProps) {
  const detail = describeAgentUsage(snapshot)
  const tone = detail.available ? detail.tone : 'off'

  return (
    <div className={`quotaBody quotaBody--${tone}`}>
      <div className="quotaBody__head">
        <span className="quotaBody__dot" aria-hidden />
        <span className="quotaBody__name">{snapshot.label} usage</span>
        {detail.plan ? <span className="quotaBody__plan">{detail.plan}</span> : null}
        {live && detail.available ? (
          <span className="quotaBody__live">
            <span className="quotaBody__liveDot" aria-hidden />
            Live
          </span>
        ) : null}
      </div>

      {detail.available ? (
        <div className="quotaBody__windows">
          {detail.windows.map((w) => (
            <WindowRow key={w.label} window={w} />
          ))}
        </div>
      ) : (
        <p className="quotaBody__reason">{detail.reason ?? 'Usage unavailable.'}</p>
      )}
    </div>
  )
}
