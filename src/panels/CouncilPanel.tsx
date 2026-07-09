import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { relativeTime } from '@shared/time'
import type { CouncilResult, ScorecardEntry } from '@shared/council'
import { COUNCIL_SEATS } from '@shared/council'
import { CouncilVerdict } from '../components/CouncilVerdict'
import { CouncilScorecard } from '../components/CouncilScorecard'
import { IconCheck, IconCouncil, IconWarning, IconX } from '../components/icons'

/** One convened run held in this session's local history (no persisted list IPC
 *  exists yet — see the file header note). `result: null` = in flight. */
interface CouncilRun {
  /** Stable render key — the persisted session id when we have one, else a local uuid. */
  id: string
  /** First line of the spec, for the history row. */
  title: string
  /** The full spec text the seats judged. */
  spec: string
  /** The finished verdict, or null while the council is still convening. */
  result: CouncilResult | null
  /** Epoch ms the run was requested. */
  at: number
}

/** A thrown council IPC call → a renderable spec-mode failure result. */
function councilFailure(error: unknown): CouncilResult {
  const message = error instanceof Error ? error.message : 'The council run failed.'
  return {
    ok: false,
    mode: 'spec',
    seats: [],
    rankings: [],
    aggregate: [],
    labelToSeat: {},
    verdict: null,
    specVerdict: null,
    error: message,
    stats: { seatsRun: 0, seatsFailed: 0, filesReviewed: 0, durationMs: 0 },
    sessionId: null,
  }
}

/** The spec's first non-empty line, trimmed to a headline length. */
function runTitle(spec: string): string {
  const line = spec.split('\n').find((l) => l.trim().length > 0)?.trim() ?? 'Untitled deliberation'
  return line.length > 72 ? `${line.slice(0, 72)}…` : line
}

/**
 * Council — a standalone deliberation surface (roadmap E4). The LLM Council was
 * reachable only as a swarm-card spec gate; this gives it a project-level entry:
 * type a free-form spec or question, convene the five-seat council in `spec`
 * mode, and read the gate verdict + seat standings with the same components the
 * board uses.
 *
 * Scope note: the council IPC surface is exactly `run` + `scorecard`. There is no
 * session-listing channel, so the "recent sessions" list below is this session's
 * runs only (in-memory) — a persisted cross-restart browser needs a new
 * `council.sessions` IPC (reported as a gap, backend untouched here).
 */
export function CouncilPanel() {
  const projectId = useStore((s) => s.activeProjectId)

  const [spec, setSpec] = useState('')
  const [convening, setConvening] = useState(false)
  const [active, setActive] = useState<CouncilRun | null>(null)
  const [history, setHistory] = useState<CouncilRun[]>([])
  const [scorecard, setScorecard] = useState<ScorecardEntry[] | null>(null)

  // Project switch (or first mount): drop every surface — a verdict, history, or
  // standings from another project must never flash under a new one.
  useEffect(() => {
    setSpec('')
    setConvening(false)
    setActive(null)
    setHistory([])
    setScorecard(null)
  }, [projectId])

  // Cross-session seat standings ride alongside the verdict — fetched fresh on
  // each convene (skeleton while it lands), dropped on a project switch.
  const loadScorecard = useCallback(async () => {
    if (!projectId) return
    setScorecard(null)
    try {
      const rows = await cockpit().council.scorecard(projectId)
      if (useStore.getState().activeProjectId === projectId) setScorecard(rows)
    } catch {
      if (useStore.getState().activeProjectId === projectId) setScorecard([])
    }
  }, [projectId])

  // Convene the five-seat council in spec mode on the free-form text. One long
  // main-process call — guarded against a project switch outliving it, exactly
  // like the board's spec gate. No cardId: this is a standalone deliberation.
  const handleConvene = useCallback(async () => {
    const trimmed = spec.trim()
    if (!projectId || convening || trimmed.length === 0) return
    const run: CouncilRun = {
      id: `local-${Date.now()}`,
      title: runTitle(trimmed),
      spec: trimmed,
      result: null,
      at: Date.now(),
    }
    setConvening(true)
    setActive(run)
    void loadScorecard()
    try {
      const result = await cockpit().council.run(projectId, { mode: 'spec', spec: trimmed })
      if (useStore.getState().activeProjectId !== projectId) return
      const done: CouncilRun = { ...run, id: result.sessionId ?? run.id, result }
      setActive(done)
      setHistory((prev) => [done, ...prev])
    } catch (err: unknown) {
      if (useStore.getState().activeProjectId !== projectId) return
      const failed: CouncilRun = { ...run, result: councilFailure(err) }
      setActive(failed)
      setHistory((prev) => [failed, ...prev])
    } finally {
      setConvening(false)
    }
  }, [projectId, convening, spec, loadScorecard])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void handleConvene()
    }
  }

  const canConvene = Boolean(projectId) && spec.trim().length > 0 && !convening

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
            onClick={() => void handleConvene()}
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
              onClick={() => setActive(null)}
              disabled={active.result === null}
              aria-label="Dismiss verdict"
            >
              <IconX width={13} height={13} />
            </button>
          </div>
          {active.result === null ? (
            <div className="councilView__busy">
              <span className="councilView__pulse" aria-hidden />
              Convening the council — five seats, peer rankings, then a build/clarify gate…
            </div>
          ) : (
            <div className="councilView__verdict">
              <CouncilVerdict result={active.result} />
              <CouncilScorecard entries={scorecard} />
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="councilView__history u-rise">
          <div className="eyebrow councilView__historyHead">this session · {history.length}</div>
          <ul className="councilView__historyList">
            {history.map((run) => {
              const isActive = active?.id === run.id
              const gate = run.result?.specVerdict?.kind
              const failed = run.result ? !run.result.ok && run.result.seats.length === 0 : false
              return (
                <li key={`${run.id}-${run.at}`}>
                  <button
                    type="button"
                    className={`councilView__historyRow ${isActive ? 'councilView__historyRow--on' : ''}`}
                    onClick={() => setActive(run)}
                    aria-current={isActive}
                  >
                    <span
                      className={`councilView__historyDot councilView__historyDot--${
                        failed ? 'failed' : gate === 'approved' ? 'approved' : 'clarify'
                      }`}
                      aria-hidden
                    >
                      {gate === 'approved' ? (
                        <IconCheck width={10} height={10} />
                      ) : failed ? (
                        <IconX width={10} height={10} />
                      ) : (
                        <IconWarning width={10} height={10} />
                      )}
                    </span>
                    <span className="councilView__historyTitle">{run.title}</span>
                    <time className="councilView__historyTime mono" dateTime={new Date(run.at).toISOString()}>
                      {relativeTime(new Date(run.at).toISOString())}
                    </time>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="councilView__historyNote">
            Recent runs are held for this session only — a persisted cross-session browser awaits a
            council session-list channel.
          </p>
        </section>
      )}
    </div>
  )
}
