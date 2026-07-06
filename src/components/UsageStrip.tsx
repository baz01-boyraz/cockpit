import { type CSSProperties } from 'react'
import { summarizeAgentUsage, toneFor, type AgentUsagePill } from '@shared/agent-usage'
import type { AgentUsageSnapshot, OpenRouterUsageSnapshot } from '@shared/domain'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'
import { useOpenRouterUsage } from '../lib/useOpenRouterUsage'
import claudeLogo from '../assets/usage/claude.png'
import codexLogo from '../assets/usage/codex.png'
import hermesAvatar from '../assets/hermes/avatar.png'

/** Each provider's 3D logo stays pristine and full-color; a thin quota ring
 *  hugging it reads the remaining level, so the mark itself never dims. */
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
 * The provider's 3D logo, kept crisp and full-color, ringed by a slim quota
 * gauge. A conic arc sweeps clockwise from 12 o'clock to `remaining%` in the
 * engine's tone over a faint spent-track; the logo itself never desaturates.
 * Decorative — the percent beneath carries the exact value.
 */
function LogoMeter({
  src,
  percent,
  avatar,
}: {
  src: string
  percent: number | null
  /** Hermes's mark is a face portrait, not a centered logo — crop it round. */
  avatar?: boolean
}) {
  const fill = clampPercent(percent)
  return (
    <span className="logoMeter" aria-hidden>
      <span className="logoMeter__ring" style={{ '--fill': fill } as CSSProperties} />
      <img
        className={`logoMeter__logo ${avatar ? 'logoMeter__logo--avatar' : ''}`}
        src={src}
        alt=""
        draggable={false}
      />
    </span>
  )
}

/** '62%' when OpenRouter reports a purchased-credit share, else the raw '$12.40'
 *  balance (a pure pay-as-you-go account has no total to take a percent of). */
function hermesDisplay(snapshot: OpenRouterUsageSnapshot | null): string {
  if (!snapshot?.available) return '—'
  if (snapshot.remainingPercent !== null) return `${snapshot.remainingPercent}%`
  if (snapshot.remainingUsd !== null) return `$${snapshot.remainingUsd.toFixed(2)}`
  return '—'
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
 * Hermes's own engine core: the OpenRouter key it runs DeepSeek calls through,
 * ringed the same way Claude/Codex are — but in a premium white/platinum tone
 * (set purely via --provider/--provider-hi; the halo, ring, and glow math is
 * identical to the other engines) instead of ember/glacier. Opens the Hermes
 * chat panel instead of the Usage tab.
 */
function HermesEngineCore({
  snapshot,
  onOpen,
}: {
  snapshot: OpenRouterUsageSnapshot | null
  onOpen: () => void
}) {
  const available = snapshot?.available ?? false
  // No total-credit percent on a pure pay-as-you-go account: ring reads "full"
  // rather than falsely empty when we simply can't express a fraction.
  const ringPercent = available ? snapshot?.remainingPercent ?? 100 : null
  const display = hermesDisplay(snapshot)
  const tone = available ? toneFor(snapshot?.remainingPercent ?? null) : 'off'
  const ariaLabel = available
    ? `Hermes engine. ${display} OpenRouter credit left. Open Hermes.`
    : `Hermes engine offline. ${snapshot?.reason ?? 'Open Hermes.'}`

  return (
    <button
      type="button"
      className={`engineCore engineCore--hermes engineCore--${tone}`}
      aria-label={ariaLabel}
      onClick={onOpen}
    >
      <span className="engineCore__stage">
        <LogoMeter src={hermesAvatar} percent={ringPercent} avatar />
      </span>
      <span className="engineCore__meta">
        <span className="engineCore__name">
          <span className="engineCore__dot" aria-hidden />
          Hermes
        </span>
        {available ? (
          <span className="engineCore__pct mono">{display}</span>
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
  const toggleHermes = useStore((s) => s.toggleHermes)
  const snapshots = useAgentUsage()
  const openRouter = useOpenRouterUsage()

  if (!snapshots) return null

  const pills = snapshots.map((snapshot) => ({ snapshot, pill: summarizeAgentUsage(snapshot) }))
  // Hide the bay entirely only when nothing is connected and nothing to say.
  if (pills.every(({ pill }) => !pill.available && !pill.reason)) return null

  const hermesOnline = openRouter?.available ?? false
  const onlineCount = pills.filter(({ pill }) => pill.available).length + (hermesOnline ? 1 : 0)
  const totalCount = pills.length + 1
  let worstRemaining = pills.reduce<number | null>((acc, { pill }) => {
    if (!pill.available || pill.minRemainingPercent === null) return acc
    return acc === null ? pill.minRemainingPercent : Math.min(acc, pill.minRemainingPercent)
  }, null)
  if (hermesOnline && openRouter?.remainingPercent !== null && openRouter?.remainingPercent !== undefined) {
    worstRemaining =
      worstRemaining === null
        ? openRouter.remainingPercent
        : Math.min(worstRemaining, openRouter.remainingPercent)
  }
  const bayTone = onlineCount === 0 ? 'off' : toneFor(worstRemaining)

  return (
    <section className={`engineBay engineBay--${bayTone}`} aria-label="AI engines">
      <header className="engineBay__head">
        <span className="engineBay__title">Engines</span>
        <span className="engineBay__rule" aria-hidden />
        <span
          className="engineBay__live mono"
          aria-label={`${onlineCount} of ${totalCount} engines online`}
        >
          <span className="engineBay__liveDot" aria-hidden />
          {onlineCount}/{totalCount}
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
        <HermesEngineCore snapshot={openRouter} onOpen={() => toggleHermes()} />
      </div>
    </section>
  )
}
