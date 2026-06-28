import { useStore } from '../store/useStore'
import { LeftRail } from './LeftRail'
import { TopBar } from './TopBar'
import { RightPanel } from './RightPanel'
import { IconBolt } from './icons'
import { DashboardPanel } from '../panels/DashboardPanel'
import { TerminalsPanel } from '../panels/TerminalsPanel'
import { GitPanel } from '../panels/GitPanel'
import { RailwayPanel } from '../panels/RailwayPanel'
import { LogsPanel } from '../panels/LogsPanel'
import { UsagePanel } from '../panels/UsagePanel'
import { SettingsPanel } from '../panels/SettingsPanel'

export function AppShell() {
  const view = useStore((s) => s.view)
  const chatOpen = useStore((s) => s.chatOpen)
  const toggleChat = useStore((s) => s.toggleChat)

  return (
    <div className={chatOpen ? 'shell' : 'shell shell--chat-collapsed'}>
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
      <button
        type="button"
        className={`chatLauncher ${chatOpen ? 'is-hidden' : 'is-shown'}`}
        onClick={() => toggleChat(true)}
        aria-label="Open AI Cockpit"
        aria-controls="ai-cockpit-panel"
        aria-expanded={chatOpen}
        title="Open AI Cockpit"
        aria-hidden={chatOpen}
        tabIndex={chatOpen ? -1 : 0}
      >
        <span className="chatLauncher__ring" aria-hidden="true" />
        <IconBolt width={20} height={20} />
      </button>
    </div>
  )
}
