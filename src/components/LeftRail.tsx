import { useStore, type View } from '../store/useStore'
import {
  IconBranch,
  IconChevron,
  IconDashboard,
  IconGit,
  IconLogs,
  IconMemory,
  IconRailway,
  IconSettings,
  IconTerminal,
  IconUsage,
} from './icons'
import type { ComponentType, SVGProps } from 'react'
import { UsageStrip } from './UsageStrip'
import { NotepadLauncher } from './NotepadLauncher'

interface NavItem {
  view: View
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

const NAV: NavItem[] = [
  { view: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { view: 'terminals', label: 'Terminals', Icon: IconTerminal },
  { view: 'git', label: 'Git', Icon: IconGit },
  { view: 'railway', label: 'Railway', Icon: IconRailway },
  { view: 'logs', label: 'Logs & Errors', Icon: IconLogs },
  { view: 'memory', label: 'Memory', Icon: IconMemory },
  { view: 'usage', label: 'Usage', Icon: IconUsage },
  { view: 'settings', label: 'Settings', Icon: IconSettings },
]

export function LeftRail() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const dashboard = useStore((s) => s.dashboard)
  const terminals = useStore((s) => s.terminals)
  const toggleSwitcher = useStore((s) => s.toggleSwitcher)
  const project = dashboard?.project

  const badgeFor = (v: View): string | null => {
    if (v === 'terminals' && terminals.length) return String(terminals.length)
    if (v === 'git' && dashboard?.changedFiles) return String(dashboard.changedFiles)
    if (v === 'logs' && dashboard?.recentErrors.length) return String(dashboard.recentErrors.length)
    return null
  }

  return (
    <aside className="rail">
      <div className="rail__brand">
        <div className="rail__logo">
          <span>c</span>
        </div>
        <div className="rail__brandText">
          <div className="rail__brandName">
            cockpi<span className="rail__brandT">T</span>
          </div>
          <div className="rail__brandSub mono">developer</div>
        </div>
      </div>

      <button className="rail__project" onClick={() => toggleSwitcher(true)}>
        <div className="rail__projectMain">
          <div className="rail__projectName">{project?.name ?? 'Select project'}</div>
          <div className="rail__projectBranch">
            <IconBranch width={11} height={11} />
            <span className="mono">{dashboard?.branch ?? 'no branch'}</span>
          </div>
        </div>
        <IconChevron width={14} height={14} className="rail__projectChevron" />
      </button>

      <nav className="rail__nav">
        {NAV.map(({ view: v, label, Icon }) => {
          const badge = badgeFor(v)
          return (
            <button
              key={v}
              data-nav={v}
              className={`rail__item ${view === v ? 'rail__item--active' : ''}`}
              onClick={() => setView(v)}
            >
              <Icon width={17} height={17} />
              <span className="rail__itemLabel">{label}</span>
              {badge && <span className="rail__itemBadge">{badge}</span>}
            </button>
          )
        })}
      </nav>

      <NotepadLauncher />

      <div className="rail__footer">
        <UsageStrip />
      </div>
    </aside>
  )
}
