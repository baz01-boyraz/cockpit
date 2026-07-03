import type { DragEvent } from 'react'
import type { KanbanCard } from '@shared/kanban'
import { IconBranch } from '../icons'

interface SwarmCardProps {
  card: KanbanCard
  /** True while this card is the one being dragged (dimmed in place). */
  dragging: boolean
  onDragStart: (card: KanbanCard) => void
  onDragEnd: () => void
  onOpen: (cardId: string) => void
}

/**
 * One board card: title, role/branch tags, a 1–2 line body preview, and — in
 * the Running column — a pulsing ember live dot (opacity animation only).
 * Click (or Enter/Space) opens the inline editor; the whole card is draggable.
 */
export function SwarmCard({ card, dragging, onDragStart, onDragEnd, onOpen }: SwarmCardProps) {
  const running = card.status === 'in_progress'

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(card)
  }

  return (
    <div
      className={`swarmCard ${dragging ? 'swarmCard--dragging' : ''}`}
      data-swarm-card
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(card.id)
        }
      }}
      aria-label={`Edit card: ${card.title}`}
    >
      <div className="swarmCard__top">
        <span className="swarmCard__title">{card.title}</span>
        {running && <span className="swarmCard__live live-dot" title="Agent running" aria-hidden />}
      </div>

      {(card.role || card.branch) && (
        <div className="swarmCard__tags">
          {card.role && <span className="swarmTag">{card.role}</span>}
          {card.branch && (
            <span className="swarmTag swarmTag--branch" title={card.branch}>
              <IconBranch width={10} height={10} />
              <span className="swarmTag__text mono">{card.branch}</span>
            </span>
          )}
        </div>
      )}

      {card.body && <p className="swarmCard__preview">{card.body}</p>}
    </div>
  )
}
