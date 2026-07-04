// Kanban kernel (VISION 6.1, plan decision D5/D7): the card state machine,
// board assembly, and ordering math. Pure — consumed by BOTH SwarmService
// and the browser mock, never implemented twice.

export type CardStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'parked'

/** Who is asking for a transition. Spawn/exit/park are facts the service owns. */
export type CardActor = 'user' | 'service'

export interface KanbanCard {
  id: string
  projectId: string
  title: string
  body: string
  status: CardStatus
  position: number
  role: string | null
  persona: string | null
  /** Named Agent slug from .claude/agents (user or project scope); null = manual role/persona. */
  agent: string | null
  terminalSessionId: string | null
  worktreePath: string | null
  branch: string | null
  createdAt: string
  updatedAt: string
}

export interface BoardColumn {
  status: CardStatus
  cards: KanbanCard[]
}

export const COLUMN_ORDER: readonly CardStatus[] = [
  'todo',
  'in_progress',
  'in_review',
  'done',
  'parked',
]

/** Ordering gap between adjacent cards; midpoint inserts halve it until renormalize. */
export const POSITION_GAP = 1024

/** Below this spacing a midpoint insert loses precision and the column must renormalize. */
const MIN_POSITION_SPACING = 1e-6

/**
 * D7: transitions entering or leaving `in_progress` belong to the service
 * (they mirror a real spawn, exit, kill, or park — never a drag). Every other
 * move between the human columns is the user's. No-op moves are rejected.
 */
export function canMove(from: CardStatus, to: CardStatus, actor: CardActor): boolean {
  if (from === to) return false
  if (from === 'in_progress' || to === 'in_progress') return actor === 'service'
  return true
}

/** Group cards into the fixed columns, ordered by position (id breaks ties). */
export function assembleBoard(cards: readonly KanbanCard[]): BoardColumn[] {
  return COLUMN_ORDER.map((status) => ({
    status,
    cards: cards
      .filter((c) => c.status === status)
      .slice()
      .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1)),
  }))
}

/**
 * Position for an insert between two neighbors (null = column edge).
 * Returns null when the neighbors are too close — caller must renormalize
 * the column first, then retry.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return POSITION_GAP
  if (before === null) return (after as number) / 2
  if (after === null) return before + POSITION_GAP
  if (after - before < MIN_POSITION_SPACING) return null
  return before + (after - before) / 2
}

/** Re-space a column's cards to whole gaps, preserving order. Returns new objects. */
export function renormalize(column: readonly KanbanCard[]): KanbanCard[] {
  return column.map((c, i) => ({ ...c, position: (i + 1) * POSITION_GAP }))
}

const byPosition = (a: KanbanCard, b: KanbanCard): number =>
  a.position - b.position || (a.id < b.id ? -1 : 1)

/** Position for appending a card to the end of a column. */
export function appendPosition(cards: readonly KanbanCard[], status: CardStatus): number {
  const tail = cards
    .filter((c) => c.status === status)
    .reduce((max, c) => Math.max(max, c.position), 0)
  return tail + POSITION_GAP
}

/**
 * Move a card to `index` of the `to` column, immutably. Same-column reorders
 * are always allowed (position is only visual); status *transitions* go
 * through `canMove`. When midpoint precision runs out, the destination column
 * is renormalized in the same result. `at` stamps the card's updatedAt.
 */
export function moveCardInList(
  cards: readonly KanbanCard[],
  cardId: string,
  to: CardStatus,
  index: number,
  actor: CardActor,
  at: string,
): KanbanCard[] {
  const card = cards.find((c) => c.id === cardId)
  if (!card) throw new Error(`Card ${cardId} not found in this project.`)
  if (card.status !== to && !canMove(card.status, to, actor)) {
    throw new Error('A running card can only be moved by the swarm itself — park or kill it instead.')
  }
  let column = cards.filter((c) => c.status === to && c.id !== cardId).sort(byPosition)
  let rest = cards.filter((c) => c.id !== cardId)
  const slot = Math.min(index, column.length)
  let pos = positionBetween(column[slot - 1]?.position ?? null, column[slot]?.position ?? null)
  if (pos === null) {
    column = renormalize(column)
    const spaced = new Map(column.map((c) => [c.id, c]))
    rest = rest.map((c) => spaced.get(c.id) ?? c)
    pos = positionBetween(column[slot - 1]?.position ?? null, column[slot]?.position ?? null)
  }
  return [...rest, { ...card, status: to, position: pos as number, updatedAt: at }]
}

const SLUG_MAX = 40

/**
 * Branch name for a card's worktree (plan D4): `swarm/<title-slug>-<id-tail>`.
 * The id tail keeps branches unique when titles collide; an unusable title
 * falls back to "card".
 */
export function cardBranch(title: string, cardId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  const tail = cardId.slice(-4)
  return `swarm/${slug || 'card'}-${tail}`
}
