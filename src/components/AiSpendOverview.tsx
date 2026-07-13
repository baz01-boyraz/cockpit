import type { OpenRouterUsageSnapshot } from '@shared/domain'
import { useAgentUsage } from '../lib/useAgentUsage'
import { useOpenRouterUsage } from '../lib/useOpenRouterUsage'
import {
  CapacityHead,
  CapacityRing,
  SubscriptionCapacity,
  toneFor,
  type CapacityTone,
} from './UsageQuotaRings'

/**
 * The Usage command center's hero — the single zone answering "what am I burning
 * and what's left?" across every engine the cockpit drives. It fuses two things
 * that used to be two lookalike card rows: the Claude/Codex remaining *capacity*
 * (flat CLI subscriptions, surfaced as quota rings, never a fake per-token price)
 * and the Council/OpenRouter metered *spend* (the one real dollar line). A slim
 * ledger folds the project's local activity beneath, so the old stat grid's
 * numbers stay reachable without a second competing card.
 */

/** Project-local activity, folded into the hero ledger from the usage summary. */
export interface ActivityLedger {
  sessions: number
  commands: number
  tasks: number
  tokens: number | null
}

function fmtTokens(n: number | null): string {
  if (n == null || n === 0) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

/**
 * The OpenRouter credit module — the only engine that meters real dollars. A single
 * credit ring beside the headline metered-spend figure (total − remaining), with
 * an honest "not connected" state when no OpenRouter key is present rather than a
 * zero that reads like data.
 */
function OpenRouterCapacity({ snapshot }: { snapshot: OpenRouterUsageSnapshot | null }) {
  const available = snapshot?.available ?? false

  if (!available || !snapshot) {
    return (
      <article className="capEngine capEngine--hermes capEngine--off">
        <CapacityHead
          glyph="OR"
          name="OpenRouter"
          kind="Council"
          tone="off"
          statusLabel="Credit unavailable"
        />
        <p className="capEngine__reason">
          {snapshot?.reason ?? 'Add an OpenRouter key in Settings to meter spend.'}
        </p>
      </article>
    )
  }

  // Uncapped keys have no percentage denominator, so a full ring plus an
  // explicit "no cap" label is more honest than an empty or unavailable ring.
  const remainingPct = snapshot.remainingPercent ?? 100
  const tone: CapacityTone = toneFor(snapshot.remainingPercent)
  const hasCap = snapshot.totalUsd !== null && snapshot.remainingUsd !== null
  const spent = snapshot.usageUsd

  const spendValue =
    spent !== null
      ? `$${spent.toFixed(2)}`
      : snapshot.usageUsd !== null
        ? `$${snapshot.usageUsd.toFixed(2)}`
        : '—'
  const spendLabel = 'Key usage'
  const spendSub =
    hasCap
      ? `of $${snapshot.totalUsd!.toFixed(2)} key limit`
      : 'unlimited key · no cap'
  const ringSub = snapshot.unlimited
    ? 'no key cap'
    : snapshot.remainingUsd !== null
      ? `$${snapshot.remainingUsd.toFixed(2)} left`
      : null

  return (
    <article className={`capEngine capEngine--hermes capEngine--${tone}`}>
      <CapacityHead glyph="OR" name="OpenRouter" kind="Council" tone={tone} />
      <div className="capEngine__credit">
        <CapacityRing percent={remainingPct} tone={tone} label="Limit" sub={ringSub} />
        <div className="capEngine__spend">
          <span className="capEngine__spendLabel">{spendLabel}</span>
          <span className="capEngine__spendValue mono">{spendValue}</span>
          <span className="capEngine__spendSub mono">{spendSub}</span>
        </div>
      </div>
    </article>
  )
}

export function AiSpendOverview({ ledger }: { ledger: ActivityLedger }) {
  const snapshots = useAgentUsage()
  const openRouter = useOpenRouterUsage()

  // Both sources still cold — a calm loading hero beats a flash of empty rings.
  if (snapshots === null && openRouter === null) {
    return (
      <section className="capacity card">
        <div className="capacity__head">
          <div>
            <div className="eyebrow">capacity · live</div>
            <h3 className="capacity__title">Engines &amp; spend</h3>
          </div>
          <span className="chip">reading engines…</span>
        </div>
        <div className="capacity__skeleton" aria-hidden />
      </section>
    )
  }

  const subscriptions = snapshots ?? []
  const reportingCount =
    subscriptions.filter((s) => s.available).length + (openRouter?.available ? 1 : 0)
  const totalCount = subscriptions.length + 1

  return (
    <section className="capacity card fade-rise">
      <div className="capacity__head">
        <div>
          <div className="eyebrow">capacity · live</div>
          <h3 className="capacity__title">Engines &amp; spend</h3>
        </div>
        <span className="chip">
          {reportingCount}/{totalCount} meters reporting
        </span>
      </div>

      <div className="capacity__engines">
        {subscriptions.map((snapshot) => (
          <SubscriptionCapacity key={snapshot.provider} snapshot={snapshot} />
        ))}
        <OpenRouterCapacity snapshot={openRouter} />
      </div>

      <footer className="capacity__ledger">
        <span className="capacity__ledgerLabel">this project · local activity</span>
        <ul className="capacity__ledgerList">
          <li className="capacity__ledgerItem">
            <b>{ledger.tasks}</b> agent tasks
          </li>
          <li className="capacity__ledgerItem">
            <b>{fmtTokens(ledger.tokens)}</b> est. tokens
          </li>
          <li className="capacity__ledgerItem">
            <b>{ledger.sessions}</b> sessions
          </li>
          <li className="capacity__ledgerItem">
            <b>{ledger.commands}</b> commands
          </li>
        </ul>
      </footer>
    </section>
  )
}
