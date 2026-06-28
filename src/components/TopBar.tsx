import { useStore } from '../store/useStore'
import { isMockBackend } from '../lib/cockpit'
import { IconBranch, IconSearch, IconShield, IconWarning } from './icons'
import { UsageStrip } from './UsageStrip'

export function TopBar() {
  const dashboard = useStore((s) => s.dashboard)
  const setView = useStore((s) => s.setView)
  const pending = dashboard?.pendingApprovals ?? 0
  const errors = dashboard?.recentErrors.length ?? 0

  return (
    <header className="topbar">
      <div className="topbar__id">
        <h1 className="topbar__title">{dashboard?.project.name ?? '—'}</h1>
        <div className="topbar__chips">
          <span className="chip">
            <IconBranch width={11} height={11} />
            <span className="mono">{dashboard?.branch ?? 'no branch'}</span>
          </span>
          {dashboard && dashboard.changedFiles > 0 && (
            <button className="chip chip--accent" onClick={() => setView('git')}>
              <span className="chip__dot" />
              {dashboard.changedFiles} changed
            </button>
          )}
          {errors > 0 && (
            <button className="chip chip--danger" onClick={() => setView('logs')}>
              <IconWarning width={11} height={11} />
              {errors} {errors === 1 ? 'error' : 'errors'}
            </button>
          )}
        </div>
      </div>

      <div className="topbar__search">
        <IconSearch width={14} height={14} />
        <input
          className="topbar__searchInput mono"
          placeholder="Search files, run a command, or ask the cockpit…"
          aria-label="Command and search"
        />
        <kbd className="topbar__kbd">⌘K</kbd>
      </div>

      <div className="topbar__status">
        <UsageStrip />
        {isMockBackend() && <span className="chip chip--warning">browser preview</span>}
        <button
          className={`topbar__approvals ${pending > 0 ? 'topbar__approvals--active' : ''}`}
          onClick={() => setView('dashboard')}
          title="Pending approvals"
        >
          <IconShield width={15} height={15} />
          {pending > 0 ? (
            <span className="topbar__approvalsCount">{pending}</span>
          ) : (
            <span className="topbar__approvalsOk">secure</span>
          )}
        </button>
      </div>
    </header>
  )
}
