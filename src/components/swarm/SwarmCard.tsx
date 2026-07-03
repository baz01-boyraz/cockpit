import type { DragEvent, MouseEvent } from 'react'
import type { KanbanCard } from '@shared/kanban'
import { IconBranch, IconPlay, IconShieldSearch, IconTerminal } from '../icons'

/** 6.2 per-card actions, grouped so board/column signatures stay small. */
export interface SwarmCardActions {
  /** Card id with a startCard call in flight, if any. */
  startingId: string | null
  /** Card id with a diff review in flight, if any. */
  reviewingId: string | null
  onStart: (cardId: string) => void
  onViewTerminal: () => void
  onReview: (card: KanbanCard) => void
}

interface SwarmCardProps {
  card: KanbanCard
  /** True while this card is the one being dragged (dimmed in place). */
  dragging: boolean
  /** True while startCard is in flight for THIS card. */
  starting: boolean
  /** True while a diff review is running for THIS card. */
  reviewing: boolean
  onDragStart: (card: KanbanCard) => void
  onDragEnd: () => void
  onOpen: (cardId: string) => void
  /** 6.2 — spawn a worker (To do / Parked cards only). */
  onStart: (cardId: string) => void
  /** Jump to the Terminals view (Running cards only). */
  onViewTerminal: () => void
  /** Run the AI diff review (In review cards only). */
  onReview: (card: KanbanCard) => void
}

const startable = (status: KanbanCard['status']): boolean =>
  status === 'todo' || status === 'parked'

/**
 * One board card: title, role/branch tags, a 1–2 line body preview, and — in
 * the Running column — a pulsing ember live dot (opacity animation only).
 * Click (or Enter/Space) opens the inline editor; the whole card is draggable.
 * 6.2 adds the per-status action row: Start (ember — THE action), View
 * terminal, and Review diff. Action clicks never bubble into the editor.
 */
export function SwarmCard({
  card,
  dragging,
  starting,
  reviewing,
  onDragStart,
  onDragEnd,
  onOpen,
  onStart,
  onViewTerminal,
  onReview,
}: SwarmCardProps) {
  const running = card.status === 'in_progress'

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(card)
  }

  /** Wrap an action so it never falls through to the card's open-editor click. */
  const act = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    fn()
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
        // Only the card surface itself opens the editor — Enter on an action
        // button must stay that button's press.
        if (e.target !== e.currentTarget) return
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

      {startable(card.status) && (
        <div className="swarmCard__actions">
          <button
            className="swarmStart"
            onClick={act(() => onStart(card.id))}
            disabled={starting}
            title="Put an agent on this card"
          >
            {starting ? (
              <>
                <span className="swarmStart__pulse live-dot" aria-hidden /> Starting…
              </>
            ) : (
              <>
                <IconPlay width={10} height={10} /> Start
              </>
            )}
          </button>
        </div>
      )}

      {running && (
        <div className="swarmCard__actions">
          <button
            className="swarmCardLink"
            onClick={act(onViewTerminal)}
            title="Open the worker's terminal"
          >
            <IconTerminal width={11} height={11} /> View terminal
          </button>
        </div>
      )}

      {card.status === 'in_review' && (
        <div className="swarmCard__actions">
          <button
            className="swarmCardLink"
            onClick={act(() => onReview(card))}
            disabled={reviewing}
            title="AI review of the working-tree diff"
          >
            <IconShieldSearch width={11} height={11} />
            {reviewing ? 'Reviewing…' : 'Review diff'}
          </button>
        </div>
      )}
    </div>
  )
}
