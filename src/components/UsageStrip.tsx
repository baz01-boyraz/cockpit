import { type CSSProperties } from 'react'
import { summarizeAgentUsage, toneFor, type AgentUsagePill } from '@shared/agent-usage'
import type { AgentUsageSnapshot } from '@shared/domain'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'
import claudeLogo from '../assets/usage/claude.png'
import codexLogo from '../assets/usage/codex.png'

/** Each provider's 3D logo doubles as its battery. The logo's lower
 *  `remaining%` renders in full color; the spent upper part desaturates. */
const PROVIDER_LOGOS: Record<string, string> = {
  claude: claudeLogo,
  codex: codexLogo,
}

function pctText(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`
}

function pctAria(percent: number | null): string {
  return percent === null ? 'not reported' : `${percent}%`
}

/** Remaining-quota percent clamped to 0..100 for the fill height. */
function clampPercent(percent: number | null): number {
  if (percent === null) return 0
  return Math.max(0, Math.min(100, percent))
}

/**
 * The logo-as-battery. Two stacked copies of the provider's 3D logo: a spent
 * base layer (desaturated, dimmed) reads as depleted quota, and a full-color
 * copy clipped to the bottom `remaining%` rises over it from the floor. A thin
 * tone-lit crest skims the fill line. Decorative — the percent beneath carries
 * the value.
 */
function LogoMeter({ src, percent }: { src: string; percent: number | null }) {
  const fill = clampPercent(percent)
  const clipTop = 100 - fill
  return (
    <span className="logoMeter" aria-hidden>
      <img className="logoMeter__base" src={src} alt="" draggable={false} />
      <img
        className="logoMeter__fill"
        src={src}
        alt=""
        draggable={false}
        style={{ clipPath: `inset(${clipTop}% 0 0 0)` } as CSSProperties}
      />
      {fill > 0 && fill < 100 ? (
        <span className="logoMeter__crest" style={{ top: `${clipTop}%` }} />
      ) : null}
    </span>
  )
}

/**
 * One provider tile: its 3D logo acting as a quota battery, with the binding
 * remaining percentage (the tighter of the 5h / weekly windows) beneath it.
 * The logo reds out via its tone glow only when a window is critically low; the
 * whole tile dims when the provider is offline.
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
  const logo = PROVIDER_LOGOS[snapshot.provider]
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
      <LogoMeter src={logo} percent={pill.available ? headline : null} />
      {pill.available ? (
        <span className="usageCard__pct mono">{pctText(headline)}</span>
      ) : (
        <span className="usageCard__offline mono">offline</span>
      )}
    </button>
  )
}

/**
 * Rail-mounted quota dock. Two compact provider tiles sit side by side in the
 * quiet lower-left rail — each provider's 3D logo doubling as an "energy
 * battery" read-out of remaining Claude / Codex headroom, out of the way of the
 * workspace.
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
