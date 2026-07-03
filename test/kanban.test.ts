import { describe, expect, it } from 'vitest'
import {
  appendPosition,
  assembleBoard,
  canMove,
  cardBranch,
  COLUMN_ORDER,
  moveCardInList,
  positionBetween,
  POSITION_GAP,
  renormalize,
  type KanbanCard,
} from '../shared/kanban'

const card = (over: Partial<KanbanCard>): KanbanCard => ({
  id: 'card_1',
  projectId: 'proj_1',
  title: 'Fix the flaky test',
  body: '',
  status: 'todo',
  position: POSITION_GAP,
  role: null,
  persona: null,
  terminalSessionId: null,
  worktreePath: null,
  branch: null,
  createdAt: '2026-07-03T00:00:00.000Z',
  updatedAt: '2026-07-03T00:00:00.000Z',
  ...over,
})

describe('canMove — in_progress is service-owned (plan D7)', () => {
  it('lets the service start a card', () => {
    expect(canMove('todo', 'in_progress', 'service')).toBe(true)
  })

  it('refuses a user drag into in_progress', () => {
    expect(canMove('todo', 'in_progress', 'user')).toBe(false)
    expect(canMove('parked', 'in_progress', 'user')).toBe(false)
  })

  it('refuses a user drag out of in_progress', () => {
    expect(canMove('in_progress', 'in_review', 'user')).toBe(false)
    expect(canMove('in_progress', 'todo', 'user')).toBe(false)
    expect(canMove('in_progress', 'parked', 'user')).toBe(false)
  })

  it('lets the service settle a finished/parked/killed run', () => {
    expect(canMove('in_progress', 'in_review', 'service')).toBe(true)
    expect(canMove('in_progress', 'parked', 'service')).toBe(true)
    expect(canMove('in_progress', 'todo', 'service')).toBe(true)
  })

  it('lets the user move freely between the human columns', () => {
    expect(canMove('todo', 'in_review', 'user')).toBe(true)
    expect(canMove('in_review', 'done', 'user')).toBe(true)
    expect(canMove('done', 'todo', 'user')).toBe(true)
    expect(canMove('parked', 'todo', 'user')).toBe(true)
    expect(canMove('todo', 'done', 'user')).toBe(true)
  })

  it('rejects a no-op move', () => {
    expect(canMove('todo', 'todo', 'user')).toBe(false)
    expect(canMove('in_progress', 'in_progress', 'service')).toBe(false)
  })
})

