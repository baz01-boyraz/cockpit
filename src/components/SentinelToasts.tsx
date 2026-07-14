/**
 * SentinelToasts — the app-shell-level toast host for the always-on sentinel
 * signal layer (Faz A UI). Mounted once inside `.floatingCorner` so it rides the
 * same bottom-right anchor as the update toast and is click-through outside its cards.
 *
 * Delivery follows the severity contract (shared/sentinel.ts): `info` never
 * toasts (feed only), `notice` shows a quiet toast that auto-dismisses, `alert`
 * shows a hotter toast that stays until acted on. At most three are visible;
 * the rest collapse into a "+N more" chip that expands the stack in place.
 *
 * The real backend pushes via `sentinel.onAlert`; the browser-preview mock never
 * emits it, so in mock mode we replay the project's seeded notice/alert signals
 * once — a faithful stand-in for push delivery that keeps the preview + the
 * screenshot workflow honest, with no debug globals.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit, isMockBackend } from '../lib/cockpit'
import type { SentinelSignal } from '@shared/sentinel'
import { isSignalForProject } from '../lib/sentinelLive'
import {
  SentinelDecisionCard,
  type SentinelDecisionAgent,
} from './SentinelDecisionCard'

/** How long a `notice` toast lingers before auto-dismissing. Alerts never auto-dismiss. */
const NOTICE_TTL_MS = 12_000
/** Toasts shown before the rest collapse into a "+N more" chip. */
const MAX_VISIBLE = 3

export function SentinelToasts() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const markSignalsSeen = useStore((s) => s.markSignalsSeen)
  const refreshSentinelUnseen = useStore((s) => s.refreshSentinelUnseen)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const setView = useStore((s) => s.setView)

  const [toasts, setToasts] = useState<SentinelSignal[]>([])
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<{ signalId: string; agent: SentinelDecisionAgent } | null>(null)
  const [actionError, setActionError] = useState<{ signalId: string; text: string } | null>(null)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const shownRef = useRef<Set<string>>(new Set())

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const enqueue = useCallback(
    (signal: SentinelSignal) => {
      // A repeat id is the triage re-emit (the enriched signal rides the same
      // sentinel:alert event with the same id): update the visible toast in
      // place. A repeat for a toast already dismissed stays dismissed — the
      // enrichment is not a reason to resurface it.
      if (shownRef.current.has(signal.id)) {
        setToasts((prev) => prev.map((s) => (s.id === signal.id ? signal : s)))
        return
      }
      shownRef.current.add(signal.id)
      setToasts((prev) => [signal, ...prev])
      if (signal.severity === 'notice') {
        const timer = setTimeout(() => removeToast(signal.id), NOTICE_TTL_MS)
        timersRef.current.set(signal.id, timer)
      }
    },
    [removeToast],
  )

  // Toast state belongs to one active project. Switching workspaces must not
  // leave the prior project's cards, timers, or id-dedup history on screen.
  useEffect(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current.clear()
    shownRef.current.clear()
    setToasts([])
    setExpanded(false)
    setBusy(null)
    setActionError(null)
  }, [activeProjectId])

  // Live push: notice/alert become toasts; every signal (incl. info) bumps the
  // active project's authoritative bell count. Re-emits reuse an id, so a
  // fresh count read stays idempotent where a blind increment could not.
  useEffect(() => {
    const off = cockpit().sentinel.onAlert((signal) => {
      if (!isSignalForProject(activeProjectId, signal)) return
      void refreshSentinelUnseen()
      if (signal.severity === 'notice' || signal.severity === 'alert') enqueue(signal)
    })
    return off
  }, [activeProjectId, enqueue, refreshSentinelUnseen])

  // Browser-preview only: stand in for push delivery by replaying the project's
  // seeded notice/alert signals once. Oldest first so the freshest lands on top.
  useEffect(() => {
    if (!isMockBackend() || !activeProjectId) return
    let cancelled = false
    void cockpit()
      .sentinel.list(activeProjectId)
      .then((signals) => {
        if (cancelled) return
        signals
          .filter(
            (s) => (s.severity === 'notice' || s.severity === 'alert') && s.status === 'new',
          )
          .slice()
          .reverse()
          .forEach(enqueue)
      })
    return () => {
      cancelled = true
    }
  }, [activeProjectId, enqueue])

  // Clear every pending auto-dismiss timer on unmount.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  const dismissDecision = async (signal: SentinelSignal) => {
    if (!activeProjectId) return
    setActionError(null)
    void markSignalsSeen([signal.id])
    removeToast(signal.id)
    try {
      await cockpit().sentinel.recordOutcome(activeProjectId, signal.id, 'dismissed')
    } catch {
      setToasts((current) =>
        current.some((item) => item.id === signal.id) ? current : [signal, ...current],
      )
      setActionError({ signalId: signal.id, text: 'Could not dismiss this signal. Try again.' })
    }
  }

  const askAgent = async (signal: SentinelSignal, agent: SentinelDecisionAgent) => {
    if (!activeProjectId) return
    setBusy({ signalId: signal.id, agent })
    setActionError(null)
    try {
      await cockpit().sentinel.askAgent(activeProjectId, signal.id, agent)
      void markSignalsSeen([signal.id])
      removeToast(signal.id)
      await refreshTerminals()
      setView('terminals')
    } catch {
      setActionError({
        signalId: signal.id,
        text: `Could not open ${agent === 'claude' ? 'Claude' : 'Codex'}. Try again.`,
      })
    } finally {
      setBusy(null)
    }
  }

  if (toasts.length === 0) return null

  const visible = expanded ? toasts : toasts.slice(0, MAX_VISIBLE)
  const overflow = toasts.length - visible.length

  return (
    <div className="sentinelToasts" aria-label="Signal notifications">
      {visible.map((signal) => (
        <SentinelDecisionCard
          key={signal.id}
          signal={signal}
          className={`sentinelToast sentinelToast--${signal.severity}`}
          role={signal.severity === 'alert' ? 'alert' : 'status'}
          onAsk={(agent) => void askAgent(signal, agent)}
          onDismiss={() => void dismissDecision(signal)}
          busyAgent={busy?.signalId === signal.id ? busy.agent : null}
          error={actionError?.signalId === signal.id ? actionError.text : null}
        />
      ))}

      {overflow > 0 && (
        <button
          type="button"
          className="sentinelToasts__more"
          onClick={() => setExpanded(true)}
        >
          +{overflow} more
        </button>
      )}
      {expanded && toasts.length > MAX_VISIBLE && (
        <button
          type="button"
          className="sentinelToasts__more"
          onClick={() => setExpanded(false)}
        >
          Show fewer
        </button>
      )}
    </div>
  )
}
