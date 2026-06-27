import { useStore } from '../store/useStore'
import { LeftRail } from './LeftRail'
import { TopBar } from './TopBar'
import { RightPanel } from './RightPanel'
import { DashboardPanel } from '../panels/DashboardPanel'
import { TerminalsPanel } from '../panels/TerminalsPanel'
import { GitPanel } from '../panels/GitPanel'
import { RailwayPanel } from '../panels/RailwayPanel'
import { LogsPanel } from '../panels/LogsPanel'
import { UsagePanel } from '../panels/UsagePanel'
import { SettingsPanel } from '../panels/SettingsPanel'

export function AppShell() {
  const view = useStore((s) => s.view)

  return (
    <div className="shell">
      <LeftRail />
      <div className="shell__center">
        <TopBar />
        <main className="shell__main scroll-y" key={view}>
          {view === 'dashboard' && <DashboardPanel />}
          {view === 'terminals' && <TerminalsPanel />}
          {view === 'git' && <GitPanel />}
          {view === 'railway' && <RailwayPanel />}
          {view === 'logs' && <LogsPanel />}
          {view === 'usage' && <UsagePanel />}
          {view === 'settings' && <SettingsPanel />}
        </main>
      </div>
      <RightPanel />
    </div>
  )
}
