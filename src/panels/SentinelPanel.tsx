/**
 * SentinelPanel — the full sentinel signal feed (Track E3). Where the top-bar
 * bell popover is a capped glance (20 newest), this is the filterable history:
 * severity chips, seen/unseen + outcome badges, legacy triage enrichment where
 * present, and the owner decisions — ask Claude, ask Codex, or dismiss as noise.
 * Read + act; the feed itself is
 * fetched on demand, the badge count stays in the store.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SentinelSeverity, SentinelSignal } from '@shared/sentinel'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { SEVERITY_LABELS } from '../lib/sentinelView'
import { IconBell, IconCheck } from '../components/icons'
import { isSignalForProject, upsertLiveSignal } from '../lib/sentinelLive'
import {
  SentinelDecisionCard,
  type SentinelDecisionAgent,
} from '../components/SentinelDecisionCard'

const FETCH_LIMIT = 200

type SeverityFilter = 'all' | SentinelSeverity
const SEVERITY_ORDER: SentinelSeverity[] = ['alert', 'notice', 'info']

export function SentinelPanel() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const markSignalsSeen = useStore((s) => s.markSignalsSeen)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const setView = useStore((s) => s.setView)

  const [signals, setSignals] = useState<SentinelSignal[]>([])
  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ signalId: string; agent: SentinelDecisionAgent } | null>(null)
  const [actionError, setActionError] = useState<{ signalId: string; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!activeProjectId) {
      setSignals([])
      return
    }
    setLoading(true)
    try {
      const list = await cockpit().sentinel.list(activeProjectId, { limit: FETCH_LIMIT })
      setSignals(list)
      setError(null)
    } catch {
      setError('Could not load the signal feed. Retry in a moment.')
    } finally {
      setLoading(false)
    }
  }, [activeProjectId])

  useEffect(() => {
    void load()
  }, [load])

  // Keep an open signal center live. Triage publishes the same id again, so
  // replace in place; other projects' broadcasts never enter this feed.
  useEffect(() => {
    return cockpit().sentinel.onAlert((signal) => {
      if (!isSignalForProject(activeProjectId, signal)) return
      setSignals((current) => upsertLiveSignal(current, signal, FETCH_LIMIT))
    })
  }, [activeProjectId])

  // A quiet, self-clearing confirmation line (card created / dismissed).
  const flashTimer = useRef<number | null>(null)
  const announce = useCallback((text: string) => {
    setFlash(text)
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 3200)
  }, [])
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    [],
  )

  const patch = (id: string, next: Partial<SentinelSignal>) =>
    setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)))

  const counts = useMemo(() => {
    const by: Record<SentinelSeverity, number> = { alert: 0, notice: 0, info: 0 }
    for (const s of signals) by[s.severity] += 1
    return by
  }, [signals])

  const visible = useMemo(
    () => (severity === 'all' ? signals : signals.filter((s) => s.severity === severity)),
    [signals, severity],
  )

  const unseenCount = useMemo(() => signals.filter((s) => s.status === 'new').length, [signals])

  const markAll = () => {
    const ids = signals.filter((s) => s.status === 'new').map((s) => s.id)
    if (ids.length === 0) return
    void markSignalsSeen(ids)
    setSignals((prev) => prev.map((s) => (s.status === 'new' ? { ...s, status: 'seen' } : s)))
  }

  const dismiss = async (signal: SentinelSignal) => {
    if (!activeProjectId) return
    // Optimistic: an explicit "noise" verdict, and clear it from the badge.
    setActionError(null)
    patch(signal.id, { outcome: 'dismissed', status: 'seen' })
    void markSignalsSeen([signal.id])
    try {
      await cockpit().sentinel.recordOutcome(activeProjectId, signal.id, 'dismissed')
      announce('Marked as noise.')
    } catch {
      setError('Could not record the outcome. Retry in a moment.')
      patch(signal.id, { outcome: signal.outcome })
    }
  }

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
    } catch {
      setActionError({
        signalId: signal.id,
        text: `Could not open ${agent === 'claude' ? 'Claude' : 'Codex'}. Try again.`,
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel panel--stagger sentinel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">signal feed</div>
          <h2 className="panel__title">
            <IconBell width={18} height={18} /> Sentinel
          </h2>
        </div>
        <div className="panel__actions">
          {unseenCount > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={markAll}>
              Mark all seen
              <span className="sentinel__markCount">{unseenCount}</span>
            </button>
          )}
        </div>
      </div>

      <div className="sentinel__filters" role="group" aria-label="Filter signals by severity">
        <button
          type="button"
          className={`sigchip ${severity === 'all' ? 'sigchip--on' : ''}`}
          aria-pressed={severity === 'all'}
          onClick={() => setSeverity('all')}
        >
          All
          <span className="sigchip__count">{signals.length}</span>
        </button>
        {SEVERITY_ORDER.map((sev) => (
          <button
            key={sev}
            type="button"
            className={`sigchip sigchip--${sev} ${severity === sev ? 'sigchip--on' : ''}`}
            aria-pressed={severity === sev}
            onClick={() => setSeverity(sev)}
          >
            <span className="sigchip__dot" aria-hidden="true" />
            {SEVERITY_LABELS[sev]}
            <span className="sigchip__count">{counts[sev]}</span>
          </button>
        ))}
      </div>

      {flash && (
        <div className="sentinel__flash" role="status">
          <IconCheck width={13} height={13} />
          {flash}
        </div>
      )}
      {error && (
        <div className="sentinel__error" role="alert">
          {error}
        </div>
      )}

      <section className="card sentinel__card u-rise">
        {visible.length === 0 ? (
          <div className="emptyline sentinel__empty">
            <IconBell width={22} height={22} />
            <span>
              {loading
                ? 'Checking for signals…'
                : signals.length === 0
                  ? 'All quiet. Sensors surface log errors, worker exits, approvals, and council verdicts here.'
                  : 'No signals match this severity.'}
            </span>
          </div>
        ) : (
          <ul className="siglist">
            {visible.map((signal, i) => (
              <SignalRow
                key={signal.id}
                signal={signal}
                index={i}
                onAsk={(agent) => void askAgent(signal, agent)}
                onDismiss={() => void dismiss(signal)}
                busyAgent={busy?.signalId === signal.id ? busy.agent : null}
                error={actionError?.signalId === signal.id ? actionError.text : null}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

interface SignalRowProps {
  signal: SentinelSignal
  index: number
  onAsk: (agent: SentinelDecisionAgent) => void
  onDismiss: () => void
  busyAgent: SentinelDecisionAgent | null
  error: string | null
}

function SignalRow({ signal, index, onAsk, onDismiss, busyAgent, error }: SignalRowProps) {
  const { triage } = signal

  return (
    <li
      className={`sigrow sigrow--${signal.severity} ${signal.status === 'new' ? 'sigrow--new' : ''} u-rise`}
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
    >
      <SentinelDecisionCard
        signal={signal}
        className="sigrow__decision"
        onAsk={onAsk}
        onDismiss={onDismiss}
        busyAgent={busyAgent}
        error={error}
      />

      {triage && (
        <div className="sigtriage">
          <div className="sigtriage__head">
            <span className="sigtriage__eyebrow">Legacy triage</span>
            <span
              className={`sigbadge ${triage.reportWorthy ? 'sigbadge--accent' : 'sigbadge--muted'}`}
            >
              {triage.reportWorthy ? 'Worth attention' : 'Likely noise'}
            </span>
            {triage.gotchaCandidate && <span className="sigbadge sigbadge--signal">Lesson</span>}
          </div>
          <div className="sigtriage__headline">{triage.headline}</div>
          <div className="sigtriage__action">
            <span className="sigtriage__arrow" aria-hidden="true">
              →
            </span>
            {triage.action}
          </div>
        </div>
      )}

      {signal.context && <div className="sigrow__context mono">{signal.context}</div>}
    </li>
  )
}
