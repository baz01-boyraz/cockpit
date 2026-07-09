import { beforeEach, describe, expect, it } from 'vitest'
import { SwarmService, type WorkerSpawner } from '../electron/main/services/SwarmService'
import type { AuditLogService } from '../electron/main/services/AuditLogService'
import type { CouncilSessionReader } from '../electron/main/services/SwarmService'
import type { PruneSummary } from '../electron/main/services/SwarmWorktrees'
import { CockpitEvents } from '../electron/main/events'
import { POSITION_GAP } from '../shared/kanban'
import type { CouncilResult } from '../shared/council'
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

interface AuditRecord {
  actionType: string
  payload?: Record<string, unknown>
}

/** Minimal row store covering board()/moveCard/removeCard/ctor statements. */
function makeStore(seed: Partial<Row>[]) {
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
      if (sql.includes('DISTINCT project_id')) return []
      if (sql.includes(`status = 'in_progress'`)) return []
      return rows.filter((r) => r.project_id === args[0]).map((r) => ({ ...r }))
    },
    get: (_sql, args) => {
      const r = rows.find((x) => x.id === args[0] && x.project_id === args[1])
      return r ? { ...r } : undefined
    },
    run: (sql, args) => {
      if (sql.startsWith('DELETE')) {
        const at = rows.findIndex((r) => r.id === args[0])
        if (at >= 0) rows.splice(at, 1)
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

function makeAudit() {
  const records: AuditRecord[] = []
  const audit = {
    record: (input: { actionType: string; payload?: Record<string, unknown> }) => {
      records.push({ actionType: input.actionType, payload: input.payload })
      return {} as never
    },
  } as unknown as AuditLogService
  return { audit, records }
}

/** Council reader returning an approved verdict for `s1`, null for anything else. */
const councilSessions: CouncilSessionReader = {
  get: (id) =>
    id === 's1'
      ? {
          projectId: 'p1',
          result: { specVerdict: { kind: 'approved', questions: [] } } as unknown as CouncilResult,
        }
      : null,
}

const noopTerminals: WorkerSpawner = {
  create: () => ({ id: 'term', projectId: 'p1' }) as TerminalSession,
  kill: () => {},
}
const memory = { list: () => ({ notes: [], unresolved: [] }), listHooks: () => [] }
const projects = { get: () => ({ path: '/proj' }) }
const worktrees = {
  create: async () => ({ path: '/p', branch: 'b' }),
  removeIfClean: async () => {},
  exists: () => true,
  restore: async (_p: string, path: string, branch: string) => ({ path, branch }),
  prune: async (): Promise<PruneSummary> => ({ pruned: [], keptDirty: [], keptLive: [], branchesDeleted: [] }),
}

function build(store: ReturnType<typeof makeStore>, audit: AuditLogService) {
  return new SwarmService(
    store.db,
    noopTerminals,
    memory as never,
    audit,
    new CockpitEvents(),
    projects,
    worktrees,
    undefined,
    undefined,
    undefined,
    councilSessions,
  )
}

const fateEvents = (records: AuditRecord[]) =>
  records.filter((r) => r.actionType.startsWith('swarm.card_'))

describe('SwarmService Track G1 terminal-fate events', () => {
  let store: ReturnType<typeof makeStore>
  let audit: ReturnType<typeof makeAudit>

  beforeEach(() => {
    store = makeStore([
      { id: 'gated_review', status: 'in_review', position: POSITION_GAP, council_session_id: 's1' },
      { id: 'dangling_review', status: 'in_review', position: 2 * POSITION_GAP, council_session_id: 's_gone' },
      { id: 'ungated_todo', status: 'todo', position: 3 * POSITION_GAP },
      { id: 'plain_todo', status: 'todo', position: 4 * POSITION_GAP },
      { id: 'done_card', status: 'done', position: POSITION_GAP },
    ])
    audit = makeAudit()
  })

  it('moveCard In review → Done emits swarm.card_shipped with the linked spec verdict', () => {
    const svc = build(store, audit.audit)
    svc.moveCard({ projectId: 'p1', cardId: 'gated_review', to: 'done', index: 0 })
    const events = fateEvents(audit.records)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      actionType: 'swarm.card_shipped',
      payload: {
        cardId: 'gated_review',
        councilSessionId: 's1',
        wasCouncilGated: true,
        specVerdictKind: 'approved',
      },
    })
  })

  it('does NOT emit swarm.card_reworked on the In review → Done transition (ship, not rework)', () => {
    const svc = build(store, audit.audit)
    svc.moveCard({ projectId: 'p1', cardId: 'gated_review', to: 'done', index: 0 })
    expect(fateEvents(audit.records).map((e) => e.actionType)).toEqual(['swarm.card_shipped'])
  })

  it('moveCard To do → Done also emits swarm.card_shipped (entering Done from any column)', () => {
    const svc = build(store, audit.audit)
    svc.moveCard({ projectId: 'p1', cardId: 'plain_todo', to: 'done', index: 0 })
    const events = fateEvents(audit.records)
    expect(events).toHaveLength(1)
    expect(events[0].actionType).toBe('swarm.card_shipped')
    expect(events[0].payload).toMatchObject({ wasCouncilGated: false, specVerdictKind: null })
  })

  it('moveCard In review → To do (an earlier column) emits swarm.card_reworked, not shipped', () => {
    const svc = build(store, audit.audit)
    svc.moveCard({ projectId: 'p1', cardId: 'gated_review', to: 'todo', index: 0 })
    const events = fateEvents(audit.records)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      actionType: 'swarm.card_reworked',
      payload: { cardId: 'gated_review', councilSessionId: 's1' },
    })
  })

  it('reads specVerdictKind null for a dangling council_session_id without crashing', () => {
    const svc = build(store, audit.audit)
    svc.moveCard({ projectId: 'p1', cardId: 'dangling_review', to: 'done', index: 0 })
    expect(fateEvents(audit.records)[0].payload).toEqual({
      cardId: 'dangling_review',
      councilSessionId: 's_gone',
      wasCouncilGated: true,
      specVerdictKind: null,
    })
  })

  it('removeCard on a not-shipped card emits swarm.card_abandoned with the prior status', async () => {
    const svc = build(store, audit.audit)
    await svc.removeCard({ projectId: 'p1', cardId: 'ungated_todo' })
    const events = fateEvents(audit.records)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      actionType: 'swarm.card_abandoned',
      payload: {
        cardId: 'ungated_todo',
        councilSessionId: null,
        wasCouncilGated: false,
        priorStatus: 'todo',
      },
    })
  })

  it('removeCard on a shipped (Done) card emits NO abandonment', async () => {
    const svc = build(store, audit.audit)
    await svc.removeCard({ projectId: 'p1', cardId: 'done_card' })
    expect(fateEvents(audit.records)).toHaveLength(0)
  })
})
