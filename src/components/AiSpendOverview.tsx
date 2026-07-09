import { useId, type CSSProperties } from 'react'
import type { AgentUsageSnapshot, OpenRouterUsageSnapshot } from '@shared/domain'
import { summarizeAgentUsage, toneFor, type UsageTone } from '@shared/agent-usage'
import { useAgentUsage } from '../lib/useAgentUsage'
import { useOpenRouterUsage } from '../lib/useOpenRouterUsage'

/**
 * One engine's line in the AI spend overview, normalized across the two very
 * different billing shapes the cockpit tracks: Claude/Codex are flat CLI
 * subscriptions (we surface remaining *capacity*, never a per-token price),
 * while OpenRouter/Hermes is pay-as-you-go (real dollars). The ring reads the
 * one percent that engine reports; the readout carries the headline the ring
 * can't spell out (a dollar balance, a plan, or an honest empty state).
 */
interface SpendEngine {
  provider: 'claude' | 'codex' | 'hermes'
  name: string
  /** 'Subscription' vs 'Pay-as-you-go' — the billing model, stated plainly. */
  kind: string
  /** True when the engine reported live data. */
  available: boolean
  /** Percent the ring fills to (remaining quota, or remaining credit). */
  ringPercent: number | null
  tone: UsageTone | 'off'
  /** The headline figure: '89%', '$12.40', or a short empty phrase. */
  value: string
  /** Quiet context beneath the value (plan, model, or a next step). */
  caption: string
}

function subscriptionEngine(snapshot: AgentUsageSnapshot): SpendEngine {
  const pill = summarizeAgentUsage(snapshot)
  const provider = snapshot.provider === 'codex' ? 'codex' : 'claude'
  if (!pill.available) {
    return {
      provider,
      name: snapshot.label,
      kind: 'Subscription',
      available: false,
      ringPercent: null,
      tone: 'off',
      value: 'Offline',
      caption: pill.reason ?? 'CLI not signed in',
    }
  }
  const min = pill.minRemainingPercent
  return {
    provider,
    name: snapshot.label,
    kind: 'Subscription',
    available: true,
    ringPercent: min,
    tone: toneFor(min),
    value: min === null ? '—' : `${min}%`,
    caption: pill.plan ? `${pill.plan} · quota left` : 'quota left',
  }
}

function hermesEngine(snapshot: OpenRouterUsageSnapshot | null): SpendEngine {
  const available = snapshot?.available ?? false
  if (!available || !snapshot) {
    return {
      provider: 'hermes',
      name: 'Hermes',
      kind: 'Pay-as-you-go',
      available: false,
      ringPercent: null,
      tone: 'off',
      value: 'Not connected',
      caption: snapshot?.reason ?? 'Add an OpenRouter key in Settings',
    }
  }
  // Pure pay-as-you-go accounts have no purchased-credit total, so a percent
  // isn't meaningful — the ring reads full rather than falsely empty.
  const ringPercent = snapshot.remainingPercent ?? 100
  const value =
    snapshot.remainingUsd !== null
      ? `$${snapshot.remainingUsd.toFixed(2)}`
      : snapshot.remainingPercent !== null
        ? `${snapshot.remainingPercent}%`
        : '—'
  return {
    provider: 'hermes',
    name: 'Hermes',
    kind: 'Pay-as-you-go',
    available: true,
    ringPercent,
    tone: toneFor(snapshot.remainingPercent),
    value,
    caption: 'OpenRouter credit left',
  }
}

/** The one true metered figure: OpenRouter credit consumed (total − remaining). */
function meteredTotal(snapshot: OpenRouterUsageSnapshot | null): {
  value: string
  label: string
  sub: string
} {
  if (!snapshot?.available) {
    return { value: '—', label: 'Metered spend', sub: 'OpenRouter not connected' }
  }
  if (snapshot.totalUsd !== null && snapshot.remainingUsd !== null) {
    const spent = Math.max(0, snapshot.totalUsd - snapshot.remainingUsd)
    return {
      value: `$${spent.toFixed(2)}`,
      label: 'Metered spend',
      sub: `of $${snapshot.totalUsd.toFixed(2)} OpenRouter credit`,
    }
  }
  if (snapshot.remainingUsd !== null) {
    return {
      value: `$${snapshot.remainingUsd.toFixed(2)}`,
      label: 'Credit balance',
      sub: 'pay-as-you-go · no cap to meter',
    }
  }
  return { value: '—', label: 'Metered spend', sub: 'no balance reported' }
}

