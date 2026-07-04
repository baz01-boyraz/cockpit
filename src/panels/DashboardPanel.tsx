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
  IconBranch,
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
type StatViz = 'spark' | 'seg' | 'pulse' | 'arc'

interface StatCard {
  label: string
  value: string | number
  sub: string
  Icon: typeof IconGit
  view: 'git' | 'terminals' | 'railway'
  tone: StatTone
  viz: StatViz
  meta: { changed: number; running: number; total: number; agents: number; services: number; connected: boolean }
}

/* ---- inline mini-visualizations (pure CSS/SVG, no libs) ---- */

const SPARK_PATTERN = [0.35, 0.62, 0.44, 0.86, 0.55, 0.97, 0.7]

function SparkBars({ value }: { value: number }) {
  const active = value > 0
  return (
    <span className={`spark ${active ? 'spark--on' : ''}`} aria-hidden>
      {SPARK_PATTERN.map((h, i) => (
        <span key={i} className="spark__bar" style={{ height: `${Math.round(h * 100)}%` }} />
      ))}
    </span>
  )
}

function SegMeter({ running, total }: { running: number; total: number }) {
  const cells = Math.max(total, 4)
  return (
    <span className="seg" aria-hidden>
      {Array.from({ length: Math.min(cells, 8) }, (_, i) => (
        <span key={i} className={`seg__cell ${i < running ? 'seg__cell--on' : ''}`} />
      ))}
    </span>
  )
}

function PulseTrail({ count }: { count: number }) {
  return (
    <span className="pulse" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`pulse__dot ${i < count ? 'pulse__dot--on' : ''}`}
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  )
}

function StatusArc({ connected, services }: { connected: boolean; services: number }) {
  const frac = connected ? Math.max(0.16, Math.min(1, services / 4)) : 0
  const r = 15
  const circ = Math.PI * r
  const offset = circ * (1 - frac)
  return (
    <span className={`arc ${connected ? 'arc--on' : ''}`} aria-hidden>
      <svg width="42" height="24" viewBox="0 0 42 24">
        <path className="arc__track" d="M 5 21 A 15 15 0 0 1 37 21" fill="none" strokeWidth="4" />
        <path
          className="arc__fill"
          d="M 5 21 A 15 15 0 0 1 37 21"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
    </span>
  )
}

function StatViz({ viz, tile }: { viz: StatViz; tile: StatCard['meta'] }) {
  switch (viz) {
    case 'spark':
      return <SparkBars value={tile.changed} />
    case 'seg':
      return <SegMeter running={tile.running} total={tile.total} />
    case 'pulse':
      return <PulseTrail count={tile.agents} />
    case 'arc':
      return <StatusArc connected={tile.connected} services={tile.services} />
  }
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

  const meta = {
    changed: dashboard.changedFiles,
    running: runningTerminals,
    total: terminalCount,
    agents: agentCount,
    services: dashboard.railwayServices,
    connected: dashboard.railwayConnected,
  }

  const stats: StatCard[] = [
    {
      label: 'Changed files',
      value: dashboard.changedFiles,
      sub: dashboard.branch ?? 'no branch',
      Icon: IconGit,
      view: 'git',
      tone: dashboard.changedFiles ? 'on' : 'idle',
      viz: 'spark',
      meta,
    },
    {
      label: 'Terminals',
      value: `${runningTerminals}/${terminalCount}`,
      sub: runningTerminals ? 'running' : 'idle',
      Icon: IconTerminal,
      view: 'terminals',
      tone: runningTerminals ? 'live' : 'idle',
      viz: 'seg',
      meta,
    },
    {
      label: 'Agents',
      value: agentCount,
      sub: agentCount ? 'active' : 'idle',
      Icon: IconBolt,
      view: 'terminals',
      tone: agentCount ? 'on' : 'idle',
      viz: 'pulse',
      meta,
    },
    {
      label: 'Railway',
      value: dashboard.railwayConnected ? dashboard.railwayServices : '—',
      sub: dashboard.railwayConnected ? 'connected' : 'offline',
      Icon: IconRailway,
      view: 'railway',
      tone: dashboard.railwayConnected ? 'ok' : 'off',
      viz: 'arc',
      meta,
    },
  ]

  const visibleActivity = showAllActivity ? activity : activity.slice(0, ACTIVITY_PREVIEW)

  return (
    <div className="panel dash">
      {/* hero status band — project identity, engine health, primary CTAs */}
      <section className="dashHero u-rise">
        <span className="dashHero__glow" aria-hidden />
        <div className="dashHero__id">
          <div className="eyebrow">command center</div>
          <h2 className="dashHero__title">
            <span className="dashHero__wordmark">cockpit</span>
          </h2>
          <div className="dashHero__meta">
            <span className="dashHero__branch mono">
              <IconBranch width={12} height={12} />
              {dashboard.branch ?? 'no branch'}
            </span>
            <span className="dashHero__sep" aria-hidden />
            <span className="dashHero__stat">
              <b>{dashboard.changedFiles}</b> changed
            </span>
            <span className="dashHero__sep" aria-hidden />
            <span className={`dashHero__stat ${errorTotal ? 'dashHero__stat--warn' : ''}`}>
              <b>{errorTotal}</b> {errorTotal === 1 ? 'error' : 'errors'}
            </span>
          </div>
        </div>
        <div className="dashHero__cta">
          <button className="btn" onClick={() => launch('codex')}>
            <IconBolt width={14} height={14} /> Launch Codex
          </button>
          <button className="btn btn--accent btn--hero" onClick={() => launch('claude')}>
            <IconBolt width={15} height={15} /> Launch Claude Code
          </button>
        </div>
      </section>

      {pending.length > 0 && (
        <section className="dash__approvalBanner u-rise" style={{ animationDelay: '40ms' }}>
          <span className="dash__approvalBannerEdge" aria-hidden />
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

      <div className="statbento">
        {stats.map((s, i) => (
          <button
            key={s.label}
            className={`card card--hover statTile statTile--${s.tone} u-rise`}
            style={{ animationDelay: `${80 + i * 55}ms` }}
            onClick={() => setView(s.view)}
          >
            <div className="statTile__head">
              <span className="statTile__plate">
                <s.Icon width={16} height={16} />
              </span>
              <span className="statTile__label">{s.label}</span>
              <span className={`statTile__dot statTile__dot--${s.tone}`} aria-hidden />
            </div>
            <div className="statTile__value">
              {typeof s.value === 'number' ? <CountUp value={s.value} /> : s.value}
            </div>
            <div className="statTile__foot">
              <span className="statTile__sub mono">{s.sub}</span>
              <StatViz viz={s.viz} tile={s.meta} />
            </div>
          </button>
        ))}
      </div>

      <div className="dash__grid">
        <section
          className="card dash__errors dash__panel--errors u-rise"
          style={{ animationDelay: '300ms' }}
        >
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
                  className={`errrow errrow--${g.severity} u-rise`}
                  style={{ animationDelay: `${340 + i * 50}ms` }}
                >
                  <span className={`errrow__rule sev-rule--${g.severity}`} aria-hidden />
                  <span className={`errrow__glyph sev-glyph--${g.severity}`} aria-hidden>
                    <IconWarning width={13} height={13} />
                  </span>
                  <span className="errrow__main">
                    <span className="errrow__title">
                      {g.title}
                      <span className={`sev ${SEVERITY_CLASS[g.severity]}`}>{g.severity}</span>
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

        <section
          className="card dash__activity dash__panel--activity u-rise"
          style={{ animationDelay: '360ms' }}
        >
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