describe('assembleBoard', () => {
  it('always yields every column, in fixed order, even when empty', () => {
    const board = assembleBoard([])
    expect(board.map((c) => c.status)).toEqual([...COLUMN_ORDER])
    expect(board.every((c) => c.cards.length === 0)).toBe(true)
  })

  it('groups by status and orders by position ascending', () => {
    const cards = [
      card({ id: 'c', status: 'todo', position: 3 * POSITION_GAP }),
      card({ id: 'a', status: 'todo', position: POSITION_GAP }),
      card({ id: 'r', status: 'in_review', position: POSITION_GAP }),
      card({ id: 'b', status: 'todo', position: 2 * POSITION_GAP }),
    ]
    const board = assembleBoard(cards)
    const todo = board.find((c) => c.status === 'todo')
    expect(todo?.cards.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(board.find((c) => c.status === 'in_review')?.cards.map((x) => x.id)).toEqual(['r'])
  })

  it('does not mutate its input', () => {
    const input = [
      card({ id: 'b', position: 2 * POSITION_GAP }),
      card({ id: 'a', position: POSITION_GAP }),
    ]
    const before = input.map((c) => c.id)
    assembleBoard(input)
    expect(input.map((c) => c.id)).toEqual(before)
  })

  it('breaks position ties by id so ordering is deterministic', () => {
    const cards = [
      card({ id: 'z', position: POSITION_GAP }),
      card({ id: 'a', position: POSITION_GAP }),
    ]
    const todo = assembleBoard(cards).find((c) => c.status === 'todo')
    expect(todo?.cards.map((x) => x.id)).toEqual(['a', 'z'])
  })
})

describe('positionBetween', () => {
  it('starts an empty column at one gap', () => {
    expect(positionBetween(null, null)).toBe(POSITION_GAP)
  })

  it('inserts at the head below the first card', () => {
    expect(positionBetween(null, POSITION_GAP)).toBeLessThan(POSITION_GAP)
    expect(positionBetween(null, POSITION_GAP)).toBeGreaterThan(0)
  })

  it('appends after the tail by one gap', () => {
    expect(positionBetween(3 * POSITION_GAP, null)).toBe(4 * POSITION_GAP)
  })

  it('takes the midpoint between neighbors', () => {
    expect(positionBetween(1024, 2048)).toBe(1536)
  })

  it('signals renormalization when neighbors collapse', () => {
    expect(positionBetween(1, 1)).toBeNull()
    expect(positionBetween(1, 1.0000001)).toBeNull()
  })
})

describe('renormalize', () => {
  it('re-spaces a column to whole gaps, preserving order, immutably', () => {
    const crowded = [
      card({ id: 'a', position: 1 }),
      card({ id: 'b', position: 1.0000001 }),
      card({ id: 'c', position: 1.0000002 }),
    ]
    const out = renormalize(crowded)
    expect(out.map((c) => c.position)).toEqual([POSITION_GAP, 2 * POSITION_GAP, 3 * POSITION_GAP])
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(crowded[0].position).toBe(1)
  })
})

describe('appendPosition', () => {
  it('starts an empty column at one gap and appends after the tail', () => {
    expect(appendPosition([], 'todo')).toBe(POSITION_GAP)
    const cards = [card({ id: 'a', position: 3 * POSITION_GAP })]
    expect(appendPosition(cards, 'todo')).toBe(4 * POSITION_GAP)
    expect(appendPosition(cards, 'done')).toBe(POSITION_GAP)
  })
})

describe('moveCardInList', () => {
  const AT = '2026-07-03T01:00:00.000Z'
  const board = [
    card({ id: 'a', status: 'todo', position: POSITION_GAP }),
    card({ id: 'b', status: 'todo', position: 2 * POSITION_GAP }),
    card({ id: 'r', status: 'in_review', position: POSITION_GAP }),
    card({ id: 'run', status: 'in_progress', position: POSITION_GAP }),
  ]

  it('moves a card across columns at the requested index', () => {
    const next = moveCardInList(board, 'a', 'in_review', 0, 'user', AT)
    const moved = next.find((c) => c.id === 'a')
    expect(moved?.status).toBe('in_review')
    expect(moved?.position).toBeLessThan(POSITION_GAP)
    expect(moved?.updatedAt).toBe(AT)
    expect(board.find((c) => c.id === 'a')?.status).toBe('todo')
  })

  it('allows a same-column reorder without a canMove transition', () => {
    const next = moveCardInList(board, 'b', 'todo', 0, 'user', AT)
    const column = assembleBoard(next).find((c) => c.status === 'todo')
    expect(column?.cards.map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('refuses a user drag out of in_progress but obeys the service', () => {
    expect(() => moveCardInList(board, 'run', 'in_review', 0, 'user', AT)).toThrow(/swarm itself/)
    const next = moveCardInList(board, 'run', 'in_review', 0, 'service', AT)
    expect(next.find((c) => c.id === 'run')?.status).toBe('in_review')
  })

  it('throws for an unknown card', () => {
    expect(() => moveCardInList(board, 'ghost', 'todo', 0, 'user', AT)).toThrow(/not found/)
  })

  it('renormalizes a collapsed destination column and still lands the card', () => {
    const crowded = [
      card({ id: 'x', status: 'in_review', position: 1 }),
      card({ id: 'y', status: 'in_review', position: 1 + 1e-9 }),
      card({ id: 'mover', status: 'todo', position: POSITION_GAP }),
    ]
    const next = moveCardInList(crowded, 'mover', 'in_review', 1, 'user', AT)
    const column = assembleBoard(next).find((c) => c.status === 'in_review')
    expect(column?.cards.map((c) => c.id)).toEqual(['x', 'mover', 'y'])
    const positions = column!.cards.map((c) => c.position)
    expect(new Set(positions).size).toBe(3)
  })

  it('clamps an out-of-range index to the end of the column', () => {
    const next = moveCardInList(board, 'a', 'in_review', 99, 'user', AT)
    const column = assembleBoard(next).find((c) => c.status === 'in_review')
    expect(column?.cards.map((c) => c.id)).toEqual(['r', 'a'])
  })
})

describe('cardBranch', () => {
  it('builds swarm/<slug>-<id-tail> from the title', () => {
    expect(cardBranch('Fix the Flaky  Test!', 'card_a1b2c3d4')).toBe('swarm/fix-the-flaky-test-c3d4')
  })

  it('survives an all-symbol title', () => {
    expect(cardBranch('!!! ???', 'card_a1b2c3d4')).toBe('swarm/card-c3d4')
  })

  it('caps slug length', () => {
    const branch = cardBranch('x'.repeat(200), 'card_a1b2c3d4')
    expect(branch.length).toBeLessThanOrEqual('swarm/'.length + 40 + 5)
  })
})
