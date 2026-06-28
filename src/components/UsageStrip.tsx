import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { AgentUsageSnapshot } from '@shared/domain'
import { summarizeAgentUsage, type AgentUsagePill } from '@shared/agent-usage'
import { cockpit } from '../lib/cockpit'
import { useStore } from '../store/useStore'

const POLL_MS = 60_000

function resetLabel(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function tooltipFor(snapshot: AgentUsageSnapshot, pill: AgentUsagePill): string {
  const head = pill.plan ? `${snapshot.label} · ${pill.plan}` : snapshot.label
  if (!pill.available) {
    return `${head}\n${pill.reason ?? 'Usage unavailable.'}`
  }
  const lines = snapshot.windows.map((w) => {
    const left = Math.max(0, Math.min(100, Math.round(100 - w.usedPercent)))
    const reset = resetLabel(w.resetAt)
    return `${w.label} ${left}% left${reset ? ` · resets ${reset}` : ''}`
  })
  return [head, ...lines].join('\n')
}

/**
 * Premium account-quota strip for the TopBar. One pill per agent provider
 * (Claude Code / Codex), each showing remaining session + weekly headroom with
 * a tone that warms from lime → amber → ember as quota runs low. Providers are
 * independent: one signed out or erroring never hides the other. Clicking a pill
 * opens the Usage panel.
 */
export function UsageStrip() {
  const setView = useStore((s) => s.setView)
  const [snapshots, setSnapshots] = useState<AgentUsageSnapshot[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const report = await cockpit().agentUsage.get()
      setSnapshots(report.providers)
    } catch {
      // Leave the last good snapshots in place; the strip simply doesn't update.
    }
  }, [])

  useEffect(() => {
    let active = true

    const tick = async () => {
      if (!active || document.hidden) return
      await refresh()
    }

    void refresh()
    const timer = window.setInterval(() => void tick(), POLL_MS)

    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

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
        return (
          <button
            key={snapshot.provider}
            type="button"
            className={`usagePill usagePill--${tone}`}
            title={tooltipFor(snapshot, pill)}
            aria-label={tooltipFor(snapshot, pill).replace(/\n/g, '. ')}
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
        )
      })}
    </div>
  )
}
