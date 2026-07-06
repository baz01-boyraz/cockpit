import { useStore } from '../store/useStore'
import { CHAT_ENABLED } from '../lib/features'
import { LeftRail } from './LeftRail'
import { TopBar } from './TopBar'
import { RightPanel } from './RightPanel'
import { UpdateToast } from './UpdateToast'
import { HermesWidget } from './HermesWidget'
import { IconBolt } from './icons'
import { DashboardPanel } from '../panels/DashboardPanel'
import { TerminalsPanel } from '../panels/TerminalsPanel'
import { GitPanel } from '../panels/GitPanel'
import { SwarmPanel } from '../panels/SwarmPanel'
import { RailwayPanel } from '../panels/RailwayPanel'
import { LogsPanel } from '../panels/LogsPanel'
import { MemoryPanel } from '../panels/MemoryPanel'
import { UsagePanel } from '../panels/UsagePanel'
import { SettingsPanel } from '../panels/SettingsPanel'

export function AppShell() {
  const view = useStore((s) => s.view)
  const chatOpen = useStore((s) => s.chatOpen)
  const toggleChat = useStore((s) => s.toggleChat)
  const hermesOpen = useStore((s) => s.hermesOpen)

  // Chat is shelved behind a flag (see lib/features). When off, the AI Cockpit
  // panel and its launcher are not rendered and the shell runs full-width —
  // that's also the only state Hermes docks into today (`shell--hermes-open`
  // widens a 3rd grid column); if CHAT_ENABLED ever comes back, the two
  // docked panels sharing the grid needs a real decision, not a guess here.
  const shellClass = !CHAT_ENABLED
    ? `shell shell--no-chat ${hermesOpen ? 'shell--hermes-open' : ''}`.trim()
    : chatOpen
      ? 'shell'
      : 'shell shell--chat-collapsed'

  return (
    <div className={shellClass}>
      <LeftRail />
      <div className="shell__center">
        <TopBar />
        <main className="shell__main scroll-y">
          {view === 'dashboard' && <DashboardPanel />}
          <section
            className={`viewSlot viewSlot--terminals ${
              view === 'terminals' ? 'viewSlot--active' : 'viewSlot--hidden'
            }`}
            aria-hidden={view !== 'terminals'}
          >
            <TerminalsPanel panelActive={view === 'terminals'} />
          </section>
          {view === 'git' && <GitPanel />}
          {view === 'swarm' && <SwarmPanel />}
          {view === 'railway' && <RailwayPanel />}
          {view === 'logs' && <LogsPanel />}
          {view === 'memory' && <MemoryPanel />}
          {view === 'usage' && <UsagePanel />}
          {view === 'settings' && <SettingsPanel />}
        </main>
      </div>
      {!CHAT_ENABLED && <HermesWidget />}
      <div className="floatingCorner">
        <UpdateToast />
      </div>
      {CHAT_ENABLED && <RightPanel />}
      {CHAT_ENABLED && (
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
      )}
    </div>
  )
}
