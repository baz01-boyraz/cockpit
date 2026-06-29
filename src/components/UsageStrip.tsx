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
 * One engine core: the provider's 3D logo acting as a quota battery, seated on a
 * soft "thruster" halo (light, never a box), with its name + a health-telemetry
 * status dot and the binding remaining percent. Identity color (ember / teal)
 * stays constant; the status dot escalates amber → red as the engine runs low.
 */
function EngineCore({
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
    ? `${label} engine. ${pctAria(headline)} quota left. 5 hour window ${pctAria(pill.sessionPercent)}, weekly ${pctAria(pill.weeklyPercent)}. Open details.`
    : `${label} engine offline. ${pill.reason ?? 'Open details.'}`

  return (
    <button
      type="button"
      className={`engineCore engineCore--${snapshot.provider} engineCore--${tone}`}
      aria-label={ariaLabel}
      onClick={onOpen}
    >
      <span className="engineCore__stage">
        <LogoMeter src={logo} percent={pill.available ? headline : null} />
      </span>
      <span className="engineCore__meta">
        <span className="engineCore__name">
          <span className="engineCore__dot" aria-hidden />
          {label}
        </span>
        {pill.available ? (
          <span className="engineCore__pct mono">{pctText(headline)}</span>
        ) : (
          <span className="engineCore__offline mono">offline</span>
        )}
      </span>
    </button>
  )
}

/**
 * The Engine Bay — the cockpit's lower-left power section. Drops the old panel
 * box entirely: an "Engines" eyebrow with a live telemetry readout heads a row
 * of engine cores, each provider's 3D logo doubling as its quota battery,
 * seated on its own thruster halo. Floats in the rail on light, not chrome.
 */
export function UsageStrip() {
  const setView = useStore((s) => s.setView)
  const snapshots = useAgentUsage()

  if (!snapshots) return null

  const pills = snapshots.map((snapshot) => ({ snapshot, pill: summarizeAgentUsage(snapshot) }))
  // Hide the bay entirely only when nothing is connected and nothing to say.
  if (pills.every(({ pill }) => !pill.available && !pill.reason)) return null

  const onlineCount = pills.filter(({ pill }) => pill.available).length
  const worstRemaining = pills.reduce<number | null>((acc, { pill }) => {
    if (!pill.available || pill.minRemainingPercent === null) return acc
    return acc === null ? pill.minRemainingPercent : Math.min(acc, pill.minRemainingPercent)
  }, null)
  const bayTone = onlineCount === 0 ? 'off' : toneFor(worstRemaining)

  return (
    <section className={`engineBay engineBay--${bayTone}`} aria-label="AI engines">
      <header className="engineBay__head">
        <span className="engineBay__title">Engines</span>
        <span className="engineBay__rule" aria-hidden />
        <span
          className="engineBay__live mono"
          aria-label={`${onlineCount} of ${pills.length} engines online`}
        >
          <span className="engineBay__liveDot" aria-hidden />
          {onlineCount}/{pills.length}
        </span>
      </header>
      <div className="engineBay__cores">
        {pills.map(({ snapshot, pill }) => (
          <EngineCore
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
