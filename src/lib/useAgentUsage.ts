import { useSyncExternalStore } from 'react'
import type { AgentUsageSnapshot } from '@shared/domain'
import { cockpit } from './cockpit'

const POLL_MS = 60_000
/** A snapshot younger than this is served as-is when a new surface mounts. */
const FRESH_MS = 30_000

/**
 * Module-level shared poller. The hook is consumed by several always- or
 * often-mounted surfaces at once (TopBar strip, Dashboard hero, Swarm chips,
 * Usage panel); per-hook state would run one interval + one IPC fetch PER
 * surface. Instead all consumers subscribe to this single store: one interval,
 * one in-flight fetch, one snapshot reference shared by everyone.
 */
let snapshots: AgentUsageSnapshot[] | null = null
let fetchedAt = 0
let inFlight = false
let timer: number | null = null
const listeners = new Set<() => void>()

async function refresh(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const report = await cockpit().agentUsage.get()
    snapshots = report.providers
    fetchedAt = Date.now()
    for (const notify of listeners) notify()
  } catch {
    // Leave the last good snapshots in place; the surface simply doesn't update.
  } finally {
    inFlight = false
  }
}

function onVisibilityChange(): void {
  if (!document.hidden) void refresh()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  // First subscriber, or a surface (re)opening after the data went stale.
  if (Date.now() - fetchedAt > FRESH_MS) void refresh()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

function getSnapshot(): AgentUsageSnapshot[] | null {
  return snapshots
}

/**
 * Live agent account-quota snapshots (Claude Code / Codex), polled from the
 * main process. Shared by the TopBar strip, Dashboard, Swarm chips, and the
 * Usage panel so all surfaces read one source of truth. Returns null until the
 * first fetch resolves; on a failed refresh the last good snapshots are kept
 * in place.
 */
export function useAgentUsage(): AgentUsageSnapshot[] | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}
