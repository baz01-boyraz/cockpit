import { type CSSProperties } from 'react'
import { useStore } from '../store/useStore'
import { IconUsage, IconWarning } from '../components/icons'
import { AiSpendOverview } from '../components/AiSpendOverview'
import { ScorecardSection } from '../components/ScorecardSection'

/* Claude reads ember, Codex reads glacier; every other provider stays a
 * neutral instrument bar. */
const PROVIDER_FILL: Record<string, string> = {
  claude: 'usagerow__fill--claude',
  codex: 'usagerow__fill--codex',
}

const fmtDuration = (ms: number): string => {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min}m`
  return `${(min / 60).toFixed(1)}h`
}

const fmtTokens = (n: number | null): string => {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

export function UsagePanel() {
  const usage = useStore((s) => s.usage)

  const totals = usage.reduce(
    (acc, u) => ({
      sessions: acc.sessions + u.sessions,
      commands: acc.commands + u.commands,
      tasks: acc.tasks + u.tasks,
      tokens: acc.tokens + (u.estimatedTokens ?? 0),
    }),
    { sessions: 0, commands: 0, tasks: 0, tokens: 0 },
  )
  const maxSessions = Math.max(1, ...usage.map((u) => u.sessions))

  return (
    <div className="panel panel--stagger">
      <div className="panel__header">
        <div>
          <div className="eyebrow">activity</div>
          <h2 className="panel__title">
            <IconUsage width={18} height={18} /> Usage dashboard
          </h2>
        </div>
      </div>

      <AiSpendOverview
        ledger={{
          sessions: totals.sessions,
          commands: totals.commands,
          tasks: totals.tasks,
          tokens: totals.tokens || null,
        }}
      />

      <ScorecardSection />

      <div className="card usage__table">
        <div className="card__head">
          <div className="card__title">By provider</div>
          <span className="chip">local tracking</span>
        </div>
        {usage.length === 0 ? (
          <div className="emptyline">No usage recorded yet. Activity is tracked locally as you work.</div>
        ) : (
          <ul className="usagerows">
            {usage.map((u) => (
              <li key={u.provider} className={`usagerow usagerow--${u.provider}`}>
                <span className="usagerow__glyph" aria-hidden>
                  {u.provider.charAt(0)}
                </span>
                <div className="usagerow__body">
                  <div className="usagerow__head">
                    <span className="usagerow__name">{u.provider}</span>
                    {u.warning && (
                      <span className="chip chip--warning">
                        <IconWarning width={11} height={11} /> {u.warning}
                      </span>
                    )}
                  </div>
                  <div className="usagerow__bar">
                    <span
                      className={`usagerow__fill ${PROVIDER_FILL[u.provider] ?? ''}`}
                      style={{ '--w': `${(u.sessions / maxSessions) * 100}%` } as CSSProperties}
                    />
                  </div>
                  <div className="usagerow__chips">
                    <span className="usagechip">
                      <b>{u.sessions}</b> sessions
                    </span>
                    <span className="usagechip">
                      <b>{u.tasks}</b> tasks
                    </span>
                    <span className="usagechip">
                      <b>{u.commands}</b> cmds
                    </span>
                    <span className="usagechip">
                      <b>{fmtDuration(u.totalDurationMs)}</b> active
                    </span>
                    <span className="usagechip">
                      <b>{fmtTokens(u.estimatedTokens)}</b> tok
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
