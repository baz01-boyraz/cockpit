import { type CSSProperties } from 'react'
import { summarizeAgentUsage } from '@shared/agent-usage'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'
import { AgentUsageBody } from './AgentUsageBody'

function percentText(percent: number | null): string {
  return percent === null ? '—' : `${percent}%`
}

function percentAria(percent: number | null): string {
  return percent === null ? 'not reported' : `${percent}%`
}

function percentScale(percent: number | null): number {
  if (percent === null) return 0
  return Math.max(0, Math.min(1, percent / 100))
}

/**
 * Rail-mounted quota dock. It keeps the busy topbar clean while making Claude
 * and Codex quota visible in the otherwise quiet lower-left rail space.
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
        const sessionMetric = percentText(pill.sessionPercent)
        const weeklyMetric = percentText(pill.weeklyPercent)
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
              <span className="usageDock__aura" aria-hidden />
              <span className="usageDock__sheen" aria-hidden />
              <span className="usageDock__identity">
                <span className="usageDock__orb" aria-hidden>
                  <span className="usageDock__orbCore" />
                </span>
                <span className="usageDock__label">{snapshot.label}</span>
              </span>
              {pill.available ? (
                <span className="usageDock__metrics" aria-hidden>
                  <span className="usageDock__metric">
                    <span className="usageDock__metricTag">5h</span>
                    <span className="usageDock__metricValue mono">{sessionMetric}</span>
                    <span className="usageDock__metricTrack">
                      <span
                        className="usageDock__metricFill"
                        style={{ '--scale': percentScale(pill.sessionPercent) } as CSSProperties}
                      />
                    </span>
                  </span>
                  <span className="usageDock__metric">
                    <span className="usageDock__metricTag">W</span>
                    <span className="usageDock__metricValue mono">{weeklyMetric}</span>
                    <span className="usageDock__metricTrack">
                      <span
                        className="usageDock__metricFill"
                        style={{ '--scale': percentScale(pill.weeklyPercent) } as CSSProperties}
                      />
                    </span>
                  </span>
                </span>
              ) : (
                <span className="usageDock__state mono" aria-hidden>
                  offline
                </span>
              )}
            </button>
            <div className="usageDock__pop" role="tooltip">
              <AgentUsageBody snapshot={snapshot} live variant="radial" />
            </div>
          </div>
        )
      })}
    </section>
  )
}
