import { useEffect, useMemo, useState } from 'react'
import type { AuditActor, AuditEntry } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import { prettyAuditSummary } from '@shared/dashboard-insights'
import { ApprovalCard } from '../components/ApprovalCard'
import { IconSearch, IconShield, IconShieldSearch, IconX } from '../components/icons'

type AuditTab = 'trail' | 'approvals'

const PAGE = 20

/** `ai` reads as "Agent" in the trail — the same taxonomy the roadmap uses. */
const ACTOR_LABEL: Record<AuditActor, string> = {
  user: 'User',
  ai: 'Agent',
  system: 'System',
}

/**
 * A one-line, redacted digest of an audit row's payload. Values are already
 * masked upstream (`payloadRedacted`); this only flattens the shape for a glance
 * and truncates long values. Returns null when there's nothing to show so the
 * row stays clean.
 */
function payloadSummary(payload: Record<string, unknown>): string | null {
  const keys = Object.keys(payload)
  if (keys.length === 0) return null
  const parts = keys.slice(0, 4).map((k) => {
    const raw = payload[k]
    const val = raw !== null && typeof raw === 'object' ? '{…}' : String(raw)
    return `${k}=${val.length > 28 ? `${val.slice(0, 28)}…` : val}`
  })
  const more = keys.length > 4 ? ` +${keys.length - 4}` : ''
  return parts.join('  ·  ') + more
}

export function AuditPanel() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const approvals = useStore((s) => s.approvals)

  const [tab, setTab] = useState<AuditTab>('trail')
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [query, setQuery] = useState('')
  const [actionType, setActionType] = useState<string>('all')
  const [limit, setLimit] = useState(PAGE)

  // Fetch the full audit trail on project change / mount. The panel re-mounts
  // each time it's opened (AppShell renders views conditionally), so a mount
  // fetch keeps it fresh without the dashboard's refetch-on-every-approval churn.
  useEffect(() => {
    let alive = true
    if (!activeProjectId) {
      setEntries([])
      return
    }
    void cockpit()
      .audit.list(activeProjectId)
      .then((rows) => {
        if (alive) setEntries(rows)
      })
    return () => {
      alive = false
    }
  }, [activeProjectId])

  const actionTypes = useMemo(
    () => Array.from(new Set(entries.map((e) => e.actionType))).sort(),
    [entries],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (actionType !== 'all' && e.actionType !== actionType) return false
      if (!q) return true
      return (
        e.summary.toLowerCase().includes(q) ||
        e.actionType.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q)
      )
    })
  }, [entries, query, actionType])

  // Past approval decisions — pending ones deliberately stay on the Dashboard.
  const history = useMemo(() => approvals.filter((a) => a.status !== 'pending'), [approvals])

  const visible = filtered.slice(0, limit)
  const remaining = filtered.length - visible.length

  const pickAction = (t: string) => {
    setActionType(t)
    setLimit(PAGE)
  }

  const onQuery = (v: string) => {
    setQuery(v)
    setLimit(PAGE)
  }

  return (
    <div className="panel panel--stagger">
      <div className="panel__header">
        <div>
          <div className="eyebrow">accountability</div>
          <h2 className="panel__title">
            <IconShieldSearch width={18} height={18} /> Audit &amp; approvals
          </h2>
        </div>
      </div>

      <div className="audit__tabs" role="tablist" aria-label="Audit views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'trail'}
          className={`tab ${tab === 'trail' ? 'tab--active' : ''}`}
          onClick={() => setTab('trail')}
        >
          Audit trail
          <span className="tab__count">{entries.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'approvals'}
          className={`tab ${tab === 'approvals' ? 'tab--active' : ''}`}
          onClick={() => setTab('approvals')}
        >
          Approvals history
          <span className="tab__count">{history.length}</span>
        </button>
      </div>

      {tab === 'trail' ? (
        <section className="card audit__card u-rise">
          <div className="audit__controls">
            <label className="audit__search">
              <IconSearch width={14} height={14} />
              <input
                className="audit__searchInput"
                type="search"
                placeholder="Filter by summary, action, or actor…"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                aria-label="Filter audit trail"
              />
              {query && (
                <button
                  type="button"
                  className="audit__searchClear"
                  onClick={() => onQuery('')}
                  aria-label="Clear filter"
                >
                  <IconX width={12} height={12} />
                </button>
              )}
            </label>
            {actionTypes.length > 0 && (
              <div className="audit__chips" role="group" aria-label="Filter by action type">
                <button
                  type="button"
                  className={`auditchip ${actionType === 'all' ? 'auditchip--on' : ''}`}
                  aria-pressed={actionType === 'all'}
                  onClick={() => pickAction('all')}
                >
                  All
                </button>
                {actionTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`auditchip auditchip--mono ${actionType === t ? 'auditchip--on' : ''}`}
                    aria-pressed={actionType === t}
                    onClick={() => pickAction(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="emptyline">
              {entries.length === 0
                ? 'No recorded activity yet. Agent and user actions land here, redacted.'
                : 'No entries match this filter.'}
            </div>
          ) : (
            <>
              <ul className="auditlist">
                {visible.map((e, i) => {
                  const payload = payloadSummary(e.payloadRedacted)
                  return (
                    <li
                      key={e.id}
                      className="auditrow u-rise"
                      style={{ animationDelay: `${Math.min(i, 10) * 24}ms` }}
                    >
                      <span className={`auditrow__actor auditrow__actor--${e.actor}`}>
                        <span className="auditrow__dot" aria-hidden />
                        {ACTOR_LABEL[e.actor]}
                      </span>
                      <span className="auditrow__body">
                        <span className="auditrow__line">
                          <span className="auditrow__action mono">{e.actionType}</span>
                          <time
                            className="auditrow__time mono"
                            dateTime={e.createdAt}
                            title={new Date(e.createdAt).toLocaleString()}
                          >
                            {relativeTime(e.createdAt)}
                          </time>
                        </span>
                        <span className="auditrow__summary">{prettyAuditSummary(e.summary)}</span>
                        {payload && <span className="auditrow__payload mono">{payload}</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {remaining > 0 && (
                <button
                  type="button"
                  className="actlist__more"
                  onClick={() => setLimit((n) => n + PAGE)}
                >
                  Load {Math.min(PAGE, remaining)} more · {remaining} remaining
                </button>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="card audit__card u-rise">
          {history.length === 0 ? (
            <div className="emptyline audit__approvalsEmpty">
              <IconShield width={22} height={22} />
              <span>No past approval decisions yet.</span>
              <span className="audit__approvalsEmptyHint">
                Pending requests wait for you on the Dashboard; once decided, they settle here.
              </span>
            </div>
          ) : (
            <div className="audit__approvals">
              {history.map((a) => (
                <ApprovalCard key={a.id} request={a} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
