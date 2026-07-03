import { useState } from 'react'
import type { BoardColumn, CardStatus, KanbanCard } from '@shared/kanban'
import { SwarmColumn, type DragInfo } from './SwarmColumn'
import type { SwarmCardActions } from './SwarmCard'
import type { SwarmCardPatch } from './SwarmCardEditor'

const COLUMN_LABELS: Record<CardStatus, string> = {
  todo: 'To do',
  in_progress: 'Running',
  in_review: 'In review',
  done: 'Done',
  parked: 'Parked',
}

interface SwarmBoardProps {
  board: BoardColumn[]
  editingId: string | null
  onOpen: (cardId: string) => void
  onCloseEditor: () => void
  onMove: (cardId: string, to: CardStatus, index: number) => Promise<void>
  onCreate: (title: string, body: string) => Promise<boolean>
  onSave: (cardId: string, patch: SwarmCardPatch) => Promise<void>
  onDelete: (cardId: string) => Promise<void>
  /** 6.2 card actions (start / view terminal / review diff). */
  cardActions: SwarmCardActions
}

/**
 * The five fixed lanes plus the native-DnD state machine: which card is in
 * flight and where the drop indicator sits. Columns report raw insertion
 * indices; same-column drops are corrected for the card's own slot here, and
 * no-op drops are skipped. Dragging FROM Running is deliberately allowed —
 * the API refuses it and the panel surfaces the message.
 */
export function SwarmBoard({
  board,
  editingId,
  onOpen,
  onCloseEditor,
  onMove,
  onCreate,
  onSave,
  onDelete,
  cardActions,
}: SwarmBoardProps) {
  const [drag, setDrag] = useState<DragInfo | null>(null)
  const [drop, setDrop] = useState<{ status: CardStatus; index: number } | null>(null)

  const clearDnd = () => {
    setDrag(null)
    setDrop(null)
  }

  const handleDragStart = (card: KanbanCard) => {
    setDrag({ cardId: card.id, from: card.status })
  }

  const handleDragOver = (status: CardStatus, index: number) => {
    setDrop((prev) => (prev && prev.status === status && prev.index === index ? prev : { status, index }))
  }

  const handleDragLeave = (status: CardStatus) => {
    setDrop((prev) => (prev?.status === status ? null : prev))
  }

  const handleDrop = (status: CardStatus, rawIndex: number) => {
    const active = drag
    clearDnd()
    if (!active) return
    let index = rawIndex
    if (active.from === status) {
      // The dragged card still renders in this column, so the raw insertion
      // slot counts it — correct for its own position and skip no-op drops.
      const cards = board.find((c) => c.status === status)?.cards ?? []
      const orig = cards.findIndex((c) => c.id === active.cardId)
      if (orig !== -1 && orig < index) index -= 1
      if (orig === index) return
    }
    void onMove(active.cardId, status, index)
  }

  return (
    <div className="swarm__board">
      {board.map((column) => (
        <SwarmColumn
          key={column.status}
          column={column}
          label={COLUMN_LABELS[column.status]}
          drag={drag}
          dropIndex={drop?.status === column.status ? drop.index : null}
          editingId={editingId}
          onDragStart={handleDragStart}
          onDragEnd={clearDnd}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onOpen={onOpen}
          onCloseEditor={onCloseEditor}
          onSave={onSave}
          onDelete={onDelete}
          cardActions={cardActions}
          onCreate={column.status === 'todo' ? onCreate : undefined}
        />
      ))}
    </div>
  )
}
