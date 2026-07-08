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
  council_session_id: string | null
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
    council_session_id: null,
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
          council_session_id: p.councilSessionId === null || p.councilSessionId === undefined ? null : String(p.councilSessionId),
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
          r.council_session_id =
            p.councilSessionId === null || p.councilSessionId === undefined
              ? null
              : String(p.councilSessionId)
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

  it('createCard surfaces a clear error instead of a raw FK message for an unknown project', () => {
    const { db } = makeRecordingDb({
      run: (sql) => {
        if (sql.startsWith('INSERT')) {
          throw Object.assign(new Error('FOREIGN KEY constraint failed'), {
            code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
          })
        }
        return { changes: 1 }
      },
    })
    const svcWithBadDb = build({ db, rows: [] }, makeDeps())
    expect(() => svcWithBadDb.createCard({ projectId: 'missing', title: 'x' })).toThrow(
      /not a registered cockpit project/,
    )
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
    deps.events.emitTyped('terminal:exit', {
      sessionId: 'term_1',
      projectId: 'p1',
      role: 'claude',
      exitCode: 0,
      signal: null,
    })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_review')
    expect(deps.audits).toContain('swarm.card_exited')
  })

  it('parkCard leaves Running first, then kills the worker — the exit is ignored', async () => {
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    svc.parkCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.killed).toEqual(['term_1'])
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('parked')
    deps.events.emitTyped('terminal:exit', {
      sessionId: 'term_1',
      projectId: 'p1',
      role: 'claude',
      exitCode: 143,
      signal: null,
    })
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
    deps.events.emitTyped('terminal:exit', {
      sessionId: 'term_1',
      projectId: 'p1',
      role: 'claude',
      exitCode: 0,
      signal: null,
    })
    deps.worktrees.removeIfClean.mockRejectedValueOnce(new Error('uncommitted changes'))
    await expect(svc.removeCard({ projectId: 'p1', cardId: 'a' })).rejects.toThrow(/uncommitted/)
    expect(store.rows.some((r) => r.id === 'a')).toBe(true)
    await svc.removeCard({ projectId: 'p1', cardId: 'a' })
    expect(store.rows.some((r) => r.id === 'a')).toBe(false)
    expect(deps.wtCalls).toContain('remove:/proj/.cockpit-worktrees/a')
  })

  it('ignores exits of terminals that are not linked to a running card', () => {
    deps.events.emitTyped('terminal:exit', {
      sessionId: 'term_ghost',
      projectId: 'p1',
      role: 'claude',
      exitCode: 1,
      signal: null,
    })
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

  it('folds a legacy card role + persona onto the taxonomy in the worker prompt', async () => {
    const store = seed()
    const deps = makeDeps()
    const svc = build(store, deps)
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    // reviewer + security-paranoid → Reviewer·Security in the canonical taxonomy.
    expect(deps.spawned[0].command).toContain('REVIEWER')
    expect(deps.spawned[0].command).toContain('Domain: SECURITY')
  })
})

