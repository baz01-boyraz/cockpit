import { useStore } from '../store/useStore'
import { IconUsage, IconWarning } from '../components/icons'

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
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">activity</div>
          <h2 className="panel__title">
            <IconUsage width={18} height={18} /> Usage dashboard
          </h2>
        </div>
      </div>

      <div className="statgrid">
        {[
          { label: 'Sessions', value: totals.sessions },
          { label: 'Commands', value: totals.commands },
          { label: 'Agent tasks', value: totals.tasks },
          { label: 'Est. tokens', value: fmtTokens(totals.tokens || null) },
        ].map((s) => (
          <div key={s.label} className="card stat">
            <div className="stat__top">
              <span className="stat__label">{s.label}</span>
            </div>
            <div className="stat__value">{s.value}</div>
          </div>
        ))}
      </div>

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
              <li key={u.provider} className="usagerow">
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
                    className="usagerow__fill"
                    style={{ width: `${(u.sessions / maxSessions) * 100}%` }}
                  />
                </div>
                <div className="usagerow__meta mono">
                  <span>{u.sessions} sessions</span>
                  <span>{u.tasks} tasks</span>
                  <span>{u.commands} cmds</span>
                  <span>{fmtDuration(u.totalDurationMs)}</span>
                  <span>{fmtTokens(u.estimatedTokens)} tok</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
