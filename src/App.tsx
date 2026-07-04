import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { cockpit } from './lib/cockpit'
import { initBlockCapture } from './store/blockStore'
import { initSwarmActivity } from './store/swarmActivityStore'
import { AppShell } from './components/AppShell'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { NotepadDrawer } from './components/NotepadDrawer'

/** How long consecutive logs:changed events are batched into one refetch. */
const LOGS_REFRESH_COALESCE_MS = 250

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
  // A chatty build can emit one logs:changed per output chunk; coalesce them so
  // the renderer runs at most one insights+logs refetch per window instead of
  // storming IPC while a terminal is spewing warnings.
  useEffect(() => {
    let timer: number | null = null
    const off = cockpit().logs.onChange(() => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void refreshInsights()
      }, LOGS_REFRESH_COALESCE_MS)
    })
    return () => {
      off()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [refreshInsights])

  // One app-level subscription captures command blocks for every session —
  // blocks survive pane unmounts and are addressable by sessionId (see 3.1).
  useEffect(() => initBlockCapture(), [])

  // Output heartbeat for the Swarm board's running cards (timestamps only).
  useEffect(() => initSwarmActivity(), [])

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