describe('SwarmService council brief (Faz 2a)', () => {
  const councilResult = () =>
    ({
      ok: true,
      mode: 'spec',
      seats: [
        { id: 'builder', label: 'Builder', engine: { engine: 'claude', model: 'opus' }, usedFallback: false, text: 'Effort M; watch the retry backoff.', ok: true },
        { id: 'contrarian', label: 'Contrarian', engine: { engine: 'claude', model: 'opus' }, usedFallback: false, text: 'The webhook has no idempotency key.', ok: true },
      ],
      rankings: [],
      aggregate: [],
      labelToSeat: {},
      verdict: '### 📋 Refined Spec\n**Goal** Wire the intake to the CRM webhook.',
      specVerdict: { kind: 'approved', questions: [] },
      error: null,
      stats: { seatsRun: 2, seatsFailed: 0, filesReviewed: 0, durationMs: 5 },
      sessionId: 'sess_9',
    }) as never

  const buildWithCouncil = (
    store: ReturnType<typeof makeStore>,
    deps: ReturnType<typeof makeDeps>,
    councilSessions: { get: (id: string) => { projectId: string; result: unknown } | null },
  ) =>
    new SwarmService(
      store.db,
      deps.terminals,
      deps.memory,
      deps.audit,
      deps.events,
      deps.projects,
      deps.worktrees,
      undefined,
      undefined,
      deps.doneSignal,
      councilSessions as never,
    )

  it('rides the approved session into the worker opening prompt and flags it on the audit', async () => {
    const store = makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP, title: 'CRM webhook', council_session_id: 'sess_9' }])
    const deps = makeDeps()
    const svc = buildWithCouncil(store, deps, {
      get: (id) => (id === 'sess_9' ? { projectId: 'p1', result: councilResult() } : null),
    })
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned[0].command).toContain('COUNCIL BRIEF')
    expect(deps.spawned[0].command).toContain('Wire the intake to the CRM webhook')
    expect(deps.spawned[0].command).toContain('Builder seat notes')
    expect(deps.spawned[0].command).toContain('Sharpest objection (Contrarian)')
    const start = deps.audit.record as unknown as ReturnType<typeof vi.fn>
    const payload = start.mock.calls.map((c) => c[0]).find((c) => c.actionType === 'swarm.start_card')
    expect(payload.payload.councilBrief).toBe(true)
  })

  it('refuses a cross-project session — the brief degrades to none (argos L1)', async () => {
    const store = makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP, council_session_id: 'sess_9' }])
    const deps = makeDeps()
    const svc = buildWithCouncil(store, deps, {
      get: (id) => (id === 'sess_9' ? { projectId: 'OTHER-project', result: councilResult() } : null),
    })
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned).toHaveLength(1)
    expect(deps.spawned[0].command).not.toContain('COUNCIL BRIEF')
  })

  it('degrades to no brief (and never blocks the start) when the session is missing', async () => {
    const store = makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP, council_session_id: 'gone' }])
    const deps = makeDeps()
    const svc = buildWithCouncil(store, deps, { get: () => null })
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned).toHaveLength(1)
    expect(deps.spawned[0].command).not.toContain('COUNCIL BRIEF')
    const rec = deps.audit.record as unknown as ReturnType<typeof vi.fn>
    const payload = rec.mock.calls.map((c) => c[0]).find((c) => c.actionType === 'swarm.start_card')
    expect(payload.payload.councilBrief).toBe(false)
  })

  it('degrades cleanly when the store throws on a corrupt row', async () => {
    const store = makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP, council_session_id: 'corrupt' }])
    const deps = makeDeps()
    const svc = buildWithCouncil(store, deps, {
      get: () => {
        throw new Error('corrupt result_json')
      },
    })
    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(deps.spawned).toHaveLength(1)
    expect(deps.spawned[0].command).not.toContain('COUNCIL BRIEF')
  })

  it('createCard and updateCard persist councilSessionId', () => {
    const store = makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP }])
    const svc = build(store, makeDeps())
    svc.createCard({ projectId: 'p1', title: 'Gated task', councilSessionId: 'sess_new' })
    const created = store.rows.find((r) => r.title === 'Gated task')!
    expect(created.council_session_id).toBe('sess_new')

    svc.updateCard({ projectId: 'p1', cardId: 'a', councilSessionId: 'sess_link' })
    expect(store.rows.find((r) => r.id === 'a')!.council_session_id).toBe('sess_link')
    // Clearing it back to null is representable.
    svc.updateCard({ projectId: 'p1', cardId: 'a', councilSessionId: null })
    expect(store.rows.find((r) => r.id === 'a')!.council_session_id).toBeNull()
  })
})

