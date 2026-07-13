import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import type { CardStatus, KanbanCard } from '@shared/kanban'
import type { CompletionReport } from '@shared/completion-report'
import { formatCompletionSummary } from '@shared/completion-report'
import type { CouncilResult, ScorecardEntry } from '@shared/council'
import { COUNCIL_SEATS, normalizeCouncilResult } from '@shared/council'
import { IconCheck, IconShieldSearch, IconWarning, IconX } from '../components/icons'
import { CouncilVerdict } from '../components/CouncilVerdict'
import { CouncilScorecard } from '../components/CouncilScorecard'
import { SwarmBoard } from '../components/swarm/SwarmBoard'
import { SwarmEmptyState } from '../components/swarm/SwarmEmptyState'
import { SwarmUsageChips } from '../components/swarm/SwarmUsageChips'
import type { SwarmCardActions } from '../components/swarm/SwarmCard'
import type { SwarmCardPatch, SwarmCouncilGate } from '../components/swarm/SwarmCardEditor'

/** Poll cadence while a worker is live — the mock finishes in ~15s. */
const RUNNING_POLL_MS = 5_000

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Something went wrong on the board.'
  // Electron wraps a main-process throw as "Error invoking remote method 'x': …"
  // (Finding 2). Strip that plumbing so the honest, actionable message shows —
  // e.g. "Card has a running agent — kill or park it before deleting." — not the
  // raw IPC banner.
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
}

/**
 * The active review surface under the header. `council` is the full LLM-Council (five advisors → peer review
 * → verdict). Each carries its own result shape; `result: null` = in flight.
 *
 * The `spec`-gate surface is NOT here: it lives in the store's council slice so a
 * convened verdict survives leaving and returning to the board (the bug this
 * closes). It is normalized back into `WideReview` for the shared render below.
 */
type CardReviewState =
  | { kind: 'council'; cardTitle: string; result: CouncilResult | null }
  | { kind: 'report'; cardTitle: string; result: CompletionReport | null }

/** The unified wide-surface model: a local diff/council/report review, or the
 *  store-lifted spec-gate run (source `run` only — a rehydrate feeds the editor). */
type WideReview =
  | CardReviewState
  | { kind: 'spec'; cardTitle: string; result: CouncilResult | null }

