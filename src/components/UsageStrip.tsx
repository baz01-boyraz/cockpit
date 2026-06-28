import { type CSSProperties } from 'react'
import { summarizeAgentUsage } from '@shared/agent-usage'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'
import { AgentUsageBody } from './AgentUsageBody'

const CELL_COUNT = 12

function percentText(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`
}

function percentAria(percent: number | null): string {
  return percent === null ? 'not reported' : `${percent}%`
}

/**
 * Map a remaining-percent into a 0..CELL_COUNT filled-cell count. We always
 * light at least one cell for any non-zero reading so a low-but-alive window
 * never reads as fully empty.
 */
function filledCells(percent: number | null): number {
  if (percent === null || percent <= 0) return 0
  return Math.max(1, Math.min(CELL_COUNT, Math.round((percent / 100) * CELL_COUNT)))
}

/** A segmented battery meter: filled cells + a glowing leading edge. */
function BatteryMeter({ tag, percent }: { tag: string; percent: number | null }) {
  const filled = filledCells(percent)
  return (
    <div className="batRow">
      <span className="batRow__tag">{tag}</span>
      <span className="batRow__cells" aria-hidden>
        {Array.from({ length: CELL_COUNT }, (_, i) => {
          const on = i < filled
          const lead = on && i === filled - 1
          return (
            <span
              key={i}
              className={`batCell${on ? ' batCell--on' : ''}${lead ? ' batCell--lead' : ''}`}
              style={{ '--i': i } as CSSProperties}
            />
          )
        })}
      </span>
      <span className="batRow__pct mono">{percentText(percent)}</span>
    </div>
  )
}

/**
 * Rail-mounted quota dock. A premium "battery cell" read-out: each provider is
 * a card with a segmented 5h + weekly meter, so quota headroom is legible at a
 * glance in the quiet lower-left rail without crowding the topbar.
 */
export function UsageStrip() {
  const setView = useStore((s) => s.setView)
  const snapshots = useAgentUsage()

  if (!snapshots) return null

  const pills = snapshots.map((snapshot) => ({ snapshot, pill: summarizeAgentUsage(snapshot) }))
  // Hide the strip entirely only when nothing is connected and nothing to say.
  if (pills.every(({ pill }) => !pill.available && !pill.reason)) return null

  return (
    <section className="usageDock" aria-label="Agent usage">
      <div className="usageDock__head">
        <span className="usageDock__eyebrow">Usage</span>
        <button type="button" className="usageDock__details" onClick={() => setView('usage')}>
          Details
        </button>
      </div>
      {pills.map(({ snapshot, pill }) => {
        const tone = pill.available ? pill.tone : 'off'
        const label = pill.plan ? `${snapshot.label} · ${pill.plan}` : snapshot.label
        const ariaLabel = pill.available
          ? `${label} usage. 5 hour window ${percentAria(pill.sessionPercent)} left. Weekly window ${percentAria(pill.weeklyPercent)} left. Open dashboard.`
          : `${label} usage unavailable. ${pill.reason ?? 'Open dashboard.'}`
        return (
          <div key={snapshot.provider} className="usageDock__itemWrap">
            <button
              type="button"
              className={`usageDock__item usageDock__item--${snapshot.provider} usageDock__item--${tone}`}
              aria-label={ariaLabel}
              onClick={() => setView('usage')}
            >
              <span className="usageDock__rail" aria-hidden />
              <span className="usageDock__identity">
                <span className="usageDock__orb" aria-hidden />
                <span className="usageDock__label">{snapshot.label}</span>
                {pill.plan ? <span className="usageDock__plan">{pill.plan}</span> : null}
              </span>
              {pill.available ? (
                <span className="usageDock__meters">
                  <BatteryMeter tag="5h" percent={pill.sessionPercent} />
                  <BatteryMeter tag="7d" percent={pill.weeklyPercent} />
                </span>
              ) : (
                <span className="usageDock__state mono" aria-hidden>
                  offline
                </span>
              )}
            </button>
            <div className="usageDock__pop" role="tooltip">
              <AgentUsageBody snapshot={snapshot} live variant="bars" />
            </div>
          </div>
        )
      })}
    </section>
  )
}
