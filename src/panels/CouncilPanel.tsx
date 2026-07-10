import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import type { CouncilSessionSummary, ScorecardEntry } from '@shared/council'
import { COUNCIL_SEATS } from '@shared/council'
import { councilHistoryPresentation, visibleCouncilSessions } from '@shared/council-history'
import { CouncilVerdict } from '../components/CouncilVerdict'
import { CouncilScorecard } from '../components/CouncilScorecard'
import { IconCheck, IconCouncil, IconWarning, IconX } from '../components/icons'

/** A persisted session's headline for the active-run surface when it is browsed. */
function sessionTitle(summary: CouncilSessionSummary): string {
  if (summary.question && summary.question.trim().length > 0) return summary.question
  return summary.mode === 'spec' ? 'Spec-gate deliberation' : 'Diff-review deliberation'
}

/**
 * Council — a standalone deliberation surface (roadmap E4). Type a free-form
 * spec or question, convene the five-seat council in `spec` mode, and read the
 * gate verdict + seat standings with the same components the board uses.
 *
 * The run state lives in the store's council slice, not in component state, so a
 * verdict — or an in-flight run's spinner — survives leaving and returning to
 * this view. The history list is the persisted `council:sessions` (cross-restart);
 * clicking a row rehydrates its full verdict through the `council:session` detail
 * channel. That closes the old "held for this session only" gap.
 */
