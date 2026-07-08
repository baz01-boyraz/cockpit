/**
 * SentinelBell — the top-bar affordance into the always-on sentinel signal feed
 * (Faz A UI). A quiet bell chip carrying an unseen-count badge; clicking it opens
 * a compact popover of recent signals (newest first, a severity edge + relative
 * time per row). Clicking a row is the same "continue from the notification"
 * handoff as a toast — it opens Hermes with the signal's context and marks it
 * seen. "Mark all seen" clears the badge in one move.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import { sourceLabel, toHermesOpener } from '../lib/sentinelView'
import { IconBell } from './icons'
import type { SentinelSignal } from '@shared/sentinel'

export function SentinelBell() {
  const unseen = useStore((s) => s.sentinelUnseen)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const openHermesWith = useStore((s) => s.openHermesWith)
  const markSignalsSeen = useStore((s) => s.markSignalsSeen)

  const [open, setOpen] = useState(false)
  const [signals, setSignals] = useState<SentinelSignal[]>([])
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setSignals([])
      return
    }
    setLoading(true)
    try {
      const list = await cockpit().sentinel.list(activeProjectId, { limit: 20 })
      setSignals(list)
    } catch {
      // Best-effort — a failed read keeps whatever the popover last showed.
    } finally {
      setLoading(false)
    }
  }, [activeProjectId])

  // Fetch the feed each time the popover opens (cheap, always fresh).
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Dismiss on outside click / Escape while the popover is open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (signal: SentinelSignal) => {
    openHermesWith(toHermesOpener(signal))
    void markSignalsSeen([signal.id])
    setOpen(false)
  }

  const markAll = () => {
    const newIds = signals.filter((s) => s.status === 'new').map((s) => s.id)
    if (newIds.length === 0) return
    void markSignalsSeen(newIds)
    setSignals((prev) =>
      prev.map((s) => (s.status === 'new' ? { ...s, status: 'seen' as const } : s)),
    )
  }

  const hasUnseen = signals.some((s) => s.status === 'new')

  return (
    <div className="sentinelBell" ref={rootRef}>
      <button
        type="button"
        className={`sentinelBell__btn ${unseen > 0 ? 'sentinelBell__btn--active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unseen > 0 ? `${unseen} unseen signals` : 'Signals — all quiet'}
        title="Signals"
      >
        <IconBell width={15} height={15} />
        {unseen > 0 && (
          <span className="sentinelBell__badge" aria-hidden="true">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>

      {open && (
        <div className="sentinelPopover" role="dialog" aria-label="Recent signals">
          <div className="sentinelPopover__head">
            <span className="sentinelPopover__title">Signals</span>
            {hasUnseen && (
              <button type="button" className="sentinelPopover__markAll" onClick={markAll}>
                Mark all seen
              </button>
            )}
          </div>

          <div className="sentinelPopover__list scroll-y">
            {signals.length === 0 ? (
              <div className="sentinelPopover__empty">
                <span className="sentinelPopover__emptyGlyph" aria-hidden="true">
                  <IconBell width={18} height={18} />
                </span>
                <span className="sentinelPopover__emptyText">
                  {loading ? 'Checking for signals…' : 'All quiet.'}
                </span>
              </div>
            ) : (
              signals.map((signal) => (
                <button
                  key={signal.id}
                  type="button"
                  className={`sentinelRow sentinelRow--${signal.severity} ${
                    signal.status === 'new' ? 'sentinelRow--new' : ''
                  }`}
                  onClick={() => pick(signal)}
                >
                  <span className="sentinelRow__edge" aria-hidden="true" />
                  <span className="sentinelRow__body">
                    <span className="sentinelRow__top">
                      <span className="sentinelRow__source">{sourceLabel(signal.source)}</span>
                      <span className="sentinelRow__time mono">
                        {relativeTime(signal.createdAt) || 'now'}
                      </span>
                    </span>
                    <span className="sentinelRow__title">{signal.title}</span>
                    <span className="sentinelRow__summary">{signal.summary}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
