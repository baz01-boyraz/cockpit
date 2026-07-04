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
  agent: string | null
  assignments: string
  pipeline_step: number
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
    agent: null,
    assignments: '[]',
    pipeline_step: 0,
    terminal_session_id: null,
    worktree_path: null,
    branch: null,
    created_at: 't0',
    updated_at: 't0',
    ...over,
  }))

  const { db } = makeRecordingDb({
    all: (sql, args) => {
      if (sql.includes(`status = 'in_progress'`) && !args.length) {
        return rows.filter((r) => r.status === 'in_progress').map((r) => ({ ...r }))
      }
      return rows.filter((r) => r.project_id === args[0]).map((r) => ({ ...r }))
    },
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
          agent: null,
          assignments: '[]',
          pipeline_step: 0,
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
        const p = args[0] as Record<string, string | number | null>
        const r = rows.find((x) => x.id === p.id)
        if (r) {
          r.title = String(p.title)
          r.body = String(p.body)
          r.role = p.role as string | null
          r.persona = p.persona as string | null
          r.agent = p.agent as string | null
          r.assignments = String(p.assignments)
          r.pipeline_step = Number(p.step)
          r.updated_at = String(p.now)
        }
      } else if (sql.includes('SET terminal_session_id') && sql.includes('worktree_path')) {
        // startCard: session, worktree, branch, assignments, pipeline_step, now, id
        const r = rows.find((x) => x.id === args[6])
        if (r) {
          r.terminal_session_id = String(args[0])
          r.worktree_path = args[1] === null ? null : String(args[1])
          r.branch = args[2] === null ? null : String(args[2])
          r.assignments = String(args[3])
          r.pipeline_step = Number(args[4])
          r.updated_at = String(args[5])
        }
      } else if (sql.includes('SET terminal_session_id')) {
        // pipeline advance: session, pipeline_step, now, id
        const r = rows.find((x) => x.id === args[3])
        if (r) {
          r.terminal_session_id = String(args[0])
          r.pipeline_step = Number(args[1])
          r.updated_at = String(args[2])
        }
      } else if (sql.includes(`SET status = 'parked'`)) {
        const r = rows.find((x) => x.id === args[1])
        if (r) {
          r.status = 'parked'
          r.updated_at = String(args[0])
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
  const spawned: { name?: string; command?: string | null; cwd?: string }[] = []
  const killed: string[] = []
  const terminals: WorkerSpawner = {
    create(input) {
      spawned.push({ name: input.name, command: input.command, cwd: input.cwd })
      return { id: `term_${spawned.length}`, projectId: input.projectId } as TerminalSession
    },
    kill(sessionId) {
      killed.push(sessionId)
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
  const projects = { get: () => ({ path: '/proj' }) }
  const wtCalls: string[] = []
  const worktrees = {
    create: vi.fn(async (_p: string, title: string, cardId: string) => {
      wtCalls.push(`create:${cardId}`)
      return { path: `/proj/.cockpit-worktrees/${cardId}`, branch: `swarm/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${cardId.slice(-4)}` }
    }),
    removeIfClean: vi.fn(async (_p: string, path: string) => {
      wtCalls.push(`remove:${path}`)
    }),
  }
  // Fake turn-finished channel: `signalled` stands in for the sentinel files.
  const signalled = new Set<string>()
  const armed: string[] = []
  const doneSignal = {
    arm: vi.fn((_p: string, worktreePath: string) => {
      armed.push(worktreePath)
      signalled.delete(worktreePath)
    }),
    consume: vi.fn((worktreePath: string) => signalled.delete(worktreePath)),
  }
  return { terminals, spawned, killed, audit, audits, memory: memory as never, events, projects, worktrees, wtCalls, doneSignal, signalled, armed }
}

const build = (store: ReturnType<typeof makeStore>, deps: ReturnType<typeof makeDeps>) =>
  new SwarmService(store.db, deps.terminals, deps.memory, deps.audit, deps.events, deps.projects, deps.worktrees, undefined, undefined, deps.doneSignal)

describe('SwarmService CRUD', () => {
  let store: ReturnType<typeof makeStore>
  let svc: SwarmService

  beforeEach(() => {
    store = makeStore([
      { id: 'a', status: 'todo', position: POSITION_GAP },
      { id: 'b', status: 'todo', position: 2 * POSITION_GAP },
      { id: 'r', status: 'in_review', position: POSITION_GAP },
    ])
    svc = build(store, makeDeps())
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

  it('moveCard throws for a card from another project', () => {
    store.rows.push({ ...store.rows[0], id: 'foreign', project_id: 'p2' })
    expect(() => svc.moveCard({ projectId: 'p1', cardId: 'foreign', to: 'done', index: 0 })).toThrow(
      /not found/,
    )
  })

  it('removeCard deletes an idle card', async () => {
    await svc.removeCard({ projectId: 'p1', cardId: 'a' })
    expect(store.rows.some((r) => r.id === 'a')).toBe(false)
  })
})

describe('SwarmService startCard / worktrees / park / exit (6.2–6.4)', () => {
  let store: ReturnType<typeof makeStore>
  let deps: ReturnType<typeof makeDeps>
  let svc: SwarmService

  beforeEach(() => {
    store = makeStore([
      { id: 'a', status: 'todo', position: POSITION_GAP, title: 'Fix the form' },
      { id: 'b', status: 'todo', position: 2 * POSITION_GAP },
      { id: 'c', status: 'todo', position: 3 * POSITION_GAP },
      { id: 'e', status: 'todo', position: 4 * POSITION_GAP },
      { id: 'p', status: 'parked', position: POSITION_GAP },
      { id: 'd', status: 'done', position: POSITION_GAP },
    ])
    deps = makeDeps()
    svc = build(store, deps)
  })

  it('spawns a claude worker in a fresh worktree and moves the card to Running', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned).toHaveLength(1)
    // The unassigned card is auto-routed at Start: "Fix the form" → a Fixer,
    // and the picked role rides the worker name and prompt.
    expect(deps.spawned[0].name).toBe('Swarm — Fixer·Frontend: Fix the form')
    expect(deps.spawned[0].command).toContain(`claude '`)
    expect(deps.spawned[0].command).toContain('Your role: FIXER')
    expect(deps.spawned[0].command).toContain('.cockpit-memory/swarm-design.md')
    expect(deps.spawned[0].cwd).toBe('/proj/.cockpit-worktrees/a')
    const row = store.rows.find((r) => r.id === 'a')!
    expect(row.status).toBe('in_progress')
    expect(row.terminal_session_id).toBe('term_1')
    expect(row.worktree_path).toBe('/proj/.cockpit-worktrees/a')
    expect(row.branch).toMatch(/^swarm\/fix-the-form/)
    // Auto-assignment is persisted so the board and any resume see the pipeline.
    expect(JSON.parse(row.assignments)).toEqual([{ role: 'fixer', spec: 'frontend' }])
    expect(deps.audits).toContain('swarm.start_card')
  })

  it('reuses an existing worktree on resume and never starts a done card', async () => {
    store.rows.find((r) => r.id === 'p')!.worktree_path = '/proj/.cockpit-worktrees/old'
    store.rows.find((r) => r.id === 'p')!.branch = 'swarm/old-1234'
    await svc.startCard({ projectId: 'p1', cardId: 'p' })
    expect(deps.worktrees.create).not.toHaveBeenCalled()
    expect(deps.spawned[0].cwd).toBe('/proj/.cockpit-worktrees/old')
    await expect(svc.startCard({ projectId: 'p1', cardId: 'd' })).rejects.toThrow(/To do or Parked/)
  })

  it('allows 3 concurrent cards and refuses the 4th (plan D6)', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    await svc.startCard({ projectId: 'p1', cardId: 'b' })
    await svc.startCard({ projectId: 'p1', cardId: 'c' })
    await expect(svc.startCard({ projectId: 'p1', cardId: 'e' })).rejects.toThrow(/Concurrency cap/)
    expect(deps.spawned).toHaveLength(3)
  })

  it('falls back to the project root when worktree creation fails', async () => {
    deps.worktrees.create.mockRejectedValueOnce(new Error('not a git repo'))
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned[0].cwd).toBeUndefined()
    expect(store.rows.find((r) => r.id === 'a')!.worktree_path).toBeNull()
  })

  it('moves the card to In review when its worker exits', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    deps.events.emitTyped('terminal:exit', { sessionId: 'term_1', exitCode: 0, signal: null })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_review')
    expect(deps.audits).toContain('swarm.card_exited')
  })

  it('parkCard leaves Running first, then kills the worker — the exit is ignored', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    svc.parkCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.killed).toEqual(['term_1'])
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('parked')
    deps.events.emitTyped('terminal:exit', { sessionId: 'term_1', exitCode: 143, signal: null })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('parked')
  })

  it('user cannot drag a running card out; removeCard also refuses it', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(() => svc.moveCard({ projectId: 'p1', cardId: 'a', to: 'done', index: 0 })).toThrow(
      /swarm itself/,
    )
    await expect(svc.removeCard({ projectId: 'p1', cardId: 'a' })).rejects.toThrow(/kill or park/)
  })

  it('removeCard cleans the worktree first and aborts when it is dirty', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    deps.events.emitTyped('terminal:exit', { sessionId: 'term_1', exitCode: 0, signal: null })
    deps.worktrees.removeIfClean.mockRejectedValueOnce(new Error('uncommitted changes'))
    await expect(svc.removeCard({ projectId: 'p1', cardId: 'a' })).rejects.toThrow(/uncommitted/)
    expect(store.rows.some((r) => r.id === 'a')).toBe(true)
    await svc.removeCard({ projectId: 'p1', cardId: 'a' })
    expect(store.rows.some((r) => r.id === 'a')).toBe(false)
    expect(deps.wtCalls).toContain('remove:/proj/.cockpit-worktrees/a')
  })

  it('ignores exits of terminals that are not linked to a running card', () => {
    deps.events.emitTyped('terminal:exit', { sessionId: 'term_ghost', exitCode: 1, signal: null })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('todo')
  })

  it('arms the done signal for the worktree before the worker spawns', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.armed).toEqual(['/proj/.cockpit-worktrees/a'])
    // No worktree (fallback run) → nothing to arm.
    deps.worktrees.create.mockRejectedValueOnce(new Error('not a git repo'))
    await svc.startCard({ projectId: 'p1', cardId: 'b' })
    expect(deps.armed).toHaveLength(1)
  })

  it('a turn-finished signal moves the Running card to In review; the terminal stays alive', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    deps.signalled.add('/proj/.cockpit-worktrees/a')

    svc.board('p1')
    const row = store.rows.find((r) => r.id === 'a')!
    expect(row.status).toBe('in_review')
    expect(deps.killed).toEqual([])
    expect(deps.audits).toContain('swarm.card_done_signal')

    // The signal was spent — the next board read does not move anything.
    svc.board('p1')
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_review')
  })

  it('advances a multi-step pipeline in place on each turn signal; review only after the last', async () => {
    store.rows.find((r) => r.id === 'a')!.assignments = JSON.stringify([
      { role: 'builder', spec: 'backend' },
      { role: 'reviewer', spec: 'security' },
    ])
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned[0].name).toBe('Swarm — Builder·Backend: Fix the form')
    const wt = '/proj/.cockpit-worktrees/a'

    // First turn-finished → advance to the Reviewer step in the SAME worktree,
    // retire the builder, and keep the card Running (no human touch).
    deps.signalled.add(wt)
    svc.board('p1')
    let row = store.rows.find((r) => r.id === 'a')!
    expect(row.status).toBe('in_progress')
    expect(row.pipeline_step).toBe(1)
    expect(deps.killed).toEqual(['term_1'])
    expect(deps.spawned).toHaveLength(2)
    expect(deps.spawned[1].name).toBe('Swarm — Reviewer·Security: Fix the form')
    expect(deps.audits).toContain('swarm.pipeline_advance')

    // Second turn-finished → last step done → In review, no further spawn.
    deps.signalled.add(wt)
    svc.board('p1')
    row = store.rows.find((r) => r.id === 'a')!
    expect(row.status).toBe('in_review')
    expect(deps.spawned).toHaveLength(2)
  })

  it('a late signal for a card no longer Running is consumed and ignored', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    svc.parkCard({ projectId: 'p1', cardId: 'a' })
    deps.signalled.add('/proj/.cockpit-worktrees/a')

    svc.board('p1')
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('parked')
    expect(deps.signalled.has('/proj/.cockpit-worktrees/a')).toBe(false)
  })

  it('without a signal the card stays Running across board reads', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    svc.board('p1')
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_progress')
  })
})

