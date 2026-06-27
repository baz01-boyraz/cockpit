import { useEffect, useState } from 'react'
import type { AuditEntry } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { ApprovalCard } from '../components/ApprovalCard'
import {
  IconBolt,
  IconGit,
  IconRailway,
  IconTerminal,
  IconWarning,
} from '../components/icons'

const SEVERITY_CLASS: Record<string, string> = {
  low: 'chip--success',
  medium: 'chip--warning',
  high: 'chip--warning',
  critical: 'chip--danger',
}

export function DashboardPanel() {
  const dashboard = useStore((s) => s.dashboard)
  const usage = useStore((s) => s.usage)
  const approvals = useStore((s) => s.approvals)
  const setView = useStore((s) => s.setView)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const [activity, setActivity] = useState<AuditEntry[]>([])

  useEffect(() => {
    if (activeProjectId) void cockpit().audit.list(activeProjectId).then(setActivity)
  }, [activeProjectId, approvals])

  if (!dashboard) return null

  const pending = approvals.filter((a) => a.status === 'pending')

  const launch = async (agent: 'claude' | 'codex') => {
    if (!activeProjectId) return
    await cockpit().terminals.launchAgent(activeProjectId, agent)
    await refreshTerminals()
    setView('terminals')
  }

  const stats = [
    { label: 'Changed files', value: dashboard.changedFiles, hint: dashboard.branch ?? '', Icon: IconGit, view: 'git' as const, tone: dashboard.changedFiles ? 'accent' : '' },
    { label: 'Terminals', value: `${dashboard.runningTerminals}/${dashboard.terminalCount}`, hint: 'running / open', Icon: IconTerminal, view: 'terminals' as const, tone: '' },
    { label: 'Agents', value: dashboard.agentCount, hint: 'Claude · Codex', Icon: IconBolt, view: 'terminals' as const, tone: '' },
    { label: 'Railway', value: dashboard.railwayServices, hint: dashboard.railwayConnected ? 'connected' : 'not connected', Icon: IconRailway, view: 'railway' as const, tone: dashboard.railwayConnected ? 'success' : '' },
  ]

  return (
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">overview</div>
          <h2 className="panel__title">Project dashboard</h2>
        </div>
        <div className="panel__actions">
          <button className="btn" onClick={() => launch('codex')}>
            <IconBolt width={14} height={14} /> Launch Codex
          </button>
          <button className="btn btn--accent" onClick={() => launch('claude')}>
            <IconBolt width={14} height={14} /> Launch Claude Code
          </button>
        </div>
      </div>

      <div className="statgrid">
        {stats.map((s) => (
          <button key={s.label} className="card card--hover stat" onClick={() => setView(s.view)}>
            <div className="stat__top">
              <span className={`stat__icon ${s.tone === 'accent' ? 'stat__icon--accent' : ''}`}>
                <s.Icon width={16} height={16} />
              </span>
              <span className="stat__label">{s.label}</span>
            </div>
            <div className={`stat__value ${s.tone === 'accent' ? 'stat__value--accent' : ''}`}>{s.value}</div>
            <div className="stat__hint mono">{s.hint}</div>
          </button>
        ))}
      </div>

      <div className="dash__cols">
        <section className="card dash__errors">
          <div className="card__head">
            <div className="card__title">
              <IconWarning width={15} height={15} /> Recent errors
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setView('logs')}>
              View all
            </button>
          </div>
          {dashboard.recentErrors.length === 0 ? (
            <div className="emptyline">No detected errors. Output looks clean.</div>
          ) : (
            <ul className="insightlist">
              {dashboard.recentErrors.map((e) => (
                <li key={e.id} className="insight">
                  <div className="insight__row">
                    <span className={`chip ${SEVERITY_CLASS[e.severity]}`}>{e.severity}</span>
                    <span className="insight__title">{e.title}</span>
                    <span className="insight__agent mono">→ {e.suggestedAgent}</span>
                  </div>
                  <div className="insight__cause">{e.likelyCause}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card dash__side">
          <div className="card__head">
            <div className="card__title">Usage</div>
            <button className="btn btn--ghost btn--sm" onClick={() => setView('usage')}>
              Details
            </button>
          </div>
          {usage.length === 0 ? (
            <div className="emptyline">No usage recorded yet.</div>
          ) : (
            <ul className="usageMini">
              {usage.map((u) => (
                <li key={u.provider} className="usageMini__row">
                  <span className="usageMini__name">{u.provider}</span>
                  <span className="usageMini__bar">
                    <span className="usageMini__fill" style={{ width: `${Math.min(100, u.sessions * 12)}%` }} />
                  </span>
                  <span className="usageMini__val mono">{u.sessions}s · {u.tasks}t</span>
                </li>
              ))}
            </ul>
          )}

          <div className="dash__approvals">
            <div className="eyebrow">approvals</div>
            {pending.length === 0 ? (
              <div className="emptyline">Nothing awaiting approval.</div>
            ) : (
              pending.map((a) => <ApprovalCard key={a.id} request={a} />)
            )}
          </div>
        </section>
      </div>

      <section className="card dash__activity">
        <div className="card__head">
          <div className="card__title">Activity</div>
          <span className="chip">audit · redacted</span>
        </div>
        {activity.length === 0 ? (
          <div className="emptyline">No recorded activity yet.</div>
        ) : (
          <ul className="activitylist">
            {activity.map((a) => (
              <li key={a.id} className="activity">
                <span className={`activity__actor activity__actor--${a.actor}`}>{a.actor}</span>
                <span className="activity__summary">{a.summary}</span>
                <span className="activity__type mono">{a.actionType}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
