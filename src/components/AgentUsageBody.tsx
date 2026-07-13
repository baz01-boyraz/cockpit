import { useId, type CSSProperties } from 'react'
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

function shortResetLabel(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  const diffMs = date.getTime() - Date.now()
  if (diffMs > 0) {
    const diffMin = Math.round(diffMs / 60000)
    if (diffMin < 60) return `Reset in ${diffMin}m`
    const diffHours = Math.round(diffMin / 60)
    if (diffHours < 48) return `Reset in ${diffHours}h`
  }

  return `Resets ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function percentScale(percent: number | null): number {
  if (percent === null) return 0
  return Math.max(0, Math.min(1, percent / 100))
}

function percentValue(percent: number | null): number {
  if (percent === null) return 0
  return Math.max(0, Math.min(100, percent))
}

function primaryWindow(windows: AgentUsageWindowView[]): AgentUsageWindowView | null {
  return windows.reduce<AgentUsageWindowView | null>((current, window) => {
    if (!current) return window
    if (window.remainingPercent === null) return current
    if (current.remainingPercent === null) return window
    return window.remainingPercent < current.remainingPercent ? window : current
  }, null)
}

function QuotaRadial({ window }: { window: AgentUsageWindowView }) {
  const rawId = useId().replace(/:/g, '')
  const value = percentValue(window.remainingPercent)
  const used = Math.round(100 - value)
  const size = 168
  const height = 116
  const center = size / 2
  const arcY = 88
  const radius = 60
  const strokeWidth = 16
  const circumference = Math.PI * radius
  const dashOffset = circumference * (1 - value / 100)
  const angle = -Math.PI + (Math.PI * value) / 100
  const needleRadius = radius - strokeWidth / 2 - 1
  const needleX1 = center + Math.cos(angle) * needleRadius
  const needleY1 = arcY + Math.sin(angle) * needleRadius
  const needleX2 = needleX1 - Math.cos(angle) * 21
  const needleY2 = needleY1 - Math.sin(angle) * 21
  const progressId = `quota-progress-${rawId}`
  const trackId = `quota-track-${rawId}`
  const glowId = `quota-glow-${rawId}`

  return (
    <div
      className={`quotaRadial quotaRadial--${window.tone}`}
      style={
        {
          '--quota-radial-circ': circumference,
          '--quota-radial-offset': dashOffset,
        } as CSSProperties
      }
      aria-label={`${window.title} ${Math.round(value)}% left`}
    >
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} aria-hidden>
        <defs>
          <linearGradient id={trackId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(236, 230, 218, 0.18)" />
            <stop offset="55%" stopColor="rgba(236, 230, 218, 0.28)" />
            <stop offset="100%" stopColor="rgba(236, 230, 218, 0.12)" />
          </linearGradient>
          <linearGradient id={progressId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--provider-2)" />
            <stop offset="54%" stopColor="var(--tone)" />
            <stop offset="100%" stopColor="var(--provider)" />
          </linearGradient>
          <filter id={glowId} x="-40%" y="-60%" width="180%" height="220%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="var(--tone)" floodOpacity="0.28" />
          </filter>
        </defs>
        <path
          className="quotaRadial__inner"
          d={`M ${center - radius + 14} ${arcY} A ${radius - 14} ${radius - 14} 0 0 1 ${
            center + radius - 14
          } ${arcY}`}
          fill="none"
        />
        <path
          className="quotaRadial__track"
          d={`M ${center - radius} ${arcY} A ${radius} ${radius} 0 0 1 ${center + radius} ${arcY}`}
          fill="none"
          stroke={`url(#${trackId})`}
          strokeWidth={strokeWidth}
        />
        <path
          className="quotaRadial__progress"
          d={`M ${center - radius} ${arcY} A ${radius} ${radius} 0 0 1 ${center + radius} ${arcY}`}
          fill="none"
          stroke={`url(#${progressId})`}
          strokeWidth={strokeWidth}
          filter={`url(#${glowId})`}
        />
        <line
          className="quotaRadial__needle"
          x1={needleX1}
          y1={needleY1}
          x2={needleX2}
          y2={needleY2}
        />
      </svg>
      <div className="quotaRadial__value mono">
        {Math.round(value)}
        <span>%</span>
      </div>
      <div className="quotaRadial__caption">
        <span>{window.title}</span>
        <span className="mono">{used}% used</span>
      </div>
      <div className="quotaRadial__labels mono" aria-hidden>
        <span>0%</span>
        <span>100%</span>
      </div>
    </div>
  )
}

function QuotaRadialStat({ window }: { window: AgentUsageWindowView }) {
  const remaining = window.remainingPercent
  const reset = shortResetLabel(window.resetAt)
  const used = remaining === null ? null : 100 - remaining

  return (
    <div className={`quotaRadialStat quotaRadialStat--${window.tone}`}>
      <span className="quotaRadialStat__rail" aria-hidden />
      <div>
        <span className="quotaRadialStat__title">{window.title}</span>
        {reset ? <span className="quotaRadialStat__reset">{reset}</span> : null}
      </div>
      <div className="quotaRadialStat__value mono">
        {remaining === null ? '—' : `${remaining}%`}
        <span> left</span>
      </div>
      <div className="quotaRadialStat__track" aria-hidden>
        <span
          className="quotaRadialStat__fill"
          style={{ '--scale': percentScale(remaining) } as CSSProperties}
        />
      </div>
      {used === null ? null : <div className="quotaRadialStat__used mono">{used}% used</div>}
    </div>
  )
}

function WindowRow({ window }: { window: AgentUsageWindowView }) {
  const remaining = window.remainingPercent
  const reset = resetLabel(window.resetAt)
  const used = remaining === null ? null : 100 - remaining
  return (
    <div className={`quotaWindow quotaWindow--${window.tone}`}>
      <span className="quotaWindow__glow" aria-hidden />
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
          style={{ '--scale': percentScale(remaining) } as CSSProperties}
        />
      </div>
      <div className="quotaWindow__meta">
        {reset ? <span className="quotaWindow__reset">{reset}</span> : <span />}
        {used === null ? null : <span className="quotaWindow__used mono">{used}% used</span>}
      </div>
    </div>
  )
}

interface AgentUsageBodyProps {
  snapshot: AgentUsageSnapshot
  /** Show the 'Live' freshness badge in the header (popover only). */
  live?: boolean
  /** Compact radial layout for the rail hover card; bar rows remain the panel default. */
  variant?: 'bars' | 'radial'
}

/**
 * The account-quota breakdown for one provider: a header with the
 * provider name + plan, then one row per quota window (5h session, weekly limit)
 * showing remaining headroom, a tone-driven bar, and the reset time. Shared by
 * the TopBar popover and the Usage panel so they never drift.
 */
export function AgentUsageBody({ snapshot, live = false, variant = 'bars' }: AgentUsageBodyProps) {
  const detail = describeAgentUsage(snapshot)
  const tone = detail.available ? detail.tone : 'off'
  const radialWindow = primaryWindow(detail.windows)

  return (
    <div className={`quotaBody quotaBody--${tone} quotaBody--${snapshot.provider} quotaBody--${variant}`}>
      <span className="quotaBody__wash" aria-hidden />
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

      {detail.available && variant === 'radial' && radialWindow ? (
        <div className="quotaBody__radial">
          <QuotaRadial window={radialWindow} />
          <div className="quotaRadialStats">
            {detail.windows.map((w) => (
              <QuotaRadialStat key={w.label} window={w} />
            ))}
          </div>
        </div>
      ) : detail.available ? (
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
