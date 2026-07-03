import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SwarmService, type WorkerSpawner } from '../electron/main/services/SwarmService'
import type { AuditLogService } from '../electron/main/services/AuditLogService'
import { CockpitEvents } from '../electron/main/events'
import { POSITION_GAP } from '../shared/kanban'
import type { TerminalSession } from '../shared/domain'
import { makeRecordingDb } from './helpers/fakeDb'

interface Row {
  id: string
  project_id: string
  title: string
  body: string
  status: string
  position: number
  role: string | null
  persona: string | null
  terminal_session_id: string | null
  worktree_path: string | null
  branch: string | null
  created_at: string
  updated_at: string
}

/** Scripted row store: enough SQLite semantics for SwarmService's statements. */
function makeStore(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((over, i) => ({
    id: `card_${i}`,
    project_id: 'p1',
    title: `Card ${i}`,
    body: '',
    status: 'todo',
    position: (i + 1) * POSITION_GAP,
    role: null,
    persona: null,
    terminal_session_id: null,
    worktree_path: null,
    branch: null,
    created_at: 't0',
    updated_at: 't0',
    ...over,
  }))

  const { db } = makeRecordingDb({
    all: (_sql, args) => rows.filter((r) => r.project_id === args[0]).map((r) => ({ ...r })),
    get: (sql, args) => {
      if (sql.includes('terminal_session_id = ?')) {
        const r = rows.find((x) => x.terminal_session_id === args[0] && x.status === 'in_progress')
        return r ? { ...r } : undefined
      }
      const r = rows.find((x) => x.id === args[0] && x.project_id === args[1])
      return r ? { ...r } : undefined
    },
    run: (sql, args) => {
      if (sql.startsWith('INSERT')) {
        const p = args[0] as Record<string, string | number>
        rows.push({
          id: String(p.id),
          project_id: String(p.projectId),
          title: String(p.title),
          body: String(p.body),
          status: 'todo',
          position: Number(p.position),
          role: null,
          persona: null,
          terminal_session_id: null,
          worktree_path: null,
          branch: null,
          created_at: String(p.now),
          updated_at: String(p.now),
        })
      } else if (sql.startsWith('DELETE')) {
        const at = rows.findIndex((r) => r.id === args[0])
        if (at >= 0) rows.splice(at, 1)
      } else if (sql.includes('SET title')) {
        const p = args[0] as Record<string, string | null>
        const r = rows.find((x) => x.id === p.id)
        if (r) {
          r.title = String(p.title)
          r.body = String(p.body)
          r.role = p.role
          r.persona = p.persona
          r.updated_at = String(p.now)
        }
      } else if (sql.includes('SET terminal_session_id')) {
        const r = rows.find((x) => x.id === args[2])
        if (r) {
          r.terminal_session_id = String(args[0])
          r.updated_at = String(args[1])
        }
      } else if (sql.includes('SET status')) {
        const r = rows.find((x) => x.id === args[3])
        if (r) {
          r.status = String(args[0])
          r.position = Number(args[1])
          r.updated_at = String(args[2])
        }
      }
      return { changes: 1 }
    },
  })
  return { db, rows }
}

const columnCards = (svc: SwarmService, status: string) =>
  svc
    .board('p1')
    .find((c) => c.status === status)!
    .cards.map((c) => c.id)

function makeDeps() {
  const spawned: { name?: string; command?: string | null }[] = []
  const terminals: WorkerSpawner = {
    create(input) {
      spawned.push({ name: input.name, command: input.command })
      return { id: `term_${spawned.length}`, projectId: input.projectId } as TerminalSession
    },
  }
  const audits: string[] = []
  const audit = {
    record: vi.fn((input: { actionType: string }) => {
      audits.push(input.actionType)
      return {} as never
    }),
  } as unknown as AuditLogService
  const memory = { list: () => ({ notes: [{ name: 'swarm-design' }], unresolved: [] }) }
  const events = new CockpitEvents()
  return { terminals, spawned, audit, audits, memory: memory as never, events }
}

