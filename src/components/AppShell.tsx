import { useStore } from '../store/useStore'
import { CHAT_ENABLED } from '../lib/features'
import { LeftRail } from './LeftRail'
import { TopBar } from './TopBar'
import { RightPanel } from './RightPanel'
import { UpdateToast } from './UpdateToast'
import { SentinelToasts } from './SentinelToasts'
import { MemoryCaptureToasts } from './MemoryCaptureToasts'
import { IconBolt } from './icons'
import { DashboardPanel } from '../panels/DashboardPanel'
import { TerminalsPanel } from '../panels/TerminalsPanel'
import { GitPanel } from '../panels/GitPanel'
import { SwarmPanel } from '../panels/SwarmPanel'
import { CouncilPanel } from '../panels/CouncilPanel'
import { RailwayPanel } from '../panels/RailwayPanel'
import { LogsPanel } from '../panels/LogsPanel'
import { AuditPanel } from '../panels/AuditPanel'
import { SentinelPanel } from '../panels/SentinelPanel'
import { MemoryPanel } from '../panels/MemoryPanel'
import { UsagePanel } from '../panels/UsagePanel'
import { SettingsPanel } from '../panels/SettingsPanel'

export function AppShell() {
  const view = useStore((s) => s.view)
  const chatOpen = useStore((s) => s.chatOpen)
  const toggleChat = useStore((s) => s.toggleChat)

  // Chat is shelved behind a flag (see lib/features). When off, the AI Cockpit
  // panel and its launcher are not rendered and the shell runs full-width.
  const shellClass = !CHAT_ENABLED
    ? 'shell shell--no-chat'
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
          {view === 'council' && <CouncilPanel />}
          {view === 'railway' && <RailwayPanel />}
          {view === 'logs' && <LogsPanel />}
          {view === 'audit' && <AuditPanel />}
          {view === 'sentinel' && <SentinelPanel />}
          {view === 'memory' && <MemoryPanel />}
          {view === 'usage' && <UsagePanel />}
          {view === 'settings' && <SettingsPanel />}
        </main>
      </div>
      <div className="floatingCorner">
        <UpdateToast />
        <MemoryCaptureToasts />
        <SentinelToasts />
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