/** A thrown council IPC call → a renderable failure result. */
function councilFailure(error: unknown, mode: CouncilResult['mode'] = 'diff'): CouncilResult {
  const message = error instanceof Error ? error.message : 'The council run failed.'
  return {
    ok: false,
    mode,
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

/**
 * Swarm — the project's Kanban board (VISION 6.1.5–6.6). Cards drive agents:
 * Start spawns a worker in its own git worktree (card → Running, up to 3 in
 * parallel), Park stops the worker but keeps the worktree (Resume continues
 * there — also the crash-recovery path for orphaned cards), and the worker's
 * exit lands the card in In review, where "Council" evaluates the diff through
 * every persona lens, merged into one tagged findings list. All data flows
 * through the swarm slice; API refusals surface in the inline notice.
 */
export function SwarmPanel() {
  const projectId = useStore((s) => s.activeProjectId)
  const board = useStore((s) => s.board)
  const boardProjectId = useStore((s) => s.boardProjectId)
  const agents = useStore((s) => s.agents)
  const refreshBoard = useStore((s) => s.refreshBoard)
  const refreshAgents = useStore((s) => s.refreshAgents)
  const createCard = useStore((s) => s.createCard)
  const updateCard = useStore((s) => s.updateCard)
  const moveCard = useStore((s) => s.moveCard)
  const removeCard = useStore((s) => s.removeCard)
  const startCard = useStore((s) => s.startCard)
  const parkCard = useStore((s) => s.parkCard)
  const setView = useStore((s) => s.setView)
  // Spec-gate council state, lifted into the store so a verdict survives a view
  // switch (the vanishing-verdict bug). The convene promise resolves in the
  // slice action, not here, so a run finishing off-view still lands.
  const councilConveningCardId = useStore((s) => s.councilConveningCardId)
  const councilCardResult = useStore((s) => s.councilCardResult)
  const conveneCardCouncil = useStore((s) => s.conveneCardCouncil)
  const loadCardCouncil = useStore((s) => s.loadCardCouncil)
  const clearCardCouncil = useStore((s) => s.clearCardCouncil)
  const resetCouncil = useStore((s) => s.resetCouncil)

  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  // Card whose Start hit the council spec gate — shows the inline convene/skip
  // prompt (Finding 1). Cleared once the card starts, convenes, or on switch.
  const [gatedId, setGatedId] = useState<string | null>(null)
  const [parkingId, setParkingId] = useState<string | null>(null)
  const [councilingId, setCouncilingId] = useState<string | null>(null)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [cardReview, setCardReview] = useState<CardReviewState | null>(null)
  const [scorecard, setScorecard] = useState<ScorecardEntry[] | null>(null)

  const reviewBusy =
    councilingId !== null ||
    councilConveningCardId !== null ||
    reportingId !== null

  // Project switch (or first mount): reset the surface, then load the board.
  // `resetCouncil` preserves the store's spec-gate run when the project is
  // unchanged (a same-project view switch keeps its verdict) and wipes it on a
  // genuine switch — so it is safe to call on every mount.
  useEffect(() => {
    setNotice(null)
    setEditing(null)
    setGatedId(null)
    setCardReview(null)
    setCouncilingId(null)
    setReportingId(null)
    setScorecard(null)
    resetCouncil(projectId)
    if (!projectId) return
    refreshBoard(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
    // The Named Agents roster rides along (once per project — the slice skips
    // a project it already holds). A roster failure never blocks the board.
    refreshAgents(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
  }, [projectId, refreshBoard, refreshAgents, resetCouncil])

  // Only trust a board that belongs to the active project (no stale flash).
  const current = projectId && boardProjectId === projectId ? board : null
  const total = current?.reduce((n, col) => n + col.cards.length, 0) ?? 0
  const running = current?.find((col) => col.status === 'in_progress')?.cards.length ?? 0
  const boardEmpty = current !== null && total === 0

  // A worker exiting (real pty or mock) means the service moved its card —
  // refetch so Running → In review lands without a manual reload.
  useEffect(() => {
    if (!projectId) return
    const off = cockpit().terminals.onExit(() => {
      refreshBoard(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
    })
    return off
  }, [projectId, refreshBoard])

  // The mock's timed finish fires no event, so while (and only while) a card
  // is Running, poll the board on a slow cadence.
  useEffect(() => {
    if (!projectId || running === 0) return
    const timer = setInterval(() => {
      refreshBoard(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
    }, RUNNING_POLL_MS)
    return () => clearInterval(timer)
  }, [projectId, running, refreshBoard])

  const handleCreate = useCallback(
    async (title: string, body: string): Promise<boolean> => {
      if (!projectId) return false
      try {
        await createCard({ projectId, title, body: body || undefined })
        setNotice(null)
        return true
      } catch (err: unknown) {
        setNotice(errorMessage(err))
        return false
      }
    },
    [projectId, createCard],
  )

  const handleMove = useCallback(
    async (cardId: string, to: CardStatus, index: number) => {
      if (!projectId) return
      try {
        await moveCard({ projectId, cardId, to, index })
        setNotice(null)
      } catch (err: unknown) {
        setNotice(errorMessage(err))
        try {
          await refreshBoard(projectId)
        } catch {
          // Keep the move refusal visible — it is the actionable message.
        }
      }
    },
    [projectId, moveCard, refreshBoard],
  )

  const handleSave = useCallback(
    async (cardId: string, patch: SwarmCardPatch) => {
      if (!projectId) return
      try {
        await updateCard({ projectId, cardId, ...patch })
        setNotice(null)
        setEditing(null)
      } catch (err: unknown) {
        setNotice(errorMessage(err))
      }
    },
    [projectId, updateCard],
  )

  const handleDelete = useCallback(
    async (cardId: string) => {
      if (!projectId) return
      try {
        await removeCard({ projectId, cardId })
        setNotice(null)
        setEditing(null)
      } catch (err: unknown) {
        setNotice(errorMessage(err))
      }
    },
    [projectId, removeCard],
  )

  const handleStart = useCallback(
    async (cardId: string, opts?: { skipGate?: boolean }) => {
      if (!projectId || startingId) return
      setStartingId(cardId)
      try {
        const result = await startCard({ projectId, cardId, skipGate: opts?.skipGate })
        if (result.gated) {
          // The spec hasn't passed the council — surface the inline gate prompt
          // (convene / start anyway) instead of a banner. The card never moved.
          setGatedId(cardId)
        } else {
          setGatedId((id) => (id === cardId ? null : id))
          setNotice(null)
        }
      } catch (err: unknown) {
        setNotice(errorMessage(err))
      } finally {
        setStartingId(null)
      }
    },
    [projectId, startingId, startCard],
  )

  // 6.3 — stop a Running card's worker but keep its worktree; the card lands
  // in Parked where Start reads "Resume" and picks up in the same worktree.
  const handlePark = useCallback(
    async (cardId: string) => {
      if (!projectId || parkingId) return
      setParkingId(cardId)
      try {
        await parkCard({ projectId, cardId })
        setNotice(null)
      } catch (err: unknown) {
        setNotice(errorMessage(err))
      } finally {
        setParkingId(null)
      }
    },
    [projectId, parkingId, parkCard],
  )

  // Seat standings ride alongside any council surface — fetched fresh each time
  // one opens (skeleton while it lands), and dropped on a project switch. Stale
  // standings from another project must never flash under a new verdict.
  const loadScorecard = useCallback(async () => {
    if (!projectId) return
    setScorecard(null)
    try {
      const rows = await cockpit().council.scorecard(projectId)
      if (useStore.getState().activeProjectId === projectId) setScorecard(rows)
    } catch {
      // A standings miss never blocks the verdict — render the empty state.
      if (useStore.getState().activeProjectId === projectId) setScorecard([])
    }
  }, [projectId])

  // Faz 2.5 — the decision-ready completion report for an In review card: branch,
  // diff stat, and the acceptance-criteria checklist, computed on demand and shown
  // in the same wide surface as the review/council results (kept visually quiet).
  const handleReport = useCallback(
    async (card: KanbanCard) => {
      if (!projectId || reviewBusy) return
      clearCardCouncil()
      setReportingId(card.id)
      setCardReview({ kind: 'report', cardTitle: card.title, result: null })
      try {
        const result = await cockpit().swarm.completionReport(projectId, card.id)
        if (useStore.getState().activeProjectId !== projectId) return
        setCardReview({ kind: 'report', cardTitle: card.title, result })
      } catch (err: unknown) {
        if (useStore.getState().activeProjectId !== projectId) return
        setNotice(errorMessage(err))
        setCardReview(null)
      } finally {
        setReportingId(null)
      }
    },
    [projectId, reviewBusy, clearCardCouncil],
  )

  // The LLM-Council (Karpathy's method): five independent advisors judge the
  // card's worktree diff, an anonymous peer reviewer critiques them, and a
  // chairman synthesizes one verdict. One long main-process call — the card's
  // title/body rides along as the author's stated intent to ground the panel.
  const handleCouncil = useCallback(
    async (card: KanbanCard) => {
      if (!projectId || reviewBusy) return
      clearCardCouncil()
      setCouncilingId(card.id)
      setCardReview({ kind: 'council', cardTitle: card.title, result: null })
      void loadScorecard()
      const question = [card.title, card.body].filter(Boolean).join('\n\n')
      try {
        const rawResult = await cockpit().council.run(projectId, {
          dir: card.worktreePath ?? undefined,
          question: question || undefined,
        })
        const result = normalizeCouncilResult(rawResult) ?? councilFailure(
          new Error('Council returned an invalid result envelope.'),
        )
        // A council can outlive a project switch — never paint a stale result.
        if (useStore.getState().activeProjectId !== projectId) return
        setCardReview({ kind: 'council', cardTitle: card.title, result })
      } catch (err: unknown) {
        setCardReview({ kind: 'council', cardTitle: card.title, result: councilFailure(err) })
      } finally {
        setCouncilingId(null)
      }
    },
    [projectId, reviewBusy, loadScorecard, clearCardCouncil],
  )

  // Faz 2b — gate a draft spec BEFORE a builder starts: the same five-seat
  // council, in `spec` mode, judging the card's title+body as a buildable spec.
  // The convene now lives in the store's council slice, so the verdict (and the
  // in-flight spinner) survive leaving and returning to the board. The wide
  // surface + the editor's inline gate both read the store; here we only clear
  // any local review surface and prime the seat standings before delegating.
  const handleConvene = useCallback(
    (card: KanbanCard, spec: string) => {
      if (!projectId || reviewBusy) return
      setCardReview(null)
      void loadScorecard()
      void conveneCardCouncil({ projectId, cardId: card.id, cardTitle: card.title, spec })
    },
    [projectId, reviewBusy, loadScorecard, conveneCardCouncil],
  )

  // Finding 1 — the gate prompt's primary action. Convene the council on the
  // card's draft (title+body) exactly as the editor does, then drop the inline
  // prompt: the full deliberation takes over the wide surface above the board.
  const handleGateConvene = useCallback(
    (card: KanbanCard) => {
      setGatedId((id) => (id === card.id ? null : id))
      handleConvene(card, [card.title, card.body].filter(Boolean).join('\n\n'))
    },
    [handleConvene],
  )

  // Rehydrate a card's persisted spec-gate verdict from its linked session id
  // (detail channel) — how a council-approved card shows its verdict again after
  // a view switch or app restart, without a re-run.
  const handleRehydrate = useCallback(
    (card: KanbanCard) => {
      if (!projectId || !card.councilSessionId) return
      void loadCardCouncil({ projectId, cardId: card.id, sessionId: card.councilSessionId })
    },
    [projectId, loadCardCouncil],
  )

  // Apply an approved council's refined spec: it becomes the card body and the
  // session is linked so the card reads "council-approved" on the board.
  const handleApplyRefined = useCallback(
    async (cardId: string, body: string, sessionId: string) => {
      if (!projectId) return
      try {
        await updateCard({ projectId, cardId, body, councilSessionId: sessionId })
        setNotice(null)
      } catch (err: unknown) {
        setNotice(errorMessage(err))
      }
    },
    [projectId, updateCard],
  )

  const councilGate = useMemo<SwarmCouncilGate>(
    () => ({
      conveningId: councilConveningCardId,
      result: councilCardResult
        ? { cardId: councilCardResult.cardId, result: councilCardResult.result }
        : null,
      onConvene: (card, spec) => handleConvene(card, spec),
      onApplyRefined: handleApplyRefined,
      onRehydrate: (card) => handleRehydrate(card),
    }),
    [councilConveningCardId, councilCardResult, handleConvene, handleApplyRefined, handleRehydrate],
  )

  // The wide review surface prefers a freshly convened spec-gate run (from the
  // store, source `run`) over a local diff/council/report review. A rehydrated
  // verdict (source `rehydrate`) stays in the editor's inline gate only.
  const wideReview = useMemo<WideReview | null>(() => {
    if (councilCardResult && councilCardResult.source === 'run') {
      return { kind: 'spec', cardTitle: councilCardResult.cardTitle, result: councilCardResult.result }
    }
    return cardReview
  }, [councilCardResult, cardReview])

  const dismissWide = useCallback(() => {
    if (wideReview?.kind === 'spec') clearCardCouncil()
    else setCardReview(null)
  }, [wideReview, clearCardCouncil])

  const cardActions = useMemo<SwarmCardActions>(
    () => ({
      startingId,
      parkingId,
      councilingId,
      reportingId,
      gatedId,
      onStart: (cardId, opts) => void handleStart(cardId, opts),
      onConveneGate: (card) => handleGateConvene(card),
      onPark: (cardId) => void handlePark(cardId),
      onViewTerminal: () => setView('terminals'),
      onCouncil: (card) => void handleCouncil(card),
      onReport: (card) => void handleReport(card),
    }),
    [
      startingId,
      parkingId,
      councilingId,
      reportingId,
      gatedId,
      handleStart,
      handleGateConvene,
      handlePark,
      handleCouncil,
      handleReport,
      setView,
    ],
  )

  return (
    <div className="panel panel--stagger swarmPanel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">orchestration</div>
          <h2 className="panel__title">Swarm board</h2>
        </div>
        <div className="panel__actions swarm__meta">
          <SwarmUsageChips />
          {current !== null && !boardEmpty && (
            <>
              <span className="chip mono">
                {total} card{total === 1 ? '' : 's'}
              </span>
              {running > 0 && (
                <span className="chip chip--accent">
                  <span className="chip__dot live-dot" />
                  {running} running
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="swarmNotice" role="alert">
          <IconWarning width={14} height={14} />
          <span className="swarmNotice__text">{notice}</span>
          <button
            className="swarmNotice__dismiss"
            onClick={() => setNotice(null)}
            aria-label="Dismiss error"
          >
            <IconX width={13} height={13} />
          </button>
        </div>
      )}

      {wideReview && (
        <section className="card swarmReview">
          <div className="swarmReview__head">
            <span className="swarmReview__icon" aria-hidden>
              <IconShieldSearch width={14} height={14} />
            </span>
            <div className="swarmReview__headText">
              <div className="eyebrow">
                {wideReview.kind === 'spec'
                  ? 'llm council · spec gate'
                  : wideReview.kind === 'council'
                    ? `llm council · ${COUNCIL_SEATS.length} seats`
                    : wideReview.kind === 'report'
                      ? 'completion report'
                      : 'diff review'}
              </div>
              <div className="swarmReview__title">{wideReview.cardTitle}</div>
            </div>
            <button
              className="swarmNotice__dismiss swarmReview__dismiss"
              onClick={dismissWide}
              disabled={wideReview.result === null}
              aria-label="Dismiss review results"
            >
              <IconX width={13} height={13} />
            </button>
          </div>
          {wideReview.result === null ? (
            <div className="review__busy review__busy--compact">
              <span className="review__pulse" aria-hidden />
              {wideReview.kind === 'spec'
                ? 'Convening the council on this spec — five seats, then a build/clarify gate…'
                : wideReview.kind === 'council'
                  ? 'Convening the council — five seats, peer rankings, then a verdict…'
                  : 'Gathering the completion report — diff stat and acceptance criteria…'}
            </div>
          ) : wideReview.kind === 'report' ? (
            <CompletionReportView report={wideReview.result} />
          ) : (
            <div className="swarmReview__council">
              <CouncilVerdict result={wideReview.result} />
              <CouncilScorecard entries={scorecard} />
            </div>
          )}
        </section>
      )}

      {current === null ? (
        <div className="swarm__busy">
          <span className="swarm__pulse" aria-hidden />
          Assembling the board…
        </div>
      ) : boardEmpty ? (
        <SwarmEmptyState onCreate={handleCreate} />
      ) : (
        <SwarmBoard
          board={current}
          agents={agents}
          editingId={editing}
          onOpen={setEditing}
          onCloseEditor={() => setEditing(null)}
          onMove={handleMove}
          onCreate={handleCreate}
          onSave={handleSave}
          onDelete={handleDelete}
          cardActions={cardActions}
          councilGate={councilGate}
        />
      )}
    </div>
  )
}

/**
 * The completion report body: the notification-sized summary line, a quiet
 * diff-stat pill (reusing the board's `swarmStat` classes), and the acceptance
 * criteria as a checklist. Deliberately calm — the same surface style as the
 * review/council results, no new design language.
 */
function CompletionReportView({ report }: { report: CompletionReport }) {
  return (
    <div className="swarmReport">
      <p className="swarmReport__summary">{formatCompletionSummary(report)}</p>
      {report.diffStat && report.diffStat.files > 0 && (
        <div
          className="swarmStat"
          role="status"
          aria-label={`${report.diffStat.files} files changed, ${report.diffStat.insertions} added, ${report.diffStat.deletions} removed`}
        >
          <span className="swarmStat__add mono">+{report.diffStat.insertions}</span>
          <span className="swarmStat__del mono">−{report.diffStat.deletions}</span>
          <span className="swarmStat__files">
            {report.diffStat.files} file{report.diffStat.files === 1 ? '' : 's'}
          </span>
          {report.branch && <span className="swarmStat__files mono">{report.branch}</span>}
        </div>
      )}
      {report.acceptance.length > 0 ? (
        <ul className="swarmReport__criteria">
          {report.acceptance.map((item, i) => (
            <li key={i} className="swarmReport__criterion">
              <IconCheck width={12} height={12} aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="swarmReport__empty">No acceptance criteria listed in the card body.</p>
      )}
    </div>
  )
}
