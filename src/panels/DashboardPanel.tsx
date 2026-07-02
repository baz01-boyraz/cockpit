import { useEffect, useMemo, useState } from 'react'
import type { AuditEntry, ErrorSeverity } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import { groupErrors, prettyAuditSummary } from '@shared/dashboard-insights'
import { ApprovalCard } from '../components/ApprovalCard'
import { CountUp } from '../components/CountUp'
import {
  IconBolt,
  IconGit,
  IconRailway,
  IconShield,
  IconTerminal,
  IconWarning,
} from '../components/icons'

const SEVERITY_CLASS: Record<ErrorSeverity, string> = {
  low: 'sev--low',
  medium: 'sev--medium',
  high: 'sev--high',
  critical: 'sev--critical',
}

const ACTIVITY_PREVIEW = 6

type StatTone = 'accent' | 'live' | 'ok' | 'on' | 'idle' | 'off'

interface StatCard {
  label: string
  value: string | number
  sub: string
  Icon: typeof IconGit
  view: 'git' | 'terminals' | 'railway'
  tone: StatTone
}

export function DashboardPanel() {
  const dashboard = useStore((s) => s.dashboard)
  const terminals = useStore((s) => s.terminals)
  const approvals = useStore((s) => s.approvals)
  const setView = useStore((s) => s.setView)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const [activity, setActivity] = useState<AuditEntry[]>([])
  const [showAllActivity, setShowAllActivity] = useState(false)

  useEffect(() => {
    if (activeProjectId) void cockpit().audit.list(activeProjectId).then(setActivity)
  }, [activeProjectId, approvals])

  const errorGroups = useMemo(
    () => (dashboard ? groupErrors(dashboard.recentErrors) : []),
    [dashboard],
  )

  if (!dashboard) return null

  const pending = approvals.filter((a) => a.status === 'pending')
  const errorTotal = dashboard.recentErrors.length

  // Derive terminal/agent counts from the live terminals list so the dashboard
  // stays in lockstep with the rail badge and the Terminals panel instead of a
  // dashboard snapshot that only refreshes on approvals. A terminal running an
  // AI CLI (claude/codex) counts as an active agent.
  const terminalCount = terminals.length
  const runningTerminals = terminals.filter(
    (t) => t.status === 'running' || t.status === 'starting',
  ).length
  const agentCount = terminals.filter((t) => t.role === 'claude' || t.role === 'codex').length

  const launch = async (agent: 'claude' | 'codex') => {
    if (!activeProjectId) return
    await cockpit().terminals.launchAgent(activeProjectId, agent)
    await refreshTerminals()
    setView('terminals')
  }

  const stats: StatCard[] = [
    {
      label: 'Changed files',
      value: dashboard.changedFiles,
      sub: dashboard.branch ?? 'no branch',
      Icon: IconGit,
      view: 'git',
      tone: dashboard.changedFiles ? 'on' : 'idle',
    },
    {
      label: 'Terminals',
      value: `${runningTerminals}/${terminalCount}`,
      sub: runningTerminals ? 'running' : 'idle',
      Icon: IconTerminal,
      view: 'terminals',
      tone: runningTerminals ? 'live' : 'idle',
    },
    {
      label: 'Agents',
      value: agentCount,
      sub: agentCount ? 'active' : 'idle',
      Icon: IconBolt,
      view: 'terminals',
      tone: agentCount ? 'on' : 'idle',
    },
    {
      label: 'Railway',
      value: dashboard.railwayConnected ? dashboard.railwayServices : '—',
      sub: dashboard.railwayConnected ? 'connected' : 'offline',
      Icon: IconRailway,
      view: 'railway',
      tone: dashboard.railwayConnected ? 'ok' : 'off',
    },
  ]

  const visibleActivity = showAllActivity ? activity : activity.slice(0, ACTIVITY_PREVIEW)

  return (
    <div className="panel dash">
      <div className="panel__header dash__head">
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

      {pending.length > 0 && (
        <section className="dash__approvalBanner u-rise" style={{ animationDelay: '20ms' }}>
          <div className="dash__approvalBannerHead">
            <span className="dash__approvalBannerTitle">
              <IconShield width={14} height={14} />
              Awaiting your approval
            </span>
            <span className="chip chip--warning">
              {pending.length} {pending.length === 1 ? 'request' : 'requests'}
            </span>
          </div>
          <div className="dash__approvalBannerList">
            {pending.map((a) => (
              <ApprovalCard key={a.id} request={a} />
            ))}
          </div>
        </section>
      )}

      <div className="statgrid">
        {stats.map((s, i) => (
          <button
            key={s.label}
            className={`card card--hover stat stat--${s.tone} u-rise`}
            style={{ animationDelay: `${60 + i * 55}ms` }}
            onClick={() => setView(s.view)}
          >
            <div className="stat__top">
              <span className="stat__icon">
                <s.Icon width={15} height={15} />
              </span>
              <span className="stat__label">{s.label}</span>
              <span className={`stat__dot stat__dot--${s.tone}`} aria-hidden />
            </div>
            <div className="stat__value">
              {typeof s.value === 'number' ? <CountUp value={s.value} /> : s.value}
            </div>
            <div className="stat__sub mono">{s.sub}</div>
          </button>
        ))}
      </div>

      <div className="dash__grid">
        <section className="card dash__errors u-rise" style={{ animationDelay: '300ms' }}>
          <div className="card__head">
            <div className="card__title">
              <IconWarning width={15} height={15} /> Recent errors
              {errorTotal > 0 && <span className="card__count">{errorTotal}</span>}
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setView('logs')}>
              View all
            </button>
          </div>
          {errorGroups.length === 0 ? (
            <div className="dash__clean">
              <span className="dash__cleanDot" />
              No detected errors. Output looks clean.
            </div>
          ) : (
            <ul className="errlist">
              {errorGroups.map((g, i) => (
                <li
                  key={g.key}
                  className="errrow u-rise"
                  style={{ animationDelay: `${340 + i * 50}ms` }}
                >
                  <span className={`sev ${SEVERITY_CLASS[g.severity]}`}>{g.severity}</span>
                  <span className="errrow__main">
                    <span className="errrow__title">
                      {g.title}
                      {g.count > 1 && <span className="errrow__count">×{g.count}</span>}
                    </span>
                    <span className="errrow__cause">{g.likelyCause}</span>
                  </span>
                  <span className="errrow__agent mono">→ {g.suggestedAgent}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card dash__activity u-rise" style={{ animationDelay: '360ms' }}>
          <div className="card__head">
            <div className="card__title">Activity</div>
            <span className="chip">audit · redacted</span>
          </div>
          {activity.length === 0 ? (
            <div className="emptyline">No recorded activity yet.</div>
          ) : (
            <>
              <ul className="actlist">
                {visibleActivity.map((a, i) => (
                  <li
                    key={a.id}
                    className="actrow u-rise"
                    style={{ animationDelay: `${400 + i * 45}ms` }}
                  >
                    <span className={`actrow__dot actrow__dot--${a.actor}`} aria-hidden />
                    <span className="actrow__actor">{a.actor}</span>
                    <span className="actrow__summary">{prettyAuditSummary(a.summary)}</span>
                    <span className="actrow__time mono">{relativeTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
              {activity.length > ACTIVITY_PREVIEW && (
                <button
                  className="actlist__more"
                  onClick={() => setShowAllActivity((v) => !v)}
                >
                  {showAllActivity ? 'Show less' : `View all ${activity.length}`}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
