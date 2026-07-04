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

/**
 * A full-circle quota ring: an SVG progress ring whose sweep tracks remaining
 * headroom, painted with a gradient stroke, with the remaining percent set as a
 * large numeral in the center. The reset time + consumed share sit beneath so no
 * information the old bar carried is lost.
 */
function RingGauge({ window }: { window: AgentUsageWindowView }) {
  const rawId = useId().replace(/:/g, '')
  const gradientId = `ring-grad-${rawId}`
  const size = 138
  const stroke = 11
  const radius = (size - stroke) / 2
  const center = size / 2
  const circumference = 2 * Math.PI * radius
  const remaining = window.remainingPercent
  const value = remaining === null ? 0 : Math.max(0, Math.min(100, remaining))
  const offset = circumference * (1 - value / 100)
  const used = remaining === null ? null : 100 - remaining
  const reset = resetLabel(window.resetAt)

  return (
    <div
      className={`ringGauge ringGauge--${window.tone}`}
      style={
        {
          '--ring-circ': circumference,
          '--ring-offset': offset,
        } as CSSProperties
      }
    >
      <div className="ringGauge__dial">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--ring-a)" />
              <stop offset="100%" stopColor="var(--ring-b)" />
            </linearGradient>
          </defs>
          <circle
            className="ringGauge__track"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
          />
          <circle
            className="ringGauge__progress"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        </svg>
        <div className="ringGauge__center">
          <span className="ringGauge__num mono">
            {remaining === null ? '—' : value}
            {remaining === null ? null : <span className="ringGauge__pct">%</span>}
          </span>
          <span className="ringGauge__left">left</span>
        </div>
      </div>
      <div className="ringGauge__meta">
        <span className="ringGauge__title">{window.title}</span>
        {reset ? <span className="ringGauge__reset mono">{reset}</span> : null}
        {used === null ? null : <span className="ringGauge__used mono">{used}% used</span>}
      </div>
    </div>
  )
}

/**
 * The per-engine account-quota card for the Usage panel: an engine glyph header
 * with the plan, then a full ring gauge per quota window (5h session + weekly).
 * Ember reads Claude, glacier reads Codex; warning / critical windows recolor
 * their own ring without touching the card identity.
 */
export function UsageQuotaRings({ snapshot }: { snapshot: AgentUsageSnapshot }) {
  const detail = describeAgentUsage(snapshot)
  const tone = detail.available ? detail.tone : 'off'

  return (
    <div className={`usageRingCard usageRingCard--${snapshot.provider} usageRingCard--${tone}`}>
      <div className="usageRingCard__head">
        <span className="usageRingCard__glyph" aria-hidden>
          {snapshot.label.charAt(0)}
        </span>
        <span className="usageRingCard__name">{snapshot.label} usage</span>
        {detail.plan ? <span className="usageRingCard__plan">{detail.plan}</span> : null}
      </div>
      {detail.available ? (
        <div className="usageRingCard__rings">
          {detail.windows.map((w) => (
            <RingGauge key={w.label} window={w} />
          ))}
        </div>
      ) : (
        <p className="usageRingCard__reason">{detail.reason ?? 'Usage unavailable.'}</p>
      )}
    </div>
  )
}
