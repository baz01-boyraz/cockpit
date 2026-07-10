import { Fragment, useRef, useState, type DragEvent } from 'react'
import type { BoardColumn, CardStatus, KanbanCard } from '@shared/kanban'
import type { NamedAgentSummary } from '@shared/named-agents'
import { IconPlus, IconSwarm } from '../icons'
import { SwarmCard, type SwarmCardActions } from './SwarmCard'
import { SwarmCardEditor, type SwarmCardPatch, type SwarmCouncilGate } from './SwarmCardEditor'
import { SwarmComposer } from './SwarmComposer'

export interface DragInfo {
  cardId: string
  from: CardStatus
}

interface SwarmColumnProps {
  column: BoardColumn
  label: string
  /** Named Agents roster — resolved per card for its identity chip + editor. */
  agents: NamedAgentSummary[]
  drag: DragInfo | null
  /** Insertion index to indicate in THIS column, or null when it isn't the target. */
  dropIndex: number | null
  editingId: string | null
  onDragStart: (card: KanbanCard) => void
  onDragEnd: () => void
  onDragOver: (status: CardStatus, index: number) => void
  onDragLeave: (status: CardStatus) => void
  onDrop: (status: CardStatus, rawIndex: number) => void
  onOpen: (cardId: string) => void
  onCloseEditor: () => void
  onSave: (cardId: string, patch: SwarmCardPatch) => Promise<void>
  onDelete: (cardId: string) => Promise<void>
  /** Per-card actions (start/resume, park, view terminal, review, council). */
  cardActions: SwarmCardActions
  /** Spec-gate wiring for the open editor (convene + apply refined spec). */
  councilGate: SwarmCouncilGate
  /** Present only on the To do column — enables the "+ New card" composer. */
  onCreate?: (title: string, body: string) => Promise<boolean>
}

/**
 * One board lane. The whole column is a native-DnD drop zone that computes the
 * insertion index from pointer Y against the rendered cards. Running is never
 * a valid target — while a drag is live it dims and refuses the drop (D7: only
 * the swarm itself moves cards in or out of execution).
 */
export function SwarmColumn({
  column,
  label,
  agents,
  drag,
  dropIndex,
  editingId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  onCloseEditor,
  onSave,
  onDelete,
  cardActions,
  councilGate,
  onCreate,
}: SwarmColumnProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [composing, setComposing] = useState(false)

  const { status, cards } = column
  const refusing = drag !== null && status === 'in_progress'

  /** Insertion slot: count cards whose vertical midpoint is above the pointer. */
  const indexFromY = (clientY: number): number => {
    const nodes = bodyRef.current?.querySelectorAll('[data-swarm-card]')
    if (!nodes) return 0
    let index = 0
    for (const node of nodes) {
      const rect = (node as HTMLElement).getBoundingClientRect()
      if (clientY > rect.top + rect.height / 2) index += 1
    }
    return index
  }

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (!drag || refusing) return // no preventDefault → the drop is refused
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    onDragOver(status, indexFromY(e.clientY))
  }

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    // Ignore bubbling leaves between children of the same column.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    onDragLeave(status)
  }

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    if (!drag || refusing) return
    e.preventDefault()
    onDrop(status, indexFromY(e.clientY))
  }

  return (
    <section
      className={`swarmCol swarmCol--${status} ${refusing ? 'swarmCol--refuse' : ''} ${
        dropIndex !== null ? 'swarmCol--target' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label={`${label} column`}
    >
      <span className="swarmCol__rule" aria-hidden />
      <header className="swarmCol__head">
        <span className="swarmCol__kicker">
          <span className="swarmCol__dot" aria-hidden />
          <span className="swarmCol__label">{label}</span>
        </span>
        <span className="swarmCol__count mono">{cards.length}</span>
      </header>

      <div className="swarmCol__body" ref={bodyRef}>
        {cards.map((card, i) => (
          <Fragment key={card.id}>
            {dropIndex === i && <div className="swarmDropline" aria-hidden />}
            {editingId === card.id ? (
              <SwarmCardEditor
                card={card}
                agents={agents}
                onSave={onSave}
                onDelete={onDelete}
                onClose={onCloseEditor}
                council={councilGate}
              />
            ) : (
              <SwarmCard
                card={card}
                agent={card.agent ? (agents.find((a) => a.slug === card.agent) ?? null) : null}
                dragging={drag?.cardId === card.id}
                index={i}
                starting={cardActions.startingId === card.id}
                parking={cardActions.parkingId === card.id}
                reviewing={cardActions.reviewingId === card.id}
                counciling={cardActions.councilingId === card.id}
                reporting={cardActions.reportingId === card.id}
                gated={cardActions.gatedId === card.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onOpen={onOpen}
                onStart={cardActions.onStart}
                onConveneGate={cardActions.onConveneGate}
                onPark={cardActions.onPark}
                onViewTerminal={cardActions.onViewTerminal}
                onReview={cardActions.onReview}
                onCouncil={cardActions.onCouncil}
                onReport={cardActions.onReport}
              />
            )}
          </Fragment>
        ))}
        {dropIndex === cards.length && <div className="swarmDropline" aria-hidden />}

        {cards.length === 0 && dropIndex === null && !onCreate && (
          <div className="swarmCol__empty">
            <IconSwarm className="swarmCol__watermark" width={26} height={26} aria-hidden />
            <span className="swarmCol__emptyText">
              {drag && !refusing ? 'Drop here' : 'No cards yet'}
            </span>
          </div>
        )}

        {onCreate &&
          (composing ? (
            <SwarmComposer onCreate={onCreate} onCancel={() => setComposing(false)} />
          ) : (
            <button className="swarmNew" onClick={() => setComposing(true)}>
              <IconPlus width={12} height={12} /> New card
            </button>
          ))}
      </div>
    </section>
  )
}
