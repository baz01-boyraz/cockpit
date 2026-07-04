import type { CSSProperties } from 'react'
import type { AgentUsageSnapshot } from '@shared/domain'
import { useAgentUsage } from '../../lib/useAgentUsage'

/** Consumed share of the provider's busiest quota window, 0–100+ (rounded). */
function highestUsedPercent(snapshot: AgentUsageSnapshot): number | null {
  const used = snapshot.windows
    .map((w) => w.usedPercent)
    .filter((v) => Number.isFinite(v))
  if (used.length === 0) return null
  return Math.round(Math.max(...used))
}

/** ≥80% used tints warning; ≥100% escalates. Below that the chip stays quiet. */
function chipTone(used: number): string {
  if (used >= 100) return 'chip--danger'
  if (used >= 80) return 'chip--warning'
  return ''
}

/**
 * Compact per-provider quota chips for the board header (VISION 6.4):
 * provider label + its busiest window's consumed percent. Awareness only —
 * the swarm never throttles on these; the pilot decides whether to start
 * another worker. Rendered from the same polled snapshot as the TopBar strip.
 */
export function SwarmUsageChips() {
  const snapshots = useAgentUsage()
  if (!snapshots) return null

  const chips = snapshots.flatMap((snapshot) => {
    if (!snapshot.available) return []
    const used = highestUsedPercent(snapshot)
    if (used === null) return []
    return [{ provider: snapshot.provider, label: snapshot.label, used }]
  })
  if (chips.length === 0) return null

  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.provider}
          className={`chip swarmUsageChip swarmUsageChip--${chip.provider} ${chipTone(chip.used)}`}
          title={`${chip.label} — busiest quota window ${chip.used}% used`}
        >
          <span className="swarmUsageChip__dot" aria-hidden />
          {chip.label}
          <span
            className="swarmUsageChip__gauge"
            aria-hidden
            style={{ '--gauge': `${Math.min(chip.used, 100)}%` } as CSSProperties}
          >
            <span className="swarmUsageChip__fill" />
          </span>
          <span className="mono swarmUsageChip__pct">{chip.used}%</span>
        </span>
      ))}
    </>
  )
}
