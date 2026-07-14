/**
 * SentinelBell — the top-bar affordance into the always-on sentinel signal feed
 * (Faz A UI). A quiet bell chip carrying an unseen-count badge; clicking it opens
 * a compact popover of recent signals (newest first, a severity edge + relative
 * time per row). Clicking a row opens the full signal center and marks it seen.
 * "Mark all seen" clears the badge in one move.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconBell, IconChevron } from './icons'
import type { SentinelSignal } from '@shared/sentinel'
import { isSignalForProject, upsertLiveSignal } from '../lib/sentinelLive'
import {
  SentinelDecisionCard,
  type SentinelDecisionAgent,
} from './SentinelDecisionCard'

export function SentinelBell() {
  const unseen = useStore((s) => s.sentinelUnseen)
  const view = useStore((s) => s.view)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setView = useStore((s) => s.setView)
  const markSignalsSeen = useStore((s) => s.markSignalsSeen)
  const refreshTerminals = useStore((s) => s.refreshTerminals)

  const [open, setOpen] = useState(false)
  const [signals, setSignals] = useState<SentinelSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<{ signalId: string; agent: SentinelDecisionAgent } | null>(null)
  const [actionError, setActionError] = useState<{ signalId: string; text: string } | null>(null)
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

  // Keep an already-open popover current and idempotent. The global event is
  // project-agnostic at the window boundary, so scope it before touching state.
  useEffect(() => {
    return cockpit().sentinel.onAlert((signal) => {
      if (!isSignalForProject(activeProjectId, signal)) return
      setSignals((current) => upsertLiveSignal(current, signal, 20))
    })
  }, [activeProjectId])

  useEffect(() => {
    setSignals([])
    setOpen(false)
    setBusy(null)
    setActionError(null)
  }, [activeProjectId])

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
    void markSignalsSeen([signal.id])
    setView('sentinel')
    setOpen(false)
  }

  const patch = (id: string, next: Partial<SentinelSignal>) =>
    setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)))

  // An explicit noise decision stays in history but clears the active badge.
  const dismiss = async (signal: SentinelSignal) => {
    if (!activeProjectId) return
    setActionError(null)
    patch(signal.id, { outcome: 'dismissed', status: 'seen' })
    void markSignalsSeen([signal.id])
    try {
      await cockpit().sentinel.recordOutcome(activeProjectId, signal.id, 'dismissed')
    } catch {
      patch(signal.id, { outcome: signal.outcome })
      setActionError({ signalId: signal.id, text: 'Could not dismiss this signal. Try again.' })
    }
  }

  // Ask opens a direct Claude/Codex terminal with bounded evidence. It does not
  // authorize a fix, restart, refresh, release, or any other follow-on action.
  const askAgent = async (signal: SentinelSignal, agent: SentinelDecisionAgent) => {
    if (!activeProjectId) return
    setBusy({ signalId: signal.id, agent })
    setActionError(null)
    try {
      await cockpit().sentinel.askAgent(activeProjectId, signal.id, agent)
      patch(signal.id, { status: 'seen' })
      void markSignalsSeen([signal.id])
      await refreshTerminals()
      setView('terminals')
      setOpen(false)
    } catch {
      setActionError({
        signalId: signal.id,
        text: `Could not open ${agent === 'claude' ? 'Claude' : 'Codex'}. Try again.`,
      })
    } finally {
      setBusy(null)
    }
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

  const openSignalCenter = () => {
    setView('sentinel')
    setOpen(false)
  }

  return (
    <div className="sentinelBell" ref={rootRef}>
      <button
        type="button"
        className={`sentinelBell__btn ${unseen > 0 ? 'sentinelBell__btn--active' : ''} ${
          view === 'sentinel' ? 'sentinelBell__btn--selected' : ''
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-current={view === 'sentinel' ? 'page' : undefined}
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
                <SentinelDecisionCard
                  key={signal.id}
                  signal={signal}
                  className={`sentinelRow sentinelRow--${signal.severity} ${
                    signal.status === 'new' ? 'sentinelRow--new' : ''
                  }`}
                  onOpen={() => pick(signal)}
                  onAsk={(agent) => void askAgent(signal, agent)}
                  onDismiss={() => void dismiss(signal)}
                  busyAgent={busy?.signalId === signal.id ? busy.agent : null}
                  error={actionError?.signalId === signal.id ? actionError.text : null}
                />
              ))
            )}
          </div>
          <div className="sentinelPopover__footer">
            <button
              type="button"
              className="sentinelPopover__openCenter"
              onClick={openSignalCenter}
              aria-label="Open signal center"
            >
              <span className="sentinelPopover__openCenterGlyph" aria-hidden="true">
                <IconBell width={16} height={16} />
              </span>
              <span className="sentinelPopover__openCenterCopy">
                <span className="sentinelPopover__openCenterTitle">Signal center</span>
                <span className="sentinelPopover__openCenterHint">History, severity, and actions</span>
              </span>
              <IconChevron width={14} height={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
