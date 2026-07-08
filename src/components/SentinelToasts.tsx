/**
 * SentinelToasts — the app-shell-level toast host for the always-on sentinel
 * signal layer (Faz A UI). Mounted once inside `.floatingCorner` so it rides the
 * same bottom-right anchor (and the same `.shell--hermes-open` left-shift) as the
 * update toast, and is click-through outside its cards.
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
import { sourceLabel, toHermesOpener } from '../lib/sentinelView'
import { IconBolt, IconX } from './icons'
import type { SentinelSignal } from '@shared/sentinel'

/** How long a `notice` toast lingers before auto-dismissing. Alerts never auto-dismiss. */
const NOTICE_TTL_MS = 12_000
/** Toasts shown before the rest collapse into a "+N more" chip. */
const MAX_VISIBLE = 3

export function SentinelToasts() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const openHermesWith = useStore((s) => s.openHermesWith)
  const markSignalsSeen = useStore((s) => s.markSignalsSeen)
  const bumpSentinelUnseen = useStore((s) => s.bumpSentinelUnseen)

  const [toasts, setToasts] = useState<SentinelSignal[]>([])
  const [expanded, setExpanded] = useState(false)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const shownRef = useRef<Set<string>>(new Set())

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const enqueue = useCallback(
    (signal: SentinelSignal) => {
      // Guard against a replay/onAlert double-add and against re-showing a
      // signal the user already dismissed.
      if (shownRef.current.has(signal.id)) return
      shownRef.current.add(signal.id)
      setToasts((prev) => [signal, ...prev])
      if (signal.severity === 'notice') {
        const timer = setTimeout(() => dismiss(signal.id), NOTICE_TTL_MS)
        timersRef.current.set(signal.id, timer)
      }
    },
    [dismiss],
  )

  // Live push: notice/alert become toasts; every signal (incl. info) bumps the
  // bell badge. The mock never fires this — see the replay effect below.
  useEffect(() => {
    const off = cockpit().sentinel.onAlert((signal) => {
      bumpSentinelUnseen()
      if (signal.severity === 'notice' || signal.severity === 'alert') enqueue(signal)
    })
    return off
  }, [bumpSentinelUnseen, enqueue])

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

  const askHermes = (signal: SentinelSignal) => {
    openHermesWith(toHermesOpener(signal))
    void markSignalsSeen([signal.id])
    dismiss(signal.id)
  }

  if (toasts.length === 0) return null

  const visible = expanded ? toasts : toasts.slice(0, MAX_VISIBLE)
  const overflow = toasts.length - visible.length

  return (
    <div className="sentinelToasts" aria-label="Signal notifications">
      {visible.map((signal) => (
        <article
          key={signal.id}
          className={`sentinelToast sentinelToast--${signal.severity}`}
          role={signal.severity === 'alert' ? 'alert' : 'status'}
        >
          <span className="sentinelToast__edge" aria-hidden="true" />
          <div className="sentinelToast__head">
            <span className="sentinelToast__source">{sourceLabel(signal.source)}</span>
            <button
              type="button"
              className="sentinelToast__close"
              onClick={() => dismiss(signal.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              <IconX width={12} height={12} />
            </button>
          </div>
          <p className="sentinelToast__title">{signal.title}</p>
          <p className="sentinelToast__summary">{signal.summary}</p>
          <div className="sentinelToast__actions">
            <button
              type="button"
              className="sentinelToast__ask"
              onClick={() => askHermes(signal)}
            >
              <IconBolt width={13} height={13} />
              Ask Hermes
            </button>
            <button
              type="button"
              className="sentinelToast__dismiss"
              onClick={() => dismiss(signal.id)}
            >
              Dismiss
            </button>
          </div>
        </article>
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
