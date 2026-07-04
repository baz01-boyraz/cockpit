import { useStore } from '../store/useStore'
import {
  IconBolt,
  IconSwarm,
  IconTerminal,
  IconUsage,
  IconWarning,
} from '../components/icons'
import { useAgentUsage } from '../lib/useAgentUsage'
import { AgentUsageBody } from '../components/AgentUsageBody'
import { CountUp } from '../components/CountUp'

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
  const agentUsage = useAgentUsage()

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

      <div className="statgrid">
        {[
          { label: 'Sessions', value: totals.sessions, sub: 'tracked locally', Icon: IconTerminal, live: totals.sessions > 0 },
          { label: 'Commands', value: totals.commands, sub: 'shell runs', Icon: IconBolt, live: totals.commands > 0 },
          { label: 'Agent tasks', value: totals.tasks, sub: 'Claude · Codex', Icon: IconSwarm, live: totals.tasks > 0 },
          { label: 'Est. tokens', value: fmtTokens(totals.tokens || null), sub: 'estimated', Icon: IconUsage, live: totals.tokens > 0 },
        ].map((s) => (
          <div key={s.label} className={`card stat stat--${s.live ? 'on' : 'idle'}`}>
            <div className="stat__top">
              <span className="stat__icon">
                <s.Icon width={15} height={15} />
              </span>
              <span className="stat__label">{s.label}</span>
              <span className={`stat__dot stat__dot--${s.live ? 'on' : 'idle'}`} aria-hidden />
            </div>
            <div className="stat__value">
              {typeof s.value === 'number' ? <CountUp value={s.value} /> : s.value}
            </div>
            <div className="stat__sub mono">{s.sub}</div>
          </div>
        ))}
      </div>

      {agentUsage && agentUsage.length > 0 ? (
        <div className="card usage__quota">
          <div className="card__head">
            <div className="card__title">Account quota</div>
            <span className="chip">live · CLI plan</span>
          </div>
          <div className="quotaGrid">
            {agentUsage.map((snapshot) => (
              <AgentUsageBody key={snapshot.provider} snapshot={snapshot} />
            ))}
          </div>
        </div>
      ) : null}

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
                    className={`usagerow__fill ${PROVIDER_FILL[u.provider] ?? ''}`}
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
