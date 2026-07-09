/**
 * SentinelPanel — the full sentinel signal feed (Track E3). Where the top-bar
 * bell popover is a capped glance (20 newest), this is the filterable history:
 * severity chips, seen/unseen + outcome badges, Hermes triage enrichment where
 * present, and the two owner affordances (Track H) — "Create card" (signal→Swarm)
 * and "Dismiss as noise" (records the G3 outcome). Read + act; the feed itself is
 * fetched on demand, the badge count stays in the store.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SentinelSeverity, SentinelSignal } from '@shared/sentinel'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import {
  OUTCOME_META,
  SEVERITY_LABELS,
  sourceLabel,
  toHermesOpener,
} from '../lib/sentinelView'
import { IconBell, IconCheck, IconPlus, IconSend, IconX } from '../components/icons'

const FETCH_LIMIT = 200

type SeverityFilter = 'all' | SentinelSeverity
const SEVERITY_ORDER: SentinelSeverity[] = ['alert', 'notice', 'info']

export function SentinelPanel() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const openHermesWith = useStore((s) => s.openHermesWith)
  const markSignalsSeen = useStore((s) => s.markSignalsSeen)

  const [signals, setSignals] = useState<SentinelSignal[]>([])
  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

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

  const ask = (signal: SentinelSignal) => {
    openHermesWith(toHermesOpener(signal))
    if (signal.status === 'new') {
      void markSignalsSeen([signal.id])
      patch(signal.id, { status: 'seen' })
    }
  }

  const dismiss = async (signal: SentinelSignal) => {
    if (!activeProjectId) return
    // Optimistic: an explicit "noise" verdict, and clear it from the badge.
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

  const createCard = async (signal: SentinelSignal) => {
    if (!activeProjectId) return
    patch(signal.id, { outcome: 'card_created', status: 'seen' })
    void markSignalsSeen([signal.id])
    try {
      await cockpit().sentinel.createCard(activeProjectId, signal.id)
      announce('Card created in Swarm.')
    } catch {
      setError('Could not create the card. Retry in a moment.')
      patch(signal.id, { outcome: signal.outcome })
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
                onAsk={() => ask(signal)}
                onCreateCard={() => void createCard(signal)}
                onDismiss={() => void dismiss(signal)}
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
  onAsk: () => void
  onCreateCard: () => void
  onDismiss: () => void
}

function SignalRow({ signal, index, onAsk, onCreateCard, onDismiss }: SignalRowProps) {
  const { triage, outcome } = signal
  const outcomeMeta = outcome ? OUTCOME_META[outcome] : null
  const cardCreated = outcome === 'card_created'
  const dismissed = outcome === 'dismissed'

  return (
    <li
      className={`sigrow sigrow--${signal.severity} ${signal.status === 'new' ? 'sigrow--new' : ''} u-rise`}
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
    >
      <span className="sigrow__edge" aria-hidden="true" />
      <div className="sigrow__body">
        <div className="sigrow__top">
          <span className="sigrow__source">{sourceLabel(signal.source)}</span>
          <div className="sigrow__meta">
            {signal.status === 'new' && <span className="sigbadge sigbadge--new">New</span>}
            {outcomeMeta && (
              <span className={`sigbadge sigbadge--${outcomeMeta.tone}`}>{outcomeMeta.label}</span>
            )}
            <time
              className="sigrow__time mono"
              dateTime={signal.createdAt}
              title={new Date(signal.createdAt).toLocaleString()}
            >
              {relativeTime(signal.createdAt) || 'now'}
            </time>
          </div>
        </div>

        <div className="sigrow__title">{signal.title}</div>
        <div className="sigrow__summary">{signal.summary}</div>

        {triage && (
          <div className="sigtriage">
            <div className="sigtriage__head">
              <span className="sigtriage__eyebrow">Hermes triage</span>
              <span
                className={`sigbadge ${triage.reportWorthy ? 'sigbadge--accent' : 'sigbadge--muted'}`}
              >
                {triage.reportWorthy ? 'Worth attention' : 'Likely noise'}
              </span>
              {triage.gotchaCandidate && (
                <span className="sigbadge sigbadge--signal">Lesson</span>
              )}
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

        <div className="sigrow__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onAsk}>
            <IconSend width={13} height={13} />
            Ask Hermes
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onCreateCard}
            disabled={cardCreated}
          >
            {cardCreated ? <IconCheck width={13} height={13} /> : <IconPlus width={13} height={13} />}
            {cardCreated ? 'Card created' : 'Create card'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm sigrow__dismiss"
            onClick={onDismiss}
            disabled={dismissed}
          >
            <IconX width={13} height={13} />
            {dismissed ? 'Dismissed' : 'Dismiss as noise'}
          </button>
        </div>
      </div>
    </li>
  )
}
