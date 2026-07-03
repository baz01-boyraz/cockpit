import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { cockpit } from './lib/cockpit'
import { initBlockCapture } from './store/blockStore'
import { AppShell } from './components/AppShell'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { NotepadDrawer } from './components/NotepadDrawer'

export function App() {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const switcherOpen = useStore((s) => s.projectSwitcherOpen)
  const refreshApprovals = useStore((s) => s.refreshApprovals)
  const refreshInsights = useStore((s) => s.refreshInsights)

  useEffect(() => {
    void init()
  }, [init])

  // Live-refresh approvals when the backend signals a change.
  useEffect(() => {
    const off = cockpit().approvals.onChange(() => void refreshApprovals())
    return off
  }, [refreshApprovals])

  // Live-refresh logs/insights on backend change (evtLogsChanged, wired in 2.1).
  useEffect(() => {
    const off = cockpit().logs.onChange(() => void refreshInsights())
    return off
  }, [refreshInsights])

  // One app-level subscription captures command blocks for every session —
  // blocks survive pane unmounts and are addressable by sessionId (see 3.1).
  useEffect(() => initBlockCapture(), [])

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash__mark">
          <span className="splash__glyph">⌘</span>
        </div>
        <div className="splash__title">cockpiT</div>
        <div className="splash__sub mono">initializing workspace…</div>
      </div>
    )
  }

  return (
    <>
      <AppShell />
      <NotepadDrawer />
      {switcherOpen && <ProjectSwitcher />}
    </>
  )
}
