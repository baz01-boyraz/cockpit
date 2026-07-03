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
