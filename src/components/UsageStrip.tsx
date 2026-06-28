import { type CSSProperties } from 'react'
import { summarizeAgentUsage } from '@shared/agent-usage'
import { useStore } from '../store/useStore'
import { useAgentUsage } from '../lib/useAgentUsage'
import { AgentUsageBody } from './AgentUsageBody'

/**
 * Premium account-quota strip for the TopBar. One pill per agent provider
 * (Claude Code / Codex), each showing remaining session + weekly headroom with
 * a tone that warms from lime → amber → ember as quota runs low. Hovering or
 * focusing a pill opens a Hermes-style popover with the full breakdown — the
 * 5h session and weekly limit, each with its bar and reset time. Providers are
 * independent: one signed out or erroring never hides the other. Clicking a pill
 * opens the Usage panel.
 */
export function UsageStrip() {
  const setView = useStore((s) => s.setView)
  const snapshots = useAgentUsage()

  if (!snapshots) return null

  const pills = snapshots.map((snapshot) => ({ snapshot, pill: summarizeAgentUsage(snapshot) }))
  // Hide the strip entirely only when nothing is connected and nothing to say.
  if (pills.every(({ pill }) => !pill.available && !pill.reason)) return null

  return (
    <div className="usageStrip" role="group" aria-label="Agent usage">
      {pills.map(({ snapshot, pill }) => {
        const tone = pill.available ? pill.tone : 'off'
        const headline =
          pill.available && pill.minRemainingPercent !== null
            ? `${pill.minRemainingPercent}%`
            : '—'
        const label = pill.plan ? `${snapshot.label} · ${pill.plan}` : snapshot.label
        return (
          <div key={snapshot.provider} className="usagePillWrap">
            <button
              type="button"
              className={`usagePill usagePill--${tone}`}
              aria-label={`${label} usage. Open dashboard.`}
              onClick={() => setView('usage')}
            >
              <span className="usagePill__sheen" aria-hidden />
              <span className="usagePill__dot" aria-hidden />
              <span className="usagePill__label">{snapshot.label}</span>
              {pill.available ? (
                <span className="usagePill__meter" aria-hidden>
                  <span
                    className="usagePill__bar"
                    style={{ '--fill': `${pill.sessionPercent ?? 0}%` } as CSSProperties}
                  />
                  <span
                    className="usagePill__bar"
                    style={{ '--fill': `${pill.weeklyPercent ?? 0}%` } as CSSProperties}
                  />
                </span>
              ) : null}
              <span className="usagePill__value mono">{headline}</span>
            </button>
            <div className="usagePop" role="tooltip">
              <AgentUsageBody snapshot={snapshot} live />
            </div>
          </div>
        )
      })}
    </div>
  )
}
