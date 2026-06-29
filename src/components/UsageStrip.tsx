import { type CSSProperties } from 'react'
import { summarizeAgentUsage, toneFor, type AgentUsagePill } from '@shared/agent-usage'
import type { AgentUsageSnapshot } from '@shared/domain'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'

/** Number of stacked cells in a battery meter. Kept small so each cell stays
 *  crisp at rail scale while still reading as a segmented energy column. */
const SEGMENTS = 7

/** Remaining percent → 0..1 fill for the battery (bottom-up). */
function clampFill(percent: number | null): number {
  if (percent === null) return 0
  return Math.max(0, Math.min(1, percent / 100))
}

function pctText(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`
}

function pctAria(percent: number | null): string {
  return percent === null ? 'not reported' : `${percent}%`
}

/** Compact secondary readout for one window: bare number or an em dash. */
function windowText(percent: number | null): string {
  return percent === null ? '—' : `${percent}`
}

/**
 * A recessed, glassy energy column. Cells are engraved slots; the lowest
 * `fill × SEGMENTS` light up from the bottom and glow from inside, the topmost
 * lit cell softly pulses. Decorative — the percent beside it carries the value.
 */
function SegmentBattery({ percent }: { percent: number | null }) {
  const fill = clampFill(percent)
  const lit = Math.round(fill * SEGMENTS)
  return (
    <span className="battery" aria-hidden>
      <span className="battery__scan" />
      {Array.from({ length: SEGMENTS }, (_, idx) => {
        const fromBottom = SEGMENTS - 1 - idx
        const on = fromBottom < lit
        const crest = on && fromBottom === lit - 1
        return (
          <span
            key={idx}
            className={`battery__cell${on ? ' battery__cell--on' : ''}${crest ? ' battery__cell--crest' : ''}`}
            style={{ '--i': fromBottom } as CSSProperties}
          />
        )
      })}
    </span>
  )
}

/**
 * One provider tile: identity, the binding remaining-quota percentage (the
 * tighter of the 5h / weekly windows), a two-window sub-readout, and the
 * battery. Warm copper for Claude, cool teal for Codex; reds out only when a
 * window is critically low.
 */
function UsageBatteryCard({
  snapshot,
  pill,
  onOpen,
}: {
  snapshot: AgentUsageSnapshot
  pill: AgentUsagePill
  onOpen: () => void
}) {
  const headline = pill.minRemainingPercent
  const tone = pill.available ? toneFor(headline) : 'off'
  const label = snapshot.label
  const ariaLabel = pill.available
    ? `${label} usage. ${pctAria(headline)} quota left. 5 hour window ${pctAria(pill.sessionPercent)}, weekly ${pctAria(pill.weeklyPercent)}. Open details.`
    : `${label} usage unavailable. ${pill.reason ?? 'Open details.'}`

  return (
    <button
      type="button"
      className={`usageCard usageCard--${snapshot.provider} usageCard--${tone}`}
      aria-label={ariaLabel}
      onClick={onOpen}
    >
      <span className="usageCard__top">
        <span className="usageCard__orb" aria-hidden />
        <span className="usageCard__name">{label}</span>
      </span>
      {pill.available ? (
        <>
          <span className="usageCard__body">
            <span className="usageCard__pct mono">{pctText(headline)}</span>
            <SegmentBattery percent={headline} />
          </span>
          <span className="usageCard__sub mono">
            <span>5h {windowText(pill.sessionPercent)}</span>
            <span className="usageCard__dot" aria-hidden>
              ·
            </span>
            <span>7d {windowText(pill.weeklyPercent)}</span>
          </span>
        </>
      ) : (
        <span className="usageCard__offline mono">offline</span>
      )}
    </button>
  )
}

/**
 * Rail-mounted quota dock. Two compact provider tiles sit side by side in the
 * quiet lower-left rail — a minimal "energy battery" read-out of remaining
 * Claude / Codex headroom that stays out of the way of the workspace.
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
      <div className="usageDock__row">
        {pills.map(({ snapshot, pill }) => (
          <UsageBatteryCard
            key={snapshot.provider}
            snapshot={snapshot}
            pill={pill}
            onOpen={() => setView('usage')}
          />
        ))}
      </div>
    </section>
  )
}
