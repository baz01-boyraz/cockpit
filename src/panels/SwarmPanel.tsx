import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import type { CardStatus, KanbanCard } from '@shared/kanban'
import type { ReviewResult } from '@shared/review'
import { IconShieldSearch, IconWarning, IconX } from '../components/icons'
import { ReviewFindings, reviewFailure } from '../components/ReviewFindings'
import { SwarmBoard } from '../components/swarm/SwarmBoard'
import { SwarmEmptyState } from '../components/swarm/SwarmEmptyState'
import type { SwarmCardActions } from '../components/swarm/SwarmCard'
import type { SwarmCardPatch } from '../components/swarm/SwarmCardEditor'

/** Poll cadence while a worker is live — the mock finishes in ~15s. */
const RUNNING_POLL_MS = 5_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong on the board.'
}

interface CardReviewState {
  cardTitle: string
  /** null while the review call is still in flight. */
  result: ReviewResult | null
}

/**
 * Swarm — the project's Kanban board (VISION 6.1.5 + 6.2 execution). Cards
 * drive agents: Start spawns a worker (card → Running), the worker's exit —
 * or the mock's timed finish, caught by the running-only poll — lands the
 * card in In review, where "Review diff" runs the shared AI review. All data
 * flows through the swarm slice; API refusals surface in the inline notice.
 */
export function SwarmPanel() {
  const projectId = useStore((s) => s.activeProjectId)
  const board = useStore((s) => s.board)
  const boardProjectId = useStore((s) => s.boardProjectId)
  const refreshBoard = useStore((s) => s.refreshBoard)
  const createCard = useStore((s) => s.createCard)
  const updateCard = useStore((s) => s.updateCard)
  const moveCard = useStore((s) => s.moveCard)
  const removeCard = useStore((s) => s.removeCard)
  const startCard = useStore((s) => s.startCard)
  const setView = useStore((s) => s.setView)

  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [cardReview, setCardReview] = useState<CardReviewState | null>(null)

  // Project switch (or first mount): reset the surface, then load the board.
  useEffect(() => {
    setNotice(null)
    setEditing(null)
    setCardReview(null)
    setReviewingId(null)
    if (!projectId) return
    refreshBoard(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
  }, [projectId, refreshBoard])

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

  // AI diff review for an In review card — shared advisory pass (read-only),
  // rendered under the header with the same ReviewFindings surface as Git.
  const handleReview = useCallback(
    async (card: KanbanCard) => {
      if (!projectId || reviewingId) return
      setReviewingId(card.id)
      setCardReview({ cardTitle: card.title, result: null })
      try {
        const result = await cockpit().review.run(projectId)
        setCardReview({ cardTitle: card.title, result })
      } catch (err: unknown) {
        setCardReview({ cardTitle: card.title, result: reviewFailure(err) })
      } finally {
        setReviewingId(null)
      }
    },
    [projectId, reviewingId],
  )

  const cardActions = useMemo<SwarmCardActions>(
    () => ({
      startingId,
      reviewingId,
      onStart: (cardId) => void handleStart(cardId),
      onViewTerminal: () => setView('terminals'),
      onReview: (card) => void handleReview(card),
    }),
    [startingId, reviewingId, handleStart, handleReview, setView],
  )

  return (
    <div className="panel panel--stagger swarmPanel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">orchestration</div>
          <h2 className="panel__title">Swarm board</h2>
        </div>
        {current !== null && !boardEmpty && (
          <div className="panel__actions swarm__meta">
            <span className="chip mono">
              {total} card{total === 1 ? '' : 's'}
            </span>
            {running > 0 && (
              <span className="chip chip--accent">
                <span className="chip__dot live-dot" />
                {running} running
              </span>
            )}
          </div>
        )}
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
              <div className="eyebrow">diff review</div>
              <div className="swarmReview__title">{cardReview.cardTitle}</div>
            </div>
            <button
              className="swarmNotice__dismiss swarmReview__dismiss"
              onClick={() => setCardReview(null)}
              disabled={reviewingId !== null}
              aria-label="Dismiss review results"
            >
              <IconX width={13} height={13} />
            </button>
          </div>
          {cardReview.result === null ? (
            <div className="review__busy review__busy--compact">
              <span className="review__pulse" aria-hidden />
              Reviewing the working-tree diff…
            </div>
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
