import { type CSSProperties } from 'react'
import { summarizeAgentUsage, toneFor } from '@shared/agent-usage'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'

/** Map a remaining-percent into a 0..1 liquid fill level for the vial. */
function fillLevel(percent: number | null): number {
  if (percent === null) return 0
  return Math.max(0, Math.min(1, percent / 100))
}

function percentText(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`
}

function percentAria(percent: number | null): string {
  return percent === null ? 'not reported' : `${percent}%`
}

/** A few drifting motes, seeded with stable offsets/timings so the liquid breathes. */
const VIAL_SPARKS = [
  { x: 26, delay: 0, dur: 7.4 },
  { x: 62, delay: 1.6, dur: 9.1 },
  { x: 44, delay: 3.2, dur: 8.3 },
  { x: 74, delay: 4.5, dur: 10.2 },
  { x: 16, delay: 5.7, dur: 8.9 },
] as const

/**
 * A premium glass "liquid energy" vial. The fill height tracks remaining quota
 * (a full tube = lots of headroom, draining as it is consumed); a glowing
 * meniscus rides the surface and a few motes drift up through the liquid. Tone
 * shifts ember/teal → amber → red as a window runs low. Decorative only — the
 * caption beneath carries the readable percent.
 */
function LiquidVial({ tag, percent }: { tag: string; percent: number | null }) {
  const tone = percent === null ? 'healthy' : toneFor(percent)
  const empty = percent === null
  return (
    <div
      className={`vial vial--${tone}${empty ? ' vial--empty' : ''}`}
      style={{ '--fill': fillLevel(percent) } as CSSProperties}
    >
      <span className="vial__glass" aria-hidden>
        <span className="vial__bore">
          <span className="vial__liquid">
            {VIAL_SPARKS.map((s, i) => (
              <span
                key={i}
                className="vial__spark"
                style={
                  { '--x': `${s.x}%`, '--delay': `${s.delay}s`, '--dur': `${s.dur}s` } as CSSProperties
                }
              />
            ))}
          </span>
          <span className="vial__meniscus" />
          <span className="vial__shine" />
        </span>
      </span>
      <span className="vial__caption">
        <span className="vial__tag">{tag}</span>
        <span className="vial__pct mono">{percentText(percent)}</span>
      </span>
    </div>
  )
}

/**
 * Rail-mounted quota dock. A premium "liquid energy" read-out: each provider is
 * a card with twin glass vials (5h + weekly) whose fill tracks remaining quota,
 * so headroom is legible at a glance in the quiet lower-left rail without
 * crowding the topbar.
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
          <button
            key={snapshot.provider}
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
                <LiquidVial tag="5h" percent={pill.sessionPercent} />
                <LiquidVial tag="7d" percent={pill.weeklyPercent} />
              </span>
            ) : (
              <span className="usageDock__state mono" aria-hidden>
                offline
              </span>
            )}
          </button>
        )
      })}
    </section>
  )
}