const RING_SIZE = 46
const RING_STROKE = 4
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CENTER = RING_SIZE / 2
const RING_CIRC = 2 * Math.PI * RING_RADIUS

/** A compact donut echoing the strip's engine cores: identity tone per engine,
 *  the engine's mark seated in the center, recolored amber/red as headroom runs
 *  low, empty track when there's nothing to gauge. The headline figure lives in
 *  the row's own text, so the ring stays a pure capacity gauge. */
function SpendRing({
  percent,
  tone,
  glyph,
}: {
  percent: number | null
  tone: UsageTone | 'off'
  glyph: string
}) {
  const rawId = useId().replace(/:/g, '')
  const gradientId = `spend-grad-${rawId}`
  const value = percent === null ? 0 : Math.max(0, Math.min(100, percent))
  const offset = RING_CIRC * (1 - value / 100)
  return (
    <span className={`spendRing spendRing--${tone}`} aria-hidden>
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--ring-a)" />
            <stop offset="100%" stopColor="var(--ring-b)" />
          </linearGradient>
        </defs>
        <circle
          className="spendRing__track"
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
        />
        {percent === null ? null : (
          <circle
            className="spendRing__fill"
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
            style={{ '--ring-circ': RING_CIRC } as CSSProperties}
          />
        )}
      </svg>
      <span className="spendRing__glyph">{glyph}</span>
    </span>
  )
}

function SpendEngineRow({ engine }: { engine: SpendEngine }) {
  return (
    <li
      className={`spendEngine spendEngine--${engine.provider} spendEngine--${engine.tone} ${
        engine.available ? '' : 'spendEngine--muted'
      }`}
    >
      <SpendRing
        percent={engine.ringPercent}
        tone={engine.tone}
        glyph={engine.name.charAt(0).toUpperCase()}
      />
      <div className="spendEngine__body">
        <div className="spendEngine__head">
          <span className="spendEngine__name">{engine.name}</span>
          <span className="spendEngine__kind">{engine.kind}</span>
        </div>
        <div className="spendEngine__readout">
          <span className="spendEngine__value mono">{engine.value}</span>
          <span className="spendEngine__cap">{engine.caption}</span>
        </div>
      </div>
    </li>
  )
}

/**
 * Unified "AI spend" overview for the Usage panel — the one screen answering
 * "what is my total AI cost right now" across every engine the cockpit drives.
 * Composes the existing live sources (useAgentUsage for the Claude/Codex CLI
 * subscriptions + useOpenRouterUsage for the Hermes pay-as-you-go key) into a
 * single roll-up: a metered-spend headline plus an honest per-engine breakdown.
 * It invents no price for the flat subscriptions and shows a quiet
 * "not connected" state when no OpenRouter key is present, rather than a zero
 * that reads like data.
 */
export function AiSpendOverview() {
  const snapshots = useAgentUsage()
  const openRouter = useOpenRouterUsage()

  // Both sources still cold — a calm loading card beats a flash of empty rows.
  if (snapshots === null && openRouter === null) {
    return (
      <div className="card spend spend--loading">
        <div className="card__head">
          <div className="card__title">AI spend</div>
          <span className="chip">reading engines…</span>
        </div>
        <div className="spend__skeleton" aria-hidden />
      </div>
    )
  }

  const subscriptions = (snapshots ?? []).map(subscriptionEngine)
  const hermes = hermesEngine(openRouter)
  const engines: SpendEngine[] = [...subscriptions, hermes]
  const total = meteredTotal(openRouter)

  const onlineCount = engines.filter((e) => e.available).length
  const totalCount = engines.length

  return (
    <div className="card spend">
      <div className="card__head">
        <div className="card__title">AI spend</div>
        <span className="chip">
          {onlineCount}/{totalCount} engines live
        </span>
      </div>

      <div className="spend__summary">
        <div className="spend__total">
          <span className="spend__totalLabel">{total.label}</span>
          <span className="spend__totalValue mono">{total.value}</span>
          <span className="spend__totalSub mono">{total.sub}</span>
        </div>
        <p className="spend__note">
          Claude and Codex run on flat subscription plans — the cockpit tracks their remaining
          capacity, not a per-token price. Only Hermes (OpenRouter) meters spend by usage.
        </p>
      </div>

      <ul className="spend__engines">
        {engines.map((engine) => (
          <SpendEngineRow key={engine.provider} engine={engine} />
        ))}
      </ul>
    </div>
  )
}
