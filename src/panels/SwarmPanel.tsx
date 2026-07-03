import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { CardStatus } from '@shared/kanban'
import { IconWarning, IconX } from '../components/icons'
import { SwarmBoard } from '../components/swarm/SwarmBoard'
import { SwarmEmptyState } from '../components/swarm/SwarmEmptyState'
import type { SwarmCardPatch } from '../components/swarm/SwarmCardEditor'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong on the board.'
}

/**
 * Swarm — the project's Kanban board (VISION 6.1.5). Cards are units of work
 * that will drive agents once 6.2 lands; today the board is the full CRUD +
 * drag surface. All data flows through the swarm slice: every mutation stores
 * the fresh board the API returns, and API refusals (e.g. dragging a running
 * card) surface in the inline notice, never a dialog.
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

  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  // Project switch (or first mount): reset the surface, then load the board.
  useEffect(() => {
    setNotice(null)
    setEditing(null)
    if (!projectId) return
    refreshBoard(projectId).catch((err: unknown) => setNotice(errorMessage(err)))
  }, [projectId, refreshBoard])

  // Only trust a board that belongs to the active project (no stale flash).
  const current = projectId && boardProjectId === projectId ? board : null
  const total = current?.reduce((n, col) => n + col.cards.length, 0) ?? 0
  const running = current?.find((col) => col.status === 'in_progress')?.cards.length ?? 0
  const boardEmpty = current !== null && total === 0

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

  return (
    <div className="panel panel--stagger swarmPanel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">orchestration</div>
          <h2 className="panel__title">Swarm board</h2>
        </div>
        {current !== null && !boardEmpty && (
          <div className="panel__actions swarm__meta">
            <span className="chip mono">{total} cards</span>
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
        />
      )}
    </div>
  )
}