describe('SwarmService completion report + notify (Faz 2.5)', () => {
  const reviewStub = { diffStat: vi.fn(async () => ({ files: 3, insertions: 42, deletions: 7 })) }

  beforeEach(() => reviewStub.diffStat.mockClear())

  const buildWithReport = (
    store: ReturnType<typeof makeStore>,
    deps: ReturnType<typeof makeDeps>,
    notifier?: (input: { title: string; body: string }) => void,
  ) =>
    new SwarmService(
      store.db,
      deps.terminals,
      deps.memory,
      deps.audit,
      deps.events,
      deps.projects,
      deps.worktrees,
      undefined,
      undefined,
      deps.doneSignal,
      undefined,
      reviewStub,
      notifier,
    )

  it('computes a report on demand: branch, diff stat, acceptance, council flag', async () => {
    const store = makeStore([
      {
        id: 'a',
        status: 'in_review',
        worktree_path: '/proj/wt/a',
        branch: 'swarm/a',
        council_session_id: 'sess-1',
        body: '**Acceptance criteria**\n1. renders\n2. tested',
      },
    ])
    const svc = buildWithReport(store, makeDeps())
    const report = await svc.completionReport('p1', 'a')
    expect(report).toMatchObject({
      cardId: 'a',
      branch: 'swarm/a',
      diffStat: { files: 3, insertions: 42, deletions: 7 },
      acceptance: ['renders', 'tested'],
      hasCouncilSpec: true,
    })
    expect(reviewStub.diffStat).toHaveBeenCalledWith('p1', { dir: '/proj/wt/a' })
  })

  it('returns a null diff stat for a card with no worktree', async () => {
    const store = makeStore([{ id: 'a', status: 'in_review', body: '' }])
    const svc = buildWithReport(store, makeDeps())
    const report = await svc.completionReport('p1', 'a')
    expect(report.diffStat).toBeNull()
    expect(report.acceptance).toEqual([])
    expect(reviewStub.diffStat).not.toHaveBeenCalled()
  })

  it('throws for a missing card', async () => {
    const svc = buildWithReport(makeStore([]), makeDeps())
    await expect(svc.completionReport('p1', 'nope')).rejects.toThrow(/not found/)
  })

  it('fires swarm:cardCompleted and notifies when a worker exit lands a card in review', async () => {
    const store = makeStore([{ id: 'a', status: 'todo', title: 'Add the widget' }])
    const deps = makeDeps()
    const completed: { projectId: string; cardId: string; title: string; summary: string }[] = []
    deps.events.onTyped('swarm:cardCompleted', (e) => completed.push(e))
    const notifier = vi.fn()
    const svc = buildWithReport(store, deps, notifier)

    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    deps.events.emitTyped('terminal:exit', {
      sessionId: 'term_1',
      projectId: 'p1',
      role: 'claude',
      exitCode: 0,
      signal: null,
    })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_review')

    await vi.waitFor(() => expect(notifier).toHaveBeenCalledTimes(1))
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ projectId: 'p1', cardId: 'a', title: 'Add the widget' })
    expect(completed[0].summary).toContain('ready for review')
    expect(notifier.mock.calls[0][0]).toMatchObject({ title: 'Swarm — ready for review' })
    expect(notifier.mock.calls[0][0].body).toBe(completed[0].summary)
  })

  it('a throwing notifier never breaks the transition', async () => {
    const store = makeStore([{ id: 'a', status: 'todo' }])
    const deps = makeDeps()
    const completed: unknown[] = []
    deps.events.onTyped('swarm:cardCompleted', (e) => completed.push(e))
    const notifier = vi.fn(() => {
      throw new Error('no notification host')
    })
    const svc = buildWithReport(store, deps, notifier)

    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    expect(() =>
      deps.events.emitTyped('terminal:exit', {
        sessionId: 'term_1',
        projectId: 'p1',
        role: 'claude',
        exitCode: 0,
        signal: null,
      }),
    ).not.toThrow()
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_review')
    // The event still fanned out before the notifier threw and was swallowed.
    await vi.waitFor(() => expect(completed).toHaveLength(1))
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

describe('SwarmService worker-exit sentinel signal (Faz A)', () => {
  const buildWithSentinel = (
    store: ReturnType<typeof makeStore>,
    deps: ReturnType<typeof makeDeps>,
    sentinel: { report: ReturnType<typeof vi.fn> },
  ) =>
    new SwarmService(
      store.db,
      deps.terminals,
      deps.memory,
      deps.audit,
      deps.events,
      deps.projects,
      deps.worktrees,
      undefined,
      undefined,
      deps.doneSignal,
      undefined,
      undefined,
      undefined,
      sentinel,
    )

  it('raises a notice on a nonzero worker exit; a clean (0) exit stays silent', async () => {
    const store = makeStore([{ id: 'a', status: 'todo', position: POSITION_GAP, title: 'Do the thing' }])
    const deps = makeDeps()
    const sentinel = { report: vi.fn() }
    const svc = buildWithSentinel(store, deps, sentinel)

    await svc.startCard({ projectId: 'p1', cardId: 'a' })
    deps.events.emitTyped('terminal:exit', { sessionId: 'term_1', projectId: 'p1', role: 'claude', exitCode: 2, signal: null })
    expect(store.rows.find((r) => r.id === 'a')!.status).toBe('in_review')
    expect(sentinel.report).toHaveBeenCalledTimes(1)
    const arg = sentinel.report.mock.calls[0][0]
    expect(arg.severity).toBe('notice')
    expect(arg.source).toBe('worker-exit')
    expect(arg.title).toContain('code 2')

    // A second card that exits cleanly must not raise a signal.
    const store2 = makeStore([{ id: 'b', status: 'todo', position: POSITION_GAP, title: 'Clean run' }])
    const deps2 = makeDeps()
    const sentinel2 = { report: vi.fn() }
    const svc2 = buildWithSentinel(store2, deps2, sentinel2)
    await svc2.startCard({ projectId: 'p1', cardId: 'b' })
    deps2.events.emitTyped('terminal:exit', { sessionId: 'term_1', projectId: 'p1', role: 'claude', exitCode: 0, signal: null })
    expect(sentinel2.report).not.toHaveBeenCalled()
  })
})
