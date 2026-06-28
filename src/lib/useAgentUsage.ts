import { useCallback, useEffect, useState } from 'react'
import type { AgentUsageSnapshot } from '@shared/domain'
import { cockpit } from './cockpit'

const POLL_MS = 60_000

/**
 * Live agent account-quota snapshots (Claude Code / Codex), polled from the
 * main process. Shared by the TopBar strip and the Usage panel so both surfaces
 * read one source of truth. Returns null until the first fetch resolves; on a
 * failed refresh the last good snapshots are kept in place.
 */
export function useAgentUsage(): AgentUsageSnapshot[] | null {
  const [snapshots, setSnapshots] = useState<AgentUsageSnapshot[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const report = await cockpit().agentUsage.get()
      setSnapshots(report.providers)
    } catch {
      // Leave the last good snapshots in place; the surface simply doesn't update.
    }
  }, [])

  useEffect(() => {
    let active = true

    void refresh()
    const timer = window.setInterval(() => {
      if (active && !document.hidden) void refresh()
    }, POLL_MS)

    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return snapshots
}