describe('SwarmService CRUD', () => {
  let store: ReturnType<typeof makeStore>
  let svc: SwarmService

  beforeEach(() => {
    store = makeStore([
      { id: 'a', status: 'todo', position: POSITION_GAP },
      { id: 'b', status: 'todo', position: 2 * POSITION_GAP },
      { id: 'run', status: 'in_progress', position: POSITION_GAP },
      { id: 'r', status: 'in_review', position: POSITION_GAP },
    ])
    const deps = makeDeps()
    svc = new SwarmService(store.db, deps.terminals, deps.memory, deps.audit, deps.events)
  })

  it('board() assembles all five columns from rows', () => {
    const board = svc.board('p1')
    expect(board.map((c) => c.status)).toEqual(['todo', 'in_progress', 'in_review', 'done', 'parked'])
    expect(columnCards(svc, 'todo')).toEqual(['a', 'b'])
  })

  it('createCard appends to the end of todo and returns the fresh board', () => {
    const board = svc.createCard({ projectId: 'p1', title: 'New task' })
    const todo = board.find((c) => c.status === 'todo')!
    expect(todo.cards).toHaveLength(3)
    expect(todo.cards[2].title).toBe('New task')
    expect(todo.cards[2].position).toBe(3 * POSITION_GAP)
  })

  it('updateCard patches only the provided fields', () => {
    svc.updateCard({ projectId: 'p1', cardId: 'a', title: 'Renamed', role: 'builder' })
    const row = store.rows.find((r) => r.id === 'a')!
    expect(row.title).toBe('Renamed')
    expect(row.role).toBe('builder')
    expect(row.body).toBe('')
  })

  it('moveCard lets the user drag between human columns', () => {
    svc.moveCard({ projectId: 'p1', cardId: 'a', to: 'in_review', index: 0 })
    expect(columnCards(svc, 'in_review')).toEqual(['a', 'r'])
    expect(columnCards(svc, 'todo')).toEqual(['b'])
  })

  it('moveCard refuses to drag a running card out (kernel rule reaches the DB layer)', () => {
    expect(() => svc.moveCard({ projectId: 'p1', cardId: 'run', to: 'done', index: 0 })).toThrow(
      /swarm itself/,
    )
    expect(store.rows.find((r) => r.id === 'run')!.status).toBe('in_progress')
  })

  it('moveCard throws for a card from another project', () => {
    store.rows.push({ ...store.rows[0], id: 'foreign', project_id: 'p2' })
    expect(() => svc.moveCard({ projectId: 'p1', cardId: 'foreign', to: 'done', index: 0 })).toThrow(
      /not found/,
    )
  })

  it('removeCard deletes an idle card but refuses a running one', () => {
    svc.removeCard({ projectId: 'p1', cardId: 'a' })
    expect(store.rows.some((r) => r.id === 'a')).toBe(false)
    expect(() => svc.removeCard({ projectId: 'p1', cardId: 'run' })).toThrow(/kill or park/)
    expect(store.rows.some((r) => r.id === 'run')).toBe(true)
  })
})

describe('SwarmService startCard + worker exit (6.2)', () => {
  let store: ReturnType<typeof makeStore>
  let deps: ReturnType<typeof makeDeps>
  let svc: SwarmService

  beforeEach(() => {
    store = makeStore([
      { id: 'a', status: 'todo', position: POSITION_GAP, title: 'Fix the form' },
      { id: 'p', status: 'parked', position: POSITION_GAP },
      { id: 'd', status: 'done', position: POSITION_GAP },
    ])
    deps = makeDeps()
    svc = new SwarmService(store.db, deps.terminals, deps.memory, deps.audit, deps.events)
  })

  it('spawns a claude worker, links the session, and moves the card to Running', () => {
    svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned).toHaveLength(1)
    expect(deps.spawned[0].name).toBe('Swarm — Fix the form')
    expect(deps.spawned[0].command).toContain(`claude '`)
    expect(deps.spawned[0].command).toContain('Fix the form')
    expect(deps.spawned[0].command).toContain('.cockpit-memory/swarm-design.md')
    const row = store.rows.find((r) => r.id === 'a')!
    expect(row.status).toBe('in_progress')
    expect(row.terminal_session_id).toBe('term_1')
    expect(deps.audits).toContain('swarm.start_card')
  })

  it('starts a parked card too, but never a done one', () => {
    svc.startCard({ projectId: 'p1', cardId: 'p' })
    expect(store.rows.find((r) => r.id === 'p')!.status).toBe('in_progress')
    expect(() => svc.startCard({ projectId: 'p1', cardId: 'd' })).toThrow(/To do or Parked/)
  })

  it('refuses a second concurrent run (6.2 parallelism = 1)', () => {
    svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(() => svc.startCard({ projectId: 'p1', cardId: 'p' })).toThrow(/already running/)
    expect(deps.spawned).toHaveLength(1)
  })

  it('moves the card to In review when its worker exits', () => {
    svc.startCard({ projectId: 'p1', cardId: 'a' })
    deps.events.emitTyped('terminal:exit', { sessionId: 'term_1', exitCode: 0, signal: null })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_review')
    expect(deps.audits).toContain('swarm.card_exited')
  })

  it('ignores exits of terminals that are not linked to a running card', () => {
    deps.events.emitTyped('terminal:exit', { sessionId: 'term_ghost', exitCode: 1, signal: null })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('todo')
  })

  it('spawns with an empty pointer list when the hub is unreadable', () => {
    const broken = makeDeps()
    const svc2 = new SwarmService(
      store.db,
      broken.terminals,
      { list: () => { throw new Error('no hub') } } as never,
      broken.audit,
      broken.events,
    )
    svc2.startCard({ projectId: 'p1', cardId: 'a' })
    expect(broken.spawned[0].command).not.toContain('.cockpit-memory')
  })
})
