import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import type {
  CouncilClarificationAnswer,
  CouncilIntentMode,
  CouncilProgressEvent,
  CouncilSessionSummary,
  ScorecardEntry,
} from '@shared/council'
import { COUNCIL_SEATS } from '@shared/council'
import type { CouncilAnalysisEgressPolicy } from '@shared/council-evidence'
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
import { CouncilRoom } from '../components/CouncilRoom'
import { CopyTextButton } from '../components/CopyTextButton'
import { CouncilTextSurface } from '../components/CouncilTextSurface'
import { downloadTextFile } from '../lib/text-export'
import { IconCheck, IconCouncil, IconDownload, IconSend, IconWarning, IconX } from '../components/icons'

/** A persisted session's headline for the active-run surface when it is browsed. */
function sessionTitle(summary: CouncilSessionSummary): string {
  if (summary.question && summary.question.trim().length > 0) return summary.question
  if (summary.mode === 'spec') return 'Spec-gate deliberation'
  if (summary.mode === 'analysis') return 'Repository analysis'
  return 'Diff-review deliberation'
}

function modeLabel(mode: CouncilIntentMode): string {
  if (mode === 'analysis') return 'repository analysis'
  if (mode === 'diff') return 'change review'
  return 'request refinement'
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
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [composerOpen, setComposerOpen] = useState(true)
  const [responseLanguage, setResponseLanguage] = useState<'auto' | 'tr' | 'en'>('auto')
  const [intent, setIntent] = useState<Extract<CouncilIntentMode, 'spec' | 'analysis'>>('spec')
  const [analysisEgress, setAnalysisEgress] =
    useState<CouncilAnalysisEgressPolicy>('local-only')
  const [analysisConsent, setAnalysisConsent] = useState(false)
  const [progressEvents, setProgressEvents] = useState<CouncilProgressEvent[]>([])
  const resultRef = useRef<HTMLElement | null>(null)

  const revealResult = useCallback(() => {
    window.requestAnimationFrame(() => {
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
      resultRef.current?.scrollIntoView({ behavior, block: 'start' })
    })
  }, [])

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
    setResponseLanguage('auto')
    setIntent('spec')
    setAnalysisEgress('local-only')
    setAnalysisConsent(false)
    setProgressEvents([])
    setComposerOpen(useStore.getState().councilActive === null)
    void loadHistory()
  }, [projectId, resetCouncil, loadHistory])

  useEffect(() => {
    return cockpit().council.onProgress((event) => {
      if (event.projectId !== projectId) return
      setProgressEvents((current) =>
        current[0]?.runId === event.runId
          ? [...current, event].slice(-20)
          : [event],
      )
    })
  }, [projectId])

  // A run finishing (in-store) means a new persisted session exists — reload the
  // history the moment convening flips false, so the browser stays current.
  const wasConvening = useRef(convening)
  useEffect(() => {
    if (wasConvening.current && !convening) void loadHistory()
    wasConvening.current = convening
  }, [convening, loadHistory])

  const handleConvene = useCallback(() => {
    if (!projectId || !spec.trim()) return
    if (intent === 'analysis' && analysisEgress !== 'local-only' && !analysisConsent) return
    void conveneCouncil(projectId, spec, {
      mode: intent,
      responseLanguage: responseLanguage === 'auto' ? undefined : responseLanguage,
      ...(intent === 'analysis'
        ? {
            analysisEgress,
            analysisConsent: analysisEgress === 'local-only' ? false : analysisConsent,
          }
        : {}),
    })
    setComposerOpen(false)
  }, [
    projectId,
    spec,
    intent,
    responseLanguage,
    analysisEgress,
    analysisConsent,
    conveneCouncil,
  ])

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
      setLoadingSessionId(summary.id)
      setCouncilActive({
        id: summary.id,
        title: sessionTitle(summary),
        spec: '',
        mode: summary.mode,
        result: null,
        at: Date.parse(summary.createdAt) || Date.now(),
      })
      revealResult()
      try {
        const result = await cockpit().council.session(projectId, summary.id)
        if (useStore.getState().activeProjectId !== projectId) return
        setCouncilActive({
          id: summary.id,
          title: sessionTitle(summary),
          spec: '',
          mode: summary.mode,
          responseLanguage: result?.responseLanguage,
          result,
          at: Date.parse(summary.createdAt) || Date.now(),
        })
        revealResult()
      } catch {
        if (useStore.getState().activeProjectId !== projectId) return
        // Leave the header; a failed detail read simply shows no verdict body.
        setCouncilActive(null)
      } finally {
        setLoadingSessionId(null)
      }
    },
    [projectId, convening, clearCouncilNotice, setCouncilActive, revealResult],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleConvene()
    }
  }

  const remoteAnalysisNeedsConsent =
    intent === 'analysis' && analysisEgress !== 'local-only' && !analysisConsent
  const canConvene =
    Boolean(projectId) && spec.trim().length > 0 && !convening && !remoteAnalysisNeedsConsent
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
                {intent === 'analysis'
                  ? 'Describe what you want investigated. Council will collect a small, relevant evidence pack and make source quality visible.'
                  : 'Paste your request. You will get one clear outcome: a ready brief or up to three questions you can answer on this page.'}
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
          <div className="councilView__intent" role="group" aria-label="Council intent">
            <span className="eyebrow">intent</span>
            <div className="councilView__intentGrid">
              <button
                type="button"
                className={`councilView__intentOption ${intent === 'spec' ? 'councilView__intentOption--on' : ''}`}
                aria-pressed={intent === 'spec'}
                onClick={() => setIntent('spec')}
              >
                <strong>Refine request</strong>
                <small>Turn a draft into one build-ready brief.</small>
              </button>
              <button
                type="button"
                className={`councilView__intentOption ${intent === 'analysis' ? 'councilView__intentOption--on' : ''}`}
                aria-pressed={intent === 'analysis'}
                onClick={() => setIntent('analysis')}
              >
                <strong>Analyze repository</strong>
                <small>Investigate with bounded evidence and claim-level provenance.</small>
              </button>
              <button type="button" className="councilView__intentOption" disabled>
                <strong>Review change</strong>
                <small>Use Council from a Swarm card with an actual change set.</small>
              </button>
            </div>
          </div>
          <textarea
            id="council-spec"
            className="councilView__input"
            placeholder={
              intent === 'analysis'
                ? 'What should Council investigate in this repository? Include the decision you need to make…'
                : 'Paste a draft spec, a design, or a question for the council to deliberate on…'
            }
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={onKeyDown}
            rows={6}
            spellCheck={false}
            disabled={!projectId}
          />
          {intent === 'analysis' && (
            <div className="councilView__egress">
              <div className="councilView__egressHead">
                <label className="councilView__egressSelect">
                  <span>Repository data sharing</span>
                  <select
                    aria-label="Repository data sharing"
                    value={analysisEgress}
                    onChange={(event) => {
                      setAnalysisEgress(event.target.value as CouncilAnalysisEgressPolicy)
                      setAnalysisConsent(false)
                    }}
                  >
                    <option value="local-only">Local evidence only</option>
                    <option value="account-models">Claude + Codex accounts</option>
                    <option value="all-configured">All configured models</option>
                  </select>
                </label>
                <span className={`councilView__egressBadge councilView__egressBadge--${analysisEgress}`}>
                  {analysisEgress === 'local-only' ? 'zero egress' : 'consent required'}
                </span>
              </div>
              {analysisEgress === 'local-only' ? (
                <p className="councilView__egressNote">
                  <strong>No repository content leaves this device.</strong> Council collects a
                  redacted source inventory locally; no model synthesis runs in this mode.
                </p>
              ) : (
                <label className="councilView__consent">
                  <input
                    type="checkbox"
                    checked={analysisConsent}
                    onChange={(event) => setAnalysisConsent(event.target.checked)}
                  />
                  <span>
                    <strong>I consent to sending bounded, redacted repository evidence</strong>
                    <small>
                      {analysisEgress === 'account-models'
                        ? 'This run may send the bounded evidence pack, short relevant Memory hooks, and Council stage outputs to Claude and Codex through your signed-in account CLIs.'
                        : 'This run may send the bounded evidence pack, short relevant Memory hooks, and Council stage outputs to Claude, Codex, and configured OpenRouter models.'}
                    </small>
                  </span>
                </label>
              )}
              <p className="councilView__egressLimit">
                Sensitive files, lockfiles, symlinks, secrets, absolute paths, and raw memory note
                bodies are excluded before analysis.
              </p>
            </div>
          )}
          <div className="councilView__composeFoot">
            <div className="councilView__composeMeta">
              <span className="councilView__kbd">
                <kbd className="mono">⌘</kbd>
                <kbd className="mono">↵</kbd> to convene
              </span>
              <label className="councilView__language">
                <span>Output language</span>
                <select
                  aria-label="Output language"
                  value={responseLanguage}
                  onChange={(event) =>
                    setResponseLanguage(event.target.value as 'auto' | 'tr' | 'en')
                  }
                >
                  <option value="auto">Auto-detect</option>
                  <option value="tr">Türkçe</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              className="btn btn--accent councilView__convene"
              onClick={handleConvene}
              disabled={!canConvene}
            >
              {convening
                ? intent === 'analysis'
                  ? 'Council is analyzing…'
                  : 'Council is reviewing…'
                : intent === 'analysis'
                  ? analysisEgress === 'local-only'
                    ? 'Collect local evidence'
                    : 'Analyze repository'
                  : 'Review my request'}
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
        <section ref={resultRef} className="card councilView__result u-rise">
          <div className="councilView__resultHead">
            <span className="councilView__resultIcon" aria-hidden>
              <IconCouncil width={14} height={14} />
            </span>
            <div className="councilView__resultText">
              <div className="eyebrow">llm council · {modeLabel(active.mode)}</div>
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
            convening ? (
              <CouncilRoom
                events={progressEvents.filter((event) => event.runId === active.id)}
                responseLanguage={active.responseLanguage}
              />
            ) : (
              <div className="councilView__busy">
                <span className="councilView__pulse" aria-hidden />
                <div>
                  <strong>Opening the saved decision.</strong>
                  <span>This should take only a moment.</span>
                </div>
              </div>
            )
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
                      <small>
                        {active.mode === 'analysis'
                          ? 'Sources, claim provenance, evidence freshness, five seats, and peer rankings'
                          : 'Chairman reasoning, refined spec, five seats, and peer rankings'}
                      </small>
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
              const isLoading = loadingSessionId === summary.id
              const presentation = councilHistoryPresentation(summary)
              return (
                <li key={summary.id}>
                  <button
                    type="button"
                    className={`councilView__historyRow ${isActive ? 'councilView__historyRow--on' : ''}`}
                    onClick={() => void browse(summary)}
                    disabled={convening || loadingSessionId !== null || summary.status === 'pending'}
                    aria-current={isActive ? 'true' : undefined}
                    aria-busy={isLoading}
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
                      {isLoading ? 'Opening…' : presentation.label}
                    </span>
                    <time
                      className="councilView__historyTime mono"
                      dateTime={new Date(summary.createdAt).toISOString()}
                    >
                      {relativeTime(summary.createdAt)}
                    </time>
                    <span className="councilView__historyOpen" aria-hidden>
                      {isActive ? 'Viewing' : 'Open'}
                    </span>
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
