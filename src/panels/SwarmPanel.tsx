import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import type { CardStatus, KanbanCard } from '@shared/kanban'
import type { ReviewResult } from '@shared/review'
import type { CouncilResult } from '@shared/council'
import { COUNCIL_ADVISORS } from '@shared/council'
import { IconShieldSearch, IconWarning, IconX } from '../components/icons'
import { ReviewFindings, reviewFailure } from '../components/ReviewFindings'
import { CouncilVerdict } from '../components/CouncilVerdict'
import { SwarmBoard } from '../components/swarm/SwarmBoard'
import { SwarmEmptyState } from '../components/swarm/SwarmEmptyState'
import { SwarmUsageChips } from '../components/swarm/SwarmUsageChips'
import type { SwarmCardActions } from '../components/swarm/SwarmCard'
import type { SwarmCardPatch } from '../components/swarm/SwarmCardEditor'

/** Poll cadence while a worker is live — the mock finishes in ~15s. */
const RUNNING_POLL_MS = 5_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong on the board.'
}

/**
 * The active review surface under the header. `diff` is one advisory pass over
 * the worktree; `council` is the full LLM-Council (five advisors → peer review
 * → verdict). Each carries its own result shape; `result: null` = in flight.
 */
type CardReviewState =
  | { kind: 'diff'; cardTitle: string; result: ReviewResult | null }
  | { kind: 'council'; cardTitle: string; result: CouncilResult | null }

/** A thrown council IPC call → a renderable failure result. */
function councilFailure(error: unknown): CouncilResult {
  const message = error instanceof Error ? error.message : 'The council run failed.'
  return {
    ok: false,
    advisors: [],
    peerReview: null,
    verdict: null,
    model: '',
    error: message,
    stats: { advisorsRun: 0, advisorsFailed: 0, filesReviewed: 0, durationMs: 0 },
  }
}

/**
 * Swarm — the project's Kanban board (VISION 6.1.5–6.6). Cards drive agents:
 * Start spawns a worker in its own git worktree (card → Running, up to 3 in
 * parallel), Park stops the worker but keeps the worktree (Resume continues
 * there — also the crash-recovery path for orphaned cards), and the worker's
 * exit lands the card in In review, where "Review diff" runs one advisory AI
 * pass over the card's worktree and "Council" runs the same diff through
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

  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [parkingId, setParkingId] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [councilingId, setCouncilingId] = useState<string | null>(null)
  const [cardReview, setCardReview] = useState<CardReviewState | null>(null)

  const reviewBusy = reviewingId !== null || councilingId !== null

  // Project switch (or first mount): reset the surface, then load the board.
  useEffect(() => {
    setNotice(null)
    setEditing(null)
    setCardReview(null)
    setReviewingId(null)
    setCouncilingId(null)
    if (!projectId) return
    refreshBoard(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
    // The Named Agents roster rides along (once per project — the slice skips
    // a project it already holds). A roster failure never blocks the board.
    refreshAgents(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
  }, [projectId, refreshBoard, refreshAgents])

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
    async (cardId: string) => {
      if (!projectId || startingId) return
      setStartingId(cardId)
      try {
        await startCard({ projectId, cardId })
        setNotice(null)
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

  // AI diff review for an In review card — one advisory pass (read-only) over
  // the card's own worktree when it has one, rendered under the header with
  // the same ReviewFindings surface as Git.
  const handleReview = useCallback(
    async (card: KanbanCard) => {
      if (!projectId || reviewBusy) return
      setReviewingId(card.id)
      setCardReview({ kind: 'diff', cardTitle: card.title, result: null })
      try {
        const result = await cockpit().review.run(projectId, { dir: card.worktreePath ?? undefined })
        setCardReview({ kind: 'diff', cardTitle: card.title, result })
      } catch (err: unknown) {
        setCardReview({ kind: 'diff', cardTitle: card.title, result: reviewFailure(err) })
      } finally {
        setReviewingId(null)
      }
    },
    [projectId, reviewBusy],
  )

  // The LLM-Council (Karpathy's method): five independent advisors judge the
  // card's worktree diff, an anonymous peer reviewer critiques them, and a
  // chairman synthesizes one verdict. One long main-process call — the card's
  // title/body rides along as the author's stated intent to ground the panel.
  const handleCouncil = useCallback(
    async (card: KanbanCard) => {
      if (!projectId || reviewBusy) return
      setCouncilingId(card.id)
      setCardReview({ kind: 'council', cardTitle: card.title, result: null })
      const question = [card.title, card.body].filter(Boolean).join('\n\n')
      try {
        const result = await cockpit().council.run(projectId, {
          dir: card.worktreePath ?? undefined,
          question: question || undefined,
        })
        // A council can outlive a project switch — never paint a stale result.
        if (useStore.getState().activeProjectId !== projectId) return
        setCardReview({ kind: 'council', cardTitle: card.title, result })
      } catch (err: unknown) {
        setCardReview({ kind: 'council', cardTitle: card.title, result: councilFailure(err) })
      } finally {
        setCouncilingId(null)
      }
    },
    [projectId, reviewBusy],
  )

  const cardActions = useMemo<SwarmCardActions>(
    () => ({
      startingId,
      parkingId,
      reviewingId,
      councilingId,
      onStart: (cardId) => void handleStart(cardId),
      onPark: (cardId) => void handlePark(cardId),
      onViewTerminal: () => setView('terminals'),
      onReview: (card) => void handleReview(card),
      onCouncil: (card) => void handleCouncil(card),
    }),
    [
      startingId,
      parkingId,
      reviewingId,
      councilingId,
      handleStart,
      handlePark,
      handleReview,
      handleCouncil,
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

      {cardReview && (
        <section className="card swarmReview">
          <div className="swarmReview__head">
            <span className="swarmReview__icon" aria-hidden>
              <IconShieldSearch width={14} height={14} />
            </span>
            <div className="swarmReview__headText">
              <div className="eyebrow">
                {cardReview.kind === 'council'
                  ? `llm council · ${COUNCIL_ADVISORS.length} advisors`
                  : 'diff review'}
              </div>
              <div className="swarmReview__title">{cardReview.cardTitle}</div>
            </div>
            <button
              className="swarmNotice__dismiss swarmReview__dismiss"
              onClick={() => setCardReview(null)}
              disabled={reviewBusy}
              aria-label="Dismiss review results"
            >
              <IconX width={13} height={13} />
            </button>
          </div>
          {cardReview.result === null ? (
            <div className="review__busy review__busy--compact">
              <span className="review__pulse" aria-hidden />
              {cardReview.kind === 'council'
                ? 'Convening the council — five advisors, peer review, then a verdict…'
                : 'Reviewing the working-tree diff…'}
            </div>
          ) : cardReview.kind === 'council' ? (
            <CouncilVerdict result={cardReview.result} />
          ) : (
            <ReviewFindings result={cardReview.result} />
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
        />
      )}
    </div>
  )
}
