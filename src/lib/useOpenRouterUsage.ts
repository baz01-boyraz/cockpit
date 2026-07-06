import { useEffect, useState } from 'react'
import type { OpenRouterUsageSnapshot } from '@shared/domain'
import { cockpit } from './cockpit'

const POLL_MS = 60_000

/**
 * Live OpenRouter credit snapshot for the Hermes engine core's quota ring.
 * Single consumer (UsageStrip), so this is a plain poll rather than
 * useAgentUsage's shared multi-subscriber store — no need for that dedup
 * machinery here. Keeps the last good snapshot in place on a failed refresh.
 */
export function useOpenRouterUsage(): OpenRouterUsageSnapshot | null {
  const [snapshot, setSnapshot] = useState<OpenRouterUsageSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const next = await cockpit().openRouterUsage.status()
        if (!cancelled) setSnapshot(next)
      } catch {
        // Leave the last good snapshot in place; the ring simply doesn't update.
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, POLL_MS)
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return snapshot
}
