import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import type {
  CouncilClarificationAnswer,
  CouncilSessionSummary,
  ScorecardEntry,
} from '@shared/council'
import { COUNCIL_SEATS } from '@shared/council'
import { councilHistoryPresentation, visibleCouncilSessions } from '@shared/council-history'
import {
  buildCouncilDisplay,
  councilReportFilename,
  primaryCouncilArtifact,
  serializeCouncilReport,
} from '@shared/council-display'
import { CouncilVerdict, CouncilVerdictEvidence } from '../components/CouncilVerdict'
import { CouncilScorecard } from '../components/CouncilScorecard'
import { CouncilJourney, type CouncilJourneyPhase } from '../components/CouncilJourney'
import { CopyTextButton } from '../components/CopyTextButton'
import { CouncilTextSurface } from '../components/CouncilTextSurface'
import { downloadTextFile } from '../lib/text-export'
import { IconCheck, IconCouncil, IconDownload, IconSend, IconWarning, IconX } from '../components/icons'

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
  const continueCouncil = useStore((s) => s.continueCouncil)
  const setCouncilActive = useStore((s) => s.setCouncilActive)
  const clearCouncilNotice = useStore((s) => s.clearCouncilNotice)
  const resetCouncil = useStore((s) => s.resetCouncil)
  const setView = useStore((s) => s.setView)

  const [spec, setSpec] = useState('')
  const [sessions, setSessions] = useState<CouncilSessionSummary[] | null>(null)
  const [scorecard, setScorecard] = useState<ScorecardEntry[] | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [composerOpen, setComposerOpen] = useState(true)

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
    setComposerOpen(useStore.getState().councilActive === null)
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
    if (!projectId || !spec.trim()) return
    void conveneCouncil(projectId, spec)
    setComposerOpen(false)
  }, [projectId, spec, conveneCouncil])

  const handleContinue = useCallback(
    (answers: CouncilClarificationAnswer[]) => {
      if (!projectId) return
      void continueCouncil(projectId, answers)
    },
    [continueCouncil, projectId],
  )

  // Rehydrate one persisted session's full verdict from the detail channel.
  const browse = useCallback(
    async (summary: CouncilSessionSummary) => {
      if (!projectId || convening) return
      clearCouncilNotice()
      setComposerOpen(false)
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
  const display = active?.result ? buildCouncilDisplay(active.result) : null
  const journeyPhase: CouncilJourneyPhase = busy
    ? 'deliberating'
    : display?.kind === 'clarify'
      ? 'clarify'
      : display?.kind === 'approved'
        ? 'approved'
        : display?.kind === 'failed'
          ? 'failed'
          : 'reviewed'
  const approvedBrief =
    display?.kind === 'approved'
      ? display.refinedSpec ?? active?.result?.verdict ?? active?.spec ?? ''
      : ''
  const reportArtifacts = useMemo(() => {
    if (!active?.result) return null
    return {
      primary: primaryCouncilArtifact(active.result),
      full: serializeCouncilReport(active.result, { title: active.title }),
      filename: councilReportFilename(active.result, active.id),
    }
  }, [active])

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

      {active && !composerOpen ? (
        <section className="card councilView__composeCollapsed u-rise">
          <span className="councilView__composeCollapsedIcon" aria-hidden>
            <IconCheck width={13} height={13} />
          </span>
          <div>
            <span className="eyebrow">request received</span>
            <strong>{active.title}</strong>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setSpec('')
              setComposerOpen(true)
            }}
            disabled={convening}
          >
            Start another request
          </button>
        </section>
      ) : (
        <section className="card councilView__compose u-rise">
          <div className="councilView__composeTop">
            <label className="councilView__composeHead" htmlFor="council-spec">
              <span className="eyebrow">ask council</span>
              <span className="councilView__composeHint">
                Paste your request. You will get one clear outcome: a ready brief or up to three
                questions you can answer on this page.
              </span>
            </label>
            {active && (
              <button
                type="button"
                className="councilView__composeBack"
                onClick={() => setComposerOpen(false)}
              >
                Back to current result
              </button>
            )}
          </div>
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
              {convening ? 'Council is reviewing…' : 'Review my request'}
            </button>
          </div>
          {!projectId && (
            <p className="councilView__noproject">
              <IconWarning width={13} height={13} /> Select a project to convene its council.
            </p>
          )}
        </section>
      )}

      {notice && projectId && (
        <p className="councilView__flash" role="status">
          <IconCheck width={13} height={13} /> {notice}
        </p>
      )}

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
          <CouncilJourney phase={journeyPhase} />
          {busy ? (
            <div className="councilView__busy">
              <span className="councilView__pulse" aria-hidden />
              <div>
                <strong>{convening ? 'Council is reviewing your request.' : 'Opening the saved decision.'}</strong>
                <span>
                  {convening
                    ? 'You do not need to do anything yet. You can leave this page; the result will stay here.'
                    : 'This should take only a moment.'}
                </span>
              </div>
            </div>
          ) : (
            active.result && (
              <CouncilTextSurface
                className="councilView__verdict"
                fullReport={reportArtifacts?.full ?? ''}
              >
                <CouncilVerdict
                  result={active.result}
                  onContinue={active.spec.trim() ? handleContinue : undefined}
                  continuing={convening}
                  showEvidence={false}
                />

                {reportArtifacts && (
                  <div className="councilResultActions" aria-label="Council report actions">
                    <CopyTextButton
                      text={reportArtifacts.primary.text}
                      label={reportArtifacts.primary.label}
                      className="btn btn--ghost btn--sm"
                    />
                    <CopyTextButton
                      text={reportArtifacts.full}
                      label="Copy full report"
                      className="btn btn--ghost btn--sm"
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm councilResultActions__export"
                      onClick={() => {
                        downloadTextFile(reportArtifacts.filename, reportArtifacts.full)
                      }}
                      aria-label="Export Markdown"
                    >
                      <IconDownload width={14} height={14} /> Export Markdown
                    </button>
                  </div>
                )}

                {display?.kind === 'approved' && (
                  <section className="councilReady" aria-labelledby="council-ready-title">
                    <div>
                      <div className="eyebrow">what happens next</div>
                      <h3 id="council-ready-title">Your brief is ready. Nothing has started yet.</h3>
                      <p>Copy it, or open Swarm when you are ready to turn it into a build task.</p>
                    </div>
                    <div className="councilReady__actions">
                      <CopyTextButton
                        text={approvedBrief}
                        label="Copy approved brief"
                        className="btn btn--ghost"
                      />
                      <button type="button" className="btn btn--accent" onClick={() => setView('swarm')}>
                        <IconSend width={14} height={14} /> Open Swarm
                      </button>
                    </div>
                  </section>
                )}

                <details className="councilDisclosure councilEvidence">
                  <summary className="councilDisclosure__summary">
                    <span>
                      <strong>How Council reached this</strong>
                      <small>Chairman reasoning, refined spec, five seats, and peer rankings</small>
                    </span>
                  </summary>
                  <div className="councilEvidence__body">
                    <CouncilVerdictEvidence result={active.result} />
                  </div>
                </details>
              </CouncilTextSurface>
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
          <details className="councilHistoryScore">
            <summary>
              <span>
                <strong>Cross-session seat standings</strong>
                <small>Historical average across Council runs, not evidence for the open report</small>
              </span>
            </summary>
            <CouncilScorecard entries={scorecard} />
          </details>
          <p className="councilView__historyNote">
            Persisted across restarts — click a run to reopen its complete decision and evidence.
          </p>
        </section>
      )}
    </div>
  )
}