export function CouncilPanel() {
  const projectId = useStore((s) => s.activeProjectId)
  const active = useStore((s) => s.councilActive)
  const convening = useStore((s) => s.councilConvening)
  const notice = useStore((s) => s.councilNotice)
  const conveneCouncil = useStore((s) => s.conveneCouncil)
  const setCouncilActive = useStore((s) => s.setCouncilActive)
  const clearCouncilNotice = useStore((s) => s.clearCouncilNotice)
  const resetCouncil = useStore((s) => s.resetCouncil)

  const [spec, setSpec] = useState('')
  const [sessions, setSessions] = useState<CouncilSessionSummary[] | null>(null)
  const [scorecard, setScorecard] = useState<ScorecardEntry[] | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)

  // Persisted history + cross-session standings, both project-scoped. A stale
  // list from another project must never flash under a new one.
  const loadHistory = useCallback(async () => {
    if (!projectId) return
    try {
      const [list, rows] = await Promise.all([
        cockpit().council.sessions(projectId),
        cockpit().council.scorecard(projectId),
      ])
      if (useStore.getState().activeProjectId !== projectId) return
      setSessions(list)
      setScorecard(rows)
    } catch {
      if (useStore.getState().activeProjectId !== projectId) return
      setSessions([])
      setScorecard([])
    }
  }, [projectId])

  // Project switch (or first mount): the store preserves an in-flight/last run
  // when the project is unchanged, and wipes it on a genuine switch. The spec
  // input and history are local to this mount — reload them either way.
  useEffect(() => {
    resetCouncil(projectId)
    setSpec('')
    setSessions(null)
    setScorecard(null)
    setShowAllHistory(false)
    void loadHistory()
  }, [projectId, resetCouncil, loadHistory])

  // A run finishing (in-store) means a new persisted session exists — reload the
  // history the moment convening flips false, so the browser stays current.
  const wasConvening = useRef(convening)
  useEffect(() => {
    if (wasConvening.current && !convening) void loadHistory()
    wasConvening.current = convening
  }, [convening, loadHistory])

  const handleConvene = useCallback(() => {
    if (!projectId) return
    void conveneCouncil(projectId, spec)
  }, [projectId, spec, conveneCouncil])

  // Rehydrate one persisted session's full verdict from the detail channel.
  const browse = useCallback(
    async (summary: CouncilSessionSummary) => {
      if (!projectId || convening) return
      clearCouncilNotice()
      setLoadingDetail(true)
      setCouncilActive({
        id: summary.id,
        title: sessionTitle(summary),
        spec: '',
        result: null,
        at: Date.parse(summary.createdAt) || Date.now(),
      })
      try {
        const result = await cockpit().council.session(projectId, summary.id)
        if (useStore.getState().activeProjectId !== projectId) return
        setCouncilActive({
          id: summary.id,
          title: sessionTitle(summary),
          spec: '',
          result,
          at: Date.parse(summary.createdAt) || Date.now(),
        })
      } catch {
        if (useStore.getState().activeProjectId !== projectId) return
        // Leave the header; a failed detail read simply shows no verdict body.
        setCouncilActive(null)
      } finally {
        setLoadingDetail(false)
      }
    },
    [projectId, convening, clearCouncilNotice, setCouncilActive],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleConvene()
    }
  }

  const canConvene = Boolean(projectId) && spec.trim().length > 0 && !convening
  const busy = active !== null && active.result === null

  return (
    <div className="panel panel--stagger councilView">
      <div className="panel__header">
        <div>
          <div className="eyebrow">deliberation</div>
          <h2 className="panel__title">
            <IconCouncil width={18} height={18} /> Council
          </h2>
        </div>
        <div className="panel__actions">
          <span className="chip mono">{COUNCIL_SEATS.length} seats</span>
        </div>
      </div>

      <section className="card councilView__compose u-rise">
        <label className="councilView__composeHead" htmlFor="council-spec">
          <span className="eyebrow">convene · spec gate</span>
          <span className="councilView__composeHint">
            Five independent seats judge the text, then a chairman returns a build/clarify verdict.
          </span>
        </label>
        <textarea
          id="council-spec"
          className="councilView__input"
          placeholder="Paste a draft spec, a design, or a question for the council to deliberate on…"
          value={spec}
          onChange={(e) => setSpec(e.target.value)}
          onKeyDown={onKeyDown}
          rows={6}
          spellCheck={false}
          disabled={!projectId}
        />
        <div className="councilView__composeFoot">
          <span className="councilView__kbd">
            <kbd className="mono">⌘</kbd>
            <kbd className="mono">↵</kbd> to convene
          </span>
          <button
            type="button"
            className="btn btn--accent councilView__convene"
            onClick={handleConvene}
            disabled={!canConvene}
          >
            {convening ? 'Convening…' : 'Convene council'}
          </button>
        </div>
        {!projectId && (
          <p className="councilView__noproject">
            <IconWarning width={13} height={13} /> Select a project to convene its council.
          </p>
        )}
        {notice && projectId && (
          <p className="councilView__flash" role="status">
            <IconCheck width={13} height={13} /> {notice}
          </p>
        )}
      </section>

      {active && (
        <section className="card councilView__result u-rise">
          <div className="councilView__resultHead">
            <span className="councilView__resultIcon" aria-hidden>
              <IconCouncil width={14} height={14} />
            </span>
            <div className="councilView__resultText">
              <div className="eyebrow">llm council · spec gate</div>
              <div className="councilView__resultTitle">{active.title}</div>
            </div>
            <button
              type="button"
              className="councilView__dismiss"
              onClick={() => setCouncilActive(null)}
              disabled={active.result === null}
              aria-label="Dismiss verdict"
            >
              <IconX width={13} height={13} />
            </button>
          </div>
          {busy ? (
            <div className="councilView__busy">
              <span className="councilView__pulse" aria-hidden />
              {convening
                ? 'Convening the council — five seats, peer rankings, then a build/clarify gate…'
                : 'Loading the saved verdict…'}
            </div>
          ) : (
            active.result && (
              <div className="councilView__verdict">
                <CouncilVerdict result={active.result} />
                <CouncilScorecard entries={scorecard} />
              </div>
            )
          )}
        </section>
      )}

      {sessions && sessions.length > 0 && (
        <section className="councilView__history u-rise">
          <div className="councilView__historyHead">
            <div>
              <div className="eyebrow">recent deliberations · {sessions.length}</div>
              <p>Three at a glance; expand only when you need the archive.</p>
            </div>
            {sessions.length > 3 && (
              <button
                type="button"
                className="councilView__historyToggle"
                onClick={() => setShowAllHistory((expanded) => !expanded)}
                aria-expanded={showAllHistory}
              >
                {showAllHistory ? 'Show recent' : `View all ${sessions.length}`}
              </button>
            )}
          </div>
          <ul className="councilView__historyList">
            {visibleCouncilSessions(sessions, showAllHistory).map((summary) => {
              const isActive = active?.id === summary.id
              const presentation = councilHistoryPresentation(summary)
              return (
                <li key={summary.id}>
                  <button
                    type="button"
                    className={`councilView__historyRow ${isActive ? 'councilView__historyRow--on' : ''}`}
                    onClick={() => void browse(summary)}
                    disabled={convening || loadingDetail || summary.status === 'pending'}
                    aria-current={isActive}
                  >
                    <span
                      className={`councilView__historyDot councilView__historyDot--${presentation.tone}`}
                      aria-hidden
                    >
                      {presentation.tone === 'pending' ? (
                        <span className="councilView__historySpinner" />
                      ) : presentation.tone === 'failed' ? (
                        <IconX width={10} height={10} />
                      ) : presentation.tone === 'clarify' ? (
                        <IconWarning width={10} height={10} />
                      ) : (
                        <IconCheck width={10} height={10} />
                      )}
                    </span>
                    <span className="councilView__historyTitle">{sessionTitle(summary)}</span>
                    <span
                      className={`councilView__historyStatus councilView__historyStatus--${presentation.tone}`}
                    >
                      {presentation.label}
                    </span>
                    <time
                      className="councilView__historyTime mono"
                      dateTime={new Date(summary.createdAt).toISOString()}
                    >
                      {relativeTime(summary.createdAt)}
                    </time>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="councilView__historyNote">
            Persisted across restarts — click a run to reopen its full verdict and seat standings.
          </p>
        </section>
      )}
    </div>
  )
}
