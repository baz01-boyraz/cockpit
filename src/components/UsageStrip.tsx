import { type CSSProperties } from 'react'
import { summarizeAgentUsage, toneFor, type AgentUsagePill } from '@shared/agent-usage'
import type { AgentUsageSnapshot, OpenRouterUsageSnapshot } from '@shared/domain'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'
import { useOpenRouterUsage } from '../lib/useOpenRouterUsage'
import claudeLogo from '../assets/usage/claude.png'
import codexLogo from '../assets/usage/codex.png'

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

/** Every engine core's ring shares one dial geometry so the three read as a
 *  matched set regardless of provider or fill — equal size is the point. */
const RING_SIZE = 56
const RING_STROKE = 1.6
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CENTER = RING_SIZE / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * The provider's 3D logo, kept crisp and full-color, seated inside a soft
 * instrument halo: a hairline circle in the engine's own tone is always
 * fully drawn (dim resting glow), with a brighter hairline arc sweeping
 * clockwise from 12 o'clock to `remaining%` on top of it — same hue
 * throughout, only brightness changes, so the ring reads as one continuous
 * light source rather than a colored-vs-neutral track. Each hairline has a
 * blurred twin sitting behind it for a wide, atmospheric bloom (the
 * "premium subtle glow"), separate from the crisp line that carries the
 * actual value. Same geometry across all three engines — only
 * `--tone`/`--tone-hi` and the fill vary.
 */
function LogoMeter({
  src,
  percent,
  glyph,
}: {
  src?: string
  percent: number | null
  glyph?: string
}) {
  const hasFill = percent !== null
  const fill = clampPercent(percent)
  const offset = RING_CIRCUMFERENCE * (1 - fill / 100)
  const dashProps = {
    strokeDasharray: RING_CIRCUMFERENCE,
    strokeDashoffset: offset,
    transform: `rotate(-90 ${RING_CENTER} ${RING_CENTER})`,
    style: { '--ring-circ': RING_CIRCUMFERENCE } as CSSProperties,
  }

  return (
    <span className="logoMeter" aria-hidden>
      <svg
        className="logoMeter__ring"
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      >
        <circle
          className="logoMeter__trackGlow"
          cx={RING_CENTER}
          cy={RING_CENTER}
          r={RING_RADIUS}
          fill="none"
        />
        <circle className="logoMeter__track" cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} fill="none" />
        {hasFill ? (
          <>
            <circle
              className="logoMeter__fillGlow"
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              {...dashProps}
            />
            <circle
              className="logoMeter__fill"
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              strokeLinecap="round"
              {...dashProps}
            />
          </>
        ) : null}
      </svg>
      {src ? (
        <img className="logoMeter__logo" src={src} alt="" draggable={false} />
      ) : (
        <span className="logoMeter__glyph mono">{glyph}</span>
      )}
    </span>
  )
}

/** Capped keys show remaining share; uncapped routing keys show infinity. */
function openRouterDisplay(snapshot: OpenRouterUsageSnapshot | null): string {
  if (!snapshot?.available) return '—'
  if (snapshot.unlimited) return '∞'
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
export function EngineCore({
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
    : `${label} quota telemetry unavailable. ${pill.reason ?? 'Open details.'}`

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
          <span className="engineCore__unavailable mono">{pill.telemetryShortLabel}</span>
        )}
      </span>
    </button>
  )
}

/**
 * OpenRouter credit for Council's DeepSeek/GLM seats, ringed like the account
 * engines and opening the shared Usage view.
 */
function OpenRouterEngineCore({
  snapshot,
  onOpen,
}: {
  snapshot: OpenRouterUsageSnapshot | null
  onOpen: () => void
}) {
  const available = snapshot?.available ?? false
  // An uncapped key has no percentage denominator, so its ring reads full and
  // the visible infinity mark communicates that this is deliberate.
  const ringPercent = available ? snapshot?.remainingPercent ?? 100 : null
  const display = openRouterDisplay(snapshot)
  const tone = available ? toneFor(snapshot?.remainingPercent ?? null) : 'off'
  const ariaLabel = available
    ? snapshot?.unlimited
      ? `OpenRouter Council key. No spending cap. $${snapshot.usageUsd?.toFixed(2) ?? '0.00'} used. Open usage details.`
      : `OpenRouter Council key. ${display} remaining. Open usage details.`
    : `OpenRouter credit telemetry unavailable. ${snapshot?.reason ?? 'Open usage details.'}`

  return (
    <button
      type="button"
      className={`engineCore engineCore--hermes engineCore--${tone}`}
      aria-label={ariaLabel}
      onClick={onOpen}
    >
      <span className="engineCore__stage">
        <LogoMeter glyph="OR" percent={ringPercent} />
      </span>
      <span className="engineCore__meta">
        <span className="engineCore__name">
          <span className="engineCore__dot" aria-hidden />
          OpenRouter
        </span>
        {available ? (
          <span className="engineCore__pct mono">{display}</span>
        ) : (
          <span className="engineCore__unavailable mono">credit n/a</span>
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
  const openRouter = useOpenRouterUsage()

  if (!snapshots) return null

  const pills = snapshots.map((snapshot) => ({ snapshot, pill: summarizeAgentUsage(snapshot) }))
  // Hide the bay entirely only when nothing is connected and nothing to say.
  if (pills.every(({ pill }) => !pill.available && !pill.reason)) return null

  const openRouterReporting = openRouter?.available ?? false
  const reportingCount =
    pills.filter(({ pill }) => pill.available).length + (openRouterReporting ? 1 : 0)
  const totalCount = pills.length + 1
  let worstRemaining = pills.reduce<number | null>((acc, { pill }) => {
    if (!pill.available || pill.minRemainingPercent === null) return acc
    return acc === null ? pill.minRemainingPercent : Math.min(acc, pill.minRemainingPercent)
  }, null)
  if (
    openRouterReporting &&
    openRouter?.remainingPercent !== null &&
    openRouter?.remainingPercent !== undefined
  ) {
    worstRemaining =
      worstRemaining === null
        ? openRouter.remainingPercent
        : Math.min(worstRemaining, openRouter.remainingPercent)
  }
  const bayTone = reportingCount === 0 ? 'off' : toneFor(worstRemaining)

  return (
    <section className={`engineBay engineBay--${bayTone}`} aria-label="AI engines">
      <header className="engineBay__head">
        <span className="engineBay__title">Engines</span>
        <span className="engineBay__rule" aria-hidden />
        <span
          className="engineBay__live mono"
          aria-label={`${reportingCount} of ${totalCount} quota or credit feeds reporting`}
        >
          <span className="engineBay__liveDot" aria-hidden />
          {reportingCount}/{totalCount} data
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
        <OpenRouterEngineCore snapshot={openRouter} onOpen={() => setView('usage')} />
      </div>
    </section>
  )
}