describe('SwarmService quota gate (6.6)', () => {
  const seed = () => makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP, role: 'reviewer', persona: 'security-paranoid' }])

  it('refuses a start when a Claude window is exhausted; unavailable/failing probes never block', async () => {
    const store = seed()
    const deps = makeDeps()
    const usage = (percent: number, available = true) => ({
      getReport: async () => ({
        providers: [
          { provider: 'claude' as const, label: 'Claude', available, plan: null, windows: [{ label: '5h', usedPercent: percent, resetAt: null }], reason: null, fetchedAt: '' },
        ],
      }),
    })
    const blocked = new SwarmService(store.db, deps.terminals, deps.memory, deps.audit, deps.events, deps.projects, deps.worktrees, usage(100) as never)
    await expect(blocked.startCard({ projectId: 'p1', cardId: 'a' })).rejects.toThrow(/exhausted/)

    const warm = new SwarmService(seed().db, deps.terminals, deps.memory, deps.audit, deps.events, deps.projects, deps.worktrees, usage(85) as never)
    await expect(warm.startCard({ projectId: 'p1', cardId: 'a' })).resolves.toBeTruthy()

    const offline = new SwarmService(seed().db, deps.terminals, deps.memory, deps.audit, deps.events, deps.projects, deps.worktrees, usage(100, false) as never)
    await expect(offline.startCard({ projectId: 'p1', cardId: 'a' })).resolves.toBeTruthy()

    const broken = new SwarmService(seed().db, deps.terminals, deps.memory, deps.audit, deps.events, deps.projects, deps.worktrees, { getReport: async () => { throw new Error('probe down') } } as never)
    await expect(broken.startCard({ projectId: 'p1', cardId: 'a' })).resolves.toBeTruthy()
  })

  it('an assigned Named Agent speaks with its authored voice (N3)', async () => {
    const store = makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP, agent: 'vulcan', title: 'API work' }])
    const deps = makeDeps()
    const named = {
      find: (_pid: string, slug: string) =>
        slug === 'vulcan'
          ? {
              slug: 'vulcan', description: '', model: 'sonnet', displayName: 'Vulcan',
              tagline: null, color: 'copper', role: 'builder', persona: 'type-zealot',
              body: 'You are Vulcan - the forge god.',
            }
          : null,
    }
    const svc = new SwarmService(store.db, deps.terminals, deps.memory, deps.audit, deps.events, deps.projects, deps.worktrees, undefined, named as never)
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned[0].command).toContain('forge god')
    expect(deps.spawned[0].command).toContain('--model sonnet')
    expect(deps.spawned[0].command).toContain('BUILDER')
    expect(deps.spawned[0].name).toBe('Swarm — Vulcan: API work')
  })

  it('folds the card role + persona into the worker prompt (6.5)', async () => {
    const store = seed()
    const deps = makeDeps()
    const svc = build(store, deps)
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned[0].command).toContain('REVIEWER')
    expect(deps.spawned[0].command).toContain('security veteran')
  })
})

describe('SwarmService boot orphan reconcile (6.4)', () => {
  it('parks cards left in_progress by a dead app instance, with an audit entry', () => {
    const store = makeStore([
      { id: 'orphan', status: 'in_progress', position: POSITION_GAP, terminal_session_id: 'term_old' },
      { id: 'ok', status: 'todo', position: POSITION_GAP },
    ])
    const deps = makeDeps()
    build(store, deps)
    expect(store.rows.find((r) => r.id === 'orphan')!.status).toBe('parked')
    expect(store.rows.find((r) => r.id === 'ok')!.status).toBe('todo')
    expect(deps.audits).toContain('swarm.card_orphaned')
  })
})
