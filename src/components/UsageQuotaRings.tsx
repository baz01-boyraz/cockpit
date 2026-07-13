import { useId, type CSSProperties } from 'react'
import type { AgentUsageSnapshot } from '@shared/domain'
import { describeAgentUsage, toneFor, type UsageTone } from '@shared/agent-usage'

/**
 * Capacity instruments for the Usage command center.
 *
 * One ring primitive (`CapacityRing`) drives every gauge on the page — a
 * Claude/Codex quota window or the OpenRouter credit line — so the whole hero reads
 * as a single matched instrument cluster instead of two lookalike card rows.
 * `SubscriptionCapacity` wraps the two windows of a flat CLI plan into one
 * per-engine module; the OpenRouter ($) module is composed in AiSpendOverview from
 * the same `CapacityRing`.
 */

export type CapacityTone = UsageTone | 'off'

const STATUS_LABEL: Record<CapacityTone, string> = {
  healthy: 'Healthy',
  warning: 'Low',
  critical: 'Critical',
  off: 'Unavailable',
}

/** Short relative reset, e.g. 'resets 2h' / 'resets 3d'. Null when unknown. */
function resetShort(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const ms = t - Date.now()
  if (ms <= 0) return 'resetting'
  const hours = ms / 3_600_000
  if (hours < 1) return `resets ${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 48) return `resets ${Math.round(hours)}h`
  return `resets ${Math.round(hours / 24)}d`
}

interface CapacityRingProps {
  /** Remaining headroom 0–100, or null when the engine doesn't report it. */
  percent: number | null
  tone: CapacityTone
  /** The window / line name beneath the dial, e.g. '5h session' or 'Credit'. */
  label: string
  /** Quiet context under the label — a reset time or a dollar balance. */
  sub?: string | null
  /** Outer diameter in px. The hero uses ~104; larger callers can scale up. */
  size?: number
}

/**
 * A single capacity dial: an SVG progress ring whose sweep tracks remaining
 * headroom, a large center numeral, and a two-line caption beneath. The stroke
 * gradient (`--ring-a/--ring-b`) is inherited from the engine module so the ring
 * carries the engine's identity color when healthy, escalating to amber/red as
 * headroom runs low.
 */
export function CapacityRing({ percent, tone, label, sub, size = 104 }: CapacityRingProps) {
  const rawId = useId().replace(/:/g, '')
  const gradientId = `cap-grad-${rawId}`
  const stroke = size >= 120 ? 11 : 9
  const radius = (size - stroke) / 2
  const center = size / 2
  const circ = 2 * Math.PI * radius
  const value = percent === null ? 0 : Math.max(0, Math.min(100, Math.round(percent)))
  const offset = circ * (1 - value / 100)

  return (
    <div
      className={`capRing capRing--${tone}`}
      style={{ '--ring-circ': circ, '--ring-size': `${size}px` } as CSSProperties}
    >
      <div className="capRing__dial">
        <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--ring-a)" />
              <stop offset="100%" stopColor="var(--ring-b)" />
            </linearGradient>
          </defs>
          <circle
            className="capRing__track"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
          />
          {percent === null ? null : (
            <circle
              className="capRing__progress"
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          )}
        </svg>
        <div className="capRing__center">
          <span className="capRing__num mono">
            {percent === null ? '—' : value}
            {percent === null ? null : <span className="capRing__pct">%</span>}
          </span>
          <span className="capRing__left">left</span>
        </div>
      </div>
      <div className="capRing__meta">
        <span className="capRing__label">{label}</span>
        {sub ? <span className="capRing__sub mono">{sub}</span> : null}
      </div>
    </div>
  )
}

/** Shared header for every engine module — glyph, name/kind, status pill. */
export function CapacityHead({
  glyph,
  name,
  kind,
  tone,
  statusLabel,
}: {
  glyph: string
  name: string
  kind: string
  tone: CapacityTone
  statusLabel?: string
}) {
  return (
    <header className="capEngine__head">
      <span className="capEngine__glyph" aria-hidden>
        {glyph}
      </span>
      <span className="capEngine__id">
        <span className="capEngine__name">{name}</span>
        <span className="capEngine__kind">{kind}</span>
      </span>
      <span className={`capEngine__status capEngine__status--${tone}`}>
        {statusLabel ?? STATUS_LABEL[tone]}
      </span>
    </header>
  )
}

/**
 * One flat-subscription engine (Claude / Codex) as a single capacity module:
 * an identity header plus a full quota ring for each window (5h session +
 * weekly). Ember reads Claude, glacier reads Codex; a warning / critical window
 * recolors its own ring without touching the module's identity. When the CLI
 * isn't signed in the module states that plainly rather than drawing empty rings.
 */
export function SubscriptionCapacity({ snapshot }: { snapshot: AgentUsageSnapshot }) {
  const detail = describeAgentUsage(snapshot)
  const tone: CapacityTone = detail.available ? detail.tone : 'off'

  return (
    <article className={`capEngine capEngine--${snapshot.provider} capEngine--${tone}`}>
      <CapacityHead
        glyph={snapshot.label.charAt(0)}
        name={snapshot.label}
        kind={detail.plan ? `Subscription · ${detail.plan}` : 'Subscription'}
        tone={tone}
        statusLabel={detail.telemetryLabel}
      />
      {detail.available ? (
        <div className="capEngine__rings">
          {detail.windows.map((w) => (
            <CapacityRing
              key={w.label}
              percent={w.remainingPercent}
              tone={w.tone}
              label={w.title}
              sub={resetShort(w.resetAt)}
            />
          ))}
        </div>
      ) : (
        <p className="capEngine__reason">{detail.reason ?? 'CLI not signed in.'}</p>
      )}
    </article>
  )
}

/** Re-exported so the OpenRouter module can tint its ring from a raw percent. */
export { toneFor }
